const { loadPage, resolveUrl } = require('./http');
const { normalise, parsePrice, parseBeds, inferPropertyType } = require('./_localBase');
const { buildTruemangrundyUrl } = require('./search-url-builders');

const SOURCE = 'truemangrundy';
// WPPF (WordPress Property Feed Pro) theme — grid view, server-rendered PHP
// Cards: article.wppf_property_item
// URL/Address: h4 a (bookmark link inside card)
// Price: h6 (e.g. "Price Guide £675,000")
// Bedrooms: h5 (e.g. "3 Bed  House - detached")
// Thumbnail: figure img
const URL = buildTruemangrundyUrl();
const BASE = 'https://www.truemanandgrundy.co.uk';

async function scrape() {
  const listings = [];
  try {
    const $ = await loadPage(URL);

    $('article.wppf_property_item').each((_, el) => {
      const c = $(el);
      const linkEl = c.find('h4 a[href*="/property/"]');
      const rawHref = linkEl.attr('href') || '';
      if (!rawHref) return;
      const url = resolveUrl(BASE, rawHref);

      const bedsText = c.find('h5').text().trim();
      const imgEl = c.find('figure img');

      listings.push(normalise({
        url,
        address: linkEl.text().trim() || null,
        price: parsePrice(c.find('h6').text().trim()),
        bedrooms: parseBeds(bedsText),
        prop_type: inferPropertyType(bedsText, linkEl.text(), rawHref),
        thumbnail: (() => {
          const sourceEl = c.find('picture source[srcset]');
          if (sourceEl.length) {
            const first = (sourceEl.attr('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
            if (first && !first.includes('.svg')) return first;
          }
          return imgEl.attr('src') || imgEl.attr('data-src') || null;
        })(),
      }, SOURCE));
    });
  } catch (err) {
    console.error(`[${SOURCE}] Error:`, err.message);
  }
  return listings;
}

module.exports = { scrape, SOURCE };
