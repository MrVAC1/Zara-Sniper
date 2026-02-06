import dotenv from 'dotenv';
dotenv.config();
import { Telegraf } from 'telegraf';
import { HttpsProxyAgent } from 'https-proxy-agent';

const BOT_TOKEN = process.env.BOT_TOKEN;
const USE_TELEGRAM_PROXY = process.env.USE_TELEGRAM_PROXY === 'true';

console.log('='.repeat(60));
console.log('🔍 Telegram Connection Debug Script');
console.log('='.repeat(60));
console.log(`Bot Token: ${BOT_TOKEN ? 'SET' : 'MISSING'}`);
console.log(`USE_TELEGRAM_PROXY: ${USE_TELEGRAM_PROXY}`);
console.log('');

async function testTelegramConnection() {
  try {
    const telegramOptions = {};

    if (USE_TELEGRAM_PROXY) {
      // Example proxy from Webshare (update with your actual proxy)
      const proxyUrl = 'http://pmhcdofu:g1f68kxnxqhw@23.95.150.145:6114';
      console.log(`📡 Using proxy: http://pmhcdofu:***@23.95.150.145:6114`);
      telegramOptions.agent = new HttpsProxyAgent(proxyUrl);
    } else {
      console.log(`📡 Using direct connection (no proxy)`);
    }

    const bot = new Telegraf(BOT_TOKEN, { telegram: telegramOptions });

    console.log('');
    console.log('⏳ Attempting bot.telegram.getMe()...');
    const startTime = Date.now();

    const me = await bot.telegram.getMe();

    const duration = Date.now() - startTime;
    console.log('');
    console.log('✅ Success!');
    console.log(`   Bot Username: @${me.username}`);
    console.log(`   Bot ID: ${me.id}`);
    console.log(`   Response time: ${duration}ms`);
    console.log('');
    console.log('='.repeat(60));
    process.exit(0);

  } catch (error) {
    console.log('');
    console.log('❌ Failed!');
    console.log(`   Error Name: ${error.name}`);
    console.log(`   Error Code: ${error.code || 'N/A'}`);
    console.log(`   Error Message: ${error.message}`);
    console.log('');
    console.log('='.repeat(60));
    process.exit(1);
  }
}

testTelegramConnection();
