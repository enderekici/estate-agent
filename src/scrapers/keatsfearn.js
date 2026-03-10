const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildKeatsfearnUrl } = require('./search-url-builders');

const SOURCE = 'keatsfearn';
// Use the full sales listings page (not the homepage slider)
const URL = buildKeatsfearnUrl();
const MAX_SCROLL_ATTEMPTS = 5;

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

function extractCards() {
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
}

async function scrape() {
  const page = await newPage();
  const listings = [];
  const seenUrls = new Set();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(4000); // React needs time

    // Accept cookies
    try {
      const btn = await page.$('[class*="accept"], button[id*="accept"]');
      if (btn) { await btn.click(); await page.waitForTimeout(1000); }
    } catch (_) {}

    // Initial extraction
    let prevCount = 0;
    for (let attempt = 0; attempt <= MAX_SCROLL_ATTEMPTS; attempt++) {
      const raw = await page.evaluate(extractCards);

      for (const r of raw) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        const basePrice = parsePrice(r.price);
        listings.push(normalise({
          ...r,
          price:    basePrice !== null && basePrice < 50000 ? null : basePrice,
          bedrooms: parseBedsFromInfoIcons(r.bedrooms) ?? parseBeds(`${r.bedrooms || ''} ${r.address || ''} ${r.cardText || ''}`) ?? bedsFromUrl(r.url),
        }, SOURCE));
      }

      // Stop if no new cards appeared
      if (listings.length === prevCount && attempt > 0) break;
      prevCount = listings.length;

      // Try to load more: click "load more" / "show more" button, or scroll to bottom
      try {
        const loadMoreBtn = await page.$('[class*="load-more"], [class*="show-more"], [aria-label*="more" i]');
        if (loadMoreBtn) {
          await loadMoreBtn.click();
          await page.waitForTimeout(2000);
        } else {
          // Scroll to bottom and wait for more cards
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(2000);
        }
      } catch (_) {}
    }
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE, parseBedsFromInfoIcons };
