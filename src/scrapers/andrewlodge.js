const { loadPage, resolveUrl } = require('./http');
const { normalise, parsePrice, parseBeds } = require('./_localBase');
const { buildAndrewLodgeUrl } = require('./search-url-builders');

const SOURCE = 'andrewlodge';
const URL = buildAndrewLodgeUrl();
const BASE = 'https://andrewlodge.net';

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();

async function scrape() {
  const listings = [];
  try {
    const $ = await loadPage(URL);
    const seen = new Set();

    $('a.cards--property').each((_, el) => {
      const a = $(el);
      const rawHref = a.attr('href') || '';
      if (!rawHref) return;
      const url = resolveUrl(BASE, rawHref);
      if (seen.has(url)) return;
      seen.add(url);

      // h4 text: "5 Beds - Detached house - For Sale"
      const h4Text = a.find('h4').text().trim();

      // h5 innerHTML: "Address<br>Guide Price £X" — split on <br> to get address and price
      const h5Html = a.find('h5').html() || '';
      const parts = h5Html.split(/<br\s*\/?>/i);
      const address = stripTags(parts[0]) || null;
      const priceText = stripTags(parts[1] || '') || null;

      const imgEl = a.find('img');
      const imgSrc = imgEl.attr('src') || '';
      const thumbnail = imgSrc && !imgSrc.startsWith('data:')
        ? imgSrc
        : (imgEl.attr('data-src') || null);

      listings.push(normalise({
        url,
        price: parsePrice(priceText),
        address,
        bedrooms: parseBeds(h4Text),
        thumbnail,
      }, SOURCE));
    });
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  }
  return listings;
}

module.exports = { scrape, SOURCE };
