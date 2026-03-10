const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds, inferPropertyType } = require('./_localBase');

const SOURCE = 'truemangrundy';
// WPPF (WordPress Property Feed Pro) theme — grid view
// Cards: article.wppf_property_item
// URL/Address: h4 a (bookmark link inside card)
// Price: h6 (e.g. "Price Guide £675,000")
// Bedrooms: h5 (e.g. "3 Bed  House - detached")
// Thumbnail: figure img
const URL = 'https://www.truemanandgrundy.co.uk/property/?department=residential-sales&minimum_bedrooms=3';

async function scrape() {
  const page = await newPage();
  const listings = [];
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
    await randomDelay();

    const raw = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('article.wppf_property_item'));
      return cards.map(c => {
        const linkEl  = c.querySelector('h4 a[href*="/property/"]');
        const href    = linkEl?.href;
        if (!href) return null;

        const addrEl  = linkEl; // h4 a text is the address
        const priceEl = c.querySelector('h6');
        const bedsEl  = c.querySelector('h5');
        const imgEl   = c.querySelector('figure img');

        return {
          url:       href,
          address:   addrEl?.textContent?.trim() || null,
          price:     priceEl?.textContent?.trim() || null,
          bedrooms:  bedsEl?.textContent?.trim()  || null,
          thumbnail: imgEl?.src || imgEl?.dataset?.src || null,
        };
      }).filter(r => r !== null);
    });

    raw.forEach(r => listings.push(normalise({
      ...r,
      price:    parsePrice(r.price),
      bedrooms: parseBeds(r.bedrooms || ''),
      prop_type: inferPropertyType(r.bedrooms, r.address, r.url),
    }, SOURCE)));
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE };
