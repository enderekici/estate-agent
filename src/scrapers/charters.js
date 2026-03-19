const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildChartersUrl } = require('./search-url-builders');

const SOURCE = 'charters';
const URL = buildChartersUrl();
const MAX_PAGES = 10;
const RESULT_SELECTOR = 'a[href*="/property-for-sale/"]';
const COOKIE_SELECTOR = '#onetrust-accept-btn-handler, button#onetrust-accept-btn-handler, button:has-text("Accept"), [data-testid="dialog-accept-all"]';

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

async function dismissCookieBanner(page) {
  try {
    const btn = await page.$(COOKIE_SELECTOR);
    if (btn) {
      await btn.click();
      await page.waitForTimeout(1200);
    }
  } catch (_) {}
}

async function waitForHydratedListings(page) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await dismissCookieBanner(page);
    try {
      await page.waitForSelector(RESULT_SELECTOR, { timeout: 4000 });
    } catch (_) {}

    const resultCount = await page.evaluate((selector) => {
      return document.querySelectorAll(selector).length;
    }, RESULT_SELECTOR).catch(() => 0);

    if (resultCount > 0) return resultCount;
    await page.waitForTimeout(1000);
  }
  return 0;
}

async function scrape() {
  const page = await newPage();
  const listings = [];
  const seenUrls = new Set();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await waitForHydratedListings(page);

    let pageNum = 1;
    while (pageNum <= MAX_PAGES) {
      await dismissCookieBanner(page);
      if (!await waitForHydratedListings(page) && pageNum === 1) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 35000 });
        await waitForHydratedListings(page);
      }

      const pageData = await page.evaluate(() => {
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

        const nextEl = document.querySelector('a[rel="next"], a[aria-label*="next" i], .pagination a[rel="next"], a[href*="page/"][aria-label*="next" i]');
        const nextHref = nextEl?.href || null;

        return { results: Object.values(map), nextHref };
      });

      let newOnPage = 0;
      for (const entry of pageData.results) {
        if (!entry.text && !entry.imgSrc) continue; // skip nav links
        if (seenUrls.has(entry.href)) continue;
        seenUrls.add(entry.href);
        const parsed = parseChartersEntry(entry);
        listings.push(normalise({
          url:       entry.href,
          price:     parsed.price,
          address:   parsed.address,
          bedrooms:  parsed.bedrooms,
          prop_type: parsed.prop_type,
          thumbnail: parsed.thumbnail,
        }, SOURCE));
        newOnPage++;
      }

      if (newOnPage === 0 || !pageData.nextHref) break;

      // Navigate to next page
      try {
        pageNum++;
        await randomDelay();
        await page.goto(pageData.nextHref, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await waitForHydratedListings(page);
      } catch (navErr) {
        console.warn(`[${SOURCE}] Pagination error on page ${pageNum}:`, navErr.message);
        break;
      }
    }
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE, parseChartersEntry, extractAddressFromAlt };
