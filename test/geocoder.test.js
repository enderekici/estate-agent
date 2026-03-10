const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRetryAfterMs, stripOutwardOnlyPostcodeSegments, simplifyAddressForFallbacks } = require('../src/geocoder');

test('parseRetryAfterMs supports seconds and HTTP dates', () => {
  assert.equal(parseRetryAfterMs('15'), 15000);

  const future = new Date(Date.now() + 10000).toUTCString();
  const parsed = parseRetryAfterMs(future);
  assert.equal(typeof parsed, 'number');
  assert.ok(parsed >= 0);
  assert.ok(parsed <= 10000);
});

test('stripOutwardOnlyPostcodeSegments removes trailing outward-only postcode segments', () => {
  assert.equal(
    stripOutwardOnlyPostcodeSegments('Ryle Road, Farnham, Surrey, GU9'),
    'Ryle Road, Farnham, Surrey'
  );
  assert.equal(
    stripOutwardOnlyPostcodeSegments('Little Green Lane, Farnham, GU9'),
    'Little Green Lane, Farnham'
  );
});

test('stripOutwardOnlyPostcodeSegments preserves full postcodes', () => {
  assert.equal(
    stripOutwardOnlyPostcodeSegments('East Street, Farnham, Surrey, GU9 7UA'),
    'East Street, Farnham, Surrey, GU9 7UA'
  );
});

test('stripOutwardOnlyPostcodeSegments removes outward code suffixes attached to segments', () => {
  assert.equal(
    stripOutwardOnlyPostcodeSegments('St. James Avenue, Farnham, Surrey GU9'),
    'St. James Avenue, Farnham, Surrey'
  );
  assert.equal(
    stripOutwardOnlyPostcodeSegments('Hops Drive, Badshot Lea, Farnham, Surrey GU9'),
    'Hops Drive, Badshot Lea, Farnham, Surrey'
  );
});

test('simplifyAddressForFallbacks removes plot and marketing noise', () => {
  assert.equal(
    simplifyAddressForFallbacks('Plot 166, Maiden Court - Type 11 at Brightwells Yard, Maiden Court GU9'),
    'Brightwells Yard, Maiden Court'
  );
  assert.equal(
    simplifyAddressForFallbacks('Beech Court, Farnham, United Kingdom, GU10'),
    'Beech Court, Farnham'
  );
  assert.equal(
    simplifyAddressForFallbacks('Plot 51, Beauwood at Deer Park, Hale Road GU9'),
    'Deer Park, Hale Road'
  );
});
