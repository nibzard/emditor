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
    Request::get(uri)
        .header(header::HOST, HOST)
        .body(Body::empty())
        .unwrap()
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
    for path in [
        "../etc/passwd.md",
        "/etc/hosts.md",
        "readme.txt",
        "",
        "notes/../alpha.md",
    ] {
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
        json_request(
            "PUT",
            "/api/file?path=alpha.md",
            json!({ "content": "changed", "baseModified": base }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["modified"].as_u64().is_some());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("alpha.md")).unwrap(),
        "changed"
    );
    assert!(!dir.path().join(".alpha.md.emditor-tmp").exists());
}

#[tokio::test]
async fn write_with_an_old_base_is_a_conflict() {
    let (dir, app) = setup();
    let (status, body) = send(
        &app,
        json_request(
            "PUT",
            "/api/file?path=alpha.md",
            json!({ "content": "x", "baseModified": 1 }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "conflict");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("alpha.md")).unwrap(),
        "# Alpha\n\nFirst."
    );
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
    let (status, body) = send(
        &app,
        json_request(
            "POST",
            "/api/file?path=notes/new.md",
            json!({ "content": "# New\n" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["content"], "# New\n");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("notes/new.md")).unwrap(),
        "# New\n"
    );

    let (status, body) = send(
        &app,
        json_request("POST", "/api/file?path=alpha.md", json!({ "content": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "exists");
}

#[tokio::test]
async fn serves_raw_files_next_to_documents() {
    let (_dir, app) = setup();
    let res = app
        .clone()
        .oneshot(get("/files/notes/image.png"))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "image/png");

    let res = app
        .clone()
        .oneshot(get("/files/../secret.png"))
        .await
        .unwrap();
    assert_ne!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn refuses_foreign_hosts_origins_and_cross_site_requests() {
    let (_dir, app) = setup();

    let req = Request::get("/api/files")
        .header(header::HOST, "evil.example:4747")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );

    let req = Request::get("/api/files")
        .header(header::HOST, HOST)
        .header(header::ORIGIN, "https://evil.example")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );

    let req = Request::get("/files/notes/image.png")
        .header(header::HOST, HOST)
        .header("sec-fetch-site", "cross-site")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );

    let req = Request::get("/api/files")
        .header(header::HOST, "localhost:5173")
        .header(header::ORIGIN, "http://localhost:5173")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::OK
    );
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
        json_request(
            "PUT",
            "/api/notes?path=notes/beta.markdown",
            json!({ "content": notes, "baseModified": 0 }),
        ),
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
    let (status, _) = send(
        &app,
        json_request("PUT", "/api/notes?path=alpha.md", first.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // A second writer that still thinks there is no notes file.
    let second = json!({ "content": "{\"version\":1,\"notes\":[{}]}", "baseModified": 0 });
    let (status, body) = send(
        &app,
        json_request("PUT", "/api/notes?path=alpha.md", second),
    )
    .await;
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
            json_request(
                "PUT",
                "/api/notes?path=alpha.md",
                json!({ "content": content, "baseModified": 0 }),
            ),
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
        json_request(
            "PUT",
            "/api/notes?path=alpha.md",
            json!({ "content": "{}", "baseModified": 0 }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!outside.path().join("notes").exists());
    let (status, _) = send(&app, get("/api/notes?path=alpha.md")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn rules_of_a_folder_without_rules_are_empty() {
    let (_dir, app) = setup();
    let (status, body) = send(&app, get("/api/rules")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["content"], "");
    assert_eq!(body["modified"], 0);
}

#[tokio::test]
async fn writes_rules_to_the_folder_sidecar_and_reads_them_back() {
    let (dir, app) = setup();
    let rules = "{\"version\":1,\"kept\":[]}\n";
    let (status, body) = send(
        &app,
        json_request(
            "PUT",
            "/api/rules",
            json!({ "content": rules, "baseModified": 0 }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".emditor/rules.json")).unwrap(),
        rules
    );
    let modified = body["modified"].as_u64().unwrap();

    let (status, body) = send(&app, get("/api/rules")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["content"], rules);
    assert_eq!(body["modified"], modified);

    // A writer that read no rules file must not overwrite the one that is there now.
    let (status, body) = send(
        &app,
        json_request(
            "PUT",
            "/api/rules",
            json!({ "content": "{}", "baseModified": 0 }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "conflict");
}

#[tokio::test]
async fn rules_must_be_a_json_object() {
    let (_dir, app) = setup();
    for content in ["", "[]", "{nope"] {
        let (status, body) = send(
            &app,
            json_request(
                "PUT",
                "/api/rules",
                json!({ "content": content, "baseModified": 0 }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "bad-rules");
    }
}

#[tokio::test]
async fn rules_do_not_follow_a_sidecar_folder_link_out_of_the_root() {
    let (dir, app) = setup();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join(".emditor")).unwrap();
    let (status, _) = send(
        &app,
        json_request(
            "PUT",
            "/api/rules",
            json!({ "content": "{}", "baseModified": 0 }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!outside.path().join("rules.json").exists());
    let (status, _) = send(&app, get("/api/rules")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn rewrite_is_unavailable_without_a_key() {
    let (_dir, app) = setup();
    let (status, body) = send(&app, get("/api/rewrite")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["available"], false);
    let (status, body) = send(
        &app,
        json_request(
            "POST",
            "/api/rewrite",
            json!({ "text": "Hello.", "context": "", "rules": [] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"], "rewrite-unavailable");
}

type Seen = std::sync::Arc<std::sync::Mutex<Vec<(String, Value)>>>;

/// A stand-in for a provider API at `path`. It records the value of the `auth` header and the body of each
/// request, and gives the reply that the test sets. Returns the origin of the stand-in.
async fn fake_api(
    path: &'static str,
    auth: &'static str,
    reply: (StatusCode, Value),
) -> (String, Seen) {
    use axum::routing::post;
    let seen: Seen = Default::default();
    let record = seen.clone();
    let app = Router::new().route(
        path,
        post(
            move |headers: axum::http::HeaderMap, axum::Json(body): axum::Json<Value>| {
                let record = record.clone();
                let reply = reply.clone();
                async move {
                    let key = headers
                        .get(auth)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .to_string();
                    record.lock().unwrap().push((key, body));
                    (reply.0, axum::Json(reply.1))
                }
            },
        ),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, seen)
}

async fn fake_anthropic(reply: (StatusCode, Value)) -> (String, Seen) {
    fake_api("/v1/messages", "x-api-key", reply).await
}

/// The OpenAI base URL includes `/v1`, as with the official SDKs.
async fn fake_openai(reply: (StatusCode, Value)) -> (String, Seen) {
    let (origin, seen) = fake_api("/v1/responses", "authorization", reply).await;
    (format!("{origin}/v1"), seen)
}

fn rewrite_app(dir: &TempDir, provider: emditor::Provider, base_url: String) -> Router {
    emditor::app_with(
        dir.path().to_path_buf(),
        emditor::Options {
            rewrite: Some(emditor::RewriteConfig {
                provider,
                api_key: "test-key".into(),
                base_url,
                model: "test-model".into(),
            }),
        },
    )
}

fn rewrite_request() -> Value {
    json!({
        "text": "We should circle back.",
        "context": "Before it.",
        "rules": ["“circle back” is on your list of phrases to avoid."],
    })
}

fn assert_prompt(prompt: &str) {
    assert!(prompt.contains("<passage>\nWe should circle back.\n</passage>"));
    assert!(prompt.contains("<context>\nBefore it.\n</context>"));
    assert!(prompt.contains("- “circle back” is on your list of phrases to avoid."));
}

#[tokio::test]
async fn rewrite_status_names_the_model() {
    let (dir, _) = setup();
    let app = rewrite_app(&dir, emditor::Provider::OpenAi, "http://127.0.0.1:9".into());
    let (status, body) = send(&app, get("/api/rewrite")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "available": true, "model": "test-model" }));
}

#[tokio::test]
async fn rewrite_sends_the_passage_and_rules_to_claude_and_returns_the_revision() {
    let (dir, _) = setup();
    let reply = json!({
        "content": [{ "type": "text", "text": "Sure.\n<revised>\nWe should talk again.\n</revised>" }],
        "stop_reason": "end_turn",
    });
    let (url, seen) = fake_anthropic((StatusCode::OK, reply)).await;
    let app = rewrite_app(&dir, emditor::Provider::Anthropic, url);

    let (status, body) = send(
        &app,
        json_request("POST", "/api/rewrite", rewrite_request()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["text"], "We should talk again.");

    let seen = seen.lock().unwrap();
    let (key, sent) = &seen[0];
    assert_eq!(key, "test-key");
    assert_eq!(sent["model"], "test-model");
    assert!(sent["system"].as_str().unwrap().contains("<revised>"));
    assert_prompt(sent["messages"][0]["content"].as_str().unwrap());
}

#[tokio::test]
async fn rewrite_sends_the_passage_and_rules_to_openai_and_returns_the_revision() {
    let (dir, _) = setup();
    let reply = json!({
        "status": "completed",
        "output": [
            { "type": "reasoning", "summary": [] },
            { "type": "message", "content": [{ "type": "output_text", "text": "<revised>We should talk again.</revised>" }] },
        ],
    });
    let (url, seen) = fake_openai((StatusCode::OK, reply)).await;
    let app = rewrite_app(&dir, emditor::Provider::OpenAi, url);

    let (status, body) = send(
        &app,
        json_request("POST", "/api/rewrite", rewrite_request()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["text"], "We should talk again.");

    let seen = seen.lock().unwrap();
    let (auth, sent) = &seen[0];
    assert_eq!(auth, "Bearer test-key");
    assert_eq!(sent["model"], "test-model");
    assert_eq!(sent["reasoning"]["effort"], "low");
    assert_eq!(sent["store"], false);
    assert!(sent["instructions"].as_str().unwrap().contains("<revised>"));
    assert_prompt(sent["input"].as_str().unwrap());
}

#[tokio::test]
async fn rewrite_reports_a_failed_or_empty_reply_from_claude() {
    let (dir, _) = setup();
    for reply in [
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": { "message": "down" } }),
        ),
        (
            StatusCode::OK,
            json!({ "content": [], "stop_reason": "refusal" }),
        ),
        (
            StatusCode::OK,
            json!({ "content": [{ "type": "text", "text": "   " }], "stop_reason": "end_turn" }),
        ),
    ] {
        let (url, _) = fake_anthropic(reply).await;
        let app = rewrite_app(&dir, emditor::Provider::Anthropic, url);
        let (status, body) = send(
            &app,
            json_request("POST", "/api/rewrite", rewrite_request()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(body["error"], "rewrite-failed");
    }
}

#[tokio::test]
async fn rewrite_reports_a_failed_refused_or_cut_off_reply_from_openai() {
    let (dir, _) = setup();
    let text =
        |t: &str| json!([{ "type": "message", "content": [{ "type": "output_text", "text": t }] }]);
    for reply in [
        (
            StatusCode::TOO_MANY_REQUESTS,
            json!({ "error": { "message": "slow down", "type": "rate_limit" } }),
        ),
        (
            StatusCode::OK,
            json!({ "status": "completed", "output": [{ "type": "message", "content": [{ "type": "refusal", "refusal": "No." }] }] }),
        ),
        (
            StatusCode::OK,
            json!({ "status": "incomplete", "incomplete_details": { "reason": "max_output_tokens" }, "output": text("<revised>half") }),
        ),
        (
            StatusCode::OK,
            json!({ "status": "completed", "output": text("  ") }),
        ),
    ] {
        let (url, _) = fake_openai(reply).await;
        let app = rewrite_app(&dir, emditor::Provider::OpenAi, url);
        let (status, body) = send(
            &app,
            json_request("POST", "/api/rewrite", rewrite_request()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(body["error"], "rewrite-failed");
    }
}

#[tokio::test]
async fn rewrite_refuses_empty_or_very_long_text() {
    let (dir, _) = setup();
    let app = rewrite_app(
        &dir,
        emditor::Provider::Anthropic,
        "http://127.0.0.1:9".into(),
    );
    for text in ["  ".to_string(), "a".repeat(20_001)] {
        let (status, body) = send(
            &app,
            json_request(
                "POST",
                "/api/rewrite",
                json!({ "text": text, "context": "", "rules": [] }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["error"], "bad-rewrite");
    }
}
