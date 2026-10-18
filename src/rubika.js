'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const style = require('./style');

const BASE = () => `${cfg.apiBase}/${cfg.token}`;

async function call(method, body = {}) {
  try {
    const r = await fetch(`${BASE()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json().catch(() => ({}));
    if (j.status && j.status !== 'OK') console.error('[rubika]', method, j.status, j.dev_message || '');
    return j;
  } catch (e) {
    const why = e.cause ? ' | علت: ' + (e.cause.code || '') + ' ' + (e.cause.message || '') : '';
    console.error('[rubika]', method, e.message + why);
    return { _net: true };
  }
}


// ارسال متن با استایل (style.js متن را به پیام‌های metadata/html/markdown تبدیل می‌کند).
// اگر API با استایل خطا داد ولی همان پیام بدون استایل موفق ارسال شد، یعنی مشکل از استایل بوده؛
// بعد از ۳ بار پشت سر هم دیگر استایل نمی‌فرستیم. خطای چت خراب این را خاموش نمی‌کند.
let styleFail = 0;
async function post(method, body, p) {
  const { plain, ...styled } = p;
  if (!styled.metadata && !styled.parse_mode) return call(method, { ...body, text: plain });
  const r = await call(method, { ...body, ...styled });
  if (r._net || !r.status || r.status === 'OK') {
    if (r.status === 'OK') styleFail = 0;
    return r;
  }
  const r2 = await call(method, { ...body, text: plain });
  if (r2.status === 'OK' && ++styleFail >= 3) {
    console.error('[style] API استایل را نمی‌پذیرد؛ از این پس متن‌ها بدون استایل ارسال می‌شوند.');
    style.setMode('plain');
  }
  return r2;
}

// id دکمه بدون ایموجی است (مسیریابی بر اساس نام تمیز)، متن نمایشی با ایموجی
const clean = (t) => require('./text').noEmoji(t) || t;
const keypad = (rows) => ({
  rows: rows.map((r) => ({ buttons: r.map((t) => ({ id: clean(t), type: 'Simple', button_text: t })) })),
  resize_keyboard: true,
  on_time_keyboard: false,
});

// ارسال پیام؛ content رشته‌ی استایل‌دار (text.js) یا آرایه‌ی قطعه‌هاست.
// اگر rows داده شود کیبورد اصلی پایین صفحه جایگزین می‌شود
async function send(chatId, content, rows) {
  const msgs = style.build(content);
  let last = {};
  for (let i = 0; i < msgs.length; i++) {
    const b = { chat_id: chatId };
    if (rows && i === msgs.length - 1) {
      b.chat_keypad = keypad(rows);
      b.chat_keypad_type = 'New';
    }
    last = await post('sendMessage', b, msgs[i]);
  }
  return last;
}

// ارسال عکس از ریشه‌ی پروژه (name بدون پسوند؛ jpg/jpeg/png). اگر عکس نبود فقط متن ارسال می‌شود.
const fileIds = new Map();
// شناسه‌ی فایل‌های آپلودشده در دیتابیس هم ذخیره می‌شود تا در Vercel هر بار دوباره آپلود نشود
const fidKey = (name) => 'fileid:' + name;
async function loadId(name) {
  if (fileIds.has(name)) return fileIds.get(name);
  try {
    const s = await require('./db').Setting.findOne({ key: fidKey(name) });
    if (s && s.value) { fileIds.set(name, s.value); return s.value; }
  } catch (e) { /* بدون دیتابیس هم کار می‌کند */ }
  return null;
}
async function saveId(name, id) {
  fileIds.set(name, id);
  try { await require('./db').Setting.updateOne({ key: fidKey(name) }, { $set: { value: id } }, { upsert: true }); } catch (e) { /* ignore */ }
}
async function dropId(name) {
  fileIds.delete(name);
  try { await require('./db').Setting.deleteOne({ key: fidKey(name) }); } catch (e) { /* ignore */ }
}
// اگر عکس اختصاصی نبود از عکس جایگزین استفاده می‌شود
const IMG_FALLBACK = { delivered: 'shipment', attack_ground: 'attack', attack_air: 'attack', attack_naval: 'attack' };
function findImage(name) {
  if (!name) return null;
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const f = path.join(__dirname, '..', `${name}.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

async function sendImage(chatId, name, caption) {
  // اگر عکس اختصاصی نبود از عکس جایگزین استفاده می‌شود (مثلا delivered ← shipment)
  const file = findImage(name) || findImage(IMG_FALLBACK[name] || '');
  if (!file) return send(chatId, caption);
  // کلید کش به خودِ فایل وابسته است؛ با عوض کردن عکس (نام یا حجم فایل) عکس جدید خودکار آپلود می‌شود
  let cacheKey = name;
  try { cacheKey = name + '.' + path.basename(file) + '.' + fs.statSync(file).size; } catch (e) { /* ignore */ }
  name = cacheKey;
  try {
    let id = await loadId(name);
    if (!id) {
      const a = await call('requestSendFile', { type: 'Image' });
      const url = a.data && a.data.upload_url;
      if (!url) throw new Error('upload_url missing');
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
      const up = await (await fetch(url, { method: 'POST', body: fd })).json();
      id = up.data && up.data.file_id;
      if (!id) throw new Error('file_id missing');
      await saveId(name, id);
    }
    const msgs = style.build(caption, 1000);
    if (msgs.length === 1) {
      const r = await post('sendFile', { chat_id: chatId, file_id: id }, msgs[0]);
      if (r.status === 'OK') return r;
      await dropId(name);
    } else {
      // کپشن طولانی: عکس بدون کپشن، سپس متن کامل
      const r = await call('sendFile', { chat_id: chatId, file_id: id });
      if (r.status === 'OK') return send(chatId, caption);
      await dropId(name);
    }
  } catch (e) {
    console.error('[image]', e.message);
    await dropId(name);
  }
  return send(chatId, caption);
}

// دانلود عکسِ دریافتی و آپلود دوباره (file_id پیام‌های کاربر گاهی مستقیم قابل ارسال به چت دیگر نیست)
async function reupload(fileId) {
  const g = await call('getFile', { file_id: fileId });
  const dl = g.data && g.data.download_url;
  if (!dl) return null;
  const buf = Buffer.from(await (await fetch(dl, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
  const a = await call('requestSendFile', { type: 'Image' });
  const url = a.data && a.data.upload_url;
  if (!url) return null;
  const fd = new FormData();
  fd.append('file', new Blob([buf]), 'photo.jpg');
  const up = await (await fetch(url, { method: 'POST', body: fd })).json();
  return (up.data && up.data.file_id) || null;
}

// ارسال عکس با کپشن (کپشن طولانی: عکس + متن جدا)
async function sendWithId(chatId, id, caption) {
  const msgs = style.build(caption, 1000);
  if (msgs.length === 1) return post('sendFile', { chat_id: chatId, file_id: id }, msgs[0]);
  const r = await call('sendFile', { chat_id: chatId, file_id: id });
  if (r.status === 'OK') await send(chatId, caption);
  return r;
}

// ارسال عکسِ کاربر با file_id. اگر مستقیم نشد، عکس دوباره آپلود و ارسال می‌شود؛
// فقط اگر هر دو شکست خورد متن بدون عکس می‌رود (withPhoto=false).
async function sendFileId(chatId, fileId, caption) {
  try {
    let r = await sendWithId(chatId, fileId, caption);
    if (r.status === 'OK') return { ...r, withPhoto: true };
    console.error('[photo] ارسال مستقیم نشد:', JSON.stringify(r).slice(0, 200));
    const id2 = await reupload(fileId);
    if (id2) {
      r = await sendWithId(chatId, id2, caption);
      if (r.status === 'OK') return { ...r, withPhoto: true };
      // آخرین تلاش: عکس بدون کپشن، بعد متن جدا
      const r3 = await call('sendFile', { chat_id: chatId, file_id: id2 });
      if (r3.status === 'OK') return { ...(await send(chatId, caption)), withPhoto: true };
    } else {
      console.error('[photo] دانلود/آپلود دوباره ممکن نشد');
    }
  } catch (e) {
    console.error('[photo]', e.message);
  }
  return { ...(await send(chatId, caption)), withPhoto: false };
}

const getMe = () => call('getMe');
const getChat = (chatId) => call('getChat', { chat_id: chatId });
const deleteMessage = (chatId, messageId) => call('deleteMessage', { chat_id: chatId, message_id: messageId });

module.exports = { call, send, sendImage, sendFileId, getMe, getChat, deleteMessage };
