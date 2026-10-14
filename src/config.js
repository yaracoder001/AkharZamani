'use strict';
require('dotenv').config();

const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);

const cfg = {
  token: (process.env.BOT_TOKEN || '').trim(),
  apiBase: (process.env.RUBIKA_API_BASE || 'https://botapi.rubika.ir/v3').replace(/\/+$/, ''),
  mongo: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/rubika_war',
  ownerPass: process.env.OWNER_PASSWORD,
  adminPass: process.env.ADMIN_PASSWORD,
  announceChat: process.env.ANNOUNCE_CHAT_ID || '',
  travelMin: num(process.env.TRAVEL_MINUTES, 5),
  seasonDays: Math.max(1, Math.floor(num(process.env.SEASON_DAYS, 30))),
  dayHours: num(process.env.DAY_HOURS, 0), // 0 = رفتن به روز بعد فقط دستی توسط مدیریت
  pollMs: num(process.env.POLL_MS, 1200),
  richMode: (process.env.RICH_MODE || 'metadata').toLowerCase(), // metadata | plain | html | markdown
  metaIndex: (process.env.META_INDEX || 'utf16').toLowerCase(), // utf16 | codepoint
  payInfo: (process.env.PAYMENT_INFO || 'برای پرداخت با پشتیبانی هماهنگ کنید.').replace(/[\uE000-\uF8FF]/g, ''),
};

cfg.missing = () => {
  const miss = [];
  if (!cfg.token) miss.push('BOT_TOKEN');
  if (!cfg.ownerPass) miss.push('OWNER_PASSWORD');
  if (!cfg.adminPass) miss.push('ADMIN_PASSWORD');
  return miss;
};

cfg.check = () => {
  const miss = [];
  if (!cfg.token) miss.push('BOT_TOKEN');
  if (!cfg.ownerPass) miss.push('OWNER_PASSWORD');
  if (!cfg.adminPass) miss.push('ADMIN_PASSWORD');
  if (miss.length) {
    console.error('مقادیر زیر در فایل .env تنظیم نشده‌اند: ' + miss.join(', '));
    process.exit(1);
  }
};

module.exports = cfg;
