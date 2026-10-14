'use strict';
const cfg = require('../../src/config');
const sl = require('../../src/serverless');

module.exports = async (req, res) => {
  const miss = cfg.missing();
  if (miss.length) return res.status(500).json({ error: 'env missing: ' + miss.join(',') });

  // مسیر: /api/webhook/<secret>
  const url = new URL(req.url, 'http://x');
  const seg = url.pathname.split('/').filter(Boolean);
  const given = seg[seg.length - 1] || '';
  if (!sl.safeEq(given, sl.secret())) return res.status(403).json({ error: 'forbidden' });
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  try {
    const { connect } = require('../../src/db');
    await connect();
    const bot = require('../../src/bot');
    const ups = sl.extract(await sl.bodyOf(req));
    for (const up of ups) {
      try { await bot.onUpdate(up); } catch (e) { console.error('[update]', e); }
    }
    await require('../../src/scheduler').tick().catch((e) => console.error('[tick]', e.message));
  } catch (e) {
    console.error('[webhook]', e);
  }
  // همیشه ۲۰۰ تا روبیکا بارها همان آپدیت را دوباره نفرستد
  res.status(200).json({ ok: true });
};
