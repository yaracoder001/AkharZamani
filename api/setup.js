'use strict';
const cfg = require('../src/config');
const sl = require('../src/serverless');

// ثبت وب‌هوک: https://<domain>/api/setup?password=OWNER_PASSWORD
module.exports = async (req, res) => {
  const miss = cfg.missing();
  if (miss.length) return res.status(500).json({ error: 'این متغیرها در Vercel تنظیم نشده‌اند: ' + miss.join(',') });
  const url = new URL(req.url, 'http://x');
  const pass = url.searchParams.get('password') || '';
  if (!sl.safeEq(pass, cfg.ownerPass)) return res.status(403).json({ error: 'رمز نادرست است' });
  try {
    const me = await require('../src/rubika').getMe();
    const out = await sl.register(req);
    res.status(200).json({ bot: me.data && me.data.bot ? me.data.bot.bot_title || me.data.bot.bot_id : me.status || me, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
