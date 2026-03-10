require('dotenv').config();
const path = require('path');
const dashboardPort = parseInt(process.env.DASHBOARD_PORT || '', 10);

module.exports = {
  search: {
    location: 'Farnham',
    county: 'Surrey',
    locationSlug: 'farnham',
    postcodeDistrict: 'GU9',
    postcodeDistricts: ['GU9', 'GU10'],
    minBedrooms: parseInt(process.env.MIN_BEDROOMS || '3', 10),
    maxPrice: process.env.MAX_PRICE ? parseInt(process.env.MAX_PRICE, 10) : null,
  },

  // Highfield South Farnham School — GU9 8QH, Weydon Lane
  // Coordinates resolved at startup via Nominatim if not set
  school: {
    name: 'Highfield South Farnham School',
    address: 'Weydon Lane, Farnham, GU9 8QH',
    lat: 51.2064465,
    lng: -0.8030390,
    maxWalkingMiles: 1.2, // ~25 min walk
  },

  // Farnham town centre (The Borough)
  townCentre: {
    name: 'Farnham town centre',
    address: 'The Borough, Farnham, GU9 7NJ',
    lat: 51.2152435,
    lng: -0.7982083,
    radiusMiles: 0.5,
  },

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  scheduler: {
    // Every 45 minutes, 8am–10pm
    cron: '*/45 8-22 * * *',
  },

  dashboard: {
    port: Number.isFinite(dashboardPort) ? dashboardPort : 3000,
  },

  db: {
    path: process.env.DB_PATH || path.join(__dirname, 'data', 'listings.db'),
  },

  scraper: {
    // Delay between page loads (ms) — be polite to servers
    minDelay: 2000,
    maxDelay: 5000,
    headless: true,
  },
};
