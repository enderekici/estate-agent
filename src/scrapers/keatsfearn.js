const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildKeatsfearnUrl } = require('./search-url-builders');

const SOURCE = 'keatsfearn';
// Use the full sales listings page (not the homepage slider)
const URL = buildKeatsfearnUrl();

function bedsFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/(?:^|\/)(\d+)-bed(?:room)?(?:-|\/)/i);
  return m ? Number.parseInt(m[1], 10) : null;
}

function parseBedsFromInfoIcons(values) {
  const first = Array.isArray(values) ? values[0] : values;
  const match = String(first || '').match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

async function scrape() {
  const page = await newPage();
  const listings = [];
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 35000 });
    await page.waitForTimeout(4000); // React needs time

    // Accept cookies
    try {
      const btn = await page.$('[class*="accept"], button[id*="accept"]');
      if (btn) { await btn.click(); await page.waitForTimeout(1000); }
    } catch (_) {}

    const raw = await page.evaluate(() => {
      // Keats Fearn cards: div.swiper-card with class "service swell-108"
      const cards = Array.from(document.querySelectorAll('.swiper-card, [class*="property-card"], [class*="listing-card"]'));
      const seen = new Set();
      return cards.map(c => {
        // Link to full detail
        const linkEl = c.querySelector('a[href*="/properties/"]') || c.querySelector('a[href]');
        const href   = linkEl?.href;
        if (!href || seen.has(href)) return null;
        seen.add(href);

        // Price is the "primary title" on Keats Fearn cards
        const priceEl = c.querySelector('p.price, [class*="primary-title"], [class*="price"]');
        // Address/description is a secondary element
        const addrEl  = c.querySelector('[class*="secondary"], [class*="address"], [class*="subtitle"], h3, p:not([class*="price"]):not([class*="primary"])');
        const thumb = (() => {
          const source = c.querySelector('picture source[srcset]');
          if (source) {
            const first = (source.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
            if (first && !first.includes('.svg')) return first;
          }
          const img = c.querySelector('img');
          return img ? (img.currentSrc || img.src || img.getAttribute('data-src') || null) : null;
        })();
        const infoIconValues = Array.from(c.querySelectorAll('.info-icons .d-inline-block'))
          .map((el) => el.textContent?.trim() || '')
          .filter(Boolean);

        return {
          url:       href,
          price:     priceEl?.textContent?.trim(),
          address:   addrEl?.textContent?.trim(),
          bedrooms:  infoIconValues[0] || null,
          cardText:  c.textContent?.replace(/\s+/g, ' ').trim() || null,
          thumbnail: thumb,
        };
      }).filter(Boolean);
    });

    raw.forEach(r => {
      const basePrice = parsePrice(r.price);
      listings.push(normalise({
        ...r,
        price:    basePrice !== null && basePrice < 50000 ? null : basePrice,
        bedrooms: parseBedsFromInfoIcons(r.bedrooms) ?? parseBeds(`${r.bedrooms || ''} ${r.address || ''} ${r.cardText || ''}`) ?? bedsFromUrl(r.url),
      }, SOURCE));
    });
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE, parseBedsFromInfoIcons };
