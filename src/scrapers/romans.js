const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice } = require('./_localBase');
const { buildRomansUrl } = require('./search-url-builders');

const SOURCE = 'romans';
const BASE_URL = buildRomansUrl();

// Romans usually embeds beds/type/address in URL slug.
function parseFromSlug(url) {
  const slugMatch = String(url).match(/\/properties-for-sale\/([^/]+)\//i);
  if (!slugMatch) return { bedrooms: null, prop_type: null, address: null };

  const slug = slugMatch[1].toLowerCase();
  const saleIdx = slug.indexOf('-for-sale-in-');

  let left = saleIdx >= 0 ? slug.slice(0, saleIdx) : slug;
  const right = saleIdx >= 0 ? slug.slice(saleIdx + '-for-sale-in-'.length) : '';

  let bedrooms = null;
  const bedMatch = left.match(/(^|-)\d+-bed(?:room)?-/i) || left.match(/(^|-)\d+-bed(?:room)?$/i);
  if (bedMatch) {
    const n = left.match(/(\d+)-bed(?:room)?/i);
    bedrooms = n ? Number.parseInt(n[1], 10) : null;
    left = left.replace(/(^|-)\d+-bed(?:room)?-?/i, '').replace(/^-+/, '');
  }

  const titleCase = (s) => s
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const prop_type = left ? titleCase(left) : null;
  const address = right ? titleCase(right.replace(/-(gu\d[a-z0-9-]*)$/i, '')) : null;

  return {
    bedrooms,
    prop_type,
    address,
  };
}

function extractAddressFromAlt(altText) {
  const input = String(altText || '').trim();
  if (!input) return null;
  const match = input.match(/-\s*(.*?)\s*-\s*Property View/i);
  return match ? match[1].trim() : null;
}

async function scrape() {
  const page = await newPage();
  const listings = [];
  const seenUrls = new Set();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay();

    // Dismiss cookie/consent banner if present
    try {
      const btn = await page.$('[id*="accept"], button[class*="accept"]');
      if (btn) { await btn.click(); await page.waitForTimeout(1000); }
    } catch (_) {}

    let pageNum = 1;
    let hasMore = true;

    while (hasMore) {
      await page.waitForTimeout(1000);

      const raw = await page.evaluate(() => {
        // Romans property detail links use /properties-for-sale/ path
        const links = Array.from(document.querySelectorAll('a[href*="/properties-for-sale/"]'));
        const seen = new Set();
        const results = [];

        for (const a of links) {
          const href = a.href;
          if (!href || seen.has(href)) continue;
          // Skip links that are just the index page
          if (href.endsWith('/properties-for-sale/')) continue;
          seen.add(href);

          // Walk up from the anchor until we find the card wrapper.
          let card = a;
          for (let i = 0; i < 8; i++) {
            if (!card.parentElement) break;
            card = card.parentElement;
            if (card.classList.contains('property-card-wrapper')) break;
          }

          const priceEl = card.querySelector('h3.property-price');
          const titleEl = card.querySelector('h2, h3, .property-title, .property-address, [class*=\"title\"], [class*=\"address\"]');
          const imgEl   = card.querySelector('img');

          results.push({
            url:       href,
            price:     priceEl ? priceEl.textContent.trim() : null,
            cardText:  titleEl ? titleEl.textContent.trim() : null,
            imageAlt:  imgEl ? (imgEl.alt || null) : null,
            thumbnail: imgEl   ? imgEl.src               : null,
          });
        }
        return results;
      });

      for (const r of raw) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);

        const slug = parseFromSlug(r.url);
        const fallbackBeds = slug.bedrooms ?? (() => {
          const m = String(r.cardText || '').match(/(\d+)\s*bed/i);
          return m ? Number.parseInt(m[1], 10) : null;
        })();
        const addressFromAlt = extractAddressFromAlt(r.imageAlt);
        listings.push(normalise({
          url:       r.url,
          address:   addressFromAlt || slug.address || r.cardText || null,
          price:     parsePrice(r.price),
          bedrooms:  fallbackBeds,
          prop_type: slug.prop_type,
          thumbnail: r.thumbnail || null,
        }, SOURCE));
      }

      // Pagination: Romans uses a <button class="next-btn"> (not an anchor)
      // and it gets the disabled attribute / class when on last page.
      const nextState = await page.evaluate(() => {
        const btn = document.querySelector('button.next-btn');
        if (!btn) return 'none';
        if (btn.disabled || btn.classList.contains('disabled')) return 'disabled';
        return 'enabled';
      });

      if (nextState === 'enabled') {
        await page.click('button.next-btn');
        pageNum++;
        await randomDelay();
      } else {
        hasMore = false;
      }
    }
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE, parseFromSlug, extractAddressFromAlt };
