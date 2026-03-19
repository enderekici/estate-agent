const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds, inferPropertyType } = require('./_localBase');
const { buildGascoignePeesUrl } = require('./search-url-builders');

const SOURCE = 'gascoignepees';
const BASE_URL = buildGascoignePeesUrl();
const MAX_PAGES = 10;

async function scrollForLazyLoad(page) {
  await page.evaluate(() => {
    const target = document.scrollingElement || document.documentElement || document.body;
    if (!target) return;
    window.scrollTo(0, target.scrollHeight || 0);
  });
}

async function scrape() {
  const page = await newPage();
  const listings = [];
  const seenUrls = new Set();
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });
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

    await scrollForLazyLoad(page);
    await page.waitForTimeout(2000);

    let pageNum = 1;
    while (pageNum <= MAX_PAGES) {
      const pageData = await page.evaluate(() => {
        const text = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        // Gascoigne Pees renders one result per .card container.
        const cards = Array.from(document.querySelectorAll('.results-page .card, .card--image.card--list .card'));
        const seen = new Set();
        const results = cards.map((card) => {
          const linkEl = card.querySelector('a.card__link[href*="/properties/"][href*="/sales/"]')
            || card.querySelector('a[href*="/properties/"][href*="/sales/"]');
          const href = linkEl?.href || '';
          if (!href || seen.has(href) || !href.includes('/sales/')) return null;
          seen.add(href);

          const priceHeading = card.querySelector('.card__heading');
          const priceQualifier = card.querySelector('.card__intro');
          const titleEl = card.querySelector('.card__text-title');
          const addressEl = card.querySelector('.card__text-content:not(.card__text-content--description)');
          const descriptionEl = card.querySelector('.card__text-content--description');
          const bedsEl = card.querySelector('.card-content__spec-list-item:first-child .card-content__spec-list-number');
          const sourceEl = card.querySelector('picture source[srcset]');
          const imgEl = card.querySelector('img.property-card-image, img');

          return {
            url:       href,
            address:   text(addressEl?.textContent),
            price:     text(`${priceHeading?.textContent || ''} ${priceQualifier?.textContent || ''}`),
            bedrooms:  text(bedsEl?.textContent),
            cardText:  text(`${titleEl?.textContent || ''} ${addressEl?.textContent || ''} ${descriptionEl?.textContent || ''}`),
            thumbnail: (() => {
              if (sourceEl) {
                const first = (sourceEl.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
                if (first && !first.includes('.svg')) return first;
              }
              return imgEl ? (imgEl.currentSrc || imgEl.src || imgEl.getAttribute('data-src') || null) : null;
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
        await scrollForLazyLoad(page);
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
