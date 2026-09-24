// ABOUTME: Command-line entry point for emditor.
// ABOUTME: It finds the folder to serve, starts the local server, and opens the browser.

use std::path::PathBuf;
use std::process::ExitCode;

const DEFAULT_PORT: u16 = 4747;

const USAGE: &str = "\
emditor — a small Markdown desk in your browser

USAGE:
    emditor [PATH] [OPTIONS]

PATH is a folder (default: the current folder) or one Markdown file.

OPTIONS:
    -p, --port <PORT>   Use this port (default: 4747, or a free port if it is busy)
        --no-open       Do not open the browser
    -h, --help          Show this help
    -V, --version       Show the version
";

struct Options {
    target: PathBuf,
    port: Option<u16>,
    open: bool,
}

fn parse_args() -> Result<Options, String> {
    let mut target = None;
    let mut port = None;
    let mut open = true;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                print!("{USAGE}");
                std::process::exit(0);
            }
            "-V" | "--version" => {
                println!("emditor {}", env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            "--no-open" => open = false,
            "-p" | "--port" => {
                let value = args.next().ok_or("--port needs a value")?;
                port = Some(value.parse().map_err(|_| format!("invalid port: {value}"))?);
            }
            _ if arg.starts_with('-') => return Err(format!("unknown option: {arg}")),
            _ if target.is_none() => target = Some(PathBuf::from(arg)),
            _ => return Err("give only one path".into()),
        }
    }
    Ok(Options {
        target: target.unwrap_or_else(|| PathBuf::from(".")),
        port,
        open,
    })
}

/// Percent-encodes a value for use in a URL query.
fn encode_query(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[tokio::main]
async fn main() -> ExitCode {
    let options = match parse_args() {
        Ok(options) => options,
        Err(err) => {
            eprintln!("emditor: {err}\n\n{USAGE}");
            return ExitCode::FAILURE;
        }
    };

    let target = match options.target.canonicalize() {
        Ok(path) => path,
        Err(err) => {
            eprintln!("emditor: {}: {err}", options.target.display());
            return ExitCode::FAILURE;
        }
    };
    let (root, initial_file) = if target.is_file() {
        let name = target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned());
        (target.parent().map(PathBuf::from).unwrap_or(target), name)
    } else {
        (target, None)
    };

    let listener = match options.port {
        Some(port) => tokio::net::TcpListener::bind(("127.0.0.1", port)).await,
        None => match tokio::net::TcpListener::bind(("127.0.0.1", DEFAULT_PORT)).await {
            Ok(listener) => Ok(listener),
            Err(_) => tokio::net::TcpListener::bind(("127.0.0.1", 0)).await,
        },
    };
    let listener = match listener {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("emditor: cannot start server: {err}");
            return ExitCode::FAILURE;
        }
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(DEFAULT_PORT);

    let mut url = format!("http://127.0.0.1:{port}/");
    if let Some(name) = &initial_file {
        url.push_str(&format!("?file={}", encode_query(name)));
    }
    println!("emditor  {}\n         {url}\n         Ctrl+C to stop", root.display());

    if options.open
        && let Err(err) = std::process::Command::new("open").arg(&url).spawn()
    {
        eprintln!("emditor: cannot open the browser: {err}");
    }

    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    if let Err(err) = axum::serve(listener, emditor::app(root))
        .with_graceful_shutdown(shutdown)
        .await
    {
        eprintln!("emditor: server error: {err}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
