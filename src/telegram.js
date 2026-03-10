const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');

let bot = null;

function getBot() {
  if (!bot && config.telegram.token) {
    bot = new TelegramBot(config.telegram.token, { polling: false });
  }
  return bot;
}

function formatPrice(price) {
  if (!price) return 'POA';
  return '£' + price.toLocaleString('en-GB');
}

function formatDistance(miles) {
  if (miles === null || miles === undefined) return '?';
  if (miles < 0.1) return 'Town centre';
  return `${miles.toFixed(1)} mi`;
}

async function sendNewListing(listing) {
  const b = getBot();
  if (!b || !config.telegram.chatId) {
    console.warn('Telegram not configured — skipping notification');
    return false;
  }

  const dSchool = listing.dist_school !== null ? formatDistance(listing.dist_school) : '?';
  const dCentre = listing.dist_centre !== null ? formatDistance(listing.dist_centre) : '?';
  const sourceLabel = listing.source.charAt(0).toUpperCase() + listing.source.slice(1);

  const caption = [
    `🏠 *NEW LISTING — Farnham*`,
    ``,
    `📍 ${listing.address || 'Address not shown'}`,
    `🛏 ${listing.bedrooms || '?'} bed  |  🏡 ${listing.prop_type || 'Property'}`,
    `💰 ${formatPrice(listing.price)}`,
    ``,
    `🏫 School: ${dSchool} walk`,
    `🏙 Town centre: ${dCentre}`,
    ``,
    `🔗 [View on ${sourceLabel}](${listing.url})`,
  ].join('\n');

  try {
    if (listing.thumbnail) {
      await b.sendPhoto(config.telegram.chatId, listing.thumbnail, {
        caption,
        parse_mode: 'Markdown',
      });
    } else {
      await b.sendMessage(config.telegram.chatId, caption, { parse_mode: 'Markdown' });
    }
    return true;
  } catch (err) {
    // Fallback without photo if image fails
    try {
      await b.sendMessage(config.telegram.chatId, caption, { parse_mode: 'Markdown' });
      return true;
    } catch (e) {
      console.error('Telegram send failed:', e.message);
      return false;
    }
  }
}

async function sendSummary(stats) {
  const b = getBot();
  if (!b || !config.telegram.chatId) return;

  const msg = [
    `📊 *Scrape complete*`,
    `New matches: ${stats.newMatches}`,
    `Total checked: ${stats.total}`,
    `Sources: ${stats.sources.join(', ')}`,
  ].join('\n');

  try {
    await b.sendMessage(config.telegram.chatId, msg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Telegram summary failed:', err.message);
  }
}

async function sendError(source, message) {
  const b = getBot();
  if (!b || !config.telegram.chatId) return;
  try {
    await b.sendMessage(config.telegram.chatId, `⚠️ Scraper error [${source}]: ${message}`);
  } catch (_) {}
}

module.exports = { sendNewListing, sendSummary, sendError };
