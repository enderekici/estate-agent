const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildSavillsUrl } = require('./search-url-builders');

const SOURCE = 'savills';
// Use search.savills.com which renders results correctly
// Id_40145 = Farnham, Category_TownVillageCity; GRS_B_3 = 3+ bedrooms; GRS_T_B = buy
const URL = buildSavillsUrl();

function isFarnhamArea(address) {
  const text = String(address || '').toUpperCase();
  return text.includes('FARNHAM') || text.includes('GU9') || text.includes('GU10');
}

async function scrape() {
  const page = await newPage();
  const listings = [];
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 35000 });
    await page.waitForTimeout(3000);

    // Accept cookies if shown
    try {
      const btn = await page.$('button[class*="accept"], #onetrust-accept-btn-handler, [class*="CookieAccept"]');
      if (btn) { await btn.click(); await page.waitForTimeout(1500); }
    } catch (_) {}

    const raw = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('article.sv-property-card'));
      const seen = new Set();
      return cards.map(card => {
        const linkEl = card.querySelector('a.sv-details__link, a[href*="/property-detail/"]');
        const href = linkEl?.href;
        if (!href || seen.has(href)) return null;
        seen.add(href);

        const headlineEl = card.querySelector('.sv-details__address1, .sv-details__title, h3, h2');
        const addr2 = card.querySelector('p.sv-details__address2');
        const headline = headlineEl?.textContent?.replace(/\s+/g, ' ').trim().replace(/…+$/g, '') || '';
        const locality = addr2?.textContent?.replace(/\s+/g, ' ').trim() || '';
        const address = [headline, locality]
          .filter(Boolean)
          .join(', ')
          .replace(/\s+,/g, ',')
          .replace(/,+/g, ',')
          .trim();

        // Price: span after sv-property-price__guide
        const priceGuide = card.querySelector('.sv-property-price__guide');
        const priceEl = priceGuide?.nextElementSibling || card.querySelector('[class*="price"]');

        // Beds from [class*="bed"]
        const bedsEl = card.querySelector('[class*="bed"], [class*="Bed"]');
        // Try picture > source srcset first, then img with various src attrs
        const thumb = (() => {
          const source = card.querySelector('picture source[srcset]');
          if (source) {
            const first = (source.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
            if (first && !first.includes('.svg')) return first;
          }
          const img = card.querySelector('img');
          return img ? (img.currentSrc || img.src || img.getAttribute('data-src') || null) : null;
        })();

        return {
          url:       href,
          address:   address || null,
          price:     priceEl?.textContent?.trim() || null,
          bedrooms:  bedsEl?.textContent?.trim() || null,
          thumbnail: thumb,
        };
      }).filter(Boolean);
    });

    raw
      .map(r => normalise({
        ...r,
        price: parsePrice(r.price),
        bedrooms: parseBeds((r.bedrooms || '') + ' ' + (r.address || '')),
      }, SOURCE))
      .filter((listing) => isFarnhamArea(listing.address))
      .forEach((listing) => listings.push(listing));
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE, isFarnhamArea };
