'use strict';
// منطق مشترک توابع Vercel: وب‌هوک، کران، ثبت وب‌هوک
const crypto = require('crypto');
const cfg = require('./config');
const rb = require('./rubika');
const { connect, Setting } = require('./db');

// مسیر مخفی وب‌هوک؛ از توکن ساخته می‌شود تا کسی نتواند آپدیت جعلی بفرستد
const secret = () => crypto.createHash('sha256').update('wh:' + cfg.token).digest('hex').slice(0, 40);
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function host(req) {
  return (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
}
const hookUrl = (req) => `https://${host(req)}/api/webhook/${secret()}`;

// بدنه‌ی درخواست (Vercel معمولا خودش parse می‌کند)
async function bodyOf(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
  else raw = await new Promise((res) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => res(d)); req.on('error', () => res(d)); });
  try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
}

// آپدیت‌ها ممکن است تکی، داخل update، inline_message یا آرایه باشند
function extract(b) {
  if (!b || typeof b !== 'object') return [];
  if (Array.isArray(b)) return b.flatMap(extract);
  if (Array.isArray(b.updates)) return b.updates;
  if (b.update && typeof b.update === 'object' && !b.update.chat_id && b.update.update) return [b.update];
  if (b.inline_message) {
    const im = b.inline_message;
    return [{ type: 'NewMessage', chat_id: im.chat_id, new_message: { message_id: im.message_id, text: im.text, sender_id: im.sender_id, sender_type: 'User', aux_data: im.aux_data, time: im.time } }];
  }
  return [b];
}

async function run() {
  await connect();
  await require('./scheduler').tick();
}

// ثبت وب‌هوک برای هر دو نوع (دریافت پیام و پیام درون‌خطی/دکمه)
async function register(req) {
  const url = hookUrl(req);
  const out = {};
  for (const type of ['ReceiveUpdate', 'ReceiveInlineMessage']) {
    out[type] = await rb.call('updateBotEndpoints', { url, type });
  }
  await connect();
  await Setting.updateOne({ key: 'hook' }, { $set: { value: url } }, { upsert: true });
  return { url, results: out };
}

module.exports = { secret, safeEq, bodyOf, extract, run, register, hookUrl };
