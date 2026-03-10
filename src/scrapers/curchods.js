const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds, inferPropertyType } = require('./_localBase');
const { buildCurchodsUrl } = require('./search-url-builders');

const SOURCE = 'curchods';
const BASE_URL = buildCurchodsUrl();

async function scrape() {
  const page = await newPage();
  const listings = [];
  const seenUrls = new Set();
  try {
    let pageNum = 1;
    let hasMore = true;

    while (hasMore && pageNum <= 5) {
      const url = BASE_URL.replace('/paged/1/', `/paged/${pageNum}/`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Accept cookies on first page
      if (pageNum === 1) {
        try {
          const btn = await page.$('button:has-text("Accept All"), [class*="accept-all"]');
          if (btn) { await btn.click(); await page.waitForTimeout(2000); }
        } catch (_) {}
      }

      // Scroll to trigger any lazy loading
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);

      const raw = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.property-card'));
        const seen = new Set();
        return cards.map(card => {
          const linkEl = card.querySelector('a[href]');
          if (!linkEl) return null;
          const href = linkEl.getAttribute('href');
          const url = href.startsWith('http') ? href : 'https://curchods.com' + href;
          if (!href.includes('/display/') || seen.has(url)) return null;
          seen.add(url);

          const priceEl = card.querySelector('.property-card-price');
          const townEl  = card.querySelector('.property-card-town');
          const roomsEl = card.querySelector('.property-card-rooms');
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
            url,
            // town only (no street address available on listing cards)
            address:  townEl ? townEl.textContent.trim() + ', Surrey' : null,
            price:    priceEl?.textContent?.trim() || null,
            bedrooms: roomsEl?.textContent?.trim() || null,
            thumbnail: thumb,
          };
        }).filter(Boolean);
      });

      if (!raw.length) { hasMore = false; break; }

      raw.forEach(r => {
        const listing = normalise({
          ...r,
          price:    parsePrice(r.price),
          bedrooms: parseBeds(r.bedrooms || ''),
          prop_type: inferPropertyType(r.bedrooms, r.address),
        }, SOURCE);
        if (listing.id && !seenUrls.has(listing.id)) {
          seenUrls.add(listing.id);
          listings.push(listing);
        }
      });

      // Check for next page link
      const nextPageUrl = `/paged/${pageNum + 1}/`;
      const hasNext = await page.$(`a[href*="${nextPageUrl}"], a[href*="/paged/"]:not([href*="/paged/${pageNum}/"]), [class*="next"] a, a[rel="next"], a[href*="/paged/"][class*="next"], .pagination a:last-child`).catch(() => null);
      if (hasNext && raw.length > 0) { pageNum++; await randomDelay(); }
      else hasMore = false;
    }
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE };
