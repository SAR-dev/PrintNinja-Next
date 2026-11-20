# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/)
from the first release (phase 7). Until then, entries accumulate under
Unreleased.

## Unreleased

### Added

- Phase 0 skeleton: Rust workspace (`core/{scene,render,planner,profiles,encoders,transport,job}`, `app`, `tests/golden`)
- CI: web-check, rust-lint, rust-test-linux (Docker container), rust-test-windows
- Golden-file test harness with a placeholder case; `GOLDEN_UPDATE=1` regeneration
- Virtual printer fixture (Raw/IPP/LPD/HTTP, fault states) ported with smoke tests
- Design system port in `app/ui` (tokens, ui component set, fonts)
