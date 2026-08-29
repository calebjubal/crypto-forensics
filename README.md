# Satoshi Trace

Satoshi Trace is a port-free, offline Electron desktop application for correlating integrated Bitcoin blockchain and network-observation metadata. It streams CSV, JSON, and XML into embedded SQLite, scores explainable investigative leads using fixed rules plus a locally trained Isolation Forest, and creates conservative common-input entity-cluster hypotheses.

## Offline boundary

- The packaged app loads bundled `file://` assets. It does not start a web server or listen on TCP/UDP ports.
- Socket, HTTP(S), TLS, UDP, DNS, WebSocket, and `fetch` APIs are denied. Chromium network requests, permissions, navigation, downloads, remote windows, and non-proxied WebRTC UDP are blocked.
- SQLite, parsers, ML code, CSS, and UI assets are bundled. No runtime model, font, map, ASN, or geolocation download exists.
- UNC/network-share evidence paths are rejected. For defense in depth, run on a disconnected host or enforce an OS firewall; the app cannot govern unrelated OS processes.

## Input schema

Each integrated record requires `timestamp`, `src_ip`, `dst_ip`, `src_port`, `dst_port`, `txid`, `input_addresses[]`, `output_addresses[]`, `input_amounts[]`, `output_amounts[]`, and at least one of `geo_country` or `asn`.

- Timestamps use ISO 8601 with seconds and explicit timezone.
- TXIDs contain exactly 64 hex characters.
- Amounts are BTC decimals with at most 8 places and are stored as integer satoshis.
- CSV list fields are JSON arrays in cells; JSON uses a top-level record array; XML uses `<records><record>` and `<item>` array values.

## Development and packaging

```powershell
npm ci
npm test
npm run package
npm run make
```

`npm ci` is only needed to build. The packaged `out/Satoshi Trace-win32-x64` directory and installer contain the runtime and production dependencies; deployed workstations need no Node.js or internet connection.

## Interpretation

All scores and clusters are hypotheses for human review. IP observations never establish wallet ownership. Supplied country/ASN fields are not independently verified. Large transfers, fees, batching, consolidation, relays, NAT, shared infrastructure, and incomplete collection can all have benign explanations.
