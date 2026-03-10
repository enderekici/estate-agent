const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildChartersUrl } = require('./search-url-builders');

const SOURCE = 'charters';
const URL = buildChartersUrl();

// Each property has TWO a[href*="/property-for-sale/"] elements with the same href:
//   1) image link: has <img>, empty text
//   2) text link: has price + address + beds in textContent, no img
// We merge both by href to capture image + data.

function extractAddressFromAlt(altText) {
  const input = String(altText || '').trim();
  if (!input) return null;
  return input.replace(/\s*-\s*Charters\s*$/i, '').trim() || null;
}

function parseChartersEntry({ href, text, imgSrc, imgAlt }) {
  // Beds + type from URL slug: /N-bedroom-TYPE-for-sale-in-ADDRESS-HASH/
  const slugBeds = href.match(/\/(\d+)-bedroom/);
  const slugType = href.match(/\/\d+-bedroom-([^/]+?)-for-sale/);
  const bedrooms = slugBeds ? parseInt(slugBeds[1]) : parseBeds(text);
  const prop_type = slugType ? slugType[1].replace(/-/g, ' ') : null;

  // Price from text: "£599,000Asking price..."
  const priceMatch = text.match(/£([\d,]+)/);
  const price = priceMatch ? parsePrice(priceMatch[0]) : null;

  // Address: text after price qualifier, before "N bedroom"
  // Format: "£NNN,NNNAsking price|Guide price|etc.ADDRESS N bedroom..."
  const afterPrice = text
    .replace(/£[\d,]+\s*/g, '')
    .replace(/\s*(Asking price|Offers in excess of|Guide price|Fixed price|Offers over|From)\s*/gi, '')
    .trim();
  const addrMatch = afterPrice.match(/^(.*?)\s*\d+\s*bedroom/i);
  const address = extractAddressFromAlt(imgAlt) || (addrMatch ? addrMatch[1].trim() : null);

  return { price, bedrooms, prop_type, address, thumbnail: imgSrc };
}

async function scrape() {
  const page = await newPage();
  const listings = [];
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    try {
      await page.waitForSelector('a[href*="/property-for-sale/"]', { timeout: 15000 });
    } catch (_) {}

    const raw = await page.evaluate(() => {
      // Merge image link + text link by href
      const map = {};
      Array.from(document.querySelectorAll('a[href*="/property-for-sale/"]')).forEach(a => {
        const href = a.href;
        if (!href || !href.includes('chartersestateagents')) return;
        if (!map[href]) map[href] = { href, imgSrc: null, imgAlt: '', text: '' };
        const img = a.querySelector('img');
        if (!map[href].imgSrc) {
          const source = a.querySelector('picture source[srcset]');
          if (source) {
            const first = (source.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
            if (first && !first.includes('.svg')) map[href].imgSrc = first;
          }
          if (!map[href].imgSrc && img) {
            map[href].imgSrc = img.currentSrc || img.src || img.getAttribute('data-src') || null;
          }
          if (img) map[href].imgAlt = img.alt || '';
        }
        const text = a.textContent.trim();
        if (text.length > map[href].text.length) map[href].text = text;
      });
      return Object.values(map);
    });

    raw.forEach(entry => {
      if (!entry.text && !entry.imgSrc) return; // skip nav links
      const parsed = parseChartersEntry(entry);
      listings.push(normalise({
        url:       entry.href,
        price:     parsed.price,
        address:   parsed.address,
        bedrooms:  parsed.bedrooms,
        prop_type: parsed.prop_type,
        thumbnail: parsed.thumbnail,
      }, SOURCE));
    });
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE, parseChartersEntry, extractAddressFromAlt };
