'use strict';
// کنترل روزانه‌ی بازی (باز / بسته) بدون هیچ اعلانی در کانال یا گروه.
//   دستی:  مدیریت با «شروع بازی» و «توقف بازی» بازی را باز یا بسته می‌کند.
//   خودکار: هر روز از ساعت شروع تا ساعت پایان (به وقت تهران) بازی باز است؛ بیرون از آن بسته.
// وقتی بازی بسته است: حمله، ارسال محموله و سرنگونی بازیکن‌ها ممکن نیست و محموله‌های در راه
// تا باز شدن بازی نمی‌رسند. برداشت درآمد، ارتقاء و خرید نیرو همیشه آزاد است.
const { Setting } = require('./db');
const T = require('./text');
const { mono, bold, quote } = T;

const KEY = 'gate';
const DEF = () => ({ mode: 'manual', open: true, from: null, to: null });

async function get() {
  const s = await Setting.findOne({ key: KEY });
  if (!s) return DEF();
  try {
    return { ...DEF(), ...JSON.parse(s.value) };
  } catch (e) {
    return DEF();
  }
}
const save = async (g) => {
  await Setting.updateOne({ key: KEY }, { $set: { value: JSON.stringify(g) } }, { upsert: true });
  return g;
};

// دقیقه‌ی فعلی از نیمه‌شب به وقت تهران
function tehranMinutes(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return g('hour') * 60 + g('minute');
}

// «16» یا «16:30» یا «۱۶:۳۰»  ←  دقیقه از نیمه‌شب (یا null)
function parseTime(s) {
  const m = T.en(s).match(/^\s*(\d{1,2})(?:\s*[:.٫]\s*(\d{1,2}))?\s*$/);
  if (!m) return null;
  const h = +m[1];
  const mi = m[2] === undefined ? 0 : +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

const hhmm = (min) =>
  [Math.floor(min / 60), min % 60]
    .map((x) => String(x).padStart(2, '0'))
    .join(':')
    .replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

function openAt(g, minutes) {
  if (g.mode === 'auto' && g.from != null && g.to != null) {
    if (g.from === g.to) return true; // شروع = پایان یعنی همیشه باز
    return g.from < g.to ? minutes >= g.from && minutes < g.to : minutes >= g.from || minutes < g.to;
  }
  return g.open !== false;
}

const isOpen = async () => openAt(await get(), tehranMinutes());

const setManual = (open) => save({ ...DEF(), mode: 'manual', open: !!open });
const setAuto = (from, to) => save({ mode: 'auto', open: true, from, to });

const hoursLine = (g) => (g.mode === 'auto' && g.from != null ? 'ساعت بازی: ' + mono(hhmm(g.from) + ' تا ' + hhmm(g.to)) + ' (به وقت تهران)' : '');

// وضعیت برای مدیریت
async function text() {
  const g = await get();
  const open = openAt(g, tehranMinutes());
  return quote(
    bold('کنترل بازی'),
    'وضعیت الان: ' + mono(open ? 'باز' : 'بسته'),
    'حالت: ' + mono(g.mode === 'auto' ? 'خودکار' : 'دستی'),
    g.mode === 'auto' && hoursLine(g)
  );
}

// پیام مسدودکننده برای بازیکن؛ اگر بازی باز باشد null
async function blockText() {
  const g = await get();
  if (openAt(g, tehranMinutes())) return null;
  return quote('بازی در حال حاضر متوقف است.', g.mode === 'auto' ? hoursLine(g) : 'بعداً دوباره تلاش کنید.');
}

module.exports = { get, isOpen, setManual, setAuto, parseTime, hhmm, openAt, tehranMinutes, text, blockText };
