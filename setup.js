/**
 * Quick setup + test script.
 * Run: node setup.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function setup() {
  console.log('\n🏠 Farnham Home Finder — Setup\n');

  // 1. Check .env
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(path.join(__dirname, '.env.example'), envPath);
    console.log('✅ Created .env from .env.example');
    console.log('   ⚠️  Edit .env and add your TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID\n');
  } else {
    console.log('✅ .env exists');
  }

  // 2. Check Playwright browsers
  console.log('\nInstalling Playwright browser (first time only)...');
  const { execSync } = require('child_process');
  try {
    execSync('npx playwright install chromium --with-deps', { stdio: 'inherit' });
    console.log('✅ Playwright Chromium ready');
  } catch (e) {
    console.error('⚠️  Could not install Playwright:', e.message);
  }

  // 3. Initialise DB
  require('./src/db');
  console.log('✅ Database initialised');

  // 4. Telegram test
  const config = require('./config');
  if (config.telegram.token && config.telegram.chatId) {
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(config.telegram.token, { polling: false });
    try {
      await bot.sendMessage(config.telegram.chatId, '✅ Farnham Home Finder connected! You will receive property alerts here.');
      console.log('✅ Telegram test message sent');
    } catch (err) {
      console.error('⚠️  Telegram error:', err.message);
    }
  } else {
    console.log('⚠️  Telegram not configured — edit .env to add your token and chat ID');
  }

  console.log('\n─────────────────────────────────────────');
  console.log('Setup complete! Next steps:');
  console.log('  1. Add your Telegram credentials to .env (see instructions below)');
  console.log('  2. Run: npm start');
  console.log('  3. Open: http://localhost:3000');
  console.log('\n── How to get a Telegram bot token ──────');
  console.log('  1. Open Telegram, search for @BotFather');
  console.log('  2. Send: /newbot');
  console.log('  3. Follow prompts, copy the token into .env as TELEGRAM_BOT_TOKEN');
  console.log('\n── How to get your chat ID ──────────────');
  console.log('  1. Message your new bot (any message)');
  console.log('  2. Visit: https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates');
  console.log('  3. Find "chat":{"id": 123456789} — that number is your TELEGRAM_CHAT_ID');
  console.log('─────────────────────────────────────────\n');
}

setup().catch(console.error);
