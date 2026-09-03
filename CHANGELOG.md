# Changelog

All notable changes to Satoshi Trace are documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.5] - 2026-09-03

### Added

- Schema-v3 graph-aware analysis with bounded exact address-and-satoshi flow reconstruction, ambiguity/high-degree diagnostics, six additional transaction graph features, and deterministic flow-level anomaly scoring when at least 32 patterns exist.
- Conservative 3–20-step peeling-chain detection and directly linked CoinJoin-like mixing cascades; single CoinJoin-like structures remain caution-only with zero points and never seed risk.
- Explainable four-hop forward exposure propagation from high-confidence automatic pattern seeds, strongest-path persistence, cycle prevention, risk-10 cutoff, and capped lead-score contributions.
- A dedicated Flow Analysis workspace with summary cards, pattern/confidence/anomaly/risk filters, isolated animated Cytoscape graphs, investigator pan/zoom/drag controls, keyboard node access, evidence drill-down, and disclosed graph overflow.
- Risk and pattern badges in Priority Leads, full score/path breakdowns in transaction details, and schema-v3 JSON plus formula-safe CSV report fields for patterns, links, seeds, risk, and diagnostics.
- Offline transaction world map with a bundled Natural Earth outline, DB-IP City Lite IPv4/IPv6 lookup, aggregated dotted city routes, and bold lead-focused IP/transaction/wallet paths.
- Reduced-motion-aware animated map zoom that centers and fits the focused path whenever an investigator selects a lead.
- Toggleable lead isolation that hides full-case routes until the selected lead is clicked again, plus investigator-controlled drag, wheel/pinch, button zoom, and viewport reset.
- Searchable per-investigator cluster color settings with deterministic defaults, individual reset, and reset-all controls shared by map and entity graphs.
- Bounded overview and focus projections that retain full counts and disclose consolidated route groups or labelled overflow nodes.
- Map aggregation, geolocation fallback, missing/corrupt database, and graph-budget regression coverage.
- Focused IP markers now retain their approximate geographic coordinates and use curved relationship paths instead of schematic straight-line lanes.
- World-map navigation now uses a full-world minimum zoom, bounded vertical panning, and horizontally wrapped Pacific edges.
- Deterministic offline transaction-graph embeddings now supplement common-input entity hypotheses using repeated shared contexts, a high similarity threshold, collaborative-pattern exclusion, and a 100-wallet cap.
- Entity Clusters now opens as an analysis dashboard with case-wide summary metrics, method badges, compact network glyphs, relative wallet/activity bars, and graph-assisted-link counts.

### Changed

- Expanded the deterministic transaction Isolation Forest from 8 to 14 features while preserving the 0.55 caution and 0.62 strong thresholds.
- Evidence removal and atomic reanalysis now clear and rebuild every derived flow, pattern, seed, wallet-risk, and transaction-risk record without modifying imported evidence.
- Advanced release metadata to `1.0.5` so draft artifacts cannot collide with the published `v1.0.4` release.
- Expanded methodology, offline-assurance, licensing, and operational-limit documentation for approximate geolocation and map interpretation.

### Fixed

- Draft-release validation and platform builds now fetch Git LFS assets so the bundled City Lite database is tested and packaged instead of its pointer file.
- Development authenticated startup no longer waits on or leaves visible a hidden sign-in/loading animation.

## [1.0.4] - 2026-08-30

### Added

- GitHub Actions workflow that validates a matching draft release and publishes Windows and Linux electron-builder artifacts whenever `dev` is updated.

### Changed

- Advanced development metadata to `1.0.4` so draft artifacts could not collide with the tagged `v1.0.3` release.
- Moved hardened Electron fuse configuration into electron-builder's native cross-platform integration.
- Updated GitHub Actions dependencies to Node.js 24-compatible releases.
- Removed macOS packaging from the release scope.

### Fixed

- Prevented parallel electron-builder publishers from creating duplicate drafts by separating artifact builds from one serialized GitHub release upload.
- Draft validation enumerates unpublished releases instead of relying on the tag endpoint, which can return `404` before a draft's Git tag is published.
- Release publication refuses drafts targeting another branch and tags pointing to a different source commit.

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

[Unreleased]: https://github.com/calebjubal/crypto-forensics/compare/v1.0.5...HEAD
[1.0.5]: https://github.com/calebjubal/crypto-forensics/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/calebjubal/crypto-forensics/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/calebjubal/crypto-forensics/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/calebjubal/crypto-forensics/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/calebjubal/crypto-forensics/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/calebjubal/crypto-forensics/releases/tag/v1.0.0
