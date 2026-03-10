const test = require('node:test');
const assert = require('node:assert/strict');

const { parsePrice } = require('../src/scrapers/_localBase');

test('parsePrice keeps full comma-separated amounts when qualifier text is glued on', () => {
  assert.equal(parsePrice('£650,000Guide PriceHome Office'), 650000);
  assert.equal(parsePrice('£750,000Guide Price'), 750000);
  assert.equal(parsePrice('FEATURED PROPERTY - CLOSE TO SCHOOLS£575,000'), 575000);
});

test('parsePrice still handles plain values and suffixes', () => {
  assert.equal(parsePrice('£950,000'), 950000);
  assert.equal(parsePrice('Offers over £1.2m'), 1200000);
  assert.equal(parsePrice('Guide price 950k'), 950000);
});
