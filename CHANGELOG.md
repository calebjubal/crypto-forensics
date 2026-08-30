# Changelog

All notable changes to Satoshi Trace are documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- GitHub Actions workflow that validates a matching draft release and publishes Windows, Linux, and macOS electron-builder artifacts whenever `dev` is updated.

### Changed

- Advanced development metadata to `1.0.4` so draft artifacts cannot collide with the tagged `v1.0.3` release.
- Moved hardened Electron fuse configuration into electron-builder's native cross-platform integration.
- Updated GitHub Actions dependencies to Node.js 24-compatible releases.

## [1.0.3] - 2026-08-29

### Added

- Live host-connectivity badge that displays red when the operating system reports offline and green when it reports online, without making a network request or changing the application's network isolation.
- Interactive Cytoscape entity-cluster graphs with bundled offline assets, address-to-transaction links, ring and flow layouts, viewport fitting, node evidence context, and transaction drill-down.
- Bounded cluster graph queries and regression coverage for graph links, preserving responsive visualization while disclosing full evidence counts.

### Changed

- Lead tables now show the raw Isolation Forest anomaly value and use it to order otherwise tied triage scores.

### Fixed

- Fixed Previous and Next pagination on the Overview priority-leads table by retaining its `leads` query context and five-row page size.

## [1.0.2] - 2026-08-29

### Added

- Tailwind CSS 4 and daisyUI 5 build pipeline with a bundled, offline `satoshi` theme.
- Global renderer guards that surface unexpected user-action failures through the toast system.
- Regression coverage for aggregate Bitcoin values beyond JavaScript's safe integer range.
- Comprehensive project documentation with architecture, evidence schema, security boundary, packaging targets, and operational limitations.

### Changed

- Dashboard navigation now keeps the current rendered view visible while a destination is loading.
- Failed navigation restores the previous route, search state, pagination offset, breadcrumb, and markup before displaying an error toast.
- Buttons, forms, cards, tables, badges, alerts, progress indicators, and authentication controls now use the shared daisyUI design preset.
- Tailwind and daisyUI remain build-time-only dependencies; the generated local stylesheet is bundled with the application.

### Fixed

- Prevented large SQLite satoshi aggregates from being converted into unsafe JavaScript numbers.
- Prevented user-triggered route errors from replacing the complete dashboard with raw error text.
- Preserved the existing interface when an IPC request, list refresh, detail lookup, import, analysis, export, review, deletion, or logout action fails.

### Verification

- 11 system and regression tests pass.
- Production dependency audit reports zero known vulnerabilities.
- Offline CSS compilation and Electron packaging complete successfully.
- Packaged application archive contains the generated local stylesheet and excludes source stylesheets.

## [1.0.1] - 2026-08-29

### Added

- Multi-file CSV, JSON, and XML evidence ingestion with an auditable source ledger.
- Local username and password authentication using salted scrypt hashes.
- Application lifecycle and investigator operation audit logging.
- Source-aware evidence deletion and derived-analysis invalidation.
- Satoshi Trace logo and animated offline loading screen.
- Windows Squirrel installer publishing through Electron Forge.

### Changed

- Removed production placeholder data and unnecessary dashboard content.
- Formatted JavaScript and CSS sources consistently.

## [1.0.0] - 2026-08-27

### Added

- Initial port-free Electron desktop application.
- Embedded SQLite evidence store and streaming ingestion pipeline.
- Network-to-blockchain correlation by TXID.
- Local Isolation Forest anomaly detection and common-input entity clustering.
- Explainable priority leads, investigator reviews, and JSON/CSV exports.
- Runtime network denial, restrictive Electron policies, and hardened fuses.

[Unreleased]: https://github.com/calebjubal/crypto-forensics/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/calebjubal/crypto-forensics/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/calebjubal/crypto-forensics/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/calebjubal/crypto-forensics/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/calebjubal/crypto-forensics/releases/tag/v1.0.0
