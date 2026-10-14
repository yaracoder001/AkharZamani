'use strict';
const cfg = require('./config');
const rb = require('./rubika');
const H = require('./handlers');
const T = require('./text');
const { Seen } = require('./db');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// پشتیبانی از شکل‌های مختلف آپدیت روبیکا
function parse(up) {
  const type = up.type;
  const chatId = String(up.chat_id || (up.update && up.update.chat_id) || '');
  if (!chatId) return null;
  if (type === 'StoppedBot') return null;
  if (type === 'StartedBot') return { chatId, senderId: chatId, text: '/start', msg: { message_id: 'start-' + Date.now() }, key: 'start:' + chatId + ':' + (up.time || Math.floor(Date.now() / 5000)) };

  const m = up.new_message || (up.update && up.update.new_message) || (up.text !== undefined ? up : null);
  if (!m) return null;
  if (m.sender_type && m.sender_type !== 'User') return null;
  const text = T.clean(m.text || (m.aux_data && m.aux_data.button_id) || '');
  if (!text) return null;
  if (m.time && Date.now() / 1000 - Number(m.time) > 300) return null; // پیام‌های خیلی قدیمی
  return { chatId, senderId: String(m.sender_id || chatId), text, msg: { ...m, text }, key: chatId + ':' + m.message_id };
}

async function onUpdate(up) {
  const p = parse(up);
  if (!p) return;
  // جلوگیری از پردازش دوباره (تکرار آپدیت در polling یا ارسال دوباره‌ی وب‌هوک)؛ در دیتابیس تا بین چند سرور هم کار کند
  try {
    await Seen.create({ key: p.key });
  } catch (e) {
    if (e && e.code === 11000) return;
    throw e;
  }

  console.log('[recv]', p.chatId.slice(0, 6) + '...', JSON.stringify(p.text).slice(0, 40));
  // گروه: g0 ، کانال: c0 ، چت خصوصی با ربات: b0
  if (p.chatId.startsWith('g')) await H.onGroup(p.chatId, p.senderId, p.text);
  else if (!p.chatId.startsWith('c')) await H.onPrivate(p.chatId, p.senderId, p.text, p.msg);
}

async function poll() {
  let offset = null;
  let fails = 0;
  console.log('ربات روشن شد و در حال دریافت پیام‌هاست...');
  for (;;) {
    try {
      const r = await rb.call('getUpdates', { limit: 50, ...(offset ? { offset_id: offset } : {}) });
      if (r._net || (r.status && r.status !== 'OK')) {
        fails++;
        if (fails === 1 || fails % 10 === 0) {
          console.error(r._net
            ? 'اتصال به روبیکا برقرار نیست. اینترنت/فیلترینگ سرور را بررسی کنید.'
            : 'پاسخ نامعتبر از روبیکا؛ توکن را بررسی کنید: ' + JSON.stringify(r).slice(0, 200));
        }
        await sleep(Math.min(2000 * fails, 20000));
        continue;
      }
      fails = 0;
      const d = r.data || {};
      const list = d.updates || [];
      for (const up of list) {
        try {
          await onUpdate(up);
        } catch (e) {
          console.error('[update]', e);
          if (up.chat_id) await rb.send(up.chat_id, T.quote('خطایی رخ داد. دوباره تلاش کنید.')).catch(() => {});
        }
      }
      if (d.next_offset_id) offset = d.next_offset_id;
      if (!list.length || !d.next_offset_id) await sleep(cfg.pollMs);
    } catch (e) {
      console.error('[poll]', e.message);
      await sleep(3000);
    }
  }
}

module.exports = { poll, parse, onUpdate };
