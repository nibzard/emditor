# ABOUTME: Build, test, and install tasks for emditor.
# ABOUTME: The web app must be built before the release binary, because the binary embeds it.

.PHONY: build web test install dev

build: web
	cargo build --release

web:
	cd web && npm ci && npm run build

test:
	cargo test
	cd web && npm test

install: web
	cargo install --path .

dev:
	@echo "Run 'cargo run -- <folder> --no-open' and 'cd web && npm run dev' in two terminals."
