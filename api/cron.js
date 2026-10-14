'use strict';
const cfg = require('../src/config');
const sl = require('../src/serverless');

// هر بار صدا زده شود: محموله‌های سررسیده و روز خودکار را پردازش می‌کند.
// با cron-job.org هر ۱ دقیقه این آدرس را صدا بزنید: https://<domain>/api/cron
module.exports = async (req, res) => {
  const miss = cfg.missing();
  if (miss.length) return res.status(500).json({ error: 'env missing: ' + miss.join(',') });
  try {
    const { connect, Setting } = require('../src/db');
    await connect();
    const last = await Setting.findOne({ key: 'lastTick' });
    if (last && Date.now() - Number(last.value) < 15000) return res.status(200).json({ ok: true, skipped: true });
    await Setting.updateOne({ key: 'lastTick' }, { $set: { value: String(Date.now()) } }, { upsert: true });
    await sl.run();
    // اگر وب‌هوک ثبت نشده باشد یک بار ثبت می‌شود
    const h = await Setting.findOne({ key: 'hook' });
    if (!h) await sl.register(req).catch((e) => console.error('[hook]', e.message));
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[cron]', e);
    res.status(500).json({ ok: false });
  }
};
