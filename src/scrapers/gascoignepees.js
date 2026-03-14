const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds, inferPropertyType } = require('./_localBase');
const { buildGascoignePeesUrl } = require('./search-url-builders');

const SOURCE = 'gascoignepees';
const URL = buildGascoignePeesUrl();
const MAX_PAGES = 10;

async function scrape() {
  const page = await newPage();
  const listings = [];
  const seenUrls = new Set();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await randomDelay();

    // Accept cookies if shown
    try {
      const btn = await page.$('button:has-text("Accept"), [class*="accept"], #onetrust-accept-btn-handler');
      if (btn) { await btn.click(); await page.waitForTimeout(1000); }
    } catch (_) {}

    // Wait for property cards to render
    try {
      await page.waitForSelector('[class*="property"], [class*="listing"], article', { timeout: 10000 });
    } catch (_) {}

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    let pageNum = 1;
    while (pageNum <= MAX_PAGES) {
      const pageData = await page.evaluate(() => {
        // Gascoigne Pees uses property cards with links to /properties/[id]/sales/[ref]
        const links = Array.from(document.querySelectorAll('a[href*="/properties/"][href*="/sales/"]'));
        const seen = new Set();
        const results = links.map(a => {
          const href = a.href;
          if (!href || seen.has(href) || !href.includes('/sales/')) return null;
          seen.add(href);

          const card = a.closest('[class*="property"], [class*="listing"], article, li') || a.parentElement;
          if (!card) return null;

          const priceEl = card.querySelector('[class*="price"]');
          const addressEl = card.querySelector('[class*="address"], [class*="location"], h2, h3');
          const bedsEl = card.querySelector('[class*="bed"]');

          return {
            url:       href,
            address:   addressEl?.textContent?.trim() || null,
            price:     priceEl?.textContent?.trim() || null,
            bedrooms:  bedsEl?.textContent?.trim() || null,
            cardText:  card?.textContent?.replace(/\s+/g, ' ').trim() || null,
            thumbnail: (() => {
              const source = card.querySelector('picture source[srcset]');
              if (source) {
                const first = (source.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
                if (first && !first.includes('.svg')) return first;
              }
              const img = card.querySelector('img');
              return img ? (img.currentSrc || img.src || img.getAttribute('data-src') || null) : null;
            })(),
          };
        }).filter(Boolean);

        // Look for pagination / next page link
        const nextEl = document.querySelector('a[rel="next"], a[class*="next"], [class*="pagination"] a:last-child, a[aria-label="Next"]');
        const nextHref = nextEl?.href || null;

        return { results, nextHref };
      });

      let newOnPage = 0;
      for (const r of pageData.results) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        listings.push(normalise({
          ...r,
          price:     parsePrice(r.price),
          bedrooms:  parseBeds(`${r.bedrooms || ''} ${r.cardText || ''}`),
          prop_type: inferPropertyType(r.cardText, r.address, r.url),
        }, SOURCE));
        newOnPage++;
      }

      if (newOnPage === 0 || !pageData.nextHref) break;

      try {
        pageNum++;
        await randomDelay();
        await page.goto(pageData.nextHref, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForTimeout(2000);
        try {
          await page.waitForSelector('a[href*="/properties/"][href*="/sales/"]', { timeout: 10000 });
        } catch (_) {}
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
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

module.exports = { scrape, SOURCE };
