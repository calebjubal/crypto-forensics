# Satoshi Trace v1.0.5

Satoshi Trace v1.0.5 adds an entirely offline transaction world map, clearer entity analysis, and graph-aware flow and exposure analysis while preserving the application's port-free security boundary.

## Highlights

- **Full-case transaction map** — every imported network observation contributes to dotted, cluster-colored source-city-to-destination-city routes over a bundled Natural Earth outline.
- **Focused lead paths** — selecting a lead smoothly fits the map, hides the overview routes, and shows only the bold, curved source IP, transaction, destination IP, and wallet path. IP markers remain at their approximate GeoIP coordinates; transaction and wallet nodes are explicitly logical rather than physical locations. Selecting that lead again restores the complete overview; Inspect remains separate.
- **Bounded world navigation** — zoom-out stops at the complete world view, vertical movement cannot reveal empty canvas, and east/west movement wraps across the Pacific seam.
- **Investigator map navigation** — drag to move, use a mouse wheel or pinch gesture to zoom, or use the accessible zoom and reset controls. Reduced-motion preferences are respected.
- **Offline City Lite geolocation** — the packaged DB-IP City Lite September 2026 database resolves IPv4 and IPv6 without runtime network access or writes to evidentiary tables.
- **Disclosed fallbacks and limits** — supplied country metadata is used only as a labelled centroid fallback, unlocated endpoints remain visible in totals, and graph overflow is represented by count nodes.
- **Cluster color settings** — deterministic contrast-safe colors can be searched, customized, reset individually, or reset together and persist for the local investigator account.
- **Graph-assisted entity hypotheses** — common-input components can be linked through deterministic 32-dimensional transaction-neighborhood embeddings only after repeated shared contexts, high cosine similarity, input-side evidence, collaborative-pattern exclusion, and a strict size cap.
- **Entity analysis dashboard** — case-wide cluster metrics, method badges, network glyphs, relative wallet/activity bars, and embedding-link counts make hypotheses easier to compare before opening the full Cytoscape graph.
- **Exact flow reconstruction** — bounded indexed tables link a transaction output to a later input only when wallet identifier and integer satoshi amount match uniquely; ambiguous, high-degree, and timestamp-conflict candidates are skipped and counted.
- **Conservative flow patterns** — 3–20-step peeling chains and directly linked CoinJoin-like mixing cascades receive deterministic confidence. A single CoinJoin-like transaction remains caution-only, adds no points, and cannot seed risk.
- **Explainable automatic exposure** — high-confidence detected patterns seed forward-only risk for at most four hops with strongest-path retention, cycle prevention, a risk-10 cutoff, and a saved decay formula. No manual or bundled illicit-wallet list is included.
- **Dedicated Flow Analysis screen** — summary cards and pattern/confidence/anomaly/risk filters sit beside compact isolated Cytoscape graphs with animated fit, pan, zoom, draggable nodes, keyboard access, and transaction drill-down.
- **Schema-v3 reports** — JSON includes complete patterns, members, exact links, automatic seeds, wallet/transaction paths, settings, and skipped-link diagnostics; CSV includes exposure, boost, pattern, hop, seed, and strongest-path columns.

## Interpretation warning

DB-IP City Lite locations are approximate visualization metadata. IP association and map position do not establish physical presence, identity, wallet ownership, or control. Common-input and embedding-assisted groups are also hypotheses that can produce false associations. Exact flow links, address reuse, CoinJoin-like structure, peeling chains, mixing cascades, anomaly, and propagated exposure do not prove laundering, illicit status, or ownership. First-observed network timestamps are not authoritative block times. The application does not infer ISP, domain, connection type, postal code, or accuracy radius.

## Offline guarantee

The Natural Earth outline, DB-IP MMDB, country fallback data, Cytoscape runtime, and all interface assets are packaged locally. There are no online tiles, CDNs, runtime database updates, or geolocation requests.

## Verification

- 24 automated system and regression tests pass.
- Peeling, linked mixing, lone-CoinJoin caution, ambiguity rejection, four-hop cutoff, deterministic reruns, cancellation rollback, flow-anomaly fallback, evidence deletion, and schema-v3 report fields are covered.
- The Flow Analysis workspace was visually checked with 130 synthetic transactions, pattern switching, compact graph isolation, and lead risk badges.
- The Electron workflow was visually checked with 240 synthetic transactions and 320 observations.
- Leads list filters leave full-case map totals unchanged; selecting a lead creates one focused overlay.
- The package archive includes the pinned City Lite MMDB, metadata/checksum, Natural Earth SVG, and country-centroid data.

See `THIRD_PARTY_NOTICES.md` for DB-IP attribution, dataset version and checksum, Natural Earth terms, and dependency notices.
