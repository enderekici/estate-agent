/**
 * Shared helper for local estate agent scrapers.
 * Each scraper exports { scrape, SOURCE }.
 */
const crypto = require('crypto');

const TRACKING_PARAM_RE = /^(utm_|fbclid$|gclid$|dclid$|msclkid$|mc_eid$|mc_cid$|_ga$|_gl$|yclid$|igshid$)/i;
const ID_PARAM_RE = /^(id|pid|property|propertyid|listing|listingid|ref|reference|propertyref)$/i;
const BED_WORDS = {
  studio: 0,
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const PROPERTY_TYPE_PATTERNS = [
  { re: /\bdetached bungalow\b/i, value: 'Detached Bungalow' },
  { re: /\bsemi[-\s]?detached bungalow\b/i, value: 'Semi-Detached Bungalow' },
  { re: /\bend[-\s]?of[-\s]?terrace\b/i, value: 'End of Terrace' },
  { re: /\bsemi[-\s]?detached house\b/i, value: 'Semi-Detached House' },
  { re: /\bdetached house\b/i, value: 'Detached House' },
  { re: /\bterraced house\b/i, value: 'Terraced House' },
  { re: /\btown ?house\b/i, value: 'Townhouse' },
  { re: /\bmaisonette\b/i, value: 'Maisonette' },
  { re: /\bapartment\b/i, value: 'Apartment' },
  { re: /\bflat\b/i, value: 'Flat' },
  { re: /\bbungalow\b/i, value: 'Bungalow' },
  { re: /\bcottage\b/i, value: 'Cottage' },
  { re: /\bmews\b/i, value: 'Mews' },
  { re: /\bchalet\b/i, value: 'Chalet' },
  { re: /\bland(?:\/development)? plot\b/i, value: 'Land Plot' },
  { re: /\bplot\b/i, value: 'Plot' },
  { re: /\bsemi[-\s]?detached\b/i, value: 'Semi-Detached' },
  { re: /\bdetached\b/i, value: 'Detached' },
  { re: /\bterraced\b/i, value: 'Terraced' },
  { re: /\bhouse\b/i, value: 'House' },
];

function canonicaliseUrl(url) {
  if (url === null || url === undefined) return '';
  const input = String(url).trim();
  if (!input) return '';

  const withProtocol = input.startsWith('//') ? `https:${input}` : input;
  let parsed;
  try {
    parsed = new URL(withProtocol, 'https://placeholder.invalid');
  } catch (_) {
    return withProtocol
      .replace(/#.*$/, '')
      .replace(/\?.*$/, '')
      .replace(/\/+$/, '');
  }

  const isRelative = parsed.origin === 'https://placeholder.invalid';
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = (parsed.pathname || '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '') || '/';

  const kept = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (TRACKING_PARAM_RE.test(key)) continue;
    if (ID_PARAM_RE.test(key)) kept.push([key.toLowerCase(), value]);
  }
  kept.sort(([a], [b]) => a.localeCompare(b));
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';
  const core = `${path}${query}`;

  if (isRelative) return core;
  return `https://${host}${core}`;
}

function makeId(url) {
  const canonical = canonicaliseUrl(url);
  return crypto.createHash('md5').update(canonical).digest('hex');
}

function parsePrice(text) {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text) : null;

  const input = String(text).replace(/\u00a0/g, ' ').trim();
  if (!input) return null;
  if (/\b(p\.?\s*o\.?\s*a\.?|poa|price on application|on application|tba)\b/i.test(input)) return null;

  const values = [];
  const amountRe = /(£|\bgbp\b)?\s*((?:\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.\d+)?)\s*([km])?(?![\d,])/gi;
  let m;
  while ((m = amountRe.exec(input))) {
    const hasCurrency = Boolean(m[1]);
    const hasSuffix = Boolean(m[3]);
    const compact = m[2].replace(/[,\s]/g, '');
    const asNumber = Number.parseFloat(compact);
    if (!Number.isFinite(asNumber)) continue;
    // Ignore small plain numbers without currency/suffix (often sqft/metadata).
    if (!hasCurrency && !hasSuffix && asNumber < 50000) continue;

    const suffix = (m[3] || '').toLowerCase();
    const multiplier = suffix === 'm' ? 1000000 : suffix === 'k' ? 1000 : 1;
    values.push(Math.round(asNumber * multiplier));
  }

  return values.length ? values[0] : null;
}

function parseBeds(text) {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text) : null;

  const input = String(text).replace(/\u00a0/g, ' ').trim();
  if (!input) return null;

  const range = input.match(/(\d+)\s*(?:\/|-|to)\s*(\d+)\s*(?:bed(?:room)?s?|br)\b/i);
  if (range) return Math.max(Number.parseInt(range[1], 10), Number.parseInt(range[2], 10));

  const numericPatterns = [
    /(\d+)\s*(?:\+)?\s*(?:bed(?:room)?s?|br)\b/i,
    /\b(?:bed(?:room)?s?|br)\s*[:\-]?\s*(\d+)\b/i,
  ];
  for (const re of numericPatterns) {
    const match = input.match(re);
    if (match) return Number.parseInt(match[1], 10);
  }

  const wordBeds = input.match(/\b(studio|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:bed(?:room)?s?|br)\b/i);
  if (wordBeds) return BED_WORDS[wordBeds[1].toLowerCase()];
  if (/\bstudio\b/i.test(input)) return 0;

  return null;
}

function inferPropertyType(...inputs) {
  const haystack = inputs
    .flat()
    .filter(Boolean)
    .map((value) => String(value))
    .join(' ');

  if (!haystack.trim()) return null;

  for (const pattern of PROPERTY_TYPE_PATTERNS) {
    if (pattern.re.test(haystack)) return pattern.value;
  }
  return null;
}

function cleanValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value;
}

function normalise(listing, source) {
  const url = cleanValue(canonicaliseUrl(listing.url));
  return {
    id:        url ? makeId(url) : null,
    source,
    url,
    address:   cleanValue(listing.address),
    price:     cleanValue(listing.price),
    bedrooms:  cleanValue(listing.bedrooms),
    prop_type: cleanValue(listing.prop_type),
    thumbnail: cleanValue(listing.thumbnail),
  };
}

module.exports = { canonicaliseUrl, makeId, parsePrice, parseBeds, inferPropertyType, normalise };
