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

const keypad = (rows) => ({
  rows: rows.map((r) => ({ buttons: r.map((t) => ({ id: t, type: 'Simple', button_text: t })) })),
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
function findImage(name) {
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const f = path.join(__dirname, '..', `${name}.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

async function sendImage(chatId, name, caption) {
  const file = findImage(name);
  if (!file) return send(chatId, caption);
  try {
    let id = fileIds.get(name);
    if (!id) {
      const a = await call('requestSendFile', { type: 'Image' });
      const url = a.data && a.data.upload_url;
      if (!url) throw new Error('upload_url missing');
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
      const up = await (await fetch(url, { method: 'POST', body: fd })).json();
      id = up.data && up.data.file_id;
      if (!id) throw new Error('file_id missing');
      fileIds.set(name, id);
    }
    const msgs = style.build(caption, 1000);
    if (msgs.length === 1) {
      const r = await post('sendFile', { chat_id: chatId, file_id: id }, msgs[0]);
      if (r.status === 'OK') return r;
      fileIds.delete(name);
    } else {
      // کپشن طولانی: عکس بدون کپشن، سپس متن کامل
      const r = await call('sendFile', { chat_id: chatId, file_id: id });
      if (r.status === 'OK') return send(chatId, caption);
      fileIds.delete(name);
    }
  } catch (e) {
    console.error('[image]', e.message);
    fileIds.delete(name);
  }
  return send(chatId, caption);
}

const getMe = () => call('getMe');
const getChat = (chatId) => call('getChat', { chat_id: chatId });
const deleteMessage = (chatId, messageId) => call('deleteMessage', { chat_id: chatId, message_id: messageId });

module.exports = { call, send, sendImage, getMe, getChat, deleteMessage };
