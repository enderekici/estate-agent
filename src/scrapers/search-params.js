const config = require('../../config');

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const text = String(value || '').trim();
    if (!text) return false;
    const key = text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getSearchParams() {
  const search = config.search || {};
  const location = String(search.location || '').trim();
  const county = String(search.county || '').trim();
  const locationSlug = String(search.locationSlug || slugify(location)).trim();
  const postcodeDistrict = String(search.postcodeDistrict || '').trim().toUpperCase();
  const postcodeDistricts = uniqueStrings(
    Array.isArray(search.postcodeDistricts)
      ? search.postcodeDistricts.map((code) => String(code || '').trim().toUpperCase())
      : [postcodeDistrict]
  );
  const locationParts = uniqueStrings([location, county]);

  return {
    location,
    county,
    locationSlug,
    postcodeDistrict,
    postcodeDistricts,
    locationParts,
    locationQuery: locationParts.join(', '),
    minBedrooms: Number.isFinite(search.minBedrooms) ? search.minBedrooms : null,
    maxPrice: Number.isFinite(search.maxPrice) ? search.maxPrice : null,
  };
}

module.exports = {
  getSearchParams,
  slugify,
};
