'use strict';
const rb = require('./rubika');
const cfg = require('./config');
const { Setting, User } = require('./db');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function groupId() {
  const s = await Setting.findOne({ key: 'announce' });
  return (s && s.value) || cfg.announceChat;
}

// اعلان داخل گروه؛ img نام عکس بدون پسوند در ریشه‌ی پروژه است
async function announce(text, img) {
  const g = await groupId();
  if (!g) return false;
  if (img) await rb.sendImage(g, img, text);
  else await rb.send(g, text);
  return true;
}

// پیام خصوصی به کاربر
async function dm(userId, text) {
  if (!userId) return;
  try {
    const u = await User.findOne({ userId });
    if (u && u.chatId) await rb.send(u.chatId, text);
  } catch (e) {
    console.error('[dm]', e.message);
  }
}

// ارسال همگانی (پشت‌صحنه، با فاصله برای جلوگیری از محدودیت)
// باید await شود (در Vercel بعد از پایان درخواست کاری اجرا نمی‌شود). دسته‌های ۱۰ تایی موازی.
async function broadcast(users, text) {
  const list = users.filter((u) => u.chatId);
  for (let i = 0; i < list.length; i += 10) {
    await Promise.all(list.slice(i, i + 10).map((u) => rb.send(u.chatId, text).catch(() => {})));
    if (i + 10 < list.length) await sleep(150);
  }
}

module.exports = { announce, dm, broadcast, groupId };
