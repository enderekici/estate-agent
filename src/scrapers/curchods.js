const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');

const SOURCE = 'curchods';
const BASE_URL = 'https://curchods.com/houses-for-sale-in/Farnham/paged/1/?attr=1&min=0&max=650000&bmin=3&bmax=0&sortby=HL&added=anytime';

async function scrape() {
  const page = await newPage();
  const listings = [];
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
          const img     = card.querySelector('img');

          return {
            url,
            // town only (no street address available on listing cards)
            address:  townEl ? townEl.textContent.trim() + ', Surrey' : null,
            price:    priceEl?.textContent?.trim() || null,
            bedrooms: roomsEl?.textContent?.trim() || null,
            thumbnail: img?.src || null,
          };
        }).filter(Boolean);
      });

      if (!raw.length) { hasMore = false; break; }

      raw.forEach(r => listings.push(normalise({
        ...r,
        price:    parsePrice(r.price),
        bedrooms: parseBeds(r.bedrooms || ''),
        prop_type: 'House',
      }, SOURCE)));

      // Check for next page link
      const hasNext = await page.$('a[href*="/paged/"]:has-text("Next"), [class*="next"] a, a[rel="next"]').catch(() => null);
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
