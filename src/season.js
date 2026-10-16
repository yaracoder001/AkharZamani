'use strict';
// فصل بازی: ۳۰ روز، حذف تیم‌ها، و برنده شدن آخرین تیم باقی‌مانده
const cfg = require('./config');
const T = require('./text');
const G = require('./game');
const N = require('./notify');
const { Country, User, Setting, Shipment } = require('./db');
const { withFlag } = require('./countries');
const { fa, mono, bold, quote } = T;

const KEY = 'season';
const DEF = () => ({ state: 'lobby', day: 0, dayStart: null, winner: null, maxDays: cfg.seasonDays });

async function get() {
  const s = await Setting.findOne({ key: KEY });
  if (!s) return DEF();
  try {
    return { ...DEF(), ...JSON.parse(s.value) };
  } catch (e) {
    return DEF();
  }
}
const save = async (s) => {
  await Setting.updateOne({ key: KEY }, { $set: { value: JSON.stringify(s) } }, { upsert: true });
  return s;
};

const alive = () => Country.find({ status: 'active', ownerId: { $ne: null } });
const ranked = async () => {
  const l = await alive();
  return l.map((c) => ({ c, score: G.score(c) })).sort((a, b) => b.score - a.score);
};

// بازگرداندن همه‌ی کشورها به حالت اولیه (با توجه به رده‌ی هر کشور: عادی / نظامی ویژه / اقتصادی ویژه)
// منابع، نیروها، سطح زیرساخت‌ها و جان کشور از نو ساخته می‌شود. رده، کد ورود و صاحب کشور حفظ می‌شود.
// کشورهای نابودشده‌ی فصل قبل دوباره آزاد و فعال می‌شوند. محموله‌های در راه لغو می‌شوند.
async function resetAll() {
  const all = await Country.find();
  let n = 0;
  for (const c of all) {
    const f = G.freshState(c.tier);
    const set = { res: f.res, units: f.units, lv: f.lv, hp: f.hp, lastClaim: f.lastClaim, lastStatement: null, status: 'active' };
    if (c.status === 'destroyed') set.ownerId = null;
    await Country.updateOne({ _id: c._id }, { $set: set });
    n++;
  }
  await Shipment.updateMany({ status: { $in: ['flying', 'landing'] } }, { $set: { status: 'returned' } });
  return n;
}

async function start() {
  const s = await get();
  if (s.state === 'running') return { ok: false, msg: 'فصل در حال اجراست.' };
  if ((await alive()).length < 2) return { ok: false, msg: 'برای شروع فصل حداقل دو کشور دارای بازیکن لازم است.' };
  const reset = await resetAll();
  const n = await save({ ...DEF(), state: 'running', day: 1, dayStart: Date.now() });
  await N.announce(
    quote(bold('فصل جدید آغاز شد'), 'مدت فصل: ' + mono(fa(n.maxDays) + ' روز'), 'روز ' + mono(fa(1))) +
      '\n\nتیمی که تا پایان فصل بماند برنده است. تیمی که نابود شود از بازی حذف می‌شود.'
  );
  return { ok: true, season: n };
}

async function finish(reason) {
  const s = await get();
  if (s.state !== 'running') return { ok: false, msg: 'فصل در حال اجرا نیست.' };
  const r = await ranked();
  const top = r[0];
  const winner = top ? { name: top.c.name, ownerId: top.c.ownerId, score: top.score } : null;
  await save({ ...s, state: 'ended', winner });
  const why = reason === 'last' ? 'آخرین تیم باقی‌مانده' : reason === 'time' ? 'پایان روز ' + fa(s.maxDays) : 'پایان دستی فصل';
  const board = r.slice(0, 5).map((x, i) => fa(i + 1) + '. ' + mono(withFlag(x.c.name)) + ' ـ امتیاز ' + mono(fa(x.score))).join('\n');
  await N.announce(
    quote(bold('پایان فصل'), winner ? 'برنده: ' + mono(withFlag(winner.name)) : 'برنده‌ای وجود ندارد', 'دلیل: ' + why) +
      (board ? '\n\n' + bold('جدول نهایی') + '\n' + board : '')
  );
  if (winner) await N.dm(winner.ownerId, quote(bold('تبریک'), 'شما برنده‌ی این فصل شدید.'));
  return { ok: true, winner };
}

async function checkWinner() {
  const s = await get();
  if (s.state !== 'running') return null;
  if ((await alive()).length <= 1) return finish('last');
  return null;
}

async function advanceDay() {
  const s = await get();
  if (s.state !== 'running') return { ok: false, msg: 'فصل در حال اجرا نیست.' };
  if (s.day >= s.maxDays) {
    const r = await finish('time');
    return { ...r, ended: true };
  }
  const n = await save({ ...s, day: s.day + 1, dayStart: Date.now() });
  // بازسازی روزانه‌ی هسته‌ی کشورها (حداکثر HP_MAX)
  await Country.updateMany({ status: 'active' }, { $inc: { hp: G.HP_REGEN } });
  await Country.updateMany({ status: 'active' }, { $min: { hp: G.HP_MAX } });
  const r = await ranked();
  await N.announce(
    quote(bold('روز ' + fa(n.day) + ' از ' + fa(n.maxDays)), 'تیم‌های باقی‌مانده: ' + mono(fa(r.length))) +
      '\n\n' + r.slice(0, 5).map((x, i) => fa(i + 1) + '. ' + mono(withFlag(x.c.name)) + ' ـ امتیاز ' + mono(fa(x.score))).join('\n')
  );
  return { ok: true, season: n };
}

// حذف یک تیم از بازی
async function eliminate(c, why) {
  const done = await Country.findOneAndUpdate({ _id: c._id, status: 'active' }, { $set: { status: 'destroyed', ownerId: null } });
  if (!done) return false;
  await User.updateMany({ countryId: c._id }, { $set: { countryId: null } });
  await N.announce(quote(bold('تیم حذف شد'), 'کشور: ' + mono(withFlag(c.name)), 'دلیل: ' + why));
  await N.dm(c.ownerId, quote(bold('کشور شما نابود شد و از بازی حذف شدید.'), why));
  await checkWinner();
  return true;
}

async function text() {
  const s = await get();
  if (s.state === 'lobby') return quote(bold('وضعیت فصل'), 'فصل هنوز شروع نشده است.');
  const r = await ranked();
  const board = r.slice(0, 10).map((x, i) => fa(i + 1) + '. ' + mono(withFlag(x.c.name)) + ' ـ امتیاز ' + mono(fa(x.score))).join('\n');
  if (s.state === 'ended') {
    return quote(bold('وضعیت فصل'), 'فصل پایان یافته است.', s.winner ? 'برنده: ' + mono(withFlag(s.winner.name)) : 'برنده‌ای وجود ندارد') + (board ? '\n\n' + board : '');
  }
  return quote(bold('وضعیت فصل'), 'روز ' + mono(fa(s.day) + ' از ' + fa(s.maxDays)), 'تیم‌های باقی‌مانده: ' + mono(fa(r.length))) + '\n\n' + board;
}

module.exports = { get, start, resetAll, finish, checkWinner, advanceDay, eliminate, ranked, text };
