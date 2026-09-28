// ABOUTME: Core of emditor. It builds the HTTP router that serves the embedded web app
// ABOUTME: and the JSON API for the Markdown files of one folder, their notes, the folder's writing rules, and rewrites.

mod rewrite;

pub use rewrite::{Provider, RewriteConfig};

use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use axum::extract::{Path as UrlPath, Query, Request, State};
use axum::http::{HeaderValue, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use serde_json::json;
use walkdir::WalkDir;

/// Upper limit of files in one listing. It keeps the response small in very large folders.
const MAX_FILES: usize = 2000;
/// Number of bytes from the start of each file that the listing sends for thumbnails.
const PREVIEW_BYTES: usize = 3000;
/// Folders that the listing does not enter.
const SKIPPED_DIRS: &[&str] = &["node_modules", "target"];
/// Folder in the root that keeps the notes of each document in `<document path>.json`.
const NOTES_DIR: &[&str] = &[".emditor", "notes"];
/// Folder in the root that keeps the writing rules of the whole folder.
const RULES_DIR: &[&str] = &[".emditor"];
const RULES_FILE: &str = "rules.json";
/// Upper limit of characters in a passage to rewrite.
const MAX_REWRITE_CHARS: usize = 20_000;

#[derive(RustEmbed)]
#[folder = "web/dist"]
struct Assets;

#[derive(Clone)]
struct AppState {
    root: Arc<PathBuf>,
    rewrite: Option<Arc<RewriteConfig>>,
    http: reqwest::Client,
}

/// Settings of the server that do not come from the folder.
#[derive(Clone, Debug, Default)]
pub struct Options {
    /// How to reach Claude for rewrites. None turns rewrites off.
    pub rewrite: Option<RewriteConfig>,
}

/// Makes the router for one root folder, with rewrites off. All file access stays inside this folder.
pub fn app(root: PathBuf) -> Router {
    app_with(root, Options::default())
}

/// Makes the router for one root folder with the given options.
pub fn app_with(root: PathBuf, options: Options) -> Router {
    let root = root.canonicalize().unwrap_or(root);
    let state = AppState {
        root: Arc::new(root),
        rewrite: options.rewrite.map(Arc::new),
        http: reqwest::Client::new(),
    };
    Router::new()
        .route("/api/files", get(list_files))
        .route("/api/file", get(read_file).put(write_file).post(create_file))
        .route("/api/notes", get(read_notes).put(write_notes))
        .route("/api/rules", get(read_rules).put(write_rules))
        .route("/api/rewrite", get(rewrite_status).post(rewrite_passage))
        .route("/files/{*path}", get(raw_file))
        .fallback(static_asset)
        .layer(middleware::from_fn(local_only))
        .with_state(state)
}

#[derive(Debug)]
enum ApiError {
    BadPath,
    BadNotes,
    BadRules,
    BadRewrite,
    RewriteUnavailable,
    RewriteFailed,
    NotFound,
    Conflict,
    Exists,
    Io(std::io::Error),
}

impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            ErrorKind::NotFound => ApiError::NotFound,
            ErrorKind::AlreadyExists => ApiError::Exists,
            _ => ApiError::Io(err),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            ApiError::BadPath => (StatusCode::BAD_REQUEST, "bad-path".to_string()),
            ApiError::BadNotes => (StatusCode::BAD_REQUEST, "bad-notes".to_string()),
            ApiError::BadRules => (StatusCode::BAD_REQUEST, "bad-rules".to_string()),
            ApiError::BadRewrite => (StatusCode::BAD_REQUEST, "bad-rewrite".to_string()),
            ApiError::RewriteUnavailable => (StatusCode::SERVICE_UNAVAILABLE, "rewrite-unavailable".to_string()),
            ApiError::RewriteFailed => (StatusCode::BAD_GATEWAY, "rewrite-failed".to_string()),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not-found".to_string()),
            ApiError::Conflict => (StatusCode::CONFLICT, "conflict".to_string()),
            ApiError::Exists => (StatusCode::CONFLICT, "exists".to_string()),
            ApiError::Io(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
        };
        (status, Json(json!({ "error": code }))).into_response()
    }
}

#[derive(Serialize)]
struct Listing {
    root: String,
    path: String,
    files: Vec<FileEntry>,
}

#[derive(Serialize)]
struct FileEntry {
    path: String,
    modified: u64,
    size: u64,
    preview: String,
}

#[derive(Deserialize)]
struct PathQuery {
    path: String,
}

#[derive(Serialize)]
struct Doc {
    path: String,
    content: String,
    modified: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteBody {
    content: String,
    base_modified: Option<u64>,
}

#[derive(Serialize)]
struct Saved {
    modified: u64,
}

/// A sidecar file: the notes of one document, or the rules of the folder. A missing file has empty content and modified 0.
#[derive(Serialize)]
struct Sidecar {
    content: String,
    modified: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarBody {
    content: String,
    /// The modified time that the writer read, or 0 when it read no sidecar file.
    base_modified: u64,
}

#[derive(Serialize)]
struct RewriteStatus {
    available: bool,
    /// The model that rewrites, when rewrites are on.
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
}

#[derive(Serialize)]
struct Rewritten {
    text: String,
}

async fn list_files(State(state): State<AppState>) -> Result<Json<Listing>, ApiError> {
    let root = state.root.clone();
    let files = tokio::task::spawn_blocking(move || scan(&root))
        .await
        .map_err(|err| ApiError::Io(std::io::Error::other(err)))?;
    let name = state
        .root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| state.root.display().to_string());
    Ok(Json(Listing {
        root: name,
        path: state.root.display().to_string(),
        files,
    }))
}

async fn read_file(
    State(state): State<AppState>,
    Query(query): Query<PathQuery>,
) -> Result<Json<Doc>, ApiError> {
    let full = resolve_markdown(&state.root, &query.path)?;
    let content = tokio::fs::read_to_string(&full).await?;
    let meta = tokio::fs::metadata(&full).await?;
    Ok(Json(Doc {
        path: query.path,
        content,
        modified: modified_ms(&meta),
    }))
}

async fn write_file(
    State(state): State<AppState>,
    Query(query): Query<PathQuery>,
    Json(body): Json<WriteBody>,
) -> Result<Json<Saved>, ApiError> {
    let full = resolve_markdown(&state.root, &query.path)?;
    if let Some(base) = body.base_modified {
        let meta = tokio::fs::metadata(&full).await?;
        if modified_ms(&meta) != base {
            return Err(ApiError::Conflict);
        }
    }
    write_atomic(&full, &body.content).await?;
    let meta = tokio::fs::metadata(&full).await?;
    Ok(Json(Saved {
        modified: modified_ms(&meta),
    }))
}

async fn create_file(
    State(state): State<AppState>,
    Query(query): Query<PathQuery>,
    Json(body): Json<WriteBody>,
) -> Result<Json<Doc>, ApiError> {
    use tokio::io::AsyncWriteExt;

    let full = resolve_markdown(&state.root, &query.path)?;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&full)
        .await?;
    file.write_all(body.content.as_bytes()).await?;
    file.flush().await?;
    let meta = tokio::fs::metadata(&full).await?;
    Ok(Json(Doc {
        path: query.path,
        content: body.content,
        modified: modified_ms(&meta),
    }))
}

async fn read_notes(
    State(state): State<AppState>,
    Query(query): Query<PathQuery>,
) -> Result<Json<Sidecar>, ApiError> {
    let doc = resolve_markdown(&state.root, &query.path)?;
    tokio::fs::metadata(&doc).await?;
    read_sidecar(notes_path(&state.root, &query.path, false)?).await
}

async fn write_notes(
    State(state): State<AppState>,
    Query(query): Query<PathQuery>,
    Json(body): Json<SidecarBody>,
) -> Result<Json<Saved>, ApiError> {
    let doc = resolve_markdown(&state.root, &query.path)?;
    tokio::fs::metadata(&doc).await?;
    if !is_json_object(&body.content) {
        return Err(ApiError::BadNotes);
    }
    let full = notes_path(&state.root, &query.path, true)?.ok_or(ApiError::BadPath)?;
    write_sidecar(&full, &body).await
}

async fn read_rules(State(state): State<AppState>) -> Result<Json<Sidecar>, ApiError> {
    read_sidecar(rules_path(&state.root, false)?).await
}

async fn write_rules(
    State(state): State<AppState>,
    Json(body): Json<SidecarBody>,
) -> Result<Json<Saved>, ApiError> {
    if !is_json_object(&body.content) {
        return Err(ApiError::BadRules);
    }
    let full = rules_path(&state.root, true)?.ok_or(ApiError::BadPath)?;
    write_sidecar(&full, &body).await
}

async fn rewrite_status(State(state): State<AppState>) -> Json<RewriteStatus> {
    Json(RewriteStatus {
        available: state.rewrite.is_some(),
        model: state.rewrite.as_ref().map(|config| config.model.clone()),
    })
}

async fn rewrite_passage(
    State(state): State<AppState>,
    Json(body): Json<rewrite::RewriteRequest>,
) -> Result<Json<Rewritten>, ApiError> {
    let config = state.rewrite.as_ref().ok_or(ApiError::RewriteUnavailable)?;
    if body.text.trim().is_empty() || body.text.chars().count() > MAX_REWRITE_CHARS {
        return Err(ApiError::BadRewrite);
    }
    match rewrite::rewrite(&state.http, config, &body).await {
        Ok(text) => Ok(Json(Rewritten { text })),
        Err(reason) => {
            eprintln!("emditor: rewrite failed: {reason}");
            Err(ApiError::RewriteFailed)
        }
    }
}

/// Reads a sidecar file. A missing file or folder gives empty content and modified 0.
async fn read_sidecar(full: Option<PathBuf>) -> Result<Json<Sidecar>, ApiError> {
    let empty = Sidecar {
        content: String::new(),
        modified: 0,
    };
    let Some(full) = full else {
        return Ok(Json(empty));
    };
    match tokio::fs::read_to_string(&full).await {
        Ok(content) => {
            let meta = tokio::fs::metadata(&full).await?;
            Ok(Json(Sidecar {
                content,
                modified: modified_ms(&meta),
            }))
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(Json(empty)),
        Err(err) => Err(err.into()),
    }
}

/// Writes a sidecar file when its modified time is still the one that the writer read.
async fn write_sidecar(full: &Path, body: &SidecarBody) -> Result<Json<Saved>, ApiError> {
    let current = match tokio::fs::metadata(full).await {
        Ok(meta) => modified_ms(&meta),
        Err(err) if err.kind() == ErrorKind::NotFound => 0,
        Err(err) => return Err(err.into()),
    };
    if current != body.base_modified {
        return Err(ApiError::Conflict);
    }
    write_atomic(full, &body.content).await?;
    let meta = tokio::fs::metadata(full).await?;
    Ok(Json(Saved {
        modified: modified_ms(&meta),
    }))
}

fn is_json_object(content: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(content).is_ok_and(|v| v.is_object())
}

/// Serves files such as images that Markdown documents refer to with relative paths.
/// Each response stops MIME sniffing. A type that a browser can open as a document
/// also gets a sandbox policy: the file then opens on its own opaque origin,
/// where its script cannot run and it cannot reach the application origin.
async fn raw_file(
    State(state): State<AppState>,
    UrlPath(path): UrlPath<String>,
) -> Result<Response, ApiError> {
    let full = resolve(&state.root, &path)?;
    let data = tokio::fs::read(&full).await?;
    let mime = mime_guess::from_path(&full)
        .first_or_octet_stream()
        .to_string();
    let mut response = (
        [
            (header::CONTENT_TYPE, mime.clone()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        data,
    )
        .into_response();
    if can_run_as_document(&mime) {
        response.headers_mut().insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("sandbox"),
        );
    }
    Ok(response)
}

/// Says whether a browser can open a file of this content type as a document
/// that carries script: HTML, XHTML, SVG, and the XML types. Images that a
/// document embeds and plain text such as Markdown stay inline without a policy.
fn can_run_as_document(mime: &str) -> bool {
    mime == "text/html"
        || mime == "application/xhtml+xml"
        || mime == "image/svg+xml"
        || mime == "text/xml"
        || mime == "application/xml"
        || mime.ends_with("+xml")
}

async fn static_asset(uri: Uri) -> Response {
    let path = match uri.path().trim_start_matches('/') {
        "" => "index.html",
        other => other,
    };
    let (name, file) = match Assets::get(path) {
        Some(file) => (path, file),
        None => match Assets::get("index.html") {
            Some(file) => ("index.html", file),
            None => {
                return (
                    StatusCode::NOT_FOUND,
                    "The web app is not built. Run `make build`.",
                )
                    .into_response();
            }
        },
    };
    let cache = if name.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    (
        [
            (header::CONTENT_TYPE, file.metadata.mimetype().to_string()),
            (header::CACHE_CONTROL, cache.to_string()),
        ],
        file.data,
    )
        .into_response()
}

/// Accepts only requests that come from this machine and from this app.
/// It blocks DNS rebinding (bad Host), other web sites (bad Origin), and cross-site embeds.
async fn local_only(req: Request, next: Next) -> Response {
    let headers = req.headers();
    let host_ok = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .is_some_and(is_local_authority);
    let origin_ok = match headers.get(header::ORIGIN) {
        None => true,
        Some(v) => v
            .to_str()
            .ok()
            .and_then(|o| o.strip_prefix("http://"))
            .is_some_and(is_local_authority),
    };
    let site_ok = headers
        .get("sec-fetch-site")
        .is_none_or(|v| v.as_bytes() != b"cross-site");
    if host_ok && origin_ok && site_ok {
        next.run(req).await
    } else {
        (StatusCode::FORBIDDEN, "emditor accepts only local requests").into_response()
    }
}

fn is_local_authority(authority: &str) -> bool {
    let host = match authority.rsplit_once(':') {
        Some((host, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => host,
        _ => authority,
    };
    matches!(host, "localhost" | "127.0.0.1" | "[::1]")
}

fn scan(root: &Path) -> Vec<FileEntry> {
    let mut files: Vec<FileEntry> = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !is_skipped(e))
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && is_markdown(e.path()))
        .take(MAX_FILES)
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let rel = e.path().strip_prefix(root).ok()?;
            Some(FileEntry {
                path: to_slash(rel),
                modified: modified_ms(&meta),
                size: meta.len(),
                preview: read_preview(e.path()),
            })
        })
        .collect();
    files.sort_by_key(|f| f.path.to_lowercase());
    files
}

fn read_preview(path: &Path) -> String {
    use std::io::Read;

    let mut buf = Vec::with_capacity(PREVIEW_BYTES);
    let read = std::fs::File::open(path)
        .and_then(|f| f.take(PREVIEW_BYTES as u64).read_to_end(&mut buf));
    if read.is_err() {
        return String::new();
    }
    // Cut at a character boundary so that a partial UTF-8 sequence does not show.
    match std::str::from_utf8(&buf) {
        Ok(text) => text.to_string(),
        Err(err) => String::from_utf8_lossy(&buf[..err.valid_up_to()]).into_owned(),
    }
}

fn is_skipped(entry: &walkdir::DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    name.starts_with('.') || (entry.file_type().is_dir() && SKIPPED_DIRS.contains(&name.as_ref()))
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
}

fn resolve_markdown(root: &Path, rel: &str) -> Result<PathBuf, ApiError> {
    if !is_markdown(Path::new(rel)) {
        return Err(ApiError::BadPath);
    }
    resolve(root, rel)
}

/// Joins a relative path to the root. It refuses paths that go out of the root,
/// also through symbolic links. The parent folder must exist.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, ApiError> {
    let rel_path = Path::new(rel);
    let only_normal = rel_path
        .components()
        .all(|c| matches!(c, Component::Normal(_)));
    if rel.is_empty() || !only_normal {
        return Err(ApiError::BadPath);
    }
    let full = root.join(rel_path);
    let parent = full
        .parent()
        .ok_or(ApiError::BadPath)?
        .canonicalize()
        .map_err(|_| ApiError::NotFound)?;
    if !parent.starts_with(root) {
        return Err(ApiError::BadPath);
    }
    if let Ok(target) = full.canonicalize()
        && !target.starts_with(root)
    {
        return Err(ApiError::BadPath);
    }
    Ok(full)
}

/// Gives the notes file of a document, which must be a checked relative path. Each folder on the way
/// must stay inside the root, also through symbolic links. With `create`, it makes missing folders;
/// without it, a missing folder gives None.
fn notes_path(root: &Path, rel: &str, create: bool) -> Result<Option<PathBuf>, ApiError> {
    let rel_path = Path::new(rel);
    let doc_dirs = rel_path
        .parent()
        .into_iter()
        .flat_map(|p| p.components().map(|c| c.as_os_str()));
    let parts = NOTES_DIR.iter().map(std::ffi::OsStr::new).chain(doc_dirs);
    let Some(dir) = sidecar_dir(root, parts, create)? else {
        return Ok(None);
    };
    let name = rel_path
        .file_name()
        .ok_or(ApiError::BadPath)?
        .to_string_lossy();
    sidecar_file(root, dir.join(format!("{name}.json"))).map(Some)
}

/// Gives the rules file of the folder, with the same checks and `create` behavior as `notes_path`.
fn rules_path(root: &Path, create: bool) -> Result<Option<PathBuf>, ApiError> {
    let parts = RULES_DIR.iter().map(std::ffi::OsStr::new);
    let Some(dir) = sidecar_dir(root, parts, create)? else {
        return Ok(None);
    };
    sidecar_file(root, dir.join(RULES_FILE)).map(Some)
}

/// Walks down from the root through the given folders. Each folder must stay inside the root, also through
/// symbolic links. With `create`, it makes missing folders; without it, a missing folder gives None.
fn sidecar_dir<'a>(
    root: &Path,
    parts: impl Iterator<Item = &'a std::ffi::OsStr>,
    create: bool,
) -> Result<Option<PathBuf>, ApiError> {
    let mut dir = root.to_path_buf();
    for part in parts {
        dir.push(part);
        match dir.canonicalize() {
            Ok(real) if real.starts_with(root) => {}
            Ok(_) => return Err(ApiError::BadPath),
            Err(_) if create => std::fs::create_dir(&dir)?,
            Err(_) => return Ok(None),
        }
    }
    Ok(Some(dir))
}

/// Refuses a sidecar file that is a symbolic link out of the root.
fn sidecar_file(root: &Path, full: PathBuf) -> Result<PathBuf, ApiError> {
    if let Ok(target) = full.canonicalize()
        && !target.starts_with(root)
    {
        return Err(ApiError::BadPath);
    }
    Ok(full)
}

async fn write_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.emditor-tmp"));
    tokio::fs::write(&tmp, content).await?;
    tokio::fs::rename(&tmp, path).await
}

fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn to_slash(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}
