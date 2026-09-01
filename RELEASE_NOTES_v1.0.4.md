# Satoshi Trace v1.0.4

Satoshi Trace v1.0.4 adds an entirely offline transaction world map to the Priority Leads workflow while preserving the application's port-free security boundary.

## Highlights

- **Full-case transaction map** — every imported network observation contributes to dotted, cluster-colored source-city-to-destination-city routes over a bundled Natural Earth outline.
- **Focused lead paths** — selecting a lead smoothly zooms and centers the map, dims the overview, and adds bold solid paths for its source and destination IPs, transaction, and input/output wallets; Inspect remains a separate evidence action. Reduced-motion preferences are respected.
- **Offline City Lite geolocation** — the packaged DB-IP City Lite September 2026 database resolves IPv4 and IPv6 without runtime network access or writes to evidentiary tables.
- **Disclosed fallbacks and limits** — supplied country metadata is used only as a labelled centroid fallback, unlocated endpoints remain visible in totals, and graph overflow is represented by count nodes.
- **Cluster color settings** — deterministic contrast-safe colors can be searched, customized, reset individually, or reset together and persist for the local investigator account.

## Interpretation warning

DB-IP City Lite locations are approximate visualization metadata. IP association and map position do not establish physical presence, identity, wallet ownership, or control. The application does not infer ISP, domain, connection type, postal code, or accuracy radius.

## Offline guarantee

The Natural Earth outline, DB-IP MMDB, country fallback data, Cytoscape runtime, and all interface assets are packaged locally. There are no online tiles, CDNs, runtime database updates, or geolocation requests.

## Verification

- 15 automated system and regression tests pass.
- The Electron workflow was visually checked with 240 synthetic transactions and 320 observations.
- Leads list filters leave full-case map totals unchanged; selecting a lead creates one focused overlay.
- The package archive includes the pinned City Lite MMDB, metadata/checksum, Natural Earth SVG, and country-centroid data.
- Production dependency audit reports zero known vulnerabilities.

See `THIRD_PARTY_NOTICES.md` for DB-IP attribution, dataset version and checksum, Natural Earth terms, and dependency notices.
