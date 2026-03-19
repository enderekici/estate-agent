const test = require('node:test');
const assert = require('node:assert/strict');

const { getSearchParams, slugify } = require('../src/scrapers/search-params');
const {
  buildAndrewLodgeUrl,
  buildBourneUrl,
  buildBridgesUrl,
  buildBurnsAndWebberUrl,
  buildChartersUrl,
  buildGascoignePeesUrl,
  buildGreenwoodUrl,
  buildHamptonsUrl,
  buildOnTheMarketUrl,
  buildRomansUrl,
  buildWprUrl,
  buildZooplaUrl,
  buildZooplaUrls,
} = require('../src/scrapers/search-url-builders');

test('search params expose the configured location profile', () => {
  const search = getSearchParams();
  assert.equal(search.location, 'Farnham');
  assert.equal(search.county, 'Surrey');
  assert.equal(search.locationSlug, 'farnham');
  assert.deepEqual(search.postcodeDistricts, ['GU9', 'GU10']);
  assert.equal(search.minBedrooms, 3);
  assert.equal(typeof search.maxPrice === 'number' || search.maxPrice === null, true);
  assert.equal(search.locationQuery, 'Farnham, Surrey');
});

test('slugify normalizes location text for path-based search urls', () => {
  assert.equal(slugify('Badshot Lea'), 'badshot-lea');
  assert.equal(slugify('  Farnham, Surrey '), 'farnham-surrey');
});

test('search url builders derive current scraper entry urls from shared params', () => {
  assert.ok(buildOnTheMarketUrl().includes('/property/farnham/'));
  assert.ok(buildZooplaUrl().includes('/property/gu9/'));
  assert.deepEqual(buildZooplaUrls(), [
    'https://www.zoopla.co.uk/for-sale/property/gu9/?beds_min=3&price_max=700000',
    'https://www.zoopla.co.uk/for-sale/property/gu10/?beds_min=3&price_max=700000',
  ]);
  assert.ok(buildRomansUrl().includes('/in-farnham/'));
  assert.equal(buildChartersUrl(), 'https://www.chartersestateagents.co.uk/property/for-sale/in-farnham/?min_beds=3&max_price=700000');
  assert.ok(buildBridgesUrl().includes('destination=farnham'));
  assert.ok(buildWprUrl().includes('address_keyword=Farnham'));
  assert.ok(buildBourneUrl().includes('address_keyword=farnham'));
  assert.ok(buildGreenwoodUrl().includes('q=farnham'));
  assert.ok(buildAndrewLodgeUrl().includes('property-for-sale-in-farnham'));
  assert.ok(buildHamptonsUrl().includes('/text-farnham/from-3-bed'));
  assert.ok(buildGascoignePeesUrl().includes('/buy/search/farnham-surrey/'));
  assert.ok(buildBurnsAndWebberUrl().includes('/properties-for-sale-in/farnham/'));
});
