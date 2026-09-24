// ABOUTME: Build script that makes sure the embedded web folder exists.
// ABOUTME: The Rust build does not fail when the web app is not built yet.

fn main() {
    std::fs::create_dir_all("web/dist").expect("cannot create web/dist");
    println!("cargo:rerun-if-changed=web/dist");
}
