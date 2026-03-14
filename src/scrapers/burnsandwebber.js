const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds, inferPropertyType } = require('./_localBase');
const { buildBurnsAndWebberUrl } = require('./search-url-builders');

const SOURCE = 'burnsandwebber';
const BASE_URL = buildBurnsAndWebberUrl();
const MAX_PAGES = 5;

async function scrape() {
  const page = await newPage();
  const listings = [];
  const seenUrls = new Set();
  try {
    let pageNum = 1;
    let hasMore = true;

    while (hasMore && pageNum <= MAX_PAGES) {
      const url = BASE_URL.replace('currentpage=1', `currentpage=${pageNum}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Accept cookies on first page
      if (pageNum === 1) {
        try {
          const btn = await page.$('button:has-text("Accept All"), button:has-text("Accept"), [class*="accept"]');
          if (btn) { await btn.click(); await page.waitForTimeout(1000); }
        } catch (_) {}
      }

      // Scroll to trigger lazy loading
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);

      const raw = await page.evaluate(() => {
        // Burns & Webber uses .property cards with /display/[code] links (Reapit-powered)
        const cards = Array.from(document.querySelectorAll('.property, [class*="property-card"], [data-id]'));
        const seen = new Set();
        return cards.map(card => {
          const linkEl = card.querySelector('a[href*="/display/"]');
          if (!linkEl) return null;
          const href = linkEl.getAttribute('href');
          const url = href.startsWith('http') ? href : 'https://burnsandwebber.com' + href;
          if (!href.includes('/display/') || seen.has(url)) return null;
          seen.add(url);

          const priceEl = card.querySelector('[class*="price"]');
          const townEl = card.querySelector('[class*="town"], [class*="location"], [class*="address"]');
          const bedsEl = card.querySelector('[class*="bed"], [class*="rooms"]');

          const thumb = (() => {
            const source = card.querySelector('picture source[srcset]');
            if (source) {
              const first = (source.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
              if (first && !first.includes('.svg')) return first;
            }
            const img = card.querySelector('img');
            return img ? (img.currentSrc || img.src || img.getAttribute('data-src') || null) : null;
          })();

          // Get feature list items (beds, baths, receptions shown as list)
          const featureItems = Array.from(card.querySelectorAll('ul li, .features li'));
          const bedsText = featureItems.length > 0 ? featureItems[0]?.textContent?.trim() : null;

          return {
            url,
            address:   townEl?.textContent?.trim() || null,
            price:     priceEl?.textContent?.trim() || null,
            bedrooms:  bedsEl?.textContent?.trim() || bedsText || null,
            cardText:  card?.textContent?.replace(/\s+/g, ' ').trim() || null,
            thumbnail: thumb,
          };
        }).filter(Boolean);
      });

      if (!raw.length) { hasMore = false; break; }

      let newOnPage = 0;
      for (const r of raw) {
        const listing = normalise({
          ...r,
          price:     parsePrice(r.price),
          bedrooms:  parseBeds(`${r.bedrooms || ''} ${r.cardText || ''}`),
          prop_type: inferPropertyType(r.cardText, r.address),
        }, SOURCE);
        if (listing.id && !seenUrls.has(listing.id)) {
          seenUrls.add(listing.id);
          listings.push(listing);
          newOnPage++;
        }
      }

      if (newOnPage === 0) { hasMore = false; break; }
      pageNum++;
      await randomDelay();
    }
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE };
