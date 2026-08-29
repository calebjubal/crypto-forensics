# Satoshi Trace v1.0.3

Satoshi Trace v1.0.3 improves entity investigation, lead navigation, and host-connectivity visibility while preserving the application's port-free offline boundary.

## Highlights

- **Interactive entity-cluster graphs** — bundled Cytoscape views connect address members to related transactions with concentric and transaction-first layouts, pan and zoom, viewport fitting, node context, and transaction drill-down.
- **Bounded graph rendering** — large hypotheses disclose rendered and total link counts while limiting graph work to keep the desktop interface responsive.
- **Reliable Overview pagination** — Previous and Next retain the priority-lead query and five-row page size.
- **Better score differentiation** — lead tables expose the raw Isolation Forest anomaly value and use it to break otherwise tied triage scores.
- **Host connectivity badge** — the offline bar is red when the operating system reports offline and green when it reports online, without making a network request or weakening application transport blocking.

## Offline guarantee

Cytoscape and all graph assets are included in the application archive. The release does not load a CDN or create an application TCP/UDP listener, and no deployed dependency requires a runtime download.

## Verification

- 11 of 11 automated tests pass.
- Production npm audit: zero known vulnerabilities.
- Windows Electron Forge packaging and Squirrel distributable creation succeed.
- The packaged application reports version `1.0.3` and contains the local Cytoscape runtime.
- JavaScript syntax, formatting, and Git whitespace checks pass.
- Ring and flow graph layouts were visually inspected with synthetic evidence.

## Windows artifacts

| Artifact                         | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `Satoshi Trace-1.0.3 Setup.exe`  | `D67CAF7AC7B0A5F139C5B80D0738CE871E850E6906EE4FBB916C592C9BAB2D67` |
| `satoshi_trace-1.0.3-full.nupkg` | `3E49C865026930EF37C22E7EE6ED67528FAAF4AB091854B1BFF285845289934D` |
| `RELEASES`                       | `7041B010BCCBDB3ADCCDDD44DF21411EE1137EB8ECBFBADDE2B7F44F67624176` |

The generated Windows installer is **not digitally signed**. Sign the final artifacts with the publisher's trusted code-signing identity before public distribution, then regenerate the checksums because signing changes the files.

Linux `.deb` and `.rpm` packages must be built separately on compatible Linux build hosts.

Investigative scores, clusters, and correlations remain hypotheses requiring human review and independent corroboration.
