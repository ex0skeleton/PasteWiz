# PasteWiz

Paste. Save. Copy. GitHub Pages UI + Cloudflare Worker + private GitHub JSON storage. No Firebase and no app login. After owner setup, bookmark the same private link on every device.

**Start with [SETUP.md](SETUP.md)** for the complete setup, Git commands, Cloudflare variables, private-link generation, usage and troubleshooting.

- index.html: reference-inspired two-panel UI
- css/: Outfit/Inter fonts, responsive dark/orange styling
- assets/logo.svg: supplied SVG, unchanged
- js/config.js: public Worker URL (no credentials)
- js/app.js: autosave, local draft recovery, optional tabs, sync, copying
- worker/worker.mjs: paste into Cloudflare Worker editor
- data-template/pastes.json: empty template to copy into your separate PRIVATE data repository
- tests/: mocked integration tests for the Worker

The private workspace URL is your access key; keep it private. The GitHub token belongs only in Cloudflare secrets. Each online save creates a GitHub commit. Text stays in private Git history even after deleting it from the active workspace. Practical limits: 450 KB UTF-8 text per tab, 650 KB total JSON.

Validation: nine Worker tests passed; JavaScript syntax, asset references and exact SVG copy checked. Live service integration and browser visual QA were not performed.
