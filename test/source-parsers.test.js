const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCardTitle, normalizeDeveloperAddress } = require('../src/scrapers/onthemarket');
const { parseChartersEntry, extractAddressFromAlt } = require('../src/scrapers/charters');
const { extractAddressFromAlt: extractRomansAddressFromAlt } = require('../src/scrapers/romans');
const { parseBedsFromInfoIcons } = require('../src/scrapers/keatsfearn');
const { normalizeZooplaAddress } = require('../src/scrapers/zoopla');
const { isFarnhamArea } = require('../src/scrapers/savills');
const { inferPropertyType } = require('../src/scrapers/_localBase');

test('OnTheMarket card title parsing avoids postcode and nearby-school digit collisions', () => {
  assert.deepEqual(
    parseCardTitle('View the details for Sandy Lane, Rushmoor, Farnham, Surrey, GU10 - 4 bedroom detached house for sale'),
    {
      address: 'Sandy Lane, Rushmoor, Farnham, Surrey, GU10',
      bedrooms: 4,
      propType: 'detached house',
    }
  );

  assert.deepEqual(
    parseCardTitle('View the details for Farnborough Road, Farnham, GU9 - 3 bedroom bungalow for sale'),
    {
      address: 'Farnborough Road, Farnham, GU9',
      bedrooms: 3,
      propType: 'bungalow',
    }
  );
});

test('OnTheMarket developer addresses are simplified into geocodable locality-first strings', () => {
  assert.equal(
    normalizeDeveloperAddress('Plot 166, Maiden Court - Type 11 at Brightwells Yard, Maiden Court GU9'),
    'Brightwells Yard, Maiden Court GU9, Farnham, Surrey'
  );
  assert.equal(
    normalizeDeveloperAddress('Plot 51, Beauwood at Deer Park, Hale Road GU9'),
    'Deer Park, Hale Road GU9, Farnham, Surrey'
  );
});

test('Charters address extraction prefers image alt text to preserve full postcodes', () => {
  assert.equal(
    extractAddressFromAlt('Birchwood, West Street, Farnham, Surrey, GU9 - Charters'),
    'Birchwood, West Street, Farnham, Surrey, GU9'
  );

  const parsed = parseChartersEntry({
    href: 'https://chartersestateagents.co.uk/property-for-sale/3-bedroom-terraced-house-for-sale-in-east-street-farnham-surrey-gu9-69773b2f7111b300d0dc1c6b/',
    text: '£925,000Asking priceEast Street, Farnham, Surrey, GU93 bedroom terraced house for saleTerraced House31',
    imgSrc: 'https://ggfx-charters.s3.eu-west-2.amazonaws.com/x/property/FAR260033/images/loc/live/pictures/FAR/26/570x374/FAR260033_34.webp',
    imgAlt: 'East Street, Farnham, Surrey, GU9 - Charters',
  });

  assert.equal(parsed.price, 925000);
  assert.equal(parsed.bedrooms, 3);
  assert.equal(parsed.address, 'East Street, Farnham, Surrey, GU9');
  assert.equal(parsed.prop_type, 'terraced house');
});

test('Romans address extraction reads the exact address from image alt text', () => {
  assert.equal(
    extractRomansAddressFromAlt('3 bedroom house for sale - Hillside Road, Farnham, Surrey, GU9 - Property View 1'),
    'Hillside Road, Farnham, Surrey, GU9'
  );
  assert.equal(
    extractRomansAddressFromAlt('land/development plot for sale - Wrecclesham Hill, Wrecclesham, Farnham, Surrey, GU10 - Property View 1'),
    'Wrecclesham Hill, Wrecclesham, Farnham, Surrey, GU10'
  );
});

test('Zoopla addresses separate outward postcode suffixes for better downstream geocoding', () => {
  assert.equal(
    normalizeZooplaAddress('Bartlett Avenue, Badshot Lea, Farnham, Surrey GU9'),
    'Bartlett Avenue, Badshot Lea, Farnham, Surrey, GU9'
  );
  assert.equal(
    normalizeZooplaAddress('Weywood Lane, Farnham GU9'),
    'Weywood Lane, Farnham, GU9'
  );
});

test('Keats Fearn bedroom extraction prefers the first info-icon count from the listing page', () => {
  assert.equal(parseBedsFromInfoIcons(['4', '3', '2']), 4);
  assert.equal(parseBedsFromInfoIcons('5'), 5);
  assert.equal(parseBedsFromInfoIcons([]), null);
});

test('Savills Farnham area filter rejects Bordon rows and keeps Farnham rows', () => {
  assert.equal(isFarnhamArea('Stonehill Road, Headley Down, Bordon, Hampshire, GU35 8ET'), false);
  assert.equal(isFarnhamArea('Menin Way, Farnham, Surrey, GU9'), true);
});

test('property type inference identifies common residential types from free text', () => {
  assert.equal(inferPropertyType('3 bedroom detached house for sale'), 'Detached House');
  assert.equal(inferPropertyType('4 bed maisonette with garden'), 'Maisonette');
  assert.equal(inferPropertyType('3 Bed House - detached'), 'Detached');
  assert.equal(inferPropertyType('A spacious bungalow close to town'), 'Bungalow');
});
