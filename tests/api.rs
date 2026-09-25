// ABOUTME: Integration tests for the emditor HTTP API.
// ABOUTME: They drive the router against a temporary folder with real files.

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;

const HOST: &str = "127.0.0.1:4747";

fn setup() -> (TempDir, Router) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("alpha.md"), "# Alpha\n\nFirst.").unwrap();
    std::fs::create_dir(dir.path().join("notes")).unwrap();
    std::fs::write(dir.path().join("notes/beta.markdown"), "Beta").unwrap();
    std::fs::write(dir.path().join("notes/image.png"), [137, 80, 78, 71]).unwrap();
    std::fs::write(dir.path().join("readme.txt"), "not markdown").unwrap();
    std::fs::create_dir(dir.path().join(".hidden")).unwrap();
    std::fs::write(dir.path().join(".hidden/secret.md"), "hidden").unwrap();
    std::fs::create_dir(dir.path().join("node_modules")).unwrap();
    std::fs::write(dir.path().join("node_modules/dep.md"), "dep").unwrap();
    let app = emditor::app(dir.path().to_path_buf());
    (dir, app)
}

fn get(uri: &str) -> Request<Body> {
    Request::get(uri).header(header::HOST, HOST).body(Body::empty()).unwrap()
}

fn json_request(method: &str, uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::HOST, HOST)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn send(app: &Router, req: Request<Body>) -> (StatusCode, Value) {
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}

#[tokio::test]
async fn lists_markdown_files_and_skips_hidden_and_vendor_folders() {
    let (_dir, app) = setup();
    let (status, body) = send(&app, get("/api/files")).await;
    assert_eq!(status, StatusCode::OK);
    let paths: Vec<&str> = body["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, ["alpha.md", "notes/beta.markdown"]);
    assert_eq!(body["files"][0]["preview"], "# Alpha\n\nFirst.");
    assert!(body["files"][0]["modified"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn preview_is_cut_at_a_character_boundary() {
    let (dir, app) = setup();
    let long = "é".repeat(2000); // 4000 bytes, each char is 2 bytes
    std::fs::write(dir.path().join("long.md"), format!("x{long}")).unwrap();
    let (_, body) = send(&app, get("/api/files")).await;
    let entry = body["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "long.md")
        .unwrap();
    let preview = entry["preview"].as_str().unwrap();
    assert_eq!(preview.len(), 2999);
    assert!(preview.ends_with('é'));
}

#[tokio::test]
async fn searches_beyond_thumbnails_and_skips_hidden_files() {
    let (dir, app) = setup();
    std::fs::write(dir.path().join("long.md"), format!("{}\nUnique passage here", "x".repeat(4000))).unwrap();
    std::fs::write(dir.path().join(".hidden/secret.md"), "Unique passage here").unwrap();
    let (status, body) = send(&app, get("/api/search?q=unique%20passage")).await;
    assert_eq!(status, StatusCode::OK);
    let hits = body.as_array().unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0]["path"], "long.md");
    assert_eq!(hits[0]["line"], 2);
    assert!(hits[0]["excerpt"].as_str().unwrap().contains("Unique passage"));
    let (status, _) = send(&app, get("/api/search?q=x")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn reads_a_file() {
    let (_dir, app) = setup();
    let (status, body) = send(&app, get("/api/file?path=notes/beta.markdown")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["content"], "Beta");
    assert_eq!(body["path"], "notes/beta.markdown");
}

#[tokio::test]
async fn refuses_paths_outside_the_root_or_not_markdown() {
    let (_dir, app) = setup();
    for path in ["../etc/passwd.md", "/etc/hosts.md", "readme.txt", "", "notes/../alpha.md"] {
        let (status, body) = send(&app, get(&format!("/api/file?path={path}"))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "path {path:?}");
        assert_eq!(body["error"], "bad-path");
    }
}

#[tokio::test]
async fn refuses_symlinks_that_leave_the_root() {
    let (dir, app) = setup();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("out.md"), "outside").unwrap();
    std::os::unix::fs::symlink(outside.path().join("out.md"), dir.path().join("link.md")).unwrap();
    let (status, _) = send(&app, get("/api/file?path=link.md")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn missing_file_is_not_found() {
    let (_dir, app) = setup();
    let (status, body) = send(&app, get("/api/file?path=nope.md")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "not-found");
}

#[tokio::test]
async fn writes_a_file_and_returns_the_new_modified_time() {
    let (dir, app) = setup();
    let (_, doc) = send(&app, get("/api/file?path=alpha.md")).await;
    let base = doc["modified"].as_u64().unwrap();
    let (status, body) = send(
        &app,
        json_request("PUT", "/api/file?path=alpha.md", json!({ "content": "changed", "baseModified": base })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["modified"].as_u64().is_some());
    assert_eq!(std::fs::read_to_string(dir.path().join("alpha.md")).unwrap(), "changed");
    assert!(!dir.path().join(".alpha.md.emditor-tmp").exists());
}

#[tokio::test]
async fn write_with_an_old_base_is_a_conflict() {
    let (dir, app) = setup();
    let (status, body) = send(
        &app,
        json_request("PUT", "/api/file?path=alpha.md", json!({ "content": "x", "baseModified": 1 })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "conflict");
    assert_eq!(std::fs::read_to_string(dir.path().join("alpha.md")).unwrap(), "# Alpha\n\nFirst.");
}

#[tokio::test]
async fn write_needs_a_json_body() {
    let (_dir, app) = setup();
    let req = Request::put("/api/file?path=alpha.md")
        .header(header::HOST, HOST)
        .header(header::CONTENT_TYPE, "text/plain")
        .body(Body::from(r#"{"content":"x"}"#))
        .unwrap();
    let (status, _) = send(&app, req).await;
    assert_eq!(status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

#[tokio::test]
async fn creates_a_file_but_not_over_an_existing_one() {
    let (dir, app) = setup();
    let (status, body) =
        send(&app, json_request("POST", "/api/file?path=notes/new.md", json!({ "content": "# New\n" }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["content"], "# New\n");
    assert_eq!(std::fs::read_to_string(dir.path().join("notes/new.md")).unwrap(), "# New\n");

    let (status, body) =
        send(&app, json_request("POST", "/api/file?path=alpha.md", json!({ "content": "" }))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "exists");
}

#[tokio::test]
async fn serves_raw_files_next_to_documents() {
    let (_dir, app) = setup();
    let res = app.clone().oneshot(get("/files/notes/image.png")).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "image/png");

    let res = app.clone().oneshot(get("/files/../secret.png")).await.unwrap();
    assert_ne!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn refuses_foreign_hosts_origins_and_cross_site_requests() {
    let (_dir, app) = setup();

    let req = Request::get("/api/files").header(header::HOST, "evil.example:4747").body(Body::empty()).unwrap();
    assert_eq!(app.clone().oneshot(req).await.unwrap().status(), StatusCode::FORBIDDEN);

    let req = Request::get("/api/files")
        .header(header::HOST, HOST)
        .header(header::ORIGIN, "https://evil.example")
        .body(Body::empty())
        .unwrap();
    assert_eq!(app.clone().oneshot(req).await.unwrap().status(), StatusCode::FORBIDDEN);

    let req = Request::get("/files/notes/image.png")
        .header(header::HOST, HOST)
        .header("sec-fetch-site", "cross-site")
        .body(Body::empty())
        .unwrap();
    assert_eq!(app.clone().oneshot(req).await.unwrap().status(), StatusCode::FORBIDDEN);

    let req = Request::get("/api/files")
        .header(header::HOST, "localhost:5173")
        .header(header::ORIGIN, "http://localhost:5173")
        .body(Body::empty())
        .unwrap();
    assert_eq!(app.clone().oneshot(req).await.unwrap().status(), StatusCode::OK);
}

#[tokio::test]
async fn notes_of_a_document_without_notes_are_empty() {
    let (dir, app) = setup();
    let (status, body) = send(&app, get("/api/notes?path=alpha.md")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["content"], "");
    assert_eq!(body["modified"], 0);
    assert!(!dir.path().join(".emditor").exists());
}

#[tokio::test]
async fn writes_notes_to_a_sidecar_file_and_reads_them_back() {
    let (dir, app) = setup();
    let notes = "{\"version\":1,\"notes\":[]}\n";
    let (status, saved) = send(
        &app,
        json_request("PUT", "/api/notes?path=notes/beta.markdown", json!({ "content": notes, "baseModified": 0 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let sidecar = dir.path().join(".emditor/notes/notes/beta.markdown.json");
    assert_eq!(std::fs::read_to_string(&sidecar).unwrap(), notes);

    let (status, body) = send(&app, get("/api/notes?path=notes/beta.markdown")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["content"], notes);
    assert_eq!(body["modified"], saved["modified"]);
}

#[tokio::test]
async fn notes_write_with_an_old_base_is_a_conflict() {
    let (dir, app) = setup();
    let first = json!({ "content": "{\"version\":1,\"notes\":[]}", "baseModified": 0 });
    let (status, _) = send(&app, json_request("PUT", "/api/notes?path=alpha.md", first.clone())).await;
    assert_eq!(status, StatusCode::OK);

    // A second writer that still thinks there is no notes file.
    let second = json!({ "content": "{\"version\":1,\"notes\":[{}]}", "baseModified": 0 });
    let (status, body) = send(&app, json_request("PUT", "/api/notes?path=alpha.md", second)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "conflict");
    let kept = std::fs::read_to_string(dir.path().join(".emditor/notes/alpha.md.json")).unwrap();
    assert_eq!(kept, "{\"version\":1,\"notes\":[]}");
}

#[tokio::test]
async fn notes_must_be_a_json_object() {
    let (dir, app) = setup();
    for content in ["not json", "[1,2]", ""] {
        let (status, body) = send(
            &app,
            json_request("PUT", "/api/notes?path=alpha.md", json!({ "content": content, "baseModified": 0 })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "content {content:?}");
        assert_eq!(body["error"], "bad-notes");
    }
    assert!(!dir.path().join(".emditor").exists());
}

#[tokio::test]
async fn notes_need_an_existing_markdown_document() {
    let (_dir, app) = setup();
    let (status, _) = send(&app, get("/api/notes?path=nope.md")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    for path in ["readme.txt", "../x.md", "notes/../alpha.md"] {
        let (status, _) = send(&app, get(&format!("/api/notes?path={path}"))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "path {path:?}");
    }
}

#[tokio::test]
async fn notes_do_not_follow_a_sidecar_folder_link_out_of_the_root() {
    let (dir, app) = setup();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join(".emditor")).unwrap();
    let (status, _) = send(
        &app,
        json_request("PUT", "/api/notes?path=alpha.md", json!({ "content": "{}", "baseModified": 0 })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!outside.path().join("notes").exists());
    let (status, _) = send(&app, get("/api/notes?path=alpha.md")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
