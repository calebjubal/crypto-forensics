"use strict";

const fs = require("node:fs");
const { Reader } = require("maxmind");
const countryCentroids = require("../assets/country-centroids.json");
const metadata = require("../assets/geoip/dbip-city-lite.metadata.json");

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, Number(value)));

function coordinate(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, minimum, maximum) : null;
}

function countryFallback(code) {
  const normalized = String(code || "").trim().toUpperCase();
  const entry = countryCentroids[normalized];
  if (!entry) return null;
  return {
    key: `country:${normalized}`,
    country: normalized,
    countryName: entry.name || normalized,
    region: "",
    city: "Country metadata fallback",
    latitude: entry.latitude,
    longitude: entry.longitude,
    source: "supplied-country",
  };
}

function responseLocation(response) {
  if (!response || typeof response !== "object") return null;
  const latitude = coordinate(response.location?.latitude, -90, 90),
    longitude = coordinate(response.location?.longitude, -180, 180),
    country = String(response.country?.iso_code || "").toUpperCase();
  if (latitude === null || longitude === null || !country) return null;
  const region =
      response.subdivisions?.[0]?.names?.en ||
      response.subdivisions?.[0]?.iso_code ||
      "",
    city = response.city?.names?.en || "Approximate location";
  return {
    key: `city:${country}:${region}:${city}:${latitude.toFixed(4)}:${longitude.toFixed(4)}`,
    country,
    countryName: response.country?.names?.en || country,
    region,
    city,
    latitude,
    longitude,
    source: "db-ip-city-lite",
  };
}

function annotateLocation(location, suppliedCountry) {
  if (!location) return null;
  const supplied = String(suppliedCountry || "").trim().toUpperCase();
  return {
    ...location,
    suppliedCountry: supplied,
    countryConflict: !!(
      supplied &&
      location.country &&
      supplied !== location.country
    ),
  };
}

function createGeoLocator(file) {
  let reader = null,
    loadError = "";
  try {
    const buffer = fs.readFileSync(file);
    reader = new Reader(buffer);
  } catch (error) {
    loadError = error.message;
  }
  const cache = new Map();
  return {
    metadata: { ...metadata, available: !!reader, error: loadError },
    locate(ip, suppliedCountry) {
      const cacheKey = `${ip}|${String(suppliedCountry || "").toUpperCase()}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      let location = null;
      try {
        location = annotateLocation(
          responseLocation(reader?.get(ip)),
          suppliedCountry,
        );
      } catch {}
      location =
        location ||
        annotateLocation(countryFallback(suppliedCountry), suppliedCountry) || {
          key: "unlocated",
          country: "",
          countryName: "Unlocated",
          region: "",
          city: "No offline location match",
          latitude: null,
          longitude: null,
          source: "unlocated",
          suppliedCountry: "",
          countryConflict: false,
        };
      cache.set(cacheKey, location);
      return location;
    },
  };
}

module.exports = {
  createGeoLocator,
  responseLocation,
  countryFallback,
  annotateLocation,
};
