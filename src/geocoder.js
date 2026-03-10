const axios = require('axios');
const config = require('../config');

// Haversine distance in miles
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Simple in-memory cache to avoid re-geocoding the same addresses
const geocodeCache = new Map();
const geocodeInFlight = new Map();
const queryCache = new Map();

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_HEADERS = { 'User-Agent': 'FarnhamHomeFinder/1.0 (personal use)' };
const PHOTON_URL = 'https://photon.komoot.io/api/';
const NOMINATIM_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 400;
const FALLBACK_QUERY_DELAY_MS = 300;
const PROVIDER_LIMITS = {
  nominatim: {
    minIntervalMs: 1300,
    cooldownMs: 60000,
  },
  photon: {
    minIntervalMs: 800,
    cooldownMs: 15000,
  },
};
const providerState = {
  nominatim: { nextAllowedAt: 0, cooldownUntil: 0 },
  photon: { nextAllowedAt: 0, cooldownUntil: 0 },
};

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*([0-9][A-Z]{2})\b/i;
const UK_OUTWARD_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;
const UK_OUTWARD_POSTCODE_SUFFIX_RE = /\s+[A-Z]{1,2}\d[A-Z\d]?\s*$/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value) {
  if (!value) return null;
  const text = String(value).trim();
  const seconds = Number.parseInt(text, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const timestamp = Date.parse(text);
  if (Number.isFinite(timestamp)) {
    const delta = timestamp - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

async function waitForProvider(provider) {
  const state = providerState[provider];
  const limits = PROVIDER_LIMITS[provider];
  if (!state || !limits) return;

  const now = Date.now();
  const waitMs = Math.max(state.nextAllowedAt - now, state.cooldownUntil - now, 0);
  if (waitMs > 0) await sleep(waitMs);
}

function markProviderRequest(provider) {
  const state = providerState[provider];
  const limits = PROVIDER_LIMITS[provider];
  if (!state || !limits) return;

  const now = Date.now();
  state.nextAllowedAt = Math.max(state.nextAllowedAt, now) + limits.minIntervalMs;
}

function markProviderBackoff(provider, err, attempt) {
  const state = providerState[provider];
  const limits = PROVIDER_LIMITS[provider];
  if (!state || !limits) return 0;

  const retryAfterMs = parseRetryAfterMs(err?.response?.headers?.['retry-after']);
  const backoffMs = retryAfterMs ?? Math.max(limits.cooldownMs, RETRY_BASE_DELAY_MS * (2 ** attempt));
  const until = Date.now() + backoffMs;
  state.cooldownUntil = Math.max(state.cooldownUntil, until);
  state.nextAllowedAt = Math.max(state.nextAllowedAt, state.cooldownUntil);
  return backoffMs;
}

function normalizeUkPostcodes(text) {
  return text.replace(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*([0-9][A-Z]{2})\b/gi, (_, outward, inward) => {
    return `${outward.toUpperCase()} ${inward.toUpperCase()}`;
  });
}

function canonicalSegment(segment) {
  return segment.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeAddress(address) {
  const text = normalizeUkPostcodes(
    String(address)
      .replace(/[;\n|]/g, ',')
      .replace(/\s+/g, ' ')
      .trim()
  );

  const rawSegments = text
    .replace(/\s*,\s*/g, ',')
    .replace(/,+/g, ',')
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const seen = new Set();
  const dedupedSegments = rawSegments.filter((segment) => {
    const key = canonicalSegment(segment);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return dedupedSegments.join(', ');
}

function hasStreetHint(text) {
  return /\b(road|rd|street|st|lane|ln|close|drive|dr|avenue|ave|way|gardens?|court|place|mead|crescent|terrace|park|row|hill|grove|end)\b/i
    .test(text);
}

function pickStreetToken(normalizedAddress) {
  const firstSegment = normalizedAddress.split(',')[0] || normalizedAddress;
  const stop = new Set(['the', 'and', 'farnham', 'surrey', 'united', 'kingdom']);
  const tokens = firstSegment
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !stop.has(token));
  tokens.sort((a, b) => b.length - a.length);
  return tokens[0] || null;
}

function extractPostcode(text) {
  const match = String(text).toUpperCase().match(UK_POSTCODE_RE);
  if (!match) return null;
  return `${match[1]} ${match[2]}`;
}

function stripOutwardOnlyPostcodeSegments(text) {
  const segments = String(text)
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const cleaned = segments
    .map((segment) => segment.replace(UK_OUTWARD_POSTCODE_SUFFIX_RE, '').trim())
    .filter((segment) => segment && !UK_OUTWARD_POSTCODE_RE.test(segment));
  return cleaned.join(', ');
}

function simplifyAddressForFallbacks(text) {
  let simplified = String(text || '').trim();
  if (!simplified) return '';

  simplified = simplified
    .replace(/^plot\s+\d+\s*,\s*/i, '')
    .replace(/\s*-\s*type\s+[\w-]+\s*/i, ' ')
    .replace(/\bUnited Kingdom\b/gi, '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,+/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*$/g, '')
    .trim();

  const developmentMatch = simplified.match(/^(.*?)\s+at\s+([^,]+),\s*(.+)$/i);
  if (developmentMatch) {
    simplified = `${developmentMatch[2]}, ${developmentMatch[3]}`.trim();
  } else {
    simplified = simplified.replace(/\s+at\s+/i, ', ');
  }

  return stripOutwardOnlyPostcodeSegments(simplified) || simplified;
}

function ensureConfiguredLocality(query, originalAddress) {
  const input = String(query || '').trim();
  if (!input) return '';

  const hasConfiguredLocation = new RegExp(`\\b${String(config.search?.location || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    .test(input);
  const hasCounty = /\bsurrey\b/i.test(input);
  const originalHasLocation = /\bfarnham\b/i.test(String(originalAddress || '')) || /\bsurrey\b/i.test(String(originalAddress || ''));

  if (hasConfiguredLocation || hasCounty || originalHasLocation) return input;
  return `${input}, ${config.search.location}, ${config.search.county}`;
}

function ensureUkSuffix(query) {
  if (/\b(uk|united kingdom)\b/i.test(query)) return query;
  return `${query}, UK`;
}

function addUniqueQuery(queries, seen, query) {
  if (!query) return;
  const clean = normalizeUkPostcodes(
    query
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s+/g, ' ')
      .trim()
  );
  if (!clean) return;
  const key = clean.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  queries.push(clean);
}

function buildQueries(normalizedAddress) {
  const segments = normalizedAddress.split(',').map((segment) => segment.trim()).filter(Boolean);
  const postcode = extractPostcode(normalizedAddress);
  const withoutOutwardOnly = stripOutwardOnlyPostcodeSegments(normalizedAddress);
  const simplifiedFallback = simplifyAddressForFallbacks(normalizedAddress);
  const hasFarnham = /\bfarnham\b/i.test(normalizedAddress);
  const hasSurrey = /\bsurrey\b/i.test(normalizedAddress);
  const hasPostcode = !!postcode;

  const queries = [];
  const seen = new Set();

  let primary = normalizedAddress;
  if (!hasPostcode && !hasFarnham && !hasSurrey) {
    primary = `${primary}, Farnham, Surrey`;
  }
  addUniqueQuery(queries, seen, ensureUkSuffix(primary));
  if (withoutOutwardOnly && withoutOutwardOnly !== normalizedAddress) {
    addUniqueQuery(queries, seen, ensureUkSuffix(withoutOutwardOnly));
  }
  if (simplifiedFallback && simplifiedFallback !== normalizedAddress && simplifiedFallback !== withoutOutwardOnly) {
    addUniqueQuery(queries, seen, ensureUkSuffix(ensureConfiguredLocality(simplifiedFallback, normalizedAddress)));
  }

  if (postcode) {
    addUniqueQuery(queries, seen, `${postcode}, UK`);
    if (/^GU/i.test(postcode)) {
      addUniqueQuery(queries, seen, `${postcode.split(' ')[0]}, Surrey, UK`);
    }
  }

  if (segments.length > 1) {
    const simplified = segments.slice(1).join(', ');
    const needsLocality = !extractPostcode(simplified) && !/\bfarnham\b/i.test(simplified) && !/\bsurrey\b/i.test(simplified);
    addUniqueQuery(
      queries,
      seen,
      ensureUkSuffix(needsLocality ? `${simplified}, Farnham, Surrey` : simplified)
    );

    const tail = segments.slice(-2).join(', ');
    addUniqueQuery(queries, seen, ensureUkSuffix(tail));
  }

  const primaryQuery = ensureUkSuffix(primary);
  const postcodeQuery = postcode ? `${postcode}, UK` : null;
  const outwardQuery = postcode && /^GU/i.test(postcode) ? `${postcode.split(' ')[0]}, Surrey, UK` : null;
  const simplifiedQuery = segments.length > 1
    ? ensureUkSuffix((() => {
      const simplified = segments.slice(1).join(', ');
      const needsLocality = !extractPostcode(simplified) && !/\bfarnham\b/i.test(simplified) && !/\bsurrey\b/i.test(simplified);
      return needsLocality ? `${simplified}, Farnham, Surrey` : simplified;
    })())
    : null;
  const tailQuery = segments.length > 1 ? ensureUkSuffix(segments.slice(-2).join(', ')) : null;

  return queries.map((query) => {
    if (query === primaryQuery) return { query, kind: 'primary' };
    if (postcodeQuery && query === postcodeQuery) return { query, kind: 'postcode' };
    if (outwardQuery && query === outwardQuery) return { query, kind: 'outward' };
    if (simplifiedQuery && query === simplifiedQuery) return { query, kind: 'simplified' };
    if (tailQuery && query === tailQuery) return { query, kind: 'tail' };
    return { query, kind: 'fallback' };
  });
}

function isTransientError(err) {
  const status = err.response?.status;
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  return ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND'].includes(err.code);
}

async function queryNominatim(query) {
  const cacheKey = query.toLowerCase();
  if (queryCache.has(cacheKey)) return queryCache.get(cacheKey);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await waitForProvider('nominatim');
      markProviderRequest('nominatim');
      const res = await axios.get(NOMINATIM_URL, {
        params: { q: query, format: 'json', limit: 1, countrycodes: 'gb' },
        headers: NOMINATIM_HEADERS,
        timeout: NOMINATIM_TIMEOUT_MS,
      });

      if (res.data && res.data.length > 0) {
        const { lat, lon } = res.data[0];
        const result = {
          lat: parseFloat(lat),
          lng: parseFloat(lon),
          displayName: String(res.data[0].display_name || ''),
          addresstype: String(res.data[0].addresstype || ''),
          type: String(res.data[0].type || ''),
          category: String(res.data[0].class || ''),
        };
        queryCache.set(cacheKey, result);
        return result;
      }

      queryCache.set(cacheKey, null);
      return null;
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isTransientError(err)) {
        console.warn(`Geocode failed for "${query}": ${err.message}`);
        queryCache.set(cacheKey, null);
        return null;
      }

      const backoff = markProviderBackoff('nominatim', err, attempt) || (RETRY_BASE_DELAY_MS * (2 ** attempt));
      await sleep(backoff);
    }
  }

  queryCache.set(cacheKey, null);
  return null;
}

async function queryPhoton(query) {
  const cacheKey = `photon:${query.toLowerCase()}`;
  if (queryCache.has(cacheKey)) return queryCache.get(cacheKey);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await waitForProvider('photon');
      markProviderRequest('photon');
      const res = await axios.get(PHOTON_URL, {
        params: { q: query, limit: 1 },
        headers: NOMINATIM_HEADERS,
        timeout: NOMINATIM_TIMEOUT_MS,
      });

      const feature = res.data?.features?.[0];
      if (feature?.geometry?.coordinates?.length >= 2) {
        const props = feature.properties || {};
        const displayName = [
          props.name,
          props.street,
          props.locality,
          props.district,
          props.city,
          props.county,
          props.country,
        ].filter(Boolean).join(', ');
        const result = {
          lat: parseFloat(feature.geometry.coordinates[1]),
          lng: parseFloat(feature.geometry.coordinates[0]),
          displayName,
          addresstype: String(props.type || props.osm_value || ''),
          type: String(props.type || props.osm_value || ''),
          category: String(props.osm_key || ''),
          street: String(props.street || props.name || ''),
        };
        queryCache.set(cacheKey, result);
        return result;
      }

      queryCache.set(cacheKey, null);
      return null;
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isTransientError(err)) {
        console.warn(`Photon geocode failed for "${query}": ${err.message}`);
        queryCache.set(cacheKey, null);
        return null;
      }

      const backoff = markProviderBackoff('photon', err, attempt) || (RETRY_BASE_DELAY_MS * (2 ** attempt));
      await sleep(backoff);
    }
  }

  queryCache.set(cacheKey, null);
  return null;
}

function isCoarseResult(result) {
  const coarse = new Set([
    'postcode',
    'city',
    'town',
    'village',
    'hamlet',
    'county',
    'state',
    'region',
    'country',
    'administrative',
    'suburb',
    'neighbourhood',
    'quarter',
  ]);
  const value = String(result.addresstype || result.type || '').toLowerCase();
  return coarse.has(value);
}

async function geocode(address) {
  if (!address) return null;

  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) return null;
  const key = normalizedAddress.toLowerCase();

  if (geocodeCache.has(key)) return geocodeCache.get(key);
  if (geocodeInFlight.has(key)) return geocodeInFlight.get(key);

  const inFlight = (async () => {
    const queries = buildQueries(normalizedAddress);
    const streetHint = hasStreetHint(normalizedAddress);
    const streetToken = pickStreetToken(normalizedAddress);

    for (let i = 0; i < queries.length; i += 1) {
      const q = queries[i];
      let result = await queryNominatim(q.query);
      if (!result) {
        result = await queryPhoton(q.query);
      }
      if (result) {
        const display = result.displayName.toLowerCase();
        const street = String(result.street || '').toLowerCase();

        // Do not accept broad postcode-area matches for specific street-like inputs.
        if (streetHint && (q.kind === 'postcode' || q.kind === 'outward')) {
          continue;
        }
        if (streetHint && isCoarseResult(result)) {
          continue;
        }
        if (streetHint && streetToken && q.kind !== 'primary' && !display.includes(streetToken) && !street.includes(streetToken)) {
          continue;
        }

        const coords = { lat: result.lat, lng: result.lng };
        geocodeCache.set(key, coords);
        return coords;
      }
      if (i < queries.length - 1) {
        await sleep(FALLBACK_QUERY_DELAY_MS);
      }
    }

    // Cache misses too so repeated bad addresses don't re-trigger fallback chains.
    geocodeCache.set(key, null);
    return null;
  })();

  geocodeInFlight.set(key, inFlight);
  try {
    return await inFlight;
  } finally {
    geocodeInFlight.delete(key);
  }
}

function distanceToSchool(lat, lng) {
  return haversine(lat, lng, config.school.lat, config.school.lng);
}

function distanceToTownCentre(lat, lng) {
  return haversine(lat, lng, config.townCentre.lat, config.townCentre.lng);
}

function meetsLocationCriteria(lat, lng) {
  const dSchool = distanceToSchool(lat, lng);
  const dCentre = distanceToTownCentre(lat, lng);
  return dSchool <= config.school.maxWalkingMiles || dCentre <= config.townCentre.radiusMiles;
}

// Resolve school coordinates from Nominatim at startup (improves accuracy)
async function resolveSchoolCoords() {
  const result = await geocode(config.school.address);
  if (result) {
    config.school.lat = result.lat;
    config.school.lng = result.lng;
    console.log(`📍 School coords resolved: ${result.lat}, ${result.lng}`);
  }
}

module.exports = {
  geocode,
  distanceToSchool,
  distanceToTownCentre,
  meetsLocationCriteria,
  resolveSchoolCoords,
  parseRetryAfterMs,
  stripOutwardOnlyPostcodeSegments,
  simplifyAddressForFallbacks,
};
