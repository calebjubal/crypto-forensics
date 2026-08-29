# Satoshi Trace v1.0.2

Satoshi Trace v1.0.2 is a maintenance and interface release focused on resilient error handling, exact large-value aggregation, and a consistent offline design system.

## Highlights

- **Dashboard-preserving error handling** — user-triggered failures are displayed as toasts instead of replacing the application view with raw error text.
- **Exact large Bitcoin totals** — valid SQLite satoshi aggregates can exceed JavaScript's safe integer range without breaking IPC responses.
- **Tailwind CSS and daisyUI interface** — shared controls now use a versioned `satoshi` theme compiled entirely into the packaged application.
- **Expanded documentation** — the repository now includes complete setup, schema, analysis, security, packaging, and operational guidance.

## Offline guarantee

The release continues to run without an application TCP/UDP listener or runtime internet dependency. Tailwind CSS and daisyUI are used only during the build; the distributable contains generated local CSS and does not contact a CDN.

## Verification

- 11 of 11 automated tests pass.
- Production npm audit: zero known vulnerabilities.
- Electron packaging succeeds with the local stylesheet included in ASAR.
- JavaScript syntax and Git whitespace checks pass.

## Distribution notes

- Windows release assets are generated with the Electron Forge Squirrel maker.
- Linux `.deb` and `.rpm` packages must be produced separately on compatible Linux build hosts.
- The current Windows build is unsigned unless a trusted code-signing identity is supplied through the release environment.

Investigative scores, clusters, and correlations remain hypotheses requiring human review and independent corroboration.
