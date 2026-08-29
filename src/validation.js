"use strict";

const { isIP } = require("node:net");
const { createHash } = require("node:crypto");
const MAX_SAT = 21000000n * 100000000n;
const ARRAY_FIELDS = [
  "input_addresses",
  "output_addresses",
  "input_amounts",
  "output_amounts",
];
const REQUIRED = [
  "timestamp",
  "src_ip",
  "dst_ip",
  "src_port",
  "dst_port",
  "txid",
  ...ARRAY_FIELDS,
];

function satoshis(value) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(text))
    throw new Error(
      "Amounts must be nonnegative BTC decimals, at most 8 decimal places (no exponent notation).",
    );
  const [whole, fraction = ""] = text.split(".");
  const sat = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  if (sat > MAX_SAT)
    throw new Error("Amount exceeds the Bitcoin supply limit.");
  return Number(sat);
}

function array(value, field) {
  let result = value;
  if (typeof value === "string") {
    try {
      result = JSON.parse(value);
    } catch {
      throw new Error(`${field} must be a JSON array.`);
    }
  }
  if (!Array.isArray(result) || result.length < 1 || result.length > 10000)
    throw new Error(`${field} must contain 1–10,000 entries.`);
  return result;
}

function address(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{8,128}$/.test(value))
    throw new Error(
      "Invalid address identifier: expected 8–128 alphanumeric characters (or : _ -).",
    );
  return value;
}

function normalize(row) {
  if (!row || typeof row !== "object" || Array.isArray(row))
    throw new Error("Each record must be an object.");
  for (const field of REQUIRED)
    if (row[field] === undefined || row[field] === null || row[field] === "")
      throw new Error(`Missing required field: ${field}`);
  if (!row.geo_country && !row.asn)
    throw new Error("At least one of geo_country or asn is required.");
  const timestamp = String(row.timestamp);
  // Requiring an explicit timezone avoids local-machine-dependent evidence times.
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
      timestamp,
    ) ||
    !Number.isFinite(Date.parse(timestamp))
  )
    throw new Error(
      "timestamp must be ISO 8601 with seconds and an explicit timezone.",
    );
  const datePart = timestamp.slice(0, 10);
  const [year, month, day] = datePart.split("-").map(Number);
  if (
    year < 2009 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    throw new Error("Invalid Bitcoin observation calendar date.");
  const normalized = {
    timestamp: new Date(timestamp).toISOString(),
    ts_ms: Date.parse(timestamp),
  };
  for (const key of ["src_ip", "dst_ip"]) {
    const ip = String(row[key]).trim();
    if (!isIP(ip) || ip.includes("%"))
      throw new Error(
        `${key} must be an IPv4 or IPv6 address, without a zone identifier.`,
      );
    normalized[key] =
      isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname.slice(1, -1) : ip;
  }
  for (const key of ["src_port", "dst_port"]) {
    if (!/^\d+$/.test(String(row[key])) || Number(row[key]) > 65535)
      throw new Error(`${key} must be an integer between 0 and 65535.`);
    normalized[key] = Number(row[key]);
  }
  normalized.txid = String(row.txid).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized.txid))
    throw new Error("txid must be exactly 64 hexadecimal characters.");
  for (const key of ARRAY_FIELDS)
    normalized[key] = array(row[key], key).map(
      key.endsWith("addresses") ? address : satoshis,
    );
  if (
    normalized.input_addresses.length !== normalized.input_amounts.length ||
    normalized.output_addresses.length !== normalized.output_amounts.length
  )
    throw new Error(
      "Address and amount array lengths must match for each side.",
    );
  normalized.input_sat = normalized.input_amounts.reduce((a, b) => a + b, 0);
  normalized.output_sat = normalized.output_amounts.reduce((a, b) => a + b, 0);
  if (
    normalized.input_sat > Number(MAX_SAT) ||
    normalized.output_sat > Number(MAX_SAT)
  )
    throw new Error("Transaction total exceeds the Bitcoin supply limit.");
  if (normalized.input_sat < normalized.output_sat)
    throw new Error(
      "Output total exceeds input total. Coinbase and incomplete-input records are not supported.",
    );
  normalized.fee_sat = normalized.input_sat - normalized.output_sat;
  normalized.geo_country = row.geo_country
    ? String(row.geo_country).toUpperCase()
    : null;
  if (normalized.geo_country && !/^[A-Z]{2}$/.test(normalized.geo_country))
    throw new Error("geo_country must be a two-letter country code.");
  normalized.asn = row.asn
    ? String(row.asn).toUpperCase().replace(/^AS/, "")
    : null;
  if (
    normalized.asn &&
    (!/^\d+$/.test(normalized.asn) ||
      Number(normalized.asn) > 4294967295 ||
      Number(normalized.asn) < 1)
  )
    throw new Error(
      "asn must be a positive 32-bit ASN, optionally prefixed AS.",
    );
  if (normalized.asn) normalized.asn = String(Number(normalized.asn));
  const equalOutputs = new Map();
  for (const amount of normalized.output_amounts)
    if (amount > 0)
      equalOutputs.set(amount, (equalOutputs.get(amount) || 0) + 1);
  normalized.coinjoin =
    normalized.input_addresses.length >= 3 &&
    Math.max(0, ...equalOutputs.values()) >= 3
      ? 1
      : 0;
  normalized.data_hash = hash(
    JSON.stringify(ARRAY_FIELDS.map((key) => normalized[key])),
  );
  normalized.fingerprint = hash(
    JSON.stringify([
      normalized.txid,
      normalized.timestamp,
      normalized.src_ip,
      normalized.dst_ip,
      normalized.src_port,
      normalized.dst_port,
      normalized.geo_country,
      normalized.asn,
    ]),
  );
  return normalized;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
module.exports = { normalize, satoshis, hash, REQUIRED, ARRAY_FIELDS };
