'use strict';
// رسیدن محموله‌ها: هر چند ثانیه محموله‌های سررسیده بررسی می‌شوند
const { Country, Shipment } = require('./db');
const G = require('./game');
const N = require('./notify');
const S = require('./season');
const cfg = require('./config');
const T = require('./text');
const Gate = require('./gate');
const { fa, mono, bold, quote } = T;

async function refund(s) {
  const d = s.kind === 'aid' ? G.pos(s.payload.res || {}) : G.forceDelta(s.payload.force || {}, 1);
  await G.change(s.fromId, d, {}, true);
}

// خلاصه‌ی خسارت لایه‌ای برای مدافع
function lossText(h) {
  const l = [];
  if (Object.keys(h.lvLoss).length) l.push('پدافند از دست رفته:\n' + G.describeBundle({ levels: h.lvLoss }).replace(/\+/g, '-'));
  if (Object.keys(h.unitLoss).length) l.push('نیروی از دست رفته:\n' + G.describeBundle({ units: h.unitLoss }));
  return l.length ? '\n' + l.join('\n') : '';
}

async function land(s) {
  const from = await Country.findById(s.fromId);
  const to = await Country.findById(s.toId);
  const ownerOf = (c) => c && c.ownerId;

  if (!to || to.status !== 'active' || !to.ownerId) {
    await refund(s);
    await Shipment.updateOne({ _id: s._id }, { $set: { status: 'returned' } });
    await N.dm(ownerOf(from), quote('محموله ' + mono(s.code) + ' به مقصد نرسید و به کشور شما بازگشت.'));
    return;
  }

  if (s.kind === 'aid') {
    await G.change(to._id, G.pos(s.payload.res), {}, true);
    await Shipment.updateOne({ _id: s._id }, { $set: { status: 'delivered' } });
    // ۵ دقیقه بعد، محموله‌ی سالم رسیده با عکس در کانال اعلام می‌شود
    await N.announce(
      bold('محموله سالم به مقصد رسید') +
        '\n\nکد رهگیری: ' + mono(s.code) +
        '\nمبدا: ' + mono(s.fromName) +
        '\nمقصد: ' + mono(s.toName),
      'delivered'
    );
    await N.dm(to.ownerId, quote('محموله کمکی از ' + mono(s.fromName) + ' رسید.') + '\n' + G.describeBundle({ res: s.payload.res }));
    await N.dm(ownerOf(from), quote('محموله ' + mono(s.code) + ' به ' + mono(s.toName) + ' تحویل شد.'));
    return;
  }

  // حمله
  const r = G.battle(s.payload.force, s.type, to);
  const back = G.forceDelta(r.survivors, 1);
  for (const [k, v] of Object.entries(r.loot)) if (v) back['res.' + k] = (back['res.' + k] || 0) + v;
  await G.change(s.fromId, back, {}, true);

  // خسارت به مدافع: حمله‌ی موفق لایه‌به‌لایه می‌خورد (پدافند ← نیرو ← هسته)، ناموفق فقط کمی نیرو می‌گیرد
  const loss = G.forceDelta(r.win ? r.hit.unitLoss : r.defLoss, -1);
  if (r.win) {
    for (const [k, v] of Object.entries(r.hit.lvLoss)) if (v) loss['lv.' + k] = -v;
    if (r.hit.hpLoss) loss.hp = -r.hit.hpLoss;
  }
  for (const [k, v] of Object.entries(r.loot)) if (v) loss['res.' + k] = (loss['res.' + k] || 0) - v;
  const after = await G.change(to._id, loss, {}, true);
  const hpLeft = Math.max(0, after ? after.hp : 0);
  const lifeLeft = after ? G.lifeParts(after).total : 0;

  await Shipment.updateOne({ _id: s._id }, { $set: { status: 'delivered' } });

  const tname = G.TYPES[s.type].name;
  await N.announce(
    quote(bold('نتیجه نبرد ' + tname)) +
      '\n\nحمله‌کننده: ' + mono(s.fromName) +
      '\nمدافع: ' + mono(s.toName) +
      '\nپیروز: ' + mono(r.win ? s.fromName : s.toName) +
      (r.win ? '\nضربه‌ی واردشده: ' + mono(fa(r.hits) + ' موشک') : '') +
      (r.win ? '\nجان باقی‌مانده‌ی مدافع: ' + mono(fa(lifeLeft) + ' موشک') : '') +
      '\nکد رهگیری: ' + mono(s.code),
    'attack_' + s.type
  );

  const lootTxt = Object.keys(r.loot).length ? '\nغنایم:\n' + G.describeBundle({ res: r.loot }) : '';
  await N.dm(
    ownerOf(from),
    quote(bold(r.win ? 'پیروزی در حمله ' + tname : 'شکست در حمله ' + tname), 'هدف: ' + s.toName) +
      '\nنیروهای بازگشتی:\n' + (G.describeBundle({ units: r.survivors, res: {} }) || mono('هیچ')) + lootTxt
  );
  await N.dm(
    to.ownerId,
    quote(bold(r.win ? 'کشور شما مورد حمله ' + tname + ' قرار گرفت و شکست خورد' : 'حمله ' + tname + ' دفع شد'), 'مهاجم: ' + s.fromName) +
      (r.win ? '\nهسته‌ی کشور: ' + mono(fa(hpLeft) + ' از ' + fa(G.HP_MAX)) + '\nجان کل: ' + mono(fa(lifeLeft) + ' موشک') : '') +
      (r.win ? lossText(r.hit) : '') +
      lootTxt.replace('غنایم', 'منابع از دست رفته')
  );

  // حذف تیم: سلامت کشور به صفر برسد
  if (r.win && after && after.hp <= 0) {
    const se = await S.get();
    if (se.state === 'running') await S.eliminate(after, 'سلامت کشور در حمله ' + tname + ' از ' + s.fromName + ' به صفر رسید');
  }
}

async function autoDay() {
  if (!(cfg.dayHours > 0)) return;
  const se = await S.get();
  if (se.state === 'running' && se.dayStart && Date.now() - se.dayStart >= cfg.dayHours * 3600000) await S.advanceDay();
}

async function tick() {
  await autoDay().catch((e) => console.error('[day]', e.message));
  // اگر تابع وسط رسیدن محموله متوقف شده باشد (مثلا timeout در Vercel)، محموله دوباره بررسی می‌شود
  // وقتی بازی بسته است (توقف دستی یا خارج از ساعت خودکار) محموله‌ها نمی‌رسند؛ بعد از باز شدن می‌رسند
  if (!(await Gate.isOpen().catch(() => true))) return;
  await Shipment.updateMany({ status: 'landing', updatedAt: { $lt: new Date(Date.now() - 120000) } }, { $set: { status: 'flying' } }).catch(() => {});
  const due = await Shipment.find({ status: 'flying', arriveAt: { $lte: new Date() } }).limit(20);
  for (const s of due) {
    const l = await Shipment.findOneAndUpdate({ _id: s._id, status: 'flying' }, { $set: { status: 'landing' } }, { new: true });
    if (!l) continue;
    try {
      await land(l);
    } catch (e) {
      console.error('[land]', e);
    }
  }
}

function start() {
  setInterval(() => tick().catch((e) => console.error('[tick]', e.message)), 10000);
}

module.exports = { start, tick };
