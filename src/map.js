"use strict";

const OVERVIEW_ROUTE_LIMIT = 2000;
const FOCUS_ENDPOINT_LIMIT = 120;
const FOCUS_WALLET_LIMIT = 120;
const FOCUS_EDGE_LIMIT = 800;

function mapRows(db) {
  const statement = db.prepare(`SELECT o.id,o.txid,o.src_ip,o.dst_ip,o.geo_country,l.priority,
    (SELECT m.cluster_id FROM addresses a JOIN cluster_members m ON m.address=a.address
      WHERE a.txid=o.txid AND a.side='input' ORDER BY m.cluster_id LIMIT 1) AS cluster_id
    FROM observations o LEFT JOIN lead_scores l ON l.txid=o.txid
    WHERE o.id>? ORDER BY o.id LIMIT 1000`);
  return function* rows() {
    let cursor = 0;
    while (true) {
      const batch = statement.all(cursor);
      if (!batch.length) return;
      yield* batch;
      cursor = batch[batch.length - 1].id;
    }
  };
}

function locationRecord(location) {
  return {
    id: location.key,
    country: location.country,
    countryName: location.countryName,
    region: location.region,
    city: location.city,
    latitude: location.latitude,
    longitude: location.longitude,
    source: location.source,
    observationCount: 0,
    ips: new Set(),
    transactions: new Set(),
    countryConflictCount: 0,
  };
}

function publicLocation(location) {
  return {
    id: location.id,
    country: location.country,
    countryName: location.countryName,
    region: location.region,
    city: location.city,
    latitude: location.latitude,
    longitude: location.longitude,
    source: location.source,
    observationCount: location.observationCount,
    uniqueIpCount: location.ips.size,
    transactionCount: location.transactions.size,
    countryConflictCount: location.countryConflictCount,
  };
}

function publicRoute(route) {
  return {
    id: route.id,
    source: route.source,
    target: route.target,
    clusterId: route.clusterId,
    observationCount: route.observationCount,
    transactionCount: route.transactions.size,
    uniqueIpCount: route.ips.size,
    leadCount: route.leads.size,
    clusterBreakdown: route.clusterBreakdown || null,
  };
}

function combineRoutes(routes) {
  if (routes.length <= OVERVIEW_ROUTE_LIMIT)
    return { routes, combined: false, suppressed: null };
  const pairs = new Map();
  for (const route of routes) {
    const key = `${route.source}|${route.target}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = {
        id: `route-pair:${key}`,
        source: route.source,
        target: route.target,
        clusterId: route.clusterId,
        observationCount: 0,
        transactions: new Set(),
        ips: new Set(),
        leads: new Set(),
        clusters: new Map(),
      };
      pairs.set(key, pair);
    }
    pair.observationCount += route.observationCount;
    for (const value of route.transactions) pair.transactions.add(value);
    for (const value of route.ips) pair.ips.add(value);
    for (const value of route.leads) pair.leads.add(value);
    const cluster = route.clusterId || "unclustered";
    pair.clusters.set(
      cluster,
      (pair.clusters.get(cluster) || 0) + route.observationCount,
    );
  }
  let combined = [...pairs.values()].map((pair) => {
    const breakdown = [...pair.clusters.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    pair.clusterId = breakdown[0]?.[0] === "unclustered" ? null : breakdown[0]?.[0];
    pair.clusterBreakdown = breakdown.slice(0, 12).map(([clusterId, count]) => ({
      clusterId: clusterId === "unclustered" ? null : clusterId,
      count,
    }));
    delete pair.clusters;
    return pair;
  });
  combined.sort(
    (a, b) =>
      b.observationCount - a.observationCount || a.id.localeCompare(b.id),
  );
  if (combined.length <= OVERVIEW_ROUTE_LIMIT)
    return { routes: combined, combined: true, suppressed: null };
  const kept = combined.slice(0, OVERVIEW_ROUTE_LIMIT),
    omitted = combined.slice(OVERVIEW_ROUTE_LIMIT);
  return {
    routes: kept,
    combined: true,
    suppressed: {
      routeCount: omitted.length,
      observationCount: omitted.reduce(
        (sum, route) => sum + route.observationCount,
        0,
      ),
    },
  };
}

function mapOverview(db, locator) {
  const locations = new Map(),
    routes = new Map(),
    transactions = new Set(),
    ips = new Set(),
    leads = new Set(),
    clusters = new Set();
  let observations = 0;
  const addLocation = (location, ip, txid) => {
    let stored = locations.get(location.key);
    if (!stored) {
      stored = locationRecord(location);
      locations.set(location.key, stored);
    }
    stored.observationCount++;
    if (location.countryConflict) stored.countryConflictCount++;
    stored.ips.add(ip);
    stored.transactions.add(txid);
  };
  for (const row of mapRows(db)()) {
    observations++;
    transactions.add(row.txid);
    ips.add(row.src_ip);
    ips.add(row.dst_ip);
    if (row.priority) leads.add(row.txid);
    if (row.cluster_id) clusters.add(row.cluster_id);
    const source = locator.locate(row.src_ip, row.geo_country),
      target = locator.locate(row.dst_ip, row.geo_country);
    addLocation(source, row.src_ip, row.txid);
    addLocation(target, row.dst_ip, row.txid);
    const routeKey = `${source.key}|${target.key}|${row.cluster_id || "unclustered"}`;
    let route = routes.get(routeKey);
    if (!route) {
      route = {
        id: `route:${routeKey}`,
        source: source.key,
        target: target.key,
        clusterId: row.cluster_id || null,
        observationCount: 0,
        transactions: new Set(),
        ips: new Set(),
        leads: new Set(),
      };
      routes.set(routeKey, route);
    }
    route.observationCount++;
    route.transactions.add(row.txid);
    route.ips.add(row.src_ip);
    route.ips.add(row.dst_ip);
    if (row.priority) route.leads.add(row.txid);
  }
  const originalRoutes = [...routes.values()],
    rendered = combineRoutes(originalRoutes),
    usedLocations = new Set(
      rendered.routes.flatMap((route) => [route.source, route.target]),
    );
  return {
    totals: {
      observations,
      transactions: transactions.size,
      uniqueIps: ips.size,
      leads: leads.size,
      clusters: clusters.size,
      routeGroups: originalRoutes.length,
      renderedRoutes: rendered.routes.length,
      countryConflicts: [...locations.values()].reduce(
        (sum, location) => sum + location.countryConflictCount,
        0,
      ),
    },
    locations: [...locations.values()]
      .filter((location) => usedLocations.has(location.id))
      .map(publicLocation),
    routes: rendered.routes.map(publicRoute),
    clusters: [...clusters].sort(),
    aggregation: {
      combinedByCityPair: rendered.combined,
      suppressed: rendered.suppressed,
      routeLimit: OVERVIEW_ROUTE_LIMIT,
    },
    geo: locator.metadata,
  };
}

function focusEndpoints(db, txid, locator) {
  const observations = db
      .prepare(
        "SELECT src_ip,dst_ip,geo_country,count(*) AS count FROM observations WHERE txid=? GROUP BY src_ip,dst_ip,geo_country ORDER BY count DESC,src_ip,dst_ip",
      )
      .all(txid),
    endpoints = new Map();
  const add = (ip, role, country, count) => {
    const key = `${role}:${ip}`,
      location = locator.locate(ip, country);
    let endpoint = endpoints.get(key);
    if (!endpoint) {
      endpoint = { id: key, ip, role, count: 0, ...location };
      endpoints.set(key, endpoint);
    }
    endpoint.count += count;
  };
  for (const observation of observations) {
    add(observation.src_ip, "source", observation.geo_country, observation.count);
    add(
      observation.dst_ip,
      "destination",
      observation.geo_country,
      observation.count,
    );
  }
  return [...endpoints.values()].sort(
    (a, b) => b.count - a.count || a.id.localeCompare(b.id),
  );
}

function summarizeOverflow(items, groupKey, kind) {
  const groups = new Map();
  for (const item of items) {
    const key = groupKey(item);
    let group = groups.get(key);
    if (!group) {
      group = { id: `${kind}-summary:${key}`, kind, key, count: 0 };
      groups.set(key, group);
    }
    group.count++;
  }
  return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function mapLead(db, txid, locator) {
  const transaction = db
    .prepare(
      "SELECT t.txid,t.output_sat,l.priority,l.score,l.category FROM transactions t LEFT JOIN lead_scores l ON l.txid=t.txid WHERE t.txid=?",
    )
    .get(txid);
  if (!transaction) throw new Error("Transaction not found.");
  const allEndpoints = focusEndpoints(db, txid, locator),
    allWallets = db
      .prepare(
        `SELECT a.address,a.side,m.cluster_id FROM addresses a
          LEFT JOIN cluster_members m ON m.address=a.address WHERE a.txid=?
          ORDER BY CASE a.side WHEN 'input' THEN 0 ELSE 1 END,a.address`,
      )
      .all(txid),
    endpoints = allEndpoints.slice(0, FOCUS_ENDPOINT_LIMIT),
    wallets = allWallets.slice(0, FOCUS_WALLET_LIMIT),
    endpointOverflow = summarizeOverflow(
      allEndpoints.slice(FOCUS_ENDPOINT_LIMIT),
      (item) => `${item.role}:${item.country || "unlocated"}`,
      "endpoint",
    ),
    walletOverflow = summarizeOverflow(
      allWallets.slice(FOCUS_WALLET_LIMIT),
      (item) => `${item.side}:${item.cluster_id || "unclustered"}`,
      "wallet",
    );
  const located = endpoints.filter(
      (endpoint) =>
        Number.isFinite(endpoint.latitude) && Number.isFinite(endpoint.longitude),
    ),
    center = located.length
      ? {
          latitude:
            located.reduce((sum, item) => sum + item.latitude, 0) /
            located.length,
          longitude:
            located.reduce((sum, item) => sum + item.longitude, 0) /
            located.length,
        }
      : { latitude: 0, longitude: 0 };
  const edgeCount = Math.min(
    FOCUS_EDGE_LIMIT,
    endpoints.length + wallets.length + endpointOverflow.length + walletOverflow.length,
  );
  return {
    transaction,
    center,
    endpoints,
    wallets,
    endpointOverflow,
    walletOverflow,
    totals: {
      endpoints: allEndpoints.length,
      wallets: allWallets.length,
      renderedEndpoints: endpoints.length,
      renderedWallets: wallets.length,
      renderedEdges: edgeCount,
      countryConflicts: allEndpoints.filter(
        (endpoint) => endpoint.countryConflict,
      ).length,
    },
    limits: {
      endpoints: FOCUS_ENDPOINT_LIMIT,
      wallets: FOCUS_WALLET_LIMIT,
      edges: FOCUS_EDGE_LIMIT,
    },
    geo: locator.metadata,
  };
}

module.exports = {
  mapOverview,
  mapLead,
  combineRoutes,
  OVERVIEW_ROUTE_LIMIT,
  FOCUS_ENDPOINT_LIMIT,
  FOCUS_WALLET_LIMIT,
  FOCUS_EDGE_LIMIT,
};
