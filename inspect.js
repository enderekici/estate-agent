const { chromium } = require('playwright');

const sites = [
  { name: 'rightmove',     url: 'https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=OUTCODE%5E2576&minBedrooms=3&sortType=6' },
  { name: 'zoopla',        url: 'https://www.zoopla.co.uk/for-sale/property/farnham/?beds_min=3' },
  { name: 'onthemarket',   url: 'https://www.onthemarket.com/for-sale/property/farnham/?min-bedrooms=3' },
  { name: 'winkworth',     url: 'https://www.winkworth.co.uk/surrey/farnham/properties-for-sale?min_beds=3' },
  { name: 'romans',        url: 'https://www.romans.co.uk/properties/for-sale/in-farnham/?min_bedrooms=3' },
  { name: 'bridges',       url: 'https://www.bridges.co.uk/branches/farnham-estate-agents/' },
  { name: 'hamptons',      url: 'https://www.hamptons.co.uk/search/property-for-sale/?q=Farnham&min-bedrooms=3' },
  { name: 'savills',       url: 'https://www.savills.co.uk/find-a-property/residential-property/for-sale/in-farnham-surrey-gb/all/all-departments?bedrooms_min=3' },
  { name: 'truemangrundy', url: 'https://www.truemanandgrundy.co.uk/property/?department=residential-sales&minimum_bedrooms=3' },
  { name: 'keatsfearn',    url: 'https://www.keatsfearn.co.uk/#/sales' },
  { name: 'charters',      url: 'https://www.chartersestateagents.co.uk/property/for-sale/in-farnham/?min_beds=3' },
  { name: 'curchods',      url: 'https://curchods.com/properties/?department=residential-sales&address_keyword=Farnham&minimum_bedrooms=3' },
  { name: 'wpr',           url: 'https://www.wpr.co.uk/area/farnham/?department=residential-sales&minimum_bedrooms=3' },
  { name: 'andrewlodge',   url: 'https://andrewlodge.net/property-search/?department=residential-sales&minimum_bedrooms=3&location=Farnham' },
  { name: 'greenwood',     url: 'https://www.greenwood-property.co.uk/property-search/?department=residential-sales&minimum_bedrooms=3' },
  { name: 'bourne',        url: 'https://bourneestateagents.com/property-search/?department=residential-sales&minimum_bedrooms=3' },
];

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const site of sites) {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    const page = await ctx.newPage();
    try {
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      const info = await page.evaluate(() => {
        // Find links that look like property detail pages
        const allLinks = Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({ href: a.href, text: (a.textContent||'').trim().substring(0,60) }))
          .filter(l => l.href && l.href.startsWith('http'));

        // Find price-like elements
        const prices = Array.from(document.querySelectorAll('*'))
          .filter(el => el.children.length === 0 && /£[\d,]+/.test(el.textContent))
          .slice(0, 5)
          .map(el => ({ tag: el.tagName, class: el.className.substring(0,80), text: el.textContent.trim().substring(0,50) }));

        // Get all distinct class names on article/li/div that might be cards
        const cardCandidates = Array.from(document.querySelectorAll('article, [class*="property"], [class*="listing"], [class*="card"], [class*="result"]'))
          .slice(0, 3)
          .map(el => ({ tag: el.tagName, class: el.className.substring(0,100), firstLink: (el.querySelector('a')||{}).href }));

        return { 
          title: document.title.substring(0, 60),
          url: window.location.href.substring(0, 100),
          linkSample: allLinks.slice(0, 8),
          prices: prices.slice(0, 3),
          cards: cardCandidates,
          bodyLength: document.body.innerText.length,
        };
      });

      console.log('\n=== ' + site.name.toUpperCase() + ' ===');
      console.log('Title:', info.title);
      console.log('URL:', info.url);
      console.log('Body length:', info.bodyLength);
      console.log('Price elements:', JSON.stringify(info.prices));
      console.log('Card elements:', JSON.stringify(info.cards));
      console.log('Links:', JSON.stringify(info.linkSample));
    } catch (e) {
      console.log('\n=== ' + site.name.toUpperCase() + ' === ERROR:', e.message.substring(0,100));
    }
    await ctx.close();
  }

  await browser.close();
})();
