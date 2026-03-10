const { chromium } = require('playwright');
const config = require('../../config');

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: config.scraper.headless,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
  }
  return browserInstance;
}

async function newPage() {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  });
  const page = await ctx.newPage();
  // Mask webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return page;
}

function delay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, ms));
}

async function randomDelay() {
  await delay(config.scraper.minDelay, config.scraper.maxDelay);
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

module.exports = { getBrowser, newPage, randomDelay, closeBrowser };
