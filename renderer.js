"use strict";
document.addEventListener(
  "click",
  (event) => {
    const tx = event.target.closest("[data-tx]")?.dataset.tx,
      cluster = event.target.closest("[data-cluster]")?.dataset.cluster,
      errors = event.target.closest("[data-errors]");
    if (tx)
      window.forensics
        .auditEvent({ action: "transaction.opened", details: { txid: tx } })
        .catch(() => {});
    else if (cluster)
      window.forensics
        .auditEvent({ action: "cluster.opened", details: { id: cluster } })
        .catch(() => {});
    else if (errors)
      window.forensics
        .auditEvent({
          action: "import.errors_opened",
          details: { id: errors.dataset.errors, name: errors.dataset.name },
        })
        .catch(() => {});
  },
  true,
);
const api = window.forensics,
  main = document.getElementById("main"),
  navigation = document.getElementById("navigation"),
  breadcrumb = document.getElementById("breadcrumb"),
  dialog = document.getElementById("detail-dialog"),
  dialogBody = document.getElementById("dialog-body"),
  appShell = document.getElementById("app-shell"),
  loadingScreen = document.getElementById("loading-screen"),
  authScreen = document.getElementById("auth-screen");
const state = {
  route: "overview",
  summary: null,
  search: "",
  priority: "All priorities",
  status: "All statuses",
  offset: 0,
  limit: 25,
  busy: false,
  selectedTx: null,
  selectedLead: null,
  clusterGraph: null,
  flowGraph: null,
  selectedFlow: null,
  flowType: "",
  flowConfidence: 0,
  flowRisk: 0,
  flowAnomaly: 0,
  mapGraph: null,
  mapOverview: null,
  mapResizeObserver: null,
  mapViewAnimation: null,
  mapElementZoom: null,
  mapViewportGuard: false,
  settingsSearch: "",
  username: "",
  authMode: "login",
};
const routes = [
  ["overview", "Overview", "grid"],
  ["evidence", "Evidence imports", "database"],
  ["transactions", "Transactions", "transaction"],
  ["clusters", "Entity clusters", "cluster"],
  ["flows", "Flow analysis", "flow"],
  ["leads", "Priority leads", "flag"],
  ["activity", "Activity log", "audit"],
  ["methodology", "Methodology", "shield"],
  ["system", "Offline assurance", "lock"],
  ["settings", "Settings", "settings"],
];
const icons = {
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
  database:
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  transaction: '<path d="M4 7h15M15 3l4 4-4 4M20 17H5M9 13l-4 4 4 4"/>',
  cluster:
    '<circle cx="5" cy="12" r="3"/><circle cx="19" cy="6" r="3"/><circle cx="19" cy="18" r="3"/><path d="M8 11l8-4M8 13l8 4"/>',
  flow: '<path d="M4 5h7v5H4zM13 14h7v5h-7zM11 7h3a4 4 0 014 4v3M13 17h-3a4 4 0 01-4-4v-3"/>',
  flag: '<path d="M5 21V4m0 1h12l-2 4 2 4H5"/>',
  shield:
    '<path d="M12 22s8-3.4 8-10V5l-8-3-8 3v7c0 6.6 8 10 8 10zM9 12l2 2 4-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
  upload: '<path d="M12 16V3m-5 5l5-5 5 5M4 16v4h16v-4"/>',
  audit: '<path d="M4 5h16M4 12h16M4 19h10"/><circle cx="18" cy="19" r="2"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6v.2h-4v-.2a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 00.3-1.9A1.7 1.7 0 003 14H2.8v-4H3a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 001.9.3A1.7 1.7 0 0010 3v-.2h4V3a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 00-.3 1.9 1.7 1.7 0 001.6 1h.2v4H21a1.7 1.7 0 00-1.6 1z"/>',
};
function icon(n) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n] || icons.grid}</svg>`;
}
function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function num(n) {
  return new Intl.NumberFormat("en-US", {
    notation: Number(n) >= 1e6 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(Number(n) || 0);
}
function btc(s) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format((Number(s) || 0) / 1e8)} BTC`;
}
function date(v) {
  return v
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(v)) + " UTC"
    : "—";
}
function trunc(v, l = 14) {
  v = String(v || "");
  return v.length > l ? `${v.slice(0, 8)}…${v.slice(-5)}` : v;
}
function badge(p = "Low") {
  return `<span class="badge ${esc(p.toLowerCase())}">${esc(p)}</span>`;
}
const CLUSTER_PALETTE = [
  "#38bdf8",
  "#f59e0b",
  "#34d399",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#22d3ee",
  "#facc15",
  "#4ade80",
  "#c084fc",
  "#60a5fa",
  "#f97316",
];
function colorStorageKey() {
  return `satoshi-trace.cluster-colors.v1:${state.username || "local"}`;
}
function colorOverrides() {
  try {
    const stored = JSON.parse(localStorage.getItem(colorStorageKey()) || "{}");
    return Object.fromEntries(
      Object.entries(stored).filter(
        ([key, value]) => key && /^#[0-9a-f]{6}$/i.test(value),
      ),
    );
  } catch {
    return {};
  }
}
function defaultClusterColor(id) {
  let hash = 2166136261;
  for (const character of String(id || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return CLUSTER_PALETTE[Math.abs(hash) % CLUSTER_PALETTE.length];
}
function clusterColor(id) {
  if (!id) return "#7890aa";
  return colorOverrides()[id] || defaultClusterColor(id);
}
function saveClusterColor(id, value) {
  if (!id || !/^#[0-9a-f]{6}$/i.test(value)) return;
  const overrides = colorOverrides();
  overrides[id] = value.toLowerCase();
  localStorage.setItem(colorStorageKey(), JSON.stringify(overrides));
}
function resetClusterColor(id) {
  const overrides = colorOverrides();
  delete overrides[id];
  localStorage.setItem(colorStorageKey(), JSON.stringify(overrides));
}
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches,
  animations = [];
function startLoadingAnimation() {
  if (reducedMotion || !window.anime?.animate) return;
  const { animate, stagger } = window.anime;
  animations.push(
    animate("#loading-logo", {
      scale: [0.88, 1.04, 0.96],
      rotate: ["-4deg", "2deg", "0deg"],
      duration: 1800,
      ease: "inOutSine",
      loop: true,
    }),
  );
  animations.push(
    animate(".loading-orbit", {
      rotate: "1turn",
      duration: 5200,
      ease: "linear",
      loop: true,
    }),
  );
  animations.push(
    animate(".loading-orbit i", {
      scale: [0.65, 1.3, 0.65],
      opacity: [0.45, 1, 0.45],
      delay: stagger(180),
      duration: 1250,
      ease: "inOutSine",
      loop: true,
    }),
  );
  animations.push(
    animate(".loading-track span", {
      translateX: ["-110%", "310%"],
      duration: 1500,
      ease: "inOutQuad",
      loop: true,
    }),
  );
}
function stopLoadingAnimation() {
  for (const animation of animations) animation.pause?.();
  animations.length = 0;
}
function parseDetails(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return { message: String(value || "") };
  }
}
function toast(message, error = false) {
  const n = document.getElementById("toast");
  n.textContent = message;
  n.classList.toggle("error", error);
  n.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (n.hidden = true), 5500);
}
function fail(e) {
  console.error(e);
  toast(e?.message || String(e), true);
}
window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  fail(event.reason || new Error("The operation could not be completed."));
});
window.addEventListener("error", (event) => {
  fail(
    event.error || new Error(event.message || "Unexpected application error."),
  );
});
const connectivityPill = document.getElementById("connectivity-pill"),
  connectivityLabel = document.getElementById("connectivity-label");
function renderConnectivityStatus() {
  const online = navigator.onLine;
  connectivityPill.dataset.online = String(online);
  connectivityPill.classList.toggle("badge-success", online);
  connectivityPill.classList.toggle("badge-error", !online);
  connectivityLabel.textContent = online ? "Online" : "Offline";
  connectivityPill.setAttribute(
    "aria-label",
    `System connectivity: ${online ? "online" : "offline"}`,
  );
  connectivityPill.title = online
    ? "The operating system reports network connectivity. Satoshi Trace remains network-isolated and makes no internet requests."
    : "The operating system reports no network connectivity. Satoshi Trace remains network-isolated in every state.";
}
window.addEventListener("online", renderConnectivityStatus);
window.addEventListener("offline", renderConnectivityStatus);
renderConnectivityStatus();
function heading(e, t, d, a = "") {
  return `<div class="page-heading"><div><div class="eyebrow">${esc(e)}</div><h1>${esc(t)}</h1><p>${esc(d)}</p></div><div class="heading-actions">${a}</div></div>`;
}
function setBusy(v) {
  state.busy = v;
  document.querySelectorAll("button").forEach((b) => {
    if (!["cancel-job", "close-dialog"].includes(b.id)) b.disabled = v;
  });
}
function renderNav() {
  navigation.innerHTML = routes
    .map(
      ([id, l, i]) =>
        `<button class="nav-button ${state.route === id ? "active" : ""}" data-route="${id}"><span class="nav-icon">${icon(i)}</span>${l}${id === "leads" && state.summary?.leads ? `<span class="nav-count">${num(state.summary.leads)}</span>` : ""}</button>`,
    )
    .join("");
}
async function refreshSummary() {
  state.summary = await api.summary();
  renderNav();
}
function staleNotice() {
  return state.summary?.stale && state.summary.transactions
    ? `<div class="notice"><span><strong>Analysis is out of date.</strong> New evidence was imported after the last model run. Stored results are labeled stale until re-analysis.</span><button class="button button-accent" data-action="analyze">Run analysis</button></div>`
    : "";
}
function empty(type) {
  if (!state.summary?.transactions)
    return `<div class="empty"><div class="empty-symbol">◇</div><h3>No evidence imported</h3><p>Import integrated CSV, JSON, or XML evidence to begin.</p><button class="button button-primary" data-action="import">Import evidence</button></div>`;
  return `<div class="empty"><div class="empty-symbol">⌁</div><h3>No ${esc(type)} match</h3><p>Adjust the filters or run analysis after importing new evidence.</p></div>`;
}
function metric(l, v, d, i) {
  return `<article class="metric"><div class="metric-top"><span>${esc(l)}</span><span class="metric-icon">${icon(i)}</span></div><div class="metric-value">${esc(v)}</div><div class="metric-bottom">${d}</div></article>`;
}
function trend(points) {
  if (!points?.length)
    return '<div class="empty-chart">No observation timeline yet</div>';
  const m = Math.max(...points.map((p) => Number(p.count))),
    w = 420,
    b = Math.max(6, Math.min(23, (w - 34) / points.length - 5));
  return `<svg class="chart" viewBox="0 0 ${w} 150" role="img" aria-label="Daily observation volume"><line class="chart-axis" x1="20" y1="24" x2="410" y2="24"/><line class="chart-axis" x1="20" y1="73" x2="410" y2="73"/><line class="chart-axis" x1="20" y1="122" x2="410" y2="122"/>${points
    .map((p, i) => {
      const x = 24 + i * ((w - 40) / points.length),
        h = Math.max(3, Math.round((Number(p.count) / m) * 105));
      return `<rect class="chart-bar ${i === points.length - 1 ? "highlight" : ""}" x="${x}" y="${125 - h}" width="${b}" height="${h}" rx="2"><title>${esc(p.day)}: ${p.count} observations</title></rect>`;
    })
    .join(
      "",
    )}<text x="20" y="145">${esc(points[0].day.slice(5))}</text><text x="365" y="145">${esc(points.at(-1).day.slice(5))}</text></svg>`;
}
function countries(rows, total) {
  return rows?.length
    ? rows
        .map(
          (r) =>
            `<div class="country-row"><span class="country-code">${esc(r.country)}</span><svg class="country-bar" viewBox="0 0 170 8" preserveAspectRatio="none"><rect width="${Math.max(2, Math.round((r.count / Math.max(1, total)) * 170))}" height="8" rx="3"/></svg><span class="country-number">${num(r.count)}</span></div>`,
        )
        .join("")
    : '<div class="empty-chart">No supplied country metadata</div>';
}
function sources(rows) {
  return rows?.length
    ? rows
        .slice(0, 4)
        .map(
          (x) =>
            `<div class="source-row"><span class="file-icon">${esc(x.format)}</span><div><strong>${esc(x.name)}</strong><small>${num(x.rows)} rows · ${num(x.bytes)} bytes · ${date(x.created)}</small></div><span class="source-status">${x.rejected ? `${x.rejected} rejected` : "✓ Verified"}</span></div>`,
        )
        .join("")
    : '<div class="empty-chart">No evidence sources</div>';
}
async function overview() {
  const s = state.summary;
  const actions = s.transactions
    ? `<button class="button" data-action="import">${icon("upload")} Import evidence</button><button class="button button-primary" data-action="analyze">Run analysis</button>`
    : "";
  if (!s.transactions) {
    main.innerHTML =
      heading(
        "CASE OVERVIEW",
        "Investigation overview",
        "Case status and analysis results.",
      ) + `<section class="panel">${empty("evidence")}</section>`;
    return;
  }
  const leads = await api.page({ type: "leads", options: { limit: 5 } });
  main.innerHTML =
    heading(
      "CASE OVERVIEW",
      "Investigation overview",
      "Network and blockchain evidence processed on this machine.",
      actions,
    ) +
    staleNotice() +
    `<section class="metrics">${metric("Transactions", num(s.transactions), `${num(s.observations)} network observations`, "transaction")}${metric("Addresses", num(s.addresses), "Observed inputs and outputs", "database")}${metric("Entity clusters", num(s.clusters), "Multi-address hypotheses", "cluster")}${metric("Priority leads", num(s.leads), `${num(s.urgent)} high or critical`, "flag")}</section><section class="panel overview-chart"><div class="panel-head"><div><h2>Observation activity</h2><p>Daily UTC network observations</p></div><span class="tag">${s.timeline.length} DAYS</span></div><div class="chart-summary"><span class="chart-number">${num(s.observations)}</span><span>observations</span></div>${trend(s.timeline)}</section><section class="panel mt"><div class="panel-head"><div><h2>Priority leads</h2><p>Integer rule score · raw anomaly breaks ties</p></div><button class="link-button" data-route="leads">View all →</button></div><div class="results">${leadTable(leads)}</div></section><section class="bottom-grid"><article class="panel"><div class="panel-head"><div><h2>Evidence sources</h2><p>SHA-256 provenance</p></div><button class="link-button" data-route="evidence">View imports →</button></div><div class="panel-body">${sources(s.imports)}</div></article><article class="panel"><div class="panel-head"><div><h2>Country metadata</h2><p>Values supplied in the dataset</p></div></div><div class="panel-body">${countries(s.countries, s.observations)}</div></article></section>`;
}
function pager(d, type) {
  return `<div class="pagination"><button class="button button-small" data-page="${Math.max(0, d.offset - d.limit)}" data-page-type="${type}" data-page-limit="${d.limit}" ${d.offset ? "" : "disabled"}>Previous</button><span>${Math.floor(d.offset / d.limit) + 1} / ${Math.max(1, Math.ceil(d.total / d.limit))}</span><button class="button button-small" data-page="${d.offset + d.limit}" data-page-type="${type}" data-page-limit="${d.limit}" ${d.offset + d.limit < d.total ? "" : "disabled"}>Next</button></div>`;
}
function leadTable(d) {
  if (!d.rows.length) return empty("priority leads");
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>PRIORITY</th><th>TRANSACTION / FIRST OBSERVED</th><th>CATEGORY</th><th>EXPOSURE</th><th>SCORE</th><th>STATUS</th><th></th></tr></thead><tbody>${d.rows.map((r) => `<tr><td>${badge(r.priority)}</td><td><button class="tx-link" data-tx="${esc(r.txid)}">${esc(trunc(r.txid, 24))}</button><small>${date(r.timestamp)}</small></td><td>${esc(r.category)}<small>${r.pattern_types ? esc(r.pattern_types.replaceAll(",", " · ")) : r.coinjoin ? "CoinJoin-like caution" : ""}</small></td><td>${Number(r.exposure_risk) ? `<span class="risk-badge">${Number(r.exposure_risk).toFixed(1)}</span><small>+${r.risk_boost} score</small>` : '<span class="muted">None</span>'}</td><td class="score">${r.score}<span>/100</span><small class="score-detail" title="Raw Isolation Forest anomaly score; relative unusualness, not risk probability">Anomaly ${r.anomaly === null ? "—" : Number(r.anomaly).toFixed(3)}</small></td><td class="status-label">${esc(r.status)}</td><td><button class="link-button" data-tx="${esc(r.txid)}">Inspect →</button></td></tr>`).join("")}</tbody></table></div><div class="table-footer"><span>Showing ${d.offset + 1}–${Math.min(d.total, d.offset + d.rows.length)} of ${num(d.total)} leads</span>${pager(d, "leads")}</div>`;
}
function txTable(d) {
  if (!d.rows.length) return empty("transactions");
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>TXID / FIRST OBSERVED</th><th>OUTPUT VALUE</th><th>FEE</th><th>NETWORK OBS.</th><th>LEAD PRIORITY</th><th></th></tr></thead><tbody>${d.rows.map((r) => `<tr><td><button class="tx-link" data-tx="${esc(r.txid)}">${esc(trunc(r.txid, 30))}</button><small>${date(r.timestamp)}</small></td><td>${btc(r.output_sat)}</td><td>${btc(r.fee_sat)}</td><td>${num(r.observations)}</td><td>${r.priority ? badge(r.priority) : '<span class="muted">Not analyzed</span>'}</td><td><button class="link-button" data-tx="${esc(r.txid)}">Open →</button></td></tr>`).join("")}</tbody></table></div><div class="table-footer"><span>Showing ${d.offset + 1}–${Math.min(d.total, d.offset + d.rows.length)} of ${num(d.total)} transactions</span>${pager(d, "transactions")}</div>`;
}
function toolbar(kind) {
  return `<div class="toolbar"><label class="search"><span class="screen-reader">Search</span><input id="search-input" type="text" value="${esc(state.search)}" placeholder="Search TXID, address, or IP…"></label>${kind === "leads" ? `<select id="priority-filter" aria-label="Filter priority">${["All priorities", "Critical", "High", "Medium"].map((x) => `<option ${state.priority === x ? "selected" : ""}>${x}</option>`).join("")}</select><select id="status-filter" aria-label="Filter status">${["All statuses", "New", "In review", "Escalated", "Dismissed"].map((x) => `<option ${state.status === x ? "selected" : ""}>${x}</option>`).join("")}</select>` : ""}<span class="count">Local indexed search</span></div>`;
}
async function listing(type) {
  const leads = type === "leads";
  main.innerHTML =
    heading(
      leads ? "TRIAGED RESULTS" : "BLOCKCHAIN EVIDENCE",
      leads ? "Priority leads" : "Transactions",
      leads
        ? "Review prioritized hypotheses. Integer rule scores drive priority; raw anomaly values break ties."
        : "Browse normalized transactions and correlated network observations.",
      leads
        ? '<button class="button" data-action="export-json">Export JSON</button><button class="button" data-action="export-csv">Export CSV</button><button class="button button-primary" data-action="analyze">Re-run analysis</button>'
        : `<button class="button" data-action="import">${icon("upload")} Import evidence</button>`,
    ) +
    staleNotice() +
    `<section class="panel">${toolbar(type)}<div class="results"><div class="loading">Querying local index…</div></div></section>`;
  await refreshList(type);
}
async function refreshList(type, limit = state.limit) {
  try {
    const d = await api.page({
      type,
      options: {
        search: state.search,
        priority: state.priority,
        status: state.status,
        offset: state.offset,
        limit,
      },
    });
    document.querySelector(".results").innerHTML =
      type === "leads" ? leadTable(d) : txTable(d);
  } catch (e) {
    fail(e);
  }
}
function mapLeadList(d) {
  if (!d.rows.length)
    return '<div class="map-list-empty">No leads match the current filters.</div>';
  return `<div class="map-lead-list" role="listbox" aria-label="Priority leads">${d.rows
    .map(
      (row) =>
        `<article class="map-lead-card ${state.selectedLead === row.txid ? "selected" : ""}" role="option" tabindex="0" aria-selected="${state.selectedLead === row.txid}" data-map-lead="${esc(row.txid)}"><div class="map-lead-card-top">${badge(row.priority)}<span class="map-lead-score">${row.score}<small>/100</small></span></div><strong class="mono" title="${esc(row.txid)}">${esc(trunc(row.txid, 28))}</strong><p>${esc(row.category)} · ${date(row.timestamp)}</p>${row.pattern_types || Number(row.exposure_risk) ? `<div class="lead-signal-row">${row.pattern_types ? `<span>${esc(row.pattern_types.replaceAll(",", " · "))}</span>` : ""}${Number(row.exposure_risk) ? `<span class="risk-badge">Risk ${Number(row.exposure_risk).toFixed(1)}</span>` : ""}</div>` : ""}<div class="map-lead-card-bottom"><span class="mono">${esc(row.src_ip || "No source IP")}</span><span>${esc(row.status)}</span><button class="link-button" data-tx="${esc(row.txid)}">Inspect →</button></div></article>`,
    )
    .join("")}</div><div class="map-lead-pagination"><span>${d.offset + 1}–${Math.min(d.total, d.offset + d.rows.length)} of ${num(d.total)}</span>${pager(d, "leads-map")}</div>`;
}
async function refreshMapLeadList(limit = state.limit) {
  try {
    const data = await api.page({
      type: "leads",
      options: {
        search: state.search,
        priority: state.priority,
        status: state.status,
        offset: state.offset,
        limit,
      },
    });
    const results = document.querySelector(".map-lead-results");
    if (results) results.innerHTML = mapLeadList(data);
  } catch (error) {
    fail(error);
  }
}
async function leadsWorkspace() {
  destroyMapGraph();
  state.selectedLead = null;
  main.innerHTML =
    heading(
      "GLOBAL TRANSACTION INTELLIGENCE",
      "Priority leads map",
      "Review flagged hypotheses against the full offline network-observation context.",
      '<button class="button" data-action="export-json">Export JSON</button><button class="button" data-action="export-csv">Export CSV</button><button class="button button-primary" data-action="analyze">Re-run analysis</button>',
    ) +
    staleNotice() +
    `<section class="lead-map-layout"><aside class="map-lead-panel panel"><div class="map-lead-toolbar"><label class="search"><span class="screen-reader">Search priority leads</span><input id="search-input" type="text" value="${esc(state.search)}" placeholder="Search TXID, wallet, or IP…"></label><div class="map-lead-filters"><select id="priority-filter" aria-label="Filter priority">${["All priorities", "Critical", "High", "Medium"].map((value) => `<option ${state.priority === value ? "selected" : ""}>${value}</option>`).join("")}</select><select id="status-filter" aria-label="Filter status">${["All statuses", "New", "In review", "Escalated", "Dismissed"].map((value) => `<option ${state.status === value ? "selected" : ""}>${value}</option>`).join("")}</select></div></div><div class="map-lead-results"><div class="loading">Loading flag list…</div></div></aside><section class="transaction-map-panel" aria-label="Transaction world map"><div class="transaction-map-head"><div><span class="eyebrow">FULL CASE CONTEXT</span><h2>Transaction routes</h2><p id="map-caption">Loading offline city correlations…</p></div><button class="map-clear button button-small" data-map-clear hidden>Clear focus</button></div><div id="map-stats" class="map-stats" aria-live="polite"></div><div class="transaction-map-stage"><div id="transaction-map" class="transaction-map" role="img" aria-label="Interactive world map of transaction observations. IP markers use approximate GeoIP coordinates. Drag to move and use the mouse wheel or controls to zoom."></div><div class="map-navigation" role="group" aria-label="Map navigation"><button type="button" data-map-zoom="in" aria-label="Zoom in" title="Zoom in">+</button><button type="button" data-map-zoom="out" aria-label="Zoom out" title="Zoom out">−</button><button type="button" data-map-zoom="reset" aria-label="Reset map view" title="Reset map view">Reset</button></div><div id="map-empty" class="map-empty" hidden></div></div><div class="transaction-map-legend"><span><i class="map-key dotted"></i>Aggregated transaction route</span><span><i class="map-key solid"></i>Curved selected path</span><span><i class="map-key wallet"></i>Logical wallet / transaction nodes</span><span>IP markers use approximate GeoIP positions · drag to move · wheel or pinch to zoom</span></div><div class="map-status"><span id="map-selection">Select a lead to show only its IP, transaction, and wallet path. Select it again to restore all routes.</span><span id="map-attribution"></span></div></section></section>`;
  await refreshMapLeadList();
  await loadMapOverview();
}
function schema() {
  return [
    ["timestamp", "ISO 8601 + timezone"],
    ["src_ip / dst_ip", "IPv4 or IPv6"],
    ["src_port / dst_port", "Integer 0–65,535"],
    ["txid", "64 hexadecimal characters"],
    ["input_addresses[]", "1–10,000 address identifiers"],
    ["output_addresses[]", "1–10,000 address identifiers"],
    ["input_amounts[]", "BTC decimals, ≤8 places"],
    ["output_amounts[]", "BTC decimals, ≤8 places"],
    ["geo_country / asn", "At least one is required"],
  ]
    .map(
      ([a, b]) =>
        `<div class="schema-item"><strong>${a}</strong><p>${b}</p></div>`,
    )
    .join("");
}
async function evidence() {
  const rows = state.summary.imports;
  main.innerHTML =
    heading(
      "INGESTION & PROVENANCE",
      "Evidence imports",
      "Add, inspect, and remove local CSV, JSON, or XML sources.",
    ) +
    staleNotice() +
    `<section class="import-zone"><div class="import-zone-icon">⇩</div><div><h2>Add evidence files</h2><p>Select one or many files now, then return at any time to add more.</p><div class="format-tags"><span class="tag">CSV · JSON list cells</span><span class="tag">JSON · top-level array</span><span class="tag">XML · records / record</span></div></div><button class="button button-accent" data-action="import">Choose files</button></section><section class="two-col"><article class="panel"><div class="panel-head"><div><h2>Required schema</h2><p>Integrated rows join both layers by TXID</p></div></div><div class="panel-body"><div class="schema-list">${schema()}</div></div></article><article class="panel"><div class="panel-head"><div><h2>Source management</h2></div></div><div class="panel-body form-note">Every import is timestamped and hashed. Removing a source deletes only observations no longer supported by another imported file; the original disk file is never deleted. Derived analysis is cleared until it is run again.</div></article></section><section class="panel"><div class="panel-head"><div><h2>Source ledger</h2><p>Hashes, ingestion timestamps, row outcomes, and controls</p></div><span class="pill-number">${rows.length} FILES</span></div>${rows.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>FILE</th><th>SHA-256</th><th>ROWS</th><th>ACCEPTED</th><th>DUPLICATES</th><th>REJECTED</th><th>INGESTED</th><th>ACTIONS</th></tr></thead><tbody>${rows.map((x) => `<tr><td><span class="file-icon">${esc(x.format)}</span> ${esc(x.name)}</td><td class="mono truncate" title="${esc(x.sha256)}">${esc(trunc(x.sha256, 24))}</td><td>${num(x.rows)}</td><td>${num(x.accepted)}</td><td>${num(x.duplicates)}</td><td>${x.rejected ? `<span class="badge critical">${x.rejected}</span>` : "0"}</td><td>${date(x.created)}</td><td><div class="source-actions">${x.rejected ? `<button class="link-button" data-errors="${esc(x.id)}" data-name="${esc(x.name)}">Errors</button>` : ""}<button class="button button-small button-danger" data-delete-import="${esc(x.id)}" data-name="${esc(x.name)}">Remove</button></div></td></tr>`).join("")}</tbody></table></div>` : empty("evidence sources")}</section>`;
}
function activityRows(d) {
  if (!d.rows.length) return '<div class="empty">No operations recorded.</div>';
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>TIME</th><th>OPERATION</th><th>USER</th><th>DETAILS</th></tr></thead><tbody>${d.rows
    .map((row) => {
      const details = parseDetails(row.details),
        actor = details.actor || "System";
      delete details.actor;
      delete details.sessionId;
      return `<tr><td>${date(row.timestamp)}</td><td class="activity-action">${esc(row.action)}</td><td><span class="actor-chip">${esc(actor)}</span></td><td class="activity-details">${esc(Object.keys(details).length ? JSON.stringify(details) : "—")}</td></tr>`;
    })
    .join(
      "",
    )}</tbody></table></div><div class="table-footer"><span>${num(d.total)} recorded operations</span>${pager(d, "audit")}</div>`;
}
async function activity() {
  main.innerHTML =
    heading(
      "ACCOUNTABILITY",
      "Activity log",
      "Chronological local record beginning when the application starts.",
    ) +
    `<section class="panel"><div class="panel-head"><div><h2>Operation ledger</h2><p>Authentication, navigation, ingestion, analysis, review, export, and source removal</p></div><span class="tag">LOCAL AUDIT</span></div><div class="results"><div class="loading">Reading activity ledger…</div></div></section>`;
  const d = await api.page({
    type: "audit",
    options: { offset: state.offset, limit: state.limit },
  });
  document.querySelector(".results").innerHTML = activityRows(d);
}
function clusterGlyph(graphAssisted) {
  return `<svg viewBox="0 0 112 58" aria-hidden="true"><path d="M18 30L48 14L76 28L98 12M48 14L58 48L76 28L98 46"/><circle cx="18" cy="30" r="7"/><circle cx="48" cy="14" r="7"/><circle cx="58" cy="48" r="7"/><circle cx="76" cy="28" r="7"/><circle cx="98" cy="12" r="6"/><circle cx="98" cy="46" r="6"/>${graphAssisted ? '<path class="embedding-link" d="M18 30C40 2 73 55 98 12"/>' : ""}</svg>`;
}
function clusterSummary(stats) {
  return `<section class="cluster-summary" aria-label="Entity cluster overview"><article><span class="cluster-summary-icon">◎</span><div><strong>${num(stats.hypotheses)}</strong><small>Multi-wallet hypotheses</small></div></article><article><span class="cluster-summary-icon">◫</span><div><strong>${num(stats.wallets)}</strong><small>Wallets grouped</small></div></article><article><span class="cluster-summary-icon">⌁</span><div><strong>${num(stats.graph_assisted)}</strong><small>Graph-assisted groups</small></div></article><article><span class="cluster-summary-icon">↗</span><div><strong>${num(stats.largest)}</strong><small>Largest group</small></div></article></section>`;
}
function clusterCards(data) {
  const maximumSize = Math.max(1, ...data.rows.map((row) => row.size)),
    maximumTransactions = Math.max(
      1,
      ...data.rows.map((row) => row.tx_count),
    );
  return `<div class="cluster-grid">${data.rows
    .map((cluster, index) => {
      const graphAssisted = cluster.embedding_links > 0,
        sizeWidth = Math.max(7, Math.round((cluster.size / maximumSize) * 100)),
        transactionWidth = Math.max(
          7,
          Math.round((cluster.tx_count / maximumTransactions) * 100),
        ),
        density = cluster.size
          ? (cluster.tx_count / cluster.size).toFixed(1)
          : "0.0";
      return `<article class="cluster-card ${graphAssisted ? "is-assisted" : ""}" data-cluster-accent="${esc(clusterColor(cluster.id))}" data-cluster-size="${sizeWidth}" data-cluster-activity="${transactionWidth}"><div class="cluster-card-head"><span class="cluster-rank">#${String(data.offset + index + 1).padStart(2, "0")}</span><span class="cluster-method">${graphAssisted ? "GRAPH ASSISTED" : "COMMON INPUT"}</span></div><div class="cluster-card-visual">${clusterGlyph(graphAssisted)}<div><small>ENTITY HYPOTHESIS</small><h3>${esc(cluster.id)}</h3><span>${density} transactions per wallet</span></div></div><div class="cluster-bars"><div><span><b>Wallet footprint</b><em>${num(cluster.size)}</em></span><i role="progressbar" aria-label="Relative wallet footprint" aria-valuemin="0" aria-valuemax="${maximumSize}" aria-valuenow="${cluster.size}"><u class="size"></u></i></div><div><span><b>Transaction activity</b><em>${num(cluster.tx_count)}</em></span><i role="progressbar" aria-label="Relative transaction activity" aria-valuemin="0" aria-valuemax="${maximumTransactions}" aria-valuenow="${cluster.tx_count}"><u class="activity"></u></i></div></div><div class="cluster-card-foot"><div><strong>${num(cluster.embedding_links)}</strong><small>embedding links</small></div><button class="button" data-cluster="${esc(cluster.id)}">Explore graph →</button></div></article>`;
    })
    .join("")}</div><div class="table-footer"><span>${data.offset + 1}–${Math.min(data.total, data.offset + data.rows.length)} of ${num(data.total)}</span>${pager(data, "clusters")}</div>`;
}
async function clusters() {
  main.innerHTML =
    heading(
      "ENTITY RESOLUTION",
      "Entity clusters",
      "Common-input ownership and graph-embedding hypotheses. Network metadata never merges wallets.",
      '<button class="button button-primary" data-action="analyze">Rebuild clusters</button>',
    ) +
    staleNotice() +
    `<div class="notice"><span><strong>Heuristic—not identity proof.</strong> Possible collaborative transactions are excluded. Embedding links require repeated shared transaction neighborhoods and high similarity; change-address and IP-ownership heuristics are not used.</span><button class="link-button" data-route="methodology">Read method →</button></div><div id="cluster-summary"><div class="loading">Summarizing entity hypotheses…</div></div><section class="panel cluster-catalog"><div class="toolbar"><div><span class="toolbar-eyebrow">HYPOTHESIS CATALOG</span><label class="search"><span class="screen-reader">Search</span><input id="search-input" type="text" value="${esc(state.search)}" placeholder="Find cluster ID or wallet…"></label></div><span class="count">${num(state.summary.clusters)} multi-address hypotheses</span></div><div class="results"><div class="loading">Loading clusters…</div></div></section>`;
  await refreshClusters();
}
async function refreshClusters() {
  try {
    const d = await api.page({
      type: "clusters",
      options: { search: state.search, offset: state.offset, limit: 12 },
    });
    const summary = document.getElementById("cluster-summary");
    if (summary) summary.innerHTML = clusterSummary(d.stats);
    const results = document.querySelector(".results");
    results.innerHTML = d.rows.length
      ? clusterCards(d)
      : empty("entity clusters");
    results.querySelectorAll(".cluster-card").forEach((card) => {
      card.style.setProperty("--cluster-accent", card.dataset.clusterAccent);
      card.style.setProperty("--cluster-size", `${card.dataset.clusterSize}%`);
      card.style.setProperty(
        "--cluster-activity",
        `${card.dataset.clusterActivity}%`,
      );
    });
  } catch (e) {
    fail(e);
  }
}
function destroyFlowGraph() {
  state.flowGraph?.destroy();
  state.flowGraph = null;
}
function flowSummary(stats) {
  return `<section class="flow-summary" aria-label="Flow analysis summary"><article><strong>${num(stats.peeling)}</strong><span>Peeling chains</span><i class="flow-dot peel"></i></article><article><strong>${num(stats.coinjoinCautions)}</strong><span>CoinJoin-like cautions</span><i class="flow-dot caution"></i></article><article><strong>${num(stats.mixing)}</strong><span>Mixing cascades</span><i class="flow-dot mix"></i></article><article><strong>${num(stats.automaticSeeds)}</strong><span>Automatic seeds</span><i class="flow-dot seed"></i></article><article><strong>${num(stats.exposedWallets)}</strong><span>Exposed wallets</span><i class="flow-dot risk"></i></article></section>`;
}
function flowList(data) {
  if (!data.rows.length)
    return '<div class="map-list-empty">No flow patterns match these filters.</div>';
  return `<div class="flow-pattern-list" role="listbox" aria-label="Detected flow patterns">${data.rows
    .map(
      (row) =>
        `<button class="flow-pattern-card ${state.selectedFlow === row.id ? "selected" : ""}" type="button" role="option" aria-selected="${state.selectedFlow === row.id}" data-flow-pattern="${esc(row.id)}"><span class="flow-pattern-line"><b class="flow-type ${esc(row.type)}">${row.type === "peeling" ? "PEELING CHAIN" : "MIXING CASCADE"}</b><strong>${row.confidence}<small>/100</small></strong></span><span class="mono">${esc(row.id)}</span><span class="flow-pattern-meta"><i>${num(row.tx_count)} transactions</i><i>${num(row.wallet_count)} wallets</i><i>${row.anomaly === null ? "Structural score" : `Anomaly ${Number(row.anomaly).toFixed(3)}`}</i></span>${Number(row.max_risk) ? `<span class="flow-risk-line">Maximum propagated exposure <b>${Number(row.max_risk).toFixed(1)}</b></span>` : ""}</button>`,
    )
    .join("")}</div><div class="map-lead-pagination"><span>${data.offset + 1}–${Math.min(data.total, data.offset + data.rows.length)} of ${num(data.total)}</span>${pager(data, "flows")}</div>`;
}
function renderFlowGraph(detail) {
  destroyFlowGraph();
  const container = document.getElementById("flow-graph"),
    caption = document.getElementById("flow-graph-caption"),
    nodeList = document.getElementById("flow-node-list");
  if (!container || !window.cytoscape) return;
  const elements = [
    ...detail.graph.nodes.map((node) => ({ data: node })),
    ...detail.graph.edges.map((edge) => ({ data: edge })),
  ];
  state.flowGraph = window.cytoscape({
    container,
    elements,
    minZoom: 0.2,
    maxZoom: 3.5,
    wheelSensitivity: 0.18,
    boxSelectionEnabled: false,
    style: [
      {
        selector: "node",
        style: {
          label: "data(label)",
          color: "#dbeafe",
          "font-size": 8,
          "text-valign": "center",
          "text-halign": "center",
          "text-outline-color": "#071a33",
          "text-outline-width": 2,
          width: 30,
          height: 30,
          "background-color": "#5f9fea",
          "border-color": "#dbeafe",
          "border-width": 2,
        },
      },
      {
        selector: 'node[kind = "transaction"]',
        style: { shape: "round-rectangle", width: 48, height: 27, "background-color": "#183a5e" },
      },
      {
        selector: 'node[kind = "wallet"]',
        style: { shape: "ellipse", width: 25, height: 25, "background-color": "#6b7f99" },
      },
      {
        selector: 'node[kind = "overflow"]',
        style: { shape: "round-rectangle", width: 92, height: 25, "background-color": "#42536a", "border-style": "dashed" },
      },
      {
        selector: "node[risk > 0]",
        style: { "border-color": "#ef4444", "border-width": 3 },
      },
      {
        selector: "edge",
        style: {
          width: 2,
          opacity: 0.82,
          "curve-style": "bezier",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.7,
          "line-color": "#f59e0b",
          "target-arrow-color": "#f59e0b",
        },
      },
      {
        selector: 'edge[kind = "mixing"]',
        style: { "line-style": "dashed", "line-color": "#a78bfa", "target-arrow-color": "#a78bfa" },
      },
      {
        selector: 'edge[kind = "risk"]',
        style: { width: "mapData(risk, 0, 100, 2, 8)", "line-style": "solid", "line-color": "#ef4444", "target-arrow-color": "#ef4444", "z-index": 10 },
      },
      { selector: ":selected", style: { "overlay-color": "#7dd3fc", "overlay-opacity": 0.2, "overlay-padding": 7 } },
    ],
    layout: { name: "breadthfirst", directed: true, spacingFactor: 1.05, padding: 30, fit: false },
  });
  const fit = () =>
    reducedMotion
      ? state.flowGraph.fit(undefined, 35)
      : state.flowGraph.animate({ fit: { eles: state.flowGraph.elements(), padding: 35 }, duration: 480 });
  requestAnimationFrame(fit);
  state.flowGraph.on("tap", "node", (event) => {
    const node = event.target;
    caption.textContent =
      node.data("kind") === "transaction"
        ? `Transaction ${node.data("txid")} · exposure ${Number(node.data("risk") || 0).toFixed(1)} · double-click to inspect evidence`
        : node.data("kind") === "wallet"
          ? `Wallet ${node.data("address")} · exposure ${Number(node.data("risk") || 0).toFixed(1)}`
          : node.data("label");
  });
  state.flowGraph.on("dbltap", 'node[kind = "transaction"]', (event) =>
    openTx(event.target.data("txid")),
  );
  nodeList.innerHTML = detail.graph.nodes
    .filter((node) => node.kind !== "overflow")
    .map(
      (node) => `<button type="button" data-flow-node="${esc(node.id)}">${node.kind === "transaction" ? "Transaction" : "Wallet"} ${esc(node.label)}${Number(node.risk) ? ` · risk ${Number(node.risk).toFixed(1)}` : ""}</button>`,
    )
    .join("");
}
async function selectFlowPattern(id) {
  state.selectedFlow = id;
  document.querySelectorAll("[data-flow-pattern]").forEach((card) => {
    const selected = card.dataset.flowPattern === id;
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-selected", String(selected));
  });
  try {
    const detail = await api.flowDetail({ id }),
      p = detail.pattern,
      panel = document.getElementById("flow-graph-panel");
    panel.querySelector(".flow-graph-title").textContent = p.id;
    panel.querySelector(".flow-graph-subtitle").textContent = `${p.type === "peeling" ? "Peeling chain" : "Mixing cascade"} · ${p.tx_count} transactions · confidence ${p.confidence}/100${p.anomaly === null ? " · flow anomaly unavailable (<32 patterns)" : ` · anomaly ${Number(p.anomaly).toFixed(3)}`}`;
    panel.querySelector(".flow-graph-overflow").textContent =
      detail.graph.transactionTotal > detail.graph.transactionLimit ||
      detail.graph.walletTotal > detail.graph.walletLimit ||
      detail.graph.edgeTotal >= detail.graph.edgeLimit
        ? `Responsive view limits: ${detail.graph.transactionLimit} transactions, ${detail.graph.walletLimit} wallets, ${detail.graph.edgeLimit} edges. Overflow is represented by count nodes.`
        : "Complete detected pattern and strongest propagated exposure paths are shown.";
    renderFlowGraph(detail);
  } catch (error) {
    fail(error);
  }
}
async function refreshFlows() {
  try {
    const data = await api.flowOverview({
      search: state.search,
      type: state.flowType,
      minConfidence: state.flowConfidence,
      minRisk: state.flowRisk,
      minAnomaly: state.flowAnomaly,
      offset: state.offset,
      limit: 20,
    });
    const summary = document.getElementById("flow-summary");
    if (summary) summary.innerHTML = flowSummary(data.stats);
    const results = document.querySelector(".flow-results");
    if (results) results.innerHTML = flowList(data);
    if (!state.selectedFlow && data.rows.length) await selectFlowPattern(data.rows[0].id);
    else if (state.selectedFlow && data.rows.some((row) => row.id === state.selectedFlow))
      await selectFlowPattern(state.selectedFlow);
    else if (!data.rows.length) {
      destroyFlowGraph();
      const title = document.querySelector(".flow-graph-title");
      if (title) title.textContent = "No pattern selected";
    }
  } catch (error) {
    fail(error);
  }
}
async function flows() {
  destroyFlowGraph();
  state.selectedFlow = null;
  main.innerHTML =
    heading(
      "GRAPH-AWARE INVESTIGATION",
      "Flow analysis",
      "Conservative pattern hypotheses and explainable forward exposure paths reconstructed offline.",
      '<button class="button button-primary" data-action="analyze">Re-run analysis</button>',
    ) +
    staleNotice() +
    `<div class="notice"><span><strong>Hypotheses—not illicit labels.</strong> Address reuse, exact amount links, CoinJoin-like structure, anomaly, and propagated exposure do not prove laundering, identity, or wallet ownership.</span><button class="link-button" data-route="methodology">Read method →</button></div><div id="flow-summary"><div class="loading">Summarizing flow analysis…</div></div><section class="flow-workspace"><aside class="panel flow-catalog"><div class="flow-toolbar"><label class="search"><span class="screen-reader">Search flow patterns</span><input id="search-input" value="${esc(state.search)}" placeholder="Pattern ID, transaction, or wallet…"></label><div class="flow-filters"><select id="flow-type" aria-label="Pattern type"><option value="">All patterns</option><option value="peeling" ${state.flowType === "peeling" ? "selected" : ""}>Peeling chains</option><option value="mixing" ${state.flowType === "mixing" ? "selected" : ""}>Mixing cascades</option></select><select id="flow-confidence" aria-label="Minimum confidence"><option value="0">Any confidence</option><option value="70" ${state.flowConfidence === 70 ? "selected" : ""}>Confidence 70+</option><option value="85" ${state.flowConfidence === 85 ? "selected" : ""}>Confidence 85+</option></select><select id="flow-risk" aria-label="Minimum propagated risk"><option value="0">Any exposure</option><option value="10" ${state.flowRisk === 10 ? "selected" : ""}>Risk 10+</option><option value="25" ${state.flowRisk === 25 ? "selected" : ""}>Risk 25+</option></select><select id="flow-anomaly" aria-label="Minimum flow anomaly"><option value="0">Any anomaly</option><option value="0.55" ${state.flowAnomaly === 0.55 ? "selected" : ""}>Anomaly 0.55+</option><option value="0.62" ${state.flowAnomaly === 0.62 ? "selected" : ""}>Anomaly 0.62+</option></select></div></div><div class="flow-results"><div class="loading">Loading detected patterns…</div></div></aside><section id="flow-graph-panel" class="flow-graph-panel"><div class="flow-graph-head"><div><span class="eyebrow">ISOLATED PATTERN</span><h2 class="flow-graph-title">Select a pattern</h2><p class="flow-graph-subtitle">The selected pattern will animate into view.</p></div><button class="button button-small" data-flow-fit>Fit graph</button></div><div class="flow-legend"><span><i class="flow-key peel"></i>Peeling path</span><span><i class="flow-key mix"></i>Mixing link</span><span><i class="flow-key risk"></i>Propagated exposure</span><span>Drag nodes · pan · wheel or pinch to zoom</span></div><div id="flow-graph" class="flow-graph" role="application" aria-label="Interactive directed graph of the selected flow pattern"></div><div class="flow-graph-footer"><span id="flow-graph-caption">Select a pattern to isolate it. Double-click a transaction to inspect evidence.</span><span class="flow-graph-overflow"></span></div><details class="flow-node-access"><summary>Keyboard-accessible graph nodes</summary><div id="flow-node-list"></div></details></section></section>`;
  await refreshFlows();
}
async function methodology() {
  const m = await api.model(),
    r = m.run,
    c = r ? JSON.parse(r.config) : null,
    embedding = c?.graphEmbedding,
    embeddingSummary = embedding
      ? `\nGraph embedding: ${embedding.dimensions} dimensions · ≥${embedding.minimumSharedContexts} shared contexts · cosine ≥${embedding.minimumCosine} · cluster cap ${embedding.maximumClusterSize}\nEmbedding links: ${num(embedding.acceptedLinks)} accepted from ${num(embedding.candidatePairs)} qualifying pairs`
      : "";
  main.innerHTML =
    heading(
      "MODEL & DECISION LOGIC",
      "Methodology",
      "Transparent correlation, graph-aware anomaly scoring, flow patterns, exposure, clustering, and priority thresholds.",
      '<button class="button button-primary" data-action="analyze">Run analysis</button>',
    ) +
    `<section class="two-col"><article class="panel"><div class="panel-head"><div><h2>Cross-layer correlation</h2><p>What the system can and cannot infer</p></div></div><div class="panel-body"><ol class="method-list"><li>Integrated rows join network observations to blockchain facts using an exact TXID.</li><li>First-seen timing and source-minute activity are descriptive evidence.</li><li>IP, country, and ASN values do not prove wallet ownership or physical location.</li><li>Provenance maps accepted and duplicate rows to SHA-256-hashed files.</li></ol></div></article><article class="panel"><div class="panel-head"><div><h2>Priority composition</h2><p>Additive rule evidence, capped at 100</p></div></div><div class="panel-body">${[
      ["Critical", "75–100"],
      ["High", "50–74"],
      ["Medium", "25–49"],
      ["Low", "0–24 · not shown as a lead"],
    ]
      .map(
        (x) =>
          `<div class="kv"><span>${badge(x[0])}</span><strong>${x[1]}</strong></div>`,
      )
      .join(
        "",
      )}</div></article></section><section class="panel"><div class="panel-head"><div><h2>Entity clustering</h2><p>Common-input ownership plus conservative structural similarity</p></div></div><div class="panel-body"><ol class="method-list"><li>Non-collaborative multi-input transactions establish the primary common-input components.</li><li>Each wallet receives a deterministic 32-dimensional embedding of its input/output transaction neighborhood.</li><li>Separate components are linked only after at least two shared non-collaborative output contexts, cosine similarity of at least 0.82, and evidence that both wallets later appear as inputs.</li><li>Embedding-assisted groups are capped at 100 wallets. IP, geography, ASN, and guessed change addresses never merge wallets.</li><li>Every cluster remains an investigative hypothesis, not proof of common ownership or control.</li></ol></div></section><section class="panel"><div class="panel-head"><div><h2>Flow-pattern and exposure analysis</h2><p>Exact links, conservative structure, and reproducible risk decay</p></div></div><div class="panel-body"><ol class="method-list"><li>Outputs link to later inputs only when wallet identifier and integer satoshi amount match exactly and both sides have a unique candidate. Ambiguous matches, hubs above 100 occurrences, and non-monotonic first-observed times are counted and skipped.</li><li>Peeling hypotheses require 3–20 non-CoinJoin transactions, 2–5 outputs per continuation step, a 70–99.5% continuation, and a 0.5–30% remainder.</li><li>A lone CoinJoin-like structure is caution-only with zero points. A mixing cascade requires at least two directly linked CoinJoin-like transactions.</li><li>Only peeling or mixing hypotheses at confidence 70+ seed exposure. Risk travels forward for four transaction hops using current risk × 0.65 × √(output share), retains the strongest path, and stops below 10.</li><li>First-observed network timestamps are not authoritative block times. All patterns and exposure paths are investigative hypotheses, not declarations of laundering or ownership.</li></ol></div></section><section class="panel"><div class="panel-head"><div><h2>World map interpretation</h2><p>Approximate context, never evidentiary location proof</p></div></div><div class="panel-body"><ol class="method-list"><li>DB-IP City Lite resolves IPv4 and IPv6 endpoints entirely offline and is cached only for the current session.</li><li>Unmatched or non-public IPs use supplied country metadata as a labelled country-centroid fallback, or remain unlocated.</li><li>Dotted overview routes aggregate all observations by source city, destination city, and entity hypothesis while preserving totals.</li><li>Selecting one lead keeps IP markers at their approximate GeoIP coordinates and connects them with curved paths; transaction and wallet nodes are logical, not physical locations.</li><li>Approximate location and IP association do not prove identity, physical presence, wallet ownership, or control.</li></ol></div></section><section class="panel"><div class="panel-head"><div><h2>Current local model</h2><p>Saved with evidence revision</p></div></div><div class="panel-body">${r ? `<div class="two-col"><div><div class="kv"><span>Analysis run</span><strong class="mono">${esc(r.id)}</strong></div><div class="kv"><span>Created</span><strong>${date(r.created)}</strong></div><div class="kv"><span>Evidence revision</span><strong>${r.revision}</strong></div><div class="kv"><span>Transactions</span><strong>${num(r.transaction_count)}</strong></div></div><div><div class="kv"><span>Transaction model</span><strong>${c.modelAvailable ? "14-feature Isolation Forest + rules" : "Rules only"}</strong></div><div class="kv"><span>Flow model</span><strong>${c.flowAnalysis?.modelAvailable ? "7-feature Isolation Forest" : "Structural confidence · requires ≥32 patterns"}</strong></div><div class="kv"><span>Detected patterns</span><strong>${num((c.flowAnalysis?.patternCounts?.peeling || 0) + (c.flowAnalysis?.patternCounts?.mixing || 0))}</strong></div><div class="kv"><span>Fixed seed</span><strong>${c.seed}</strong></div></div></div><div class="code-block mt">Transaction features: ${esc(c.featureNames.join(", "))}\nFeature evidence SHA-256: ${esc(c.featureSha256)}\nExact flow links: ${num(c.flowAnalysis?.diagnostics?.exactLinks || 0)}\nSkipped ambiguous outputs / inputs: ${num(c.flowAnalysis?.diagnostics?.ambiguousOutputs || 0)} / ${num(c.flowAnalysis?.diagnostics?.ambiguousInputs || 0)}\nSkipped high-degree wallet identifiers: ${num(c.flowAnalysis?.diagnostics?.highDegreeAddresses || 0)}\nClustering: ${esc(c.clustering)}${esc(embeddingSummary)}</div>` : '<div class="empty">No analysis run yet.</div>'}</div></section><section class="panel mt"><div class="panel-head"><div><h2>Explainable contributions</h2><p>Every trigger appears verbatim on the lead</p></div></div><div class="panel-body schema-list">${[
      ["Large value", "+25 · ≥100 BTC and above robust cutoff"],
      ["High fee", "+28 · >5% and ≥0.0001 BTC"],
      ["Fan-out", "+20 · ≥10 outputs"],
      ["Consolidation", "+18 · ≥10 inputs, collaborative patterns excluded"],
      ["Source burst", "+28 · ≥12 distinct TXIDs from source per UTC minute"],
      ["Wide propagation", "+10 · ≥30 observations across ≥8 sources"],
      ["Isolation Forest", "+12 at ≥0.55 or +22 at ≥0.62; not probability"],
      ["Peeling-chain membership", "+25 maximum structural-pattern contribution"],
      ["Mixing-cascade membership", "+20 when no peeling contribution applies"],
      ["Propagated exposure", "round(risk × 0.30), capped at +30"],
    ]
      .map(
        (x) =>
          `<div class="schema-item"><strong>${x[0]}</strong><p>${x[1]}</p></div>`,
      )
      .join("")}</div></section>`;
}
async function system() {
  const e = await api.environment();
  main.innerHTML =
    heading(
      "AIR-GAPPED OPERATION",
      "Offline assurance",
      "Runtime and storage controls.",
    ) +
    `<div class="notice info"><span>Bundled files use Electron IPC and a worker MessagePort. Network APIs, remote content, permissions, downloads, and TCP/UDP listeners are disabled. Transaction and flow analysis never contacts an external model, label service, or wallet list.</span></div><section class="two-col"><article class="panel"><div class="panel-head"><div><h2>Runtime</h2></div><span class="badge low">LOCAL</span></div><div class="panel-body"><div class="kv"><span>Network</span><strong>${esc(e.network)}</strong></div><div class="kv"><span>Application listeners</span><strong>${e.ports}</strong></div><div class="kv"><span>Internal transport</span><strong>${esc(e.transport)}</strong></div><div class="kv"><span>Remote content</span><strong>Denied</strong></div><div class="kv"><span>Permissions / downloads</span><strong>Denied</strong></div></div></article><article class="panel"><div class="panel-head"><div><h2>Storage</h2></div></div><div class="panel-body"><p class="full-path">${esc(e.database)}</p><div class="kv"><span>Database</span><strong>Embedded SQLite · derived schema v3</strong></div><div class="kv"><span>Journal</span><strong>WAL · synchronous FULL</strong></div><div class="kv"><span>Amounts / flow links</span><strong>Integer satoshis · exact local matching</strong></div><div class="kv"><span>Source integrity</span><strong>SHA-256</strong></div></div></article></section><section class="panel"><div class="panel-head"><div><h2>Bundled runtime</h2></div></div><div class="panel-body"><div class="kv"><span>Satoshi Trace</span><strong>${esc(e.application)}</strong></div><div class="kv"><span>Electron / Node</span><strong>${esc(e.electron)} / ${esc(e.node)}</strong></div><div class="kv"><span>ML</span><strong>Transaction + flow Isolation Forest · bundled JavaScript</strong></div><div class="kv"><span>Risk seeds</span><strong>Detected patterns only · no external label list</strong></div><div class="kv"><span>Geo lookup</span><strong>${esc(e.geoip)}</strong></div><div class="kv"><span>Geo transport</span><strong>None · packaged MMDB only</strong></div></div></section>`;
}
function settingsClusterRows(data) {
  const overrides = colorOverrides();
  if (!data.rows.length)
    return '<div class="empty">No clusters match this search.</div>';
  return `<div class="cluster-settings-list">${data.rows
    .map((cluster) => {
      const value = clusterColor(cluster.id),
        overridden = !!overrides[cluster.id];
      return `<div class="cluster-setting-row" data-cluster-setting="${esc(cluster.id)}"><div class="cluster-setting-swatch" style="--cluster-color:${esc(value)}"></div><div><strong class="mono">${esc(cluster.id)}</strong><span>${num(cluster.size)} addresses · ${num(cluster.tx_count)} transactions · ${overridden ? "Custom override" : "Deterministic default"}</span></div><label><span class="screen-reader">Color for ${esc(cluster.id)}</span><input type="color" value="${esc(value)}" data-cluster-color="${esc(cluster.id)}"></label><button class="button button-small" data-reset-cluster="${esc(cluster.id)}" ${overridden ? "" : "disabled"}>Reset</button></div>`;
    })
    .join("")}</div><div class="table-footer"><span>Showing ${data.offset + 1}–${Math.min(data.total, data.offset + data.rows.length)} of ${num(data.total)} clusters</span>${pager(data, "settings-clusters")}</div>`;
}
async function refreshSettingsClusters(offset = state.offset) {
  const results = document.querySelector(".cluster-settings-results");
  if (!results) return;
  try {
    const data = await api.page({
      type: "clusters",
      options: { search: state.settingsSearch, offset, limit: 50 },
    });
    results.innerHTML = settingsClusterRows(data);
  } catch (error) {
    results.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  }
}
async function settings() {
  main.innerHTML =
    heading(
      "VISUAL PREFERENCES",
      "Settings",
      "Customize cluster colors for this local investigator account.",
      '<button class="button" data-reset-all-clusters>Reset all cluster colors</button>',
    ) +
    `<section class="panel settings-panel"><div class="panel-head"><div><h2>Cluster color mapping</h2><p>Defaults are derived from stable cluster IDs. Overrides affect the world map and entity graphs.</p></div><span class="tag">DEVICE LOCAL</span></div><div class="settings-search"><label class="search"><span class="screen-reader">Search clusters or member addresses</span><input id="cluster-settings-search" type="text" value="${esc(state.settingsSearch)}" placeholder="Find cluster ID or member wallet…"></label></div><div class="cluster-settings-results"><div class="loading">Loading cluster colors…</div></div></section><section class="panel mt"><div class="panel-head"><div><h2>Offline map data</h2><p>Approximate geolocation metadata—not evidence of identity or physical presence</p></div></div><div class="panel-body"><div class="kv"><span>Database</span><strong>DB-IP City Lite · September 2026</strong></div><div class="kv"><span>License</span><strong>CC BY 4.0</strong></div><div class="kv"><span>Update policy</span><strong>Bundled with application releases only</strong></div><p class="form-note">IP Geolocation by DB-IP. Reduced-accuracy city results remain entirely offline. Postal code, ISP, domain, connection type, and accuracy radius are not inferred.</p></div></section>`;
  await refreshSettingsClusters();
}
async function navigate(route, push = true) {
  const previous = {
    route: state.route,
    search: state.search,
    offset: state.offset,
    breadcrumb: breadcrumb.textContent,
    markup: main.innerHTML,
  };
  if (!routes.some((x) => x[0] === route)) route = "overview";
  if (state.route === "leads" && route !== "leads") destroyMapGraph();
  if (state.route === "flows" && route !== "flows") destroyFlowGraph();
  state.route = route;
  state.search = "";
  state.offset = 0;
  if (push) history.replaceState(null, "", `#${route}`);
  breadcrumb.textContent = routes.find((x) => x[0] === route)[1];
  renderNav();
  main.setAttribute("aria-busy", "true");
  try {
    await refreshSummary();
    await {
      overview,
      evidence,
      transactions: () => listing("transactions"),
      clusters,
      flows,
      leads: leadsWorkspace,
      activity,
      methodology,
      system,
      settings,
    }[route]();
    await api.auditEvent({ action: "view.opened", details: { view: route } });
    main.focus({ preventScroll: true });
  } catch (e) {
    state.route = previous.route;
    state.search = previous.search;
    state.offset = previous.offset;
    breadcrumb.textContent = previous.breadcrumb;
    main.innerHTML = previous.markup;
    history.replaceState(null, "", `#${previous.route}`);
    renderNav();
    fail(e);
  } finally {
    main.removeAttribute("aria-busy");
  }
}
function txGraph(d) {
  const t = d.transaction,
    ins = JSON.parse(t.input_addresses).slice(0, 3),
    outs = JSON.parse(t.output_addresses).slice(0, 3),
    ips = [
      ...new Set(d.observations.flatMap((o) => [o.src_ip, o.dst_ip])),
    ].slice(0, 4),
    nodes = [
      ...ips.map((v, i) => ({
        v,
        type: "ip",
        x: 70,
        y: 35 + i * (165 / Math.max(1, ips.length - 1)),
      })),
      ...ins.map((v, i) => ({ v, type: "wallet", x: 630, y: 28 + i * 38 })),
      ...outs.map((v, i) => ({ v, type: "wallet", x: 630, y: 136 + i * 38 })),
    ];
  return `<div class="graph-wrap detail-graph"><svg viewBox="0 0 700 230" role="img">${nodes.map((n) => `<path class="graph-edge ${n.type === "ip" ? "network" : ""}" d="M${n.x} ${n.y}L350 115"/>`).join("")}<circle class="graph-circle tx" cx="350" cy="115" r="34"/><text class="graph-inner tx" x="350" y="122" text-anchor="middle">₿</text>${nodes.map((n) => `<circle class="graph-circle ${n.type === "wallet" ? "wallet" : ""}" cx="${n.x}" cy="${n.y}" r="18"/><text class="graph-inner ${n.type === "wallet" ? "wallet" : ""}" x="${n.x}" y="${n.y + 4}" text-anchor="middle">${n.type === "wallet" ? "W" : "IP"}</text><text class="graph-label" x="${n.x < 350 ? n.x + 26 : n.x - 26}" y="${n.y + 4}" text-anchor="${n.x < 350 ? "start" : "end"}">${esc(trunc(n.v, 18))}</text>`).join("")}</svg></div><div class="graph-legend"><span><i class="legend-symbol"></i>Observed endpoint</span><span><i class="legend-symbol navy"></i>Exact TXID</span><span><i class="legend-symbol orange"></i>Blockchain address</span><span class="graph-footnote">Associations are not ownership proof</span></div>`;
}
function destroyMapGraph() {
  state.mapResizeObserver?.disconnect();
  state.mapResizeObserver = null;
  state.mapViewAnimation?.cancel?.();
  state.mapViewAnimation = null;
  state.mapElementZoom = null;
  state.mapViewportGuard = false;
  const container = document.getElementById("transaction-map");
  if (container) {
    container.style.backgroundPosition = "";
    container.style.backgroundSize = "";
  }
  state.mapGraph?.destroy();
  state.mapGraph = null;
  state.mapOverview = null;
}
function mapPoint(latitude, longitude, index = 0) {
  const container = document.getElementById("transaction-map"),
    width = Math.max(1, container?.clientWidth || 1000),
    height = Math.max(1, container?.clientHeight || 483),
    located =
      latitude !== null &&
      latitude !== undefined &&
      longitude !== null &&
      longitude !== undefined &&
      Number.isFinite(Number(latitude)) &&
      Number.isFinite(Number(longitude));
  if (!located)
    return {
      x: 26 + (index % Math.max(1, Math.floor(width / 52))) * 52,
      y: height - 24 - Math.floor(index / Math.max(1, Math.floor(width / 52))) * 34,
    };
  return {
    x: Math.max(12, Math.min(width - 12, ((Number(longitude) + 180) / 360) * width)),
    y: Math.max(
      12,
      Math.min(
        height - 12,
        ((83.64513 - Number(latitude)) / 173.64513) * height,
      ),
    ),
  };
}
function positionMapGraph() {
  const graph = state.mapGraph,
    container = document.getElementById("transaction-map");
  if (!graph || !container) return;
  const width = Math.max(1, container.clientWidth),
    height = Math.max(1, container.clientHeight),
    positionNode = (node, point) => {
      node.scratch("mapBase", point);
      node.position(point);
    },
    clampPoint = (point, margin = 24) => ({
      x: Math.max(margin, Math.min(width - margin, point.x)),
      y: Math.max(margin, Math.min(height - margin, point.y)),
    });
  let unlocated = 0;
  graph.nodes('[kind = "place"]').forEach((node) => {
    positionNode(
      node,
      mapPoint(
        node.data("latitude"),
        node.data("longitude"),
        unlocated++,
      ),
    );
  });
  const transaction = graph.getElementById("focus:transaction");
  if (!transaction.length) return;
  const center = clampPoint(
    mapPoint(
      transaction.data("latitude"),
      transaction.data("longitude"),
    ),
    42,
  );
  positionNode(transaction, center);
  const endpointGroups = new Map();
  graph
    .nodes('.focus[kind = "endpoint"]')
    .sort((a, b) => a.id().localeCompare(b.id()))
    .forEach((node) => {
      const rawLatitude = node.data("latitude"),
        rawLongitude = node.data("longitude"),
        latitude = Number(rawLatitude),
        longitude = Number(rawLongitude),
        located =
          rawLatitude !== null &&
          rawLatitude !== undefined &&
          rawLongitude !== null &&
          rawLongitude !== undefined &&
          Number.isFinite(latitude) &&
          Number.isFinite(longitude),
        key = located
          ? `${latitude.toFixed(3)}:${longitude.toFixed(3)}`
          : `unlocated:${unlocated++}`,
        group = endpointGroups.get(key) || [];
      group.push({
        node,
        located,
        point: mapPoint(
          located ? latitude : null,
          located ? longitude : null,
          unlocated,
        ),
      });
      endpointGroups.set(key, group);
    });
  endpointGroups.forEach((group) => {
    const sharedPoint = group[0].point,
      overlapsTransaction =
        Math.hypot(sharedPoint.x - center.x, sharedPoint.y - center.y) < 38,
      radius = overlapsTransaction
        ? Math.min(54, 40 + group.length * 3)
        : group.length > 1
          ? Math.min(24, 10 + group.length * 2)
          : 0;
    group.forEach(({ node, point, located }, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / group.length;
      let x = point.x + Math.cos(angle) * radius;
      if (located) {
        while (x - center.x > width / 2) x -= width;
        while (x - center.x < -width / 2) x += width;
      }
      positionNode(node, {
        x,
        y: clampPoint({ x, y: point.y + Math.sin(angle) * radius }).y,
      });
    });
  });
  const positionWallets = (side, direction) => {
    const nodes = graph
        .nodes(`.focus[side = "${side}"]`)
        .filter((node) => node.data("kind") !== "endpoint")
        .sort((a, b) => a.id().localeCompare(b.id())),
      columns = Math.max(1, Math.min(14, Math.ceil(Math.sqrt(nodes.length * 2)))),
      rows = Math.max(1, Math.ceil(nodes.length / columns)),
      xSpacing = Math.max(
        20,
        Math.min(42, (width - 80) / Math.max(1, columns - 1)),
      ),
      ySpacing = Math.max(
        16,
        Math.min(28, (height / 2 - 105) / Math.max(1, rows - 1)),
      );
    nodes.forEach((node, index) => {
      const column = index % columns,
        row = Math.floor(index / columns),
        rowColumns = Math.min(columns, nodes.length - row * columns),
        rowStart = center.x - ((rowColumns - 1) * xSpacing) / 2;
      positionNode(
        node,
        clampPoint({
          x: rowStart + column * xSpacing,
          y: center.y + direction * (88 + row * ySpacing),
        }),
      );
    });
  };
  positionWallets("input", -1);
  positionWallets("output", 1);
}
function syncMapBackground() {
  const graph = state.mapGraph,
    container = document.getElementById("transaction-map");
  if (!graph || !container || state.mapViewportGuard) return;
  state.mapViewportGuard = true;
  try {
    const containerWidth = Math.max(1, container.clientWidth),
      containerHeight = Math.max(1, container.clientHeight),
      zoom = Math.max(1, graph.zoom()),
      worldWidth = containerWidth * zoom,
      worldHeight = containerHeight * zoom,
      currentPan = graph.pan(),
      wrapped = ((currentPan.x % worldWidth) + worldWidth) % worldWidth,
      x = wrapped > 0 ? wrapped - worldWidth : 0,
      y = Math.max(containerHeight - worldHeight, Math.min(0, currentPan.y));
    if (graph.zoom() !== zoom) graph.zoom(zoom);
    if (Math.abs(currentPan.x - x) > 0.1 || Math.abs(currentPan.y - y) > 0.1)
      graph.pan({ x, y });
    const viewportCenter = containerWidth / 2;
    graph.nodes().forEach((node) => {
      const base = node.scratch("mapBase");
      if (!base) return;
      const copy = Math.round(
        (viewportCenter - x - base.x * zoom) / worldWidth,
      );
      node.position({ x: base.x + copy * containerWidth, y: base.y });
    });
    container.style.backgroundSize = `${worldWidth}px ${worldHeight}px`;
    container.style.backgroundPosition = `${x}px ${y}px`;
    syncFocusScale();
  } finally {
    state.mapViewportGuard = false;
  }
}
function syncFocusScale(force = false) {
  const graph = state.mapGraph;
  if (!graph) return;
  const zoom = Math.max(0.01, graph.zoom());
  if (
    !force &&
    state.mapElementZoom !== null &&
    Math.abs(state.mapElementZoom - zoom) < 0.025
  )
    return;
  state.mapElementZoom = zoom;
  const unit = 1 / zoom;
  graph.nodes('.focus[kind = "endpoint"]').style({
    width: 16 * unit,
    height: 16 * unit,
    "font-size": 6.5 * unit,
    "border-width": 1.5 * unit,
    "text-outline-width": 1.5 * unit,
    "text-margin-y": 4 * unit,
    "text-max-width": 74 * unit,
  });
  graph.nodes('.focus[kind = "transaction"]').style({
    width: 34 * unit,
    height: 34 * unit,
    "font-size": 8 * unit,
    "border-width": 2 * unit,
  });
  graph.nodes('.focus[kind = "wallet"]').style({
    width: 20 * unit,
    height: 16 * unit,
    "font-size": 6 * unit,
    "border-width": 1.5 * unit,
  });
  graph.nodes('.focus[kind $= "summary"]').style({
    height: 18 * unit,
    padding: 4 * unit,
    "font-size": 6 * unit,
    "border-width": 1.5 * unit,
  });
  graph.edges(".focus").style({
    width: 1.8 * unit,
    "arrow-scale": 0.72 * unit,
  });
}
function setMapViewport({ x = 0, y = 0, scale = 1 }, animated = true) {
  const graph = state.mapGraph;
  if (!graph) return;
  state.mapViewAnimation?.cancel?.();
  state.mapViewAnimation = null;
  if (reducedMotion || !animated || !window.anime?.animate) {
    graph.viewport({ zoom: scale, pan: { x, y } });
    syncMapBackground();
    return;
  }
  const pan = graph.pan(),
    viewport = { x: pan.x, y: pan.y, scale: graph.zoom() },
    animation = window.anime.animate(viewport, {
      x,
      y,
      scale,
      duration: 620,
      ease: "outCubic",
      onUpdate: () =>
        graph.viewport({
          zoom: viewport.scale,
          pan: { x: viewport.x, y: viewport.y },
        }),
      onComplete: () => {
        if (state.mapViewAnimation === animation) state.mapViewAnimation = null;
      },
    });
  state.mapViewAnimation = animation;
}
function focusMapViewport(animated = true) {
  const graph = state.mapGraph,
    container = document.getElementById("transaction-map"),
    focusNodes = graph?.nodes(".focus");
  if (!graph || !container || !focusNodes?.length) return;
  const bounds = focusNodes.boundingBox({
      includeLabels: false,
      includeOverlays: false,
    }),
    width = Math.max(1, container.clientWidth),
    height = Math.max(1, container.clientHeight),
    fittedScale = Math.min(
      (width - 72) / Math.max(240, bounds.w),
      (height - 72) / Math.max(190, bounds.h),
    ),
    scale = Math.max(graph.minZoom(), Math.min(1.08, fittedScale)),
    centerX = bounds.x1 + bounds.w / 2,
    centerY = bounds.y1 + bounds.h / 2,
    horizontalPan = width - width * scale,
    verticalPan = height - height * scale,
    x = Math.max(
      Math.min(0, horizontalPan),
      Math.min(Math.max(0, horizontalPan), width / 2 - centerX * scale),
    ),
    y = Math.max(
      Math.min(0, verticalPan),
      Math.min(Math.max(0, verticalPan), height / 2 - centerY * scale),
    );
  setMapViewport({ x, y, scale }, animated);
}
function resizeMapGraph() {
  positionMapGraph();
  if (state.selectedLead) focusMapViewport(false);
  else syncMapBackground();
}
function controlMapViewport(action) {
  const graph = state.mapGraph,
    container = document.getElementById("transaction-map");
  if (!graph || !container) return;
  if (action === "reset") {
    if (state.selectedLead) focusMapViewport(true);
    else setMapViewport({}, true);
    return;
  }
  const currentZoom = graph.zoom(),
    targetZoom = Math.max(
      graph.minZoom(),
      Math.min(graph.maxZoom(), currentZoom * (action === "in" ? 1.25 : 0.8)),
    ),
    center = { x: container.clientWidth / 2, y: container.clientHeight / 2 },
    pan = graph.pan(),
    ratio = targetZoom / currentZoom;
  setMapViewport(
    {
      x: center.x - (center.x - pan.x) * ratio,
      y: center.y - (center.y - pan.y) * ratio,
      scale: targetZoom,
    },
    true,
  );
}
function renderMapOverview(data) {
  const container = document.getElementById("transaction-map"),
    status = document.getElementById("map-selection");
  if (!container || typeof window.cytoscape !== "function") {
    if (status)
      status.textContent =
        "Interactive map unavailable. Lead records remain available in the flag list.";
    return;
  }
  destroyMapGraph();
  state.mapOverview = data;
  const placeIds = new Map(),
    elements = [];
  data.locations.forEach((location, index) => {
    const id = `place:${index}`;
    placeIds.set(location.id, id);
    elements.push({
      classes: "overview",
      data: {
        id,
        kind: "place",
        label:
          location.id === "unlocated"
            ? "Unlocated"
            : `${location.city || location.countryName} · ${num(location.observationCount)}`,
        detail: `${location.city || "Unknown city"}${location.region ? `, ${location.region}` : ""}, ${location.countryName || "unknown country"} · ${num(location.uniqueIpCount)} IPs · ${location.source === "db-ip-city-lite" ? "DB-IP approximate city" : "supplied-country fallback"}${location.countryConflictCount ? ` · ${num(location.countryConflictCount)} supplied/derived country mismatches` : ""}`,
        latitude: location.latitude,
        longitude: location.longitude,
        size: Math.min(34, 10 + Math.log2(location.observationCount + 1) * 3),
      },
    });
  });
  data.routes.forEach((route, index) => {
    const source = placeIds.get(route.source),
      target = placeIds.get(route.target);
    if (!source || !target) return;
    const breakdown = route.clusterBreakdown
      ? route.clusterBreakdown
          .slice(0, 4)
          .map(
            (entry) =>
              `${entry.clusterId || "Unclustered"}: ${num(entry.count)}`,
          )
          .join(" · ")
      : route.clusterId || "Unclustered";
    elements.push({
      classes: "overview",
      data: {
        id: `overview:route:${index}`,
        kind: "route",
        source,
        target,
        color: clusterColor(route.clusterId),
        width: Math.min(4, 0.8 + Math.log2(route.observationCount + 1) * 0.45),
        detail: `${num(route.observationCount)} observations · ${num(route.transactionCount)} transactions · ${num(route.uniqueIpCount)} IPs · ${breakdown}`,
      },
    });
  });
  state.mapGraph = window.cytoscape({
    container,
    elements,
    layout: { name: "preset", fit: false },
    userPanningEnabled: true,
    userZoomingEnabled: true,
    minZoom: 1,
    maxZoom: 4,
    wheelSensitivity: 0.18,
    boxSelectionEnabled: false,
    autoungrabify: true,
    style: [
      {
        selector: "node",
        style: {
          label: "data(label)",
          "font-family": "Inter, Segoe UI, sans-serif",
          "font-size": 8,
          color: "#dbeafe",
          "text-outline-color": "#071a33",
          "text-outline-width": 2,
          "text-valign": "bottom",
          "text-margin-y": 7,
          "overlay-opacity": 0,
          "z-index": 5,
        },
      },
      {
        selector: 'node[kind = "place"]',
        style: {
          width: "data(size)",
          height: "data(size)",
          "background-color": "#7dd3fc",
          "border-width": 2,
          "border-color": "#e0f2fe",
          opacity: 0.88,
        },
      },
      {
        selector: 'edge[kind = "route"]',
        style: {
          width: "data(width)",
          "line-color": "data(color)",
          "line-style": "dotted",
          "curve-style": "bezier",
          opacity: 0.5,
          "overlay-opacity": 0,
          "z-index": 2,
        },
      },
      { selector: ".overview-hidden", style: { display: "none" } },
      {
        selector: 'node[kind = "endpoint"]',
        style: {
          shape: "ellipse",
          width: 16,
          height: 16,
          "font-size": 6.5,
          "background-color": "#22d3ee",
          "border-color": "#ecfeff",
          "border-width": 1.5,
          "text-margin-y": 4,
          "text-wrap": "wrap",
          "text-max-width": 74,
          "z-index": 20,
        },
      },
      {
        selector: 'node[kind = "endpoint"][role = "destination"]',
        style: {
          "background-color": "#60a5fa",
          "border-color": "#dbeafe",
        },
      },
      {
        selector: 'node[kind = "transaction"]',
        style: {
          shape: "diamond",
          width: 34,
          height: 34,
          "font-size": 8,
          "font-weight": 700,
          "text-valign": "center",
          "text-margin-y": 0,
          "text-outline-width": 0,
          color: "#ffffff",
          "background-color": "#dc2626",
          "border-color": "#fecaca",
          "border-width": 2,
          "z-index": 30,
        },
      },
      {
        selector: 'node[kind = "wallet"]',
        style: {
          shape: "round-rectangle",
          width: 20,
          height: 16,
          label: "data(label)",
          "font-size": 6,
          "font-weight": 700,
          "text-valign": "center",
          "text-margin-y": 0,
          "text-outline-width": 0,
          color: "#071a33",
          "background-color": "data(color)",
          "border-color": "#ffffff",
          "border-width": 1.5,
          "z-index": 25,
        },
      },
      {
        selector: 'node[kind $= "summary"]',
        style: {
          shape: "round-rectangle",
          width: "label",
          height: 18,
          padding: 4,
          "background-color": "#334155",
          "border-color": "#94a3b8",
          "border-width": 1.5,
          "font-size": 6,
          "text-valign": "center",
          "text-margin-y": 0,
          "z-index": 24,
        },
      },
      {
        selector: 'edge[kind = "focus-network"]',
        style: {
          width: 1.8,
          "line-color": "#22d3ee",
          "target-arrow-color": "#22d3ee",
          "target-arrow-shape": "triangle",
          "curve-style": "unbundled-bezier",
          "control-point-distances": "data(curveOffset)",
          "control-point-weights": 0.5,
          "line-style": "solid",
          opacity: 1,
          "z-index": 22,
        },
      },
      {
        selector: 'edge[kind = "focus-wallet"]',
        style: {
          width: 1.8,
          "line-color": "data(color)",
          "target-arrow-color": "data(color)",
          "target-arrow-shape": "triangle",
          "curve-style": "unbundled-bezier",
          "control-point-distances": "data(curveOffset)",
          "control-point-weights": 0.5,
          "line-style": "solid",
          opacity: 1,
          "z-index": 23,
        },
      },
    ],
  });
  positionMapGraph();
  setMapViewport({}, false);
  state.mapGraph.on("viewport", syncMapBackground);
  state.mapResizeObserver = new ResizeObserver(resizeMapGraph);
  state.mapResizeObserver.observe(container);
  state.mapGraph.on("tap", "node,edge", (event) => {
    status.textContent = event.target.data("detail") || "Evidence relationship";
  });
  state.mapGraph.on("tap", (event) => {
    if (event.target === state.mapGraph && !state.selectedLead)
      status.textContent =
        "Select a lead to show only its IP, transaction, and wallet path. Select it again to restore all routes.";
  });
}
function clearMapFocus() {
  state.selectedLead = null;
  state.mapGraph?.elements(".focus").remove();
  state.mapGraph?.elements(".overview").removeClass("overview-hidden");
  setMapViewport({}, true);
  document
    .querySelectorAll(".map-lead-card")
    .forEach((card) => {
      card.classList.remove("selected");
      card.setAttribute("aria-selected", "false");
    });
  const clear = document.querySelector("[data-map-clear]");
  if (clear) clear.hidden = true;
  const status = document.getElementById("map-selection");
  if (status)
    status.textContent =
      "All case routes restored. Select a lead to show only its path.";
}
function renderLeadFocus(data) {
  const graph = state.mapGraph;
  if (!graph) return;
  graph.elements(".focus").remove();
  graph.elements(".overview").addClass("overview-hidden");
  const transactionId = "focus:transaction",
    elements = [
      {
        classes: "focus",
        data: {
          id: transactionId,
          kind: "transaction",
          label: String(data.transaction.score ?? "—"),
          detail: `${data.transaction.priority || "Flagged"} transaction · score ${data.transaction.score ?? "—"}/100 · ${data.transaction.txid} · ${data.transaction.category || "No category"}`,
          latitude: data.center.latitude,
          longitude: data.center.longitude,
        },
      },
    ];
  data.endpoints.forEach((endpoint, index) => {
    const id = `focus:endpoint:${index}`,
      direction = index % 2 ? -1 : 1,
      locationLabel =
        endpoint.source === "db-ip-city-lite"
          ? endpoint.city || endpoint.country || "Located"
          : endpoint.source === "supplied-country"
            ? `${endpoint.country || endpoint.countryName || "Country"} fallback`
            : "Unlocated";
    elements.push({
      classes: "focus",
      data: {
        id,
        kind: "endpoint",
        role: endpoint.role,
        label: `${endpoint.role === "source" ? "SRC" : "DST"}\n${locationLabel}`,
        detail: `${endpoint.ip} · ${endpoint.city || "Unlocated"}${endpoint.region ? `, ${endpoint.region}` : ""} · ${endpoint.countryName || "unknown country"} · ${endpoint.source === "db-ip-city-lite" ? "DB-IP approximate city" : "supplied-country fallback"}${endpoint.countryConflict ? ` · supplied country ${endpoint.suppliedCountry} conflicts with derived ${endpoint.country}` : ""}`,
        latitude: endpoint.latitude,
        longitude: endpoint.longitude,
      },
    });
    elements.push({
      classes: "focus",
      data: {
        id: `focus:network-edge:${index}`,
        kind: "focus-network",
        curveOffset: direction * (16 + Math.min(36, Math.floor(index / 2) * 5)),
        source: endpoint.role === "source" ? id : transactionId,
        target: endpoint.role === "source" ? transactionId : id,
      },
    });
  });
  const sideSlots = { input: 0, output: 0 };
  data.wallets.forEach((wallet, index) => {
    const id = `focus:wallet:${index}`,
      color = clusterColor(wallet.cluster_id),
      side = wallet.side === "input" ? "input" : "output";
    elements.push({
      classes: "focus",
      data: {
        id,
        kind: "wallet",
        side,
        slot: sideSlots[side]++,
        label: side === "input" ? "IN" : "OUT",
        color,
        detail: `${side === "input" ? "Input" : "Output"} wallet ${wallet.address} · ${wallet.cluster_id ? `cluster ${wallet.cluster_id}` : "unclustered"}`,
      },
    });
    elements.push({
      classes: "focus",
      data: {
        id: `focus:wallet-edge:${index}`,
        kind: "focus-wallet",
        color,
        curveOffset:
          (index % 2 ? -1 : 1) *
          (12 + Math.min(30, Math.floor(index / 2) * 4)),
        source: side === "input" ? id : transactionId,
        target: side === "input" ? transactionId : id,
      },
    });
  });
  [...data.endpointOverflow, ...data.walletOverflow].forEach(
    (summary, index) => {
      const side = summary.key?.startsWith("input") ? "input" : "output",
        id = `focus:summary:${index}`;
      elements.push({
        classes: "focus",
        data: {
          id,
          kind: `${summary.kind}-summary`,
          side,
          slot: sideSlots[side]++,
          label: `+${summary.count} ${summary.kind === "wallet" ? "wallets" : "IPs"}`,
          detail: `${summary.count} additional ${summary.kind === "wallet" ? "wallet" : "IP endpoint"} records collapsed for responsive rendering`,
        },
      });
      elements.push({
        classes: "focus",
        data: {
          id: `focus:summary-edge:${index}`,
          kind: summary.kind === "wallet" ? "focus-wallet" : "focus-network",
          color: "#94a3b8",
          curveOffset: (index % 2 ? -1 : 1) * (18 + index * 3),
          source: side === "input" ? id : transactionId,
          target: side === "input" ? transactionId : id,
        },
      });
    },
  );
  graph.add(elements.slice(0, 1 + data.limits.edges * 2));
  positionMapGraph();
  syncFocusScale(true);
  focusMapViewport(true);
  const status = document.getElementById("map-selection"),
    clear = document.querySelector("[data-map-clear]");
  if (clear) clear.hidden = false;
  if (status)
    status.textContent = `${data.transaction.priority || "Flagged"} lead selected · IP markers remain at approximate GeoIP coordinates · curved paths show relationships · transaction and wallet nodes are logical, not physical locations · select this lead again to restore all · ${num(data.totals.endpoints)} unique IP endpoints · ${num(data.totals.wallets)} wallets${data.totals.countryConflicts ? ` · ${num(data.totals.countryConflicts)} supplied/derived country mismatches` : ""}${data.totals.endpoints > data.totals.renderedEndpoints || data.totals.wallets > data.totals.renderedWallets ? " · overflow collapsed into count nodes" : ""}`;
}
async function selectMapLead(txid) {
  if (!txid || !state.mapGraph) return;
  if (state.selectedLead === txid) {
    clearMapFocus();
    return;
  }
  state.selectedLead = txid;
  document
    .querySelectorAll(".map-lead-card")
    .forEach((card) => {
      const selected = card.dataset.mapLead === txid;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-selected", String(selected));
    });
  const status = document.getElementById("map-selection");
  if (status) status.textContent = "Loading selected lead path…";
  try {
    const data = await api.mapLead({ txid });
    if (state.selectedLead !== txid) return;
    renderLeadFocus(data);
    api
      .auditEvent({ action: "map.lead_selected", details: { txid } })
      .catch(() => {});
  } catch (error) {
    fail(error);
  }
}
async function loadMapOverview() {
  const caption = document.getElementById("map-caption"),
    stats = document.getElementById("map-stats"),
    empty = document.getElementById("map-empty"),
    attribution = document.getElementById("map-attribution");
  try {
    const data = await api.mapOverview();
    if (attribution)
      attribution.textContent = `${data.geo.edition} ${data.geo.release} · ${data.geo.attribution} · approximate, reduced accuracy`;
    if (!data.totals.observations) {
      empty.hidden = false;
      empty.innerHTML = "<strong>No map evidence yet</strong><span>Import evidence and run analysis to build the transaction map.</span>";
      caption.textContent = "No imported observations.";
      return;
    }
    stats.innerHTML = `<span><strong>${num(data.totals.observations)}</strong> observations</span><span><strong>${num(data.totals.transactions)}</strong> transactions</span><span><strong>${num(data.totals.uniqueIps)}</strong> unique IPs</span><span><strong>${num(data.totals.clusters)}</strong> clusters</span>`;
    const aggregation = data.aggregation.combinedByCityPair
      ? ` · ${num(data.totals.routeGroups)} route/cluster groups consolidated into ${num(data.totals.renderedRoutes)} city routes`
      : ` · ${num(data.totals.renderedRoutes)} city/cluster routes`;
    caption.textContent = `Full case context${aggregation}${data.aggregation.suppressed ? ` · ${num(data.aggregation.suppressed.observationCount)} low-volume observations remain in totals` : ""}`;
    if (data.totals.countryConflicts)
      caption.textContent += ` · ${num(data.totals.countryConflicts)} supplied/derived country mismatches disclosed`;
    if (!data.geo.available)
      caption.textContent += " · City database unavailable; supplied-country fallbacks are active";
    renderMapOverview(data);
  } catch (error) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = `Unable to build map: ${error.message}`;
    }
  }
}
function destroyClusterGraph() {
  state.clusterGraph?.destroy();
  state.clusterGraph = null;
}
function clusterLayout(name) {
  if (!state.clusterGraph) return;
  document
    .querySelectorAll('[data-graph-action="rings"], [data-graph-action="flow"]')
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.graphAction === name),
      ),
    );
  const options =
    name === "flow"
      ? {
          name: "breadthfirst",
          directed: false,
          circle: false,
          spacingFactor: 1.2,
          padding: 35,
          animate: false,
          fit: true,
          roots: state.clusterGraph.nodes('[kind = "transaction"]'),
        }
      : {
          name: "concentric",
          concentric: (node) =>
            node.data("kind") === "transaction" ? 1000 : node.degree(),
          levelWidth: () => 500,
          minNodeSpacing: 22,
          padding: 35,
          animate: false,
          fit: true,
        };
  state.clusterGraph.layout(options).run();
}
function renderClusterGraph(d) {
  const container = document.getElementById("cluster-graph"),
    status = document.getElementById("cluster-graph-selection"),
    graphColor = clusterColor(d.cluster.id);
  if (!container || !d.graph?.links.length) return;
  if (typeof window.cytoscape !== "function") {
    status.textContent =
      "Interactive graph unavailable. The evidence lists remain below.";
    return;
  }
  const transactionDetails = new Map(
      d.transactions.map((transaction) => [transaction.txid, transaction]),
    ),
    nodes = new Map(),
    edges = [];
  d.graph.links.forEach((link, index) => {
    const addressId = `address:${link.address}`,
      transactionId = `transaction:${link.txid}`,
      transaction = transactionDetails.get(link.txid);
    if (!nodes.has(addressId))
      nodes.set(addressId, {
        data: {
          id: addressId,
          kind: "address",
          reference: link.address,
          label: trunc(link.address, 21),
        },
      });
    if (!nodes.has(transactionId))
      nodes.set(transactionId, {
        data: {
          id: transactionId,
          kind: "transaction",
          reference: link.txid,
          label: `₿ ${trunc(link.txid, 17)}`,
          amount: transaction ? btc(transaction.output_sat) : "",
        },
      });
    edges.push({
      data: {
        id: `link:${index}`,
        source: addressId,
        target: transactionId,
      },
    });
  });
  destroyClusterGraph();
  state.clusterGraph = window.cytoscape({
    container,
    elements: [...nodes.values(), ...edges],
    minZoom: 0.15,
    maxZoom: 3,
    wheelSensitivity: 0.22,
    boxSelectionEnabled: false,
    style: [
      {
        selector: "node",
        style: {
          label: "data(label)",
          "font-family": "Inter, Segoe UI, sans-serif",
          "font-size": 9,
          "text-valign": "center",
          "text-halign": "center",
          "overlay-opacity": 0,
          "transition-property": "background-color, border-color, opacity",
          "transition-duration": "120ms",
        },
      },
      {
        selector: 'node[kind = "address"]',
        style: {
          shape: "round-rectangle",
          width: "label",
          height: 24,
          padding: 9,
          color: "#071a33",
          "background-color": graphColor,
          "border-width": 1.5,
          "border-color": "#ffffff",
        },
      },
      {
        selector: 'node[kind = "transaction"]',
        style: {
          shape: "ellipse",
          width: 58,
          height: 58,
          color: "#ffffff",
          "font-size": 8,
          "font-weight": 600,
          "text-wrap": "wrap",
          "text-max-width": 48,
          "background-color": "#17243a",
          "border-width": 3,
          "border-color": "#cbd7e7",
        },
      },
      {
        selector: "edge",
        style: {
          width: 1.2,
          "line-color": graphColor,
          "curve-style": "bezier",
          opacity: 0.72,
        },
      },
      {
        selector: "node:selected",
        style: {
          color: "#ffffff",
          "border-width": 4,
          "border-color": graphColor,
          "background-color": graphColor,
        },
      },
      {
        selector: "edge:selected",
        style: { width: 2.5, "line-color": graphColor, opacity: 1 },
      },
    ],
  });
  clusterLayout("rings");
  state.clusterGraph.on("tap", "node", (event) => {
    const node = event.target,
      kind = node.data("kind"),
      reference = node.data("reference");
    status.textContent =
      kind === "transaction"
        ? `Transaction ${reference} · ${node.data("amount") || "value unavailable"} · double-click to inspect`
        : `Address ${reference} · linked to ${node.degree()} transaction${node.degree() === 1 ? "" : "s"} in this view`;
  });
  state.clusterGraph.on("dbltap", 'node[kind = "transaction"]', (event) =>
    openTx(event.target.data("reference")),
  );
  state.clusterGraph.on("tap", (event) => {
    if (event.target === state.clusterGraph)
      status.textContent =
        "Select a node for evidence context. Double-click a transaction to inspect it.";
  });
}
async function openTx(txid) {
  try {
    const d = await api.detail({ txid }),
      t = d.transaction,
      rs = t.reasons ? JSON.parse(t.reasons) : [],
      f = t.features ? JSON.parse(t.features) : {};
    destroyClusterGraph();
    state.selectedTx = txid;
    document.getElementById("dialog-label").textContent =
      "TRANSACTION EVIDENCE";
    const flowBadges = d.flowPatterns
        .map((pattern) => `<span class="flow-type ${esc(pattern.type)}">${pattern.type === "peeling" ? "PEELING CHAIN" : "MIXING CASCADE"} · ${pattern.confidence}</span>`)
        .join(""),
      riskPath = Array.isArray(t.risk_path) ? t.risk_path : [];
    dialogBody.innerHTML = `<div class="dialog-content"><div class="eyebrow">${t.priority ? "PRIORITIZED LEAD" : "BLOCKCHAIN RECORD"} ${state.summary?.stale ? "· STALE ANALYSIS" : ""}</div><h2>${t.priority ? `${t.priority} priority · ${t.score}/100` : "Transaction detail"}</h2><div class="tx-full">${esc(t.txid)}</div>${flowBadges ? `<div class="detail-flow-badges">${flowBadges}</div>` : ""}${txGraph(d)}<div class="detail-metrics"><div class="detail-metric"><small>Output value</small><strong>${btc(t.output_sat)}</strong></div><div class="detail-metric"><small>Exposure risk</small><strong>${Number(t.exposure_risk) ? `${Number(t.exposure_risk).toFixed(1)}/100` : "None"}</strong></div><div class="detail-metric"><small>Risk boost</small><strong>${Number(t.risk_boost) ? `+${t.risk_boost}` : "0"}</strong></div><div class="detail-metric"><small>Entity hypotheses</small><strong>${num(d.clusters.length)}</strong></div></div>${rs.length ? `<h3 class="section-title">Why this was flagged</h3>${rs.map((r) => `<div class="reason"><span class="reason-points">${r.points ? `+${r.points}` : "!"}</span><div><strong>${esc(r.code)} · ${esc(r.category)}</strong><p>${esc(r.explanation)}</p></div></div>`).join("")}` : '<div class="notice">No rule reached the triage threshold.</div>'}${riskPath.length ? `<h3 class="section-title">Strongest automatic exposure path</h3><p class="form-note">Seed ${esc(t.seed_pattern_id)} · ${num(t.risk_hops)} hop${Number(t.risk_hops) === 1 ? "" : "s"}. Each step is derived from a suspected-pattern hypothesis, not an illicit-wallet label.</p><div class="risk-path">${riskPath.map((step, index) => `<div><span>${index + 1}</span><strong>${esc(step.kind === "seed" ? `Seed pattern ${step.patternId}` : step.kind === "spend" ? `Spend ${trunc(step.txid, 24)}` : `Output ${trunc(step.address, 24)}`)}</strong><small>Risk ${Number(step.risk).toFixed(2)}${step.amountSat !== undefined ? ` · ${btc(step.amountSat)}` : ""}</small></div>`).join("")}</div>` : ""}${
      t.anomaly !== null
        ? `<h3 class="section-title">Saved feature evidence</h3><div class="code-block">Isolation Forest anomaly score: ${Number(t.anomaly).toFixed(4)} (not risk probability)\n${Object.entries(
            f,
          )
            .map(([k, v]) => `${esc(k)}: ${esc(v)}`)
            .join("\n")}</div>`
        : ""
    }<h3 class="section-title">Network observations</h3><div class="table-scroll"><table class="data-table detail-table"><thead><tr><th>UTC TIME</th><th>SOURCE</th><th>DESTINATION</th><th>SUPPLIED GEO / ASN</th></tr></thead><tbody>${d.observations.map((o) => `<tr><td>${date(o.timestamp)}</td><td class="mono">${esc(o.src_ip)}:${o.src_port}</td><td class="mono">${esc(o.dst_ip)}:${o.dst_port}</td><td>${esc(o.geo_country || "—")} / ${esc(o.asn ? `AS${o.asn}` : "—")}</td></tr>`).join("")}</tbody></table></div>${d.observationTotal > d.observations.length ? `<p class="muted mt">First ${d.observations.length} of ${num(d.observationTotal)} shown.</p>` : ""}<h3 class="section-title">Source provenance</h3>${d.sources.map((s) => `<div class="kv"><span>${esc(s.name)} · ${s.row_count} row link(s)</span><strong class="mono">SHA-256 ${esc(trunc(s.sha256, 30))}</strong></div>`).join("") || '<p class="muted">No source mapping.</p>'}<h3 class="section-title">Investigator review</h3><form class="review-form" id="review-form"><label>Disposition<select id="review-status">${["New", "In review", "Escalated", "Dismissed"].map((x) => `<option ${d.review.status === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><label class="notes">Case notes<textarea id="review-notes" maxlength="10000" placeholder="Corroboration, limitations, next steps…">${esc(d.review.notes)}</textarea></label><button class="button button-primary" type="submit">Save review</button></form></div>`;
    if (!dialog.open) dialog.showModal();
  } catch (e) {
    fail(e);
  }
}
async function openCluster(id) {
  try {
    const d = await api.cluster({ id });
    destroyClusterGraph();
    document.getElementById("dialog-label").textContent = "ENTITY HYPOTHESIS";
    const shownLinks = d.graph?.links.length || 0,
      totalLinks = d.graph?.linkTotal || 0,
      graphAddresses = new Set(
        (d.graph?.links || []).map((link) => link.address),
      ),
      graphTransactions = new Set(
        (d.graph?.links || []).map((link) => link.txid),
      ),
      graphNodes = graphAddresses.size + graphTransactions.size,
      embeddingEvidence = d.embeddingLinks?.length
        ? `<h3 class="section-title">Graph-embedding links</h3><p class="form-note">Accepted component links use representative wallet IDs and show their cosine similarity and repeated shared transaction contexts.</p><div class="code-block">${d.embeddingLinks
            .map(
              (link) =>
                `${esc(link.left_address)} ↔ ${esc(link.right_address)}\nsimilarity ${Number(link.similarity).toFixed(4)} · ${num(link.shared_contexts)} shared contexts`,
            )
            .join("\n\n")}${d.embeddingLinkTotal > d.embeddingLinks.length ? `\n\n… showing ${num(d.embeddingLinks.length)} of ${num(d.embeddingLinkTotal)} links` : ""}</div>`
        : "";
    dialogBody.innerHTML = `<div class="dialog-content"><div class="eyebrow">ENTITY HYPOTHESIS</div><h2>${esc(d.cluster.id)}</h2><p class="form-note">A common-input and graph-embedding hypothesis; it can be wrong. Graph links show observed address participation in related transactions, not verified ownership.</p><div class="detail-metrics"><div class="detail-metric"><small>Members</small><strong>${num(d.cluster.size)}</strong></div><div class="detail-metric"><small>Transactions</small><strong>${num(d.cluster.tx_count)}</strong></div><div class="detail-metric"><small>Graph nodes</small><strong>${num(graphNodes)}</strong></div><div class="detail-metric"><small>Graph links</small><strong>${num(shownLinks)}${totalLinks > shownLinks ? ` / ${num(totalLinks)}` : ""}</strong></div></div><section class="cluster-graph-shell"><div class="cluster-graph-toolbar"><div class="cluster-graph-legend"><span><i class="cluster-key transaction"></i>Transaction</span><span><i class="cluster-key address"></i>Address</span><span><i class="cluster-key link"></i>Observed link</span></div><div class="cluster-graph-actions"><button class="button button-small" data-graph-action="rings" aria-pressed="false">Rings</button><button class="button button-small" data-graph-action="flow" aria-pressed="false">Flow</button><button class="button button-small button-primary" data-graph-action="fit">Fit graph</button></div></div>${shownLinks ? `<div id="cluster-graph" class="cluster-graph" role="img" aria-label="Interactive graph of ${num(graphAddresses.size)} address members and ${num(graphTransactions.size)} related transactions"></div>` : '<div class="cluster-graph-empty">No address-to-transaction links are available for this hypothesis.</div>'}<div class="cluster-graph-caption"><span id="cluster-graph-selection">Select a node for evidence context. Double-click a transaction to inspect it.</span><span>${totalLinks > shownLinks ? `Showing ${num(shownLinks)} of ${num(totalLinks)} links for responsive rendering. ` : ""}The evidence lists remain below.</span></div></section>${embeddingEvidence}<h3 class="section-title">Address identifiers</h3><div class="code-block">${d.members.map((x) => esc(x.address)).join("\n")}${d.cluster.size > d.members.length ? "\n… limited to 250" : ""}</div><h3 class="section-title">Related transactions</h3>${d.transactions.map((x) => `<div class="kv"><button class="tx-link" data-tx="${esc(x.txid)}">${esc(x.txid)}</button><strong>${btc(x.output_sat)}</strong></div>`).join("")}</div>`;
    if (!dialog.open) dialog.showModal();
    renderClusterGraph(d);
  } catch (e) {
    fail(e);
  }
}
async function openErrors(id, name) {
  try {
    const rows = await api.errors({ id });
    destroyClusterGraph();
    document.getElementById("dialog-label").textContent = "IMPORT REJECTIONS";
    dialogBody.innerHTML = `<div class="dialog-content"><h2>${esc(name)}</h2><p class="form-note">First ${rows.length} rejected rows.</p><div class="table-scroll mt"><table class="data-table"><thead><tr><th>ROW</th><th>VALIDATION REASON</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${x.row_number}</td><td>${esc(x.reason)}</td></tr>`).join("")}</tbody></table></div></div>`;
    dialog.showModal();
  } catch (e) {
    fail(e);
  }
}
async function action(a) {
  if (state.busy) return;
  setBusy(true);
  try {
    let r;
    if (a === "import") r = await api.importFiles();
    if (a === "analyze") r = await api.analyze();
    if (a === "export-json") r = await api.exportReport({ format: "json" });
    if (a === "export-csv") r = await api.exportReport({ format: "csv" });
    if (r) {
      const message = a.startsWith("export")
        ? `Report saved to ${r.file}`
        : a === "analyze"
          ? "Analysis complete."
          : `${r.length} evidence file${r.length === 1 ? "" : "s"} ingested.`;
      toast(message);
      await navigate(state.route, false);
    }
  } catch (e) {
    fail(e);
  } finally {
    setBusy(false);
  }
}
async function removeImport(id) {
  if (state.busy) return;
  setBusy(true);
  try {
    const result = await api.deleteImport({ id });
    if (result) {
      toast(
        `${result.name} removed; ${num(result.removedObservations)} unique observations deleted.`,
      );
      await navigate("evidence", false);
    }
  } catch (e) {
    fail(e);
  } finally {
    setBusy(false);
  }
}
function configureAuth(configured) {
  state.authMode = configured ? "login" : "setup";
  document.getElementById("auth-eyebrow").textContent = configured
    ? "LOCAL ACCESS"
    : "FIRST-RUN SETUP";
  document.getElementById("auth-title").textContent = configured
    ? "Sign in"
    : "Create local account";
  document.getElementById("auth-description").textContent = configured
    ? "Authenticate to open the local investigation workspace."
    : "Create the first local investigator account. Password recovery is not available offline.";
  document.getElementById("auth-confirm-row").hidden = configured;
  document.getElementById("auth-confirm").required = !configured;
  document.getElementById("auth-password").autocomplete = configured
    ? "current-password"
    : "new-password";
  document.getElementById("auth-submit").textContent = configured
    ? "Sign in"
    : "Create account";
  document.getElementById("auth-error").hidden = true;
}
async function enterWorkspace(account) {
  state.username = account.username;
  document.getElementById("session-user").textContent = account.username;
  stopLoadingAnimation();
  loadingScreen.hidden = true;
  if (!authScreen.hidden && window.anime?.animate && !reducedMotion)
    await new Promise((resolve) =>
      window.anime.animate(authScreen, {
        opacity: [1, 0],
        translateY: [0, -8],
        duration: 260,
        ease: "outQuad",
        onComplete: resolve,
      }),
    );
  authScreen.hidden = true;
  authScreen.style.opacity = "";
  appShell.hidden = false;
  if (window.anime?.animate && !reducedMotion)
    window.anime.animate(appShell, {
      opacity: [0, 1],
      duration: 320,
      ease: "outQuad",
    });
  await navigate(location.hash.slice(1) || "overview", false);
}
async function showAuthentication(configured) {
  stopLoadingAnimation();
  loadingScreen.hidden = true;
  configureAuth(configured);
  authScreen.hidden = false;
  document.getElementById("auth-username").focus();
}
async function bootstrap() {
  startLoadingAnimation();
  const minimum = new Promise((resolve) => setTimeout(resolve, 700));
  try {
    const status = await api.authStatus();
    await minimum;
    if (status.authenticated)
      await enterWorkspace({ username: status.username || "ui-test" });
    else await showAuthentication(status.configured);
  } catch (error) {
    document.getElementById("loading-message").textContent =
      `Unable to open local workspace: ${error.message}`;
    stopLoadingAnimation();
  }
}
main.addEventListener("click", (e) => {
  const route = e.target.closest("[data-route]")?.dataset.route,
    a = e.target.closest("[data-action]")?.dataset.action,
    tx = e.target.closest("[data-tx]")?.dataset.tx,
    mapLead = e.target.closest("[data-map-lead]")?.dataset.mapLead,
    mapZoom = e.target.closest("[data-map-zoom]")?.dataset.mapZoom,
    flowPattern = e.target.closest("[data-flow-pattern]")?.dataset.flowPattern,
    flowNode = e.target.closest("[data-flow-node]")?.dataset.flowNode,
    c = e.target.closest("[data-cluster]")?.dataset.cluster,
    errors = e.target.closest("[data-errors]"),
    remove = e.target.closest("[data-delete-import]"),
    p = e.target.closest("[data-page]"),
    resetCluster = e.target.closest("[data-reset-cluster]")?.dataset
      .resetCluster;
  if (route) navigate(route);
  else if (a) action(a);
  else if (tx) openTx(tx);
  else if (mapLead) selectMapLead(mapLead);
  else if (mapZoom) controlMapViewport(mapZoom);
  else if (flowPattern) selectFlowPattern(flowPattern);
  else if (flowNode && state.flowGraph) {
    const node = state.flowGraph.getElementById(flowNode);
    state.flowGraph.elements().unselect();
    node.select();
    reducedMotion
      ? state.flowGraph.center(node)
      : state.flowGraph.animate({ center: { eles: node }, zoom: Math.max(1, state.flowGraph.zoom()), duration: 300 });
  }
  else if (e.target.closest("[data-flow-fit]")) state.flowGraph?.fit(undefined, 35);
  else if (c) openCluster(c);
  else if (errors) openErrors(errors.dataset.errors, errors.dataset.name);
  else if (remove) removeImport(remove.dataset.deleteImport);
  else if (e.target.closest("[data-map-clear]")) clearMapFocus();
  else if (resetCluster) {
    resetClusterColor(resetCluster);
    refreshSettingsClusters();
  } else if (e.target.closest("[data-reset-all-clusters]")) {
    localStorage.removeItem(colorStorageKey());
    refreshSettingsClusters();
    toast("Cluster colors reset to defaults.");
  }
  else if (p) {
    const pageType = p.dataset.pageType,
      pageLimit = Number(p.dataset.pageLimit) || state.limit;
    state.offset = Number(p.dataset.page);
    pageType === "clusters"
      ? refreshClusters()
      : pageType === "flows"
        ? refreshFlows()
      : pageType === "leads-map"
        ? refreshMapLeadList(pageLimit)
        : pageType === "settings-clusters"
          ? refreshSettingsClusters(state.offset)
      : pageType === "audit"
        ? activity()
        : refreshList(pageType, pageLimit);
  }
});
main.addEventListener("input", (e) => {
  if (e.target.id === "search-input") {
    state.search = e.target.value;
    state.offset = 0;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(
      () =>
        state.route === "clusters"
          ? refreshClusters()
          : state.route === "flows"
            ? refreshFlows()
          : state.route === "leads"
            ? refreshMapLeadList()
          : refreshList(state.route),
      250,
    );
  }
  if (e.target.id === "cluster-settings-search") {
    state.settingsSearch = e.target.value;
    state.offset = 0;
    clearTimeout(state.settingsTimer);
    state.settingsTimer = setTimeout(() => refreshSettingsClusters(), 250);
  }
});
main.addEventListener("change", (e) => {
  if (e.target.matches("[data-cluster-color]")) {
    const clusterId = e.target.dataset.clusterColor;
    saveClusterColor(clusterId, e.target.value);
    const row = e.target.closest("[data-cluster-setting]");
    row?.querySelector(".cluster-setting-swatch")?.style.setProperty(
      "--cluster-color",
      e.target.value,
    );
    const reset = row?.querySelector("[data-reset-cluster]");
    if (reset) reset.disabled = false;
    return;
  }
  if (e.target.id === "priority-filter") {
    state.priority = e.target.value;
    state.offset = 0;
    state.route === "leads" ? refreshMapLeadList() : refreshList("leads");
  }
  if (e.target.id === "status-filter") {
    state.status = e.target.value;
    state.offset = 0;
    state.route === "leads" ? refreshMapLeadList() : refreshList("leads");
  }
  if (["flow-type", "flow-confidence", "flow-risk", "flow-anomaly"].includes(e.target.id)) {
    state.flowType = document.getElementById("flow-type")?.value || "";
    state.flowConfidence = Number(document.getElementById("flow-confidence")?.value || 0);
    state.flowRisk = Number(document.getElementById("flow-risk")?.value || 0);
    state.flowAnomaly = Number(document.getElementById("flow-anomaly")?.value || 0);
    state.offset = 0;
    state.selectedFlow = null;
    refreshFlows();
  }
});
main.addEventListener("keydown", (event) => {
  const card = event.target.closest("[data-map-lead]");
  if (
    card &&
    !event.target.closest("[data-tx]") &&
    ["Enter", " "].includes(event.key)
  ) {
    event.preventDefault();
    selectMapLead(card.dataset.mapLead);
  }
});
navigation.addEventListener("click", (e) => {
  const r = e.target.closest("[data-route]")?.dataset.route;
  if (r) navigate(r);
});
document
  .getElementById("close-dialog")
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("close", destroyClusterGraph);
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
  const graphAction = e.target.closest("[data-graph-action]")?.dataset
    .graphAction;
  if (graphAction === "fit") state.clusterGraph?.fit(undefined, 35);
  else if (graphAction) clusterLayout(graphAction);
  const tx = e.target.closest("[data-tx]")?.dataset.tx;
  if (tx) openTx(tx);
});
dialog.addEventListener("submit", async (e) => {
  if (e.target.id !== "review-form") return;
  e.preventDefault();
  try {
    await api.review({
      txid: state.selectedTx,
      status: document.getElementById("review-status").value,
      notes: document.getElementById("review-notes").value,
    });
    toast("Review saved.");
    dialog.close();
    await navigate(state.route, false);
  } catch (x) {
    fail(x);
  }
});
document
  .getElementById("cancel-job")
  .addEventListener("click", () => api.cancel());
document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await api.logout();
    appShell.hidden = true;
    state.username = "";
    document.getElementById("auth-form").reset();
    configureAuth(true);
    authScreen.hidden = false;
    document.getElementById("auth-username").focus();
  } catch (e) {
    fail(e);
  }
});
document.getElementById("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("auth-username").value,
    password = document.getElementById("auth-password").value,
    confirm = document.getElementById("auth-confirm").value,
    error = document.getElementById("auth-error"),
    submit = document.getElementById("auth-submit");
  error.hidden = true;
  if (state.authMode === "setup" && password !== confirm) {
    error.textContent = "Passwords do not match.";
    error.hidden = false;
    return;
  }
  submit.disabled = true;
  try {
    const account =
      state.authMode === "setup"
        ? await api.setupAccount({ username, password })
        : await api.login({ username, password });
    document.getElementById("auth-form").reset();
    await enterWorkspace(account);
  } catch (x) {
    error.textContent = x.message;
    error.hidden = false;
    document.getElementById("auth-password").select();
  } finally {
    submit.disabled = false;
  }
});
api.onProgress((p) => {
  const j = document.getElementById("job");
  j.hidden = !p;
  if (p) {
    document.getElementById("job-phase").textContent = p.phase;
    document.getElementById("job-description").textContent = p.name
      ? `${p.name} · ${num(p.rows || 0)} rows`
      : "";
    document.getElementById("job-progress").value = p.percent || 0;
  }
});
api.onFatal((m) => {
  if (appShell.hidden) {
    document.getElementById("loading-message").textContent =
      `Evidence worker stopped: ${m}`;
  } else {
    fail(`Evidence worker stopped: ${m}`);
    setBusy(true);
  }
});
bootstrap();
