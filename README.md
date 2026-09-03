<div align="center">
  <img src="assets/icon.png" width="132" alt="Satoshi Trace logo">

  <h1>Satoshi Trace</h1>

  <p><strong>Offline Bitcoin transaction and network investigation.</strong></p>
  <p>Import evidence, find unusual activity, explore connections, and review explainable leads—all on the local computer.</p>

  <p>
    <img alt="Version 1.0.5" src="https://img.shields.io/badge/version-v1.0.5-E88435?style=for-the-badge">
    <img alt="Offline runtime" src="https://img.shields.io/badge/runtime-offline-248675?style=for-the-badge">
    <img alt="24 tests passing" src="https://img.shields.io/badge/tests-24_passing-248675?style=for-the-badge">
    <img alt="Windows and Linux" src="https://img.shields.io/badge/platform-Windows_%7C_Linux-5B7BAE?style=for-the-badge">
  </p>

  <p>
    <a href="https://github.com/calebjubal/crypto-forensics/releases"><strong>Download</strong></a>
    · <a href="#quick-start"><strong>Quick start</strong></a>
    · <a href="#required-evidence-fields"><strong>Evidence fields</strong></a>
    · <a href="CHANGELOG.md"><strong>Changelog</strong></a>
  </p>
</div>

---

Satoshi Trace is a desktop tool for examining Bitcoin transaction records together with IP, time, port, country, and ASN observations. It runs without a web server or internet connection and keeps the case database on the investigator's computer.

> [!IMPORTANT]
> Every score, map location, pattern, cluster, and risk path is an investigative lead—not proof of identity, ownership, laundering, location, or wrongdoing. Confirm findings with independent evidence.

## What it helps you do

- Import large CSV, JSON, or XML evidence files and track their source and checksum.
- Connect network observations to Bitcoin transactions through the transaction ID.
- View all observed activity on an offline world map.
- Detect unusual transactions, peeling-chain patterns, and linked CoinJoin-like activity.
- Follow explainable exposure paths from high-confidence pattern hypotheses.
- Explore possible wallet groups through interactive entity graphs.
- Review, annotate, and export prioritized leads as JSON or formula-safe CSV.

## How network and blockchain data are correlated

Each imported record contains both sides of the observation:

- **Network layer:** source and destination IPs, ports, timestamp, and supplied country and/or ASN metadata.
- **Blockchain layer:** transaction ID (`txid`), input and output wallets, and BTC amounts.

Satoshi Trace uses the `txid` as the shared key between these layers. During import, it validates and normalizes the fields, stores each network observation with its source-file provenance, and groups every observation carrying the same `txid` with that transaction's wallets and amounts. This makes it possible to compare when and where a transaction was observed, follow its wallet flow, and display the combined relationship in lead details, graphs, and the world map.

This correlation shows that an IP observation and transaction ID appeared together in the supplied evidence. It does not, by itself, prove that the IP owner controls a wallet or created the transaction.

## Quick start

1. Download the correct installer from [GitHub Releases](https://github.com/calebjubal/crypto-forensics/releases).
2. Move it to the investigation computer using your approved evidence-handling process.
3. Install and open Satoshi Trace.
4. Create the first local investigator account. There is no password recovery, so store the credentials securely.
5. Import one or more evidence files.
6. Run **Analysis** after importing or removing evidence.
7. Review Priority Leads, Flow Analysis, Entity Clusters, and the underlying transaction evidence before exporting findings.

## Understanding the screens

### Priority Leads and world map

The list ranks transactions as Critical, High, Medium, or Low and explains what contributed to each score. The map shows all case activity as dotted city-to-city routes.

Click a lead to hide the overview, smoothly zoom to that lead, and show only its IP, transaction, and wallet path. Click the same lead again to restore the full map. You can drag, zoom, and reset the map yourself. The Pacific edges wrap so the world remains continuous.

IP locations come from the bundled DB-IP City Lite database and are approximate. Transaction and wallet symbols show relationships; they are not physical locations.

### Flow Analysis

Flow Analysis highlights possible movement patterns:

- **Amber solid paths:** possible peeling chains.
- **Violet dashed paths:** directly linked CoinJoin-like sequences.
- **Red paths:** propagated exposure; thicker lines represent higher risk.
- **Single CoinJoin-like match:** caution only. It adds no score and never starts risk propagation.

Select a pattern to isolate and fit its graph. Nodes can be dragged, and the view can be panned or zoomed. Double-click a transaction to inspect its evidence.

### Entity Clusters

Entity Clusters groups wallets that may be controlled together, starting with the common-input heuristic and adding only strongly supported graph relationships. Summary cards make groups easier to compare before opening their detailed graph.

Clusters remain hypotheses. Shared services, collaborative transactions, and incomplete records can create false associations.

## How analysis works

- Transaction anomaly scores describe how unusual a transaction is compared with the imported case—not the probability of crime.
- Flow links require a unique match on wallet identifier and exact satoshi amount in a later observed transaction. Ambiguous and very high-volume matches are skipped and counted.
- Peeling and mixing detections use conservative structural rules. A separate flow anomaly score is available only when the case contains at least 32 patterns.
- Only detected peeling or mixing patterns with confidence of at least 70 can seed exposure risk.
- Risk moves forward for no more than four transaction hops, weakens at every hop, stops below 10, and keeps the strongest saved path.
- Lead scores are capped at 100 and retain a readable breakdown.

## Required evidence fields

Each record must contain:

| Field | Expected value |
| --- | --- |
| `timestamp` | ISO 8601 date and time with timezone |
| `src_ip`, `dst_ip` | Valid IPv4 or IPv6 addresses |
| `src_port`, `dst_port` | Integers from 0 to 65535 |
| `txid` | 64-character hexadecimal transaction ID |
| `input_addresses[]`, `output_addresses[]` | Wallet/address identifier arrays |
| `input_amounts[]`, `output_amounts[]` | BTC amount arrays with up to eight decimal places |
| `geo_country` or `asn` | At least one supplied country or ASN value |

Address and amount arrays must correspond to one another. BTC values are converted exactly to integer satoshis. Files may be CSV rows, a JSON array, or XML `<record>` elements.

## Offline and privacy design

- No application web server, localhost port, telemetry, cloud model, online map, updater, CDN, or runtime download.
- Network, remote navigation, downloads, permissions, and non-local browser activity are blocked in the packaged application.
- Evidence parsing, analysis, geolocation, graphs, and exports run locally.
- The case database, accounts, notes, and audit history remain on the workstation.
- Passwords are stored as salted scrypt hashes; UNC and network-share evidence paths are rejected.

For stronger isolation, use a disconnected workstation and your organization's firewall, access-control, backup, and evidence-handling procedures.

## Important limitations

- City Lite locations can be wrong or stale. Supplied country and ASN values are not independently verified.
- VPNs, relays, NAT, shared infrastructure, missing records, and clock differences can weaken IP attribution.
- First-observed network time is not authoritative blockchain time.
- Exact amount/address matches, anomalies, clusters, peeling patterns, mixing patterns, and exposure paths can all have legitimate explanations.
- City Lite does not provide ISP, connection type, postal code, domain, or an accuracy radius; Satoshi Trace does not invent these fields.
- There is no cloud backup, synchronization, telemetry, or password-recovery service.

## Build and test from source

Downloading development dependencies requires internet access once. The packaged application then runs offline.

```powershell
git clone https://github.com/calebjubal/crypto-forensics.git
cd crypto-forensics
npm ci
npm run verify
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm start` | Build the interface styles and launch the app |
| `npm test` | Run the 24 system and regression tests |
| `npm run package` | Build an unpacked app for the current computer |
| `npm run make` | Create distributable installers |
| `npm run verify` | Run tests and package the app |

Release candidates use the `dev` branch and a matching draft GitHub release. The workflow tests the source, fetches the bundled City Lite Git LFS asset, builds Windows and Linux packages, and uploads them to the draft for review. Production installers should be signed before distribution.

## License and data attribution

Satoshi Trace is distributed under the ISC license. See [`package.json`](package.json) for project metadata and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for dependency notices, Natural Earth terms, and the required DB-IP City Lite attribution and checksum.

---

<div align="center">
  <strong>Local evidence. Explainable leads. No network transport.</strong>
</div>
