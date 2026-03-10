const { newPage, randomDelay } = require('./browser');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildAndrewLodgeUrl } = require('./search-url-builders');

const SOURCE = 'andrewlodge';
const URL = buildAndrewLodgeUrl();

async function scrape() {
  const page = await newPage();
  const listings = [];
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay();

    // Wait for property cards — Andrew Lodge uses <a class="cards cards--property">
    try {
      await page.waitForSelector('a.cards--property', { timeout: 10000 });
    } catch (_) {}

    const raw = await page.evaluate(() => {
      // Each listing is an <a class="cards cards--property" href="/properties/sale/...">
      // Inside:
      //   <h4>  "5 Beds - Detached house - For Sale"
      //   <h5>  "Address, Town, County<br>Guide Price £1,234,000"
      //   <img> thumbnail (src or data-src for lazy-loaded images)
      const cards = Array.from(document.querySelectorAll('a.cards--property'));
      const seen = new Set();
      return cards.map(a => {
        const href = a.href;
        if (!href || seen.has(href)) return null;
        seen.add(href);

        const h4 = a.querySelector('h4');
        const h5 = a.querySelector('h5');
        const imgEl = a.querySelector('img');

        // h5 innerHTML: "Address<br>Guide Price £X" — split on <br> to get address and price
        const h5Html = h5 ? h5.innerHTML : '';
        const parts = h5Html.split(/<br\s*\/?>/i);
        const address = parts[0] ? parts[0].replace(/<[^>]+>/g, '').trim() : null;
        const priceText = parts[1] ? parts[1].replace(/<[^>]+>/g, '').trim() : null;

        // h4 text: "5 Beds - Detached house - For Sale"
        const h4Text = h4 ? h4.textContent.trim() : '';

        // thumbnail: prefer src, fall back to data-src (lazy load)
        const thumbnail = (imgEl && imgEl.src && !imgEl.src.startsWith('data:'))
          ? imgEl.src
          : (imgEl ? (imgEl.getAttribute('data-src') || null) : null);

        return {
          url:       href,
          price:     priceText,
          address,
          bedrooms:  h4Text,
          thumbnail,
        };
      }).filter(Boolean);
    });

    raw.forEach(r => listings.push(normalise({
      ...r,
      price:    parsePrice(r.price),
      bedrooms: parseBeds(r.bedrooms),
    }, SOURCE)));
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  } finally {
    await page.context().close();
  }
  return listings;
}

module.exports = { scrape, SOURCE };
