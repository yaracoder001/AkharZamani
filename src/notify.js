'use strict';
const rb = require('./rubika');
const cfg = require('./config');
const { Setting, User } = require('./db');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// دو مقصد قابل ویرایش از داخل پنل مدیریت:
//   کانال (کلید announce): اعلان‌های بازی؛ محموله، نبرد، سرنگونی، فصل
//   گروه  (کلید group):    بیانیه‌های بازیکن‌ها
// اگر گروه تنظیم نشده باشد بیانیه‌ها در همان چت اعلان‌ها (کانال) ارسال می‌شوند.
const KEYS = { channel: 'announce', group: 'group' };

async function getSetting(key) {
  const s = await Setting.findOne({ key });
  return (s && s.value) || '';
}

async function channelId() {
  return (await getSetting(KEYS.channel)) || cfg.announceChat;
}
async function groupChatId() {
  return (await getSetting(KEYS.group)) || cfg.groupChat;
}
// مقصد بیانیه‌ها
async function statementId() {
  return (await groupChatId()) || (await channelId());
}
// برای سازگاری با کدهای قبلی
const groupId = channelId;

async function setChat(kind, id) {
  const key = KEYS[kind];
  if (!key) return false;
  if (!id) await Setting.deleteOne({ key });
  else await Setting.updateOne({ key }, { $set: { value: String(id) } }, { upsert: true });
  return true;
}

// اعلان داخل کانال؛ img نام عکس بدون پسوند در ریشه‌ی پروژه است
async function announce(text, img) {
  const g = await channelId();
  if (!g) return false;
  if (img) await rb.sendImage(g, img, text);
  else await rb.send(g, text);
  return true;
}

// ارسال متن به یک چت مشخص؛ fileId = عکس ارسالی از کاربر (اختیاری)، img = نام عکس ثابت پروژه (اختیاری)
async function sendTo(chat, text, { fileId, img } = {}) {
  if (!chat) return { ok: false, photo: false };
  try {
    if (fileId) {
      const r = await rb.sendFileId(chat, fileId, text);
      return { ok: true, photo: !!r.withPhoto };
    }
    if (img) await rb.sendImage(chat, img, text);
    else await rb.send(chat, text);
    return { ok: true, photo: !!img };
  } catch (e) {
    console.error('[sendTo]', e.message);
    return { ok: false, photo: false };
  }
}

// بیانیه ← گروه (یا کانال اگر گروه تنظیم نشده)
async function statement(text, opts) {
  return sendTo(await statementId(), text, opts);
}

// ارسال دستی از پنل: dest = channel | group | both
async function publish(dest, text, opts) {
  const out = {};
  if (dest === 'channel' || dest === 'both') out.channel = await sendTo(await channelId(), text, opts);
  if (dest === 'group' || dest === 'both') out.group = await sendTo(await groupChatId(), text, opts);
  return out;
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

module.exports = { announce, dm, broadcast, groupId, channelId, groupChatId, statementId, statement, publish, sendTo, setChat };
