"use strict";
// قوانین بازی: منابع، ارتقاء، نیروها، نبرد و پک‌ها
const T = require("./text");
const { withFlag } = require("./countries");
const { Country } = require("./db");
const { fa, mono, bold, quote } = T;

const RES = {
  money: "💵 پول",
  oil: "🛢️ نفت",
  gold: "🪎 طلا",
  gas: "⛽ گاز",
  copper: "🪨 مس",
  soldiers: "🪖 سرباز",
};
const UNITS = {
  tank: "تانک",
  fighter: "🛩️ جنگنده",
  drone: "✈️ پهباد",
  missile: "✈️ موشک",
  ship: "🚢 ناو",
  sub: "⚓ زیردریایی",
};
const LV = {
  oilMine: "معدن نفت",
  goldMine: "معدن طلا",
  gasMine: "معدن گاز",
  copperMine: "معدن مس",
  barracks: "پادگان (تولید سرباز)",
  bank: "بانک مرکزی (درآمد پول)",
  airDef: "پدافند هوایی",
  groundDef: "پدافند زمینی",
  navalDef: "پدافند دریایی",
};

// شروع بازی
const START = {
  res: {
    money: 5000,
    oil: 300,
    gold: 100,
    gas: 200,
    copper: 200,
    soldiers: 200,
  },
  units: { tank: 0, fighter: 0, drone: 0, missile: 0, ship: 0, sub: 0 },
};

// درآمد روزانه‌ی پایه هر زیرساخت [منبع، مقدار]
const INCOME = {
  oilMine: ["oil", 100],
  goldMine: ["gold", 30],
  gasMine: ["gas", 80],
  copperMine: ["copper", 80],
  barracks: ["soldiers", 60],
  bank: ["money", 1000],
};
// رده‌ی کشور: عادی | نظامی ویژه | اقتصادی ویژه
// start = ضریب منابع اولیه، income = ضریب درآمد روزانه، lv = سطح‌های اضافه‌ی اولیه نسبت به کشور عادی
//   نظامی ویژه: سرباز ۱۰ برابر | هر سه پدافند ۵ سطح بالاتر | پادگان (بخش نظامی) ۲ سطح بالاتر
//   اقتصادی ویژه: پول، نفت، طلا، گاز و مس ۵ برابر (بدون هیچ تغییر دیگر)
// موشک و سایر نیروها برای هیچ رده‌ای اضافه نمی‌شود (عدد MIL_UNITS برای تنظیم دستی است).
const ECO5 = { money: 5, oil: 5, gold: 5, gas: 5, copper: 5 };
const TIERS = {
  normal: { name: "عادی", start: {}, income: {}, lv: {}, units: {} },
  military: {
    name: "نظامی ویژه",
    start: { soldiers: 10 },
    // پادگان ۲ سطح بالاتر درآمد سرباز را ۲٫۲ برابر می‌کند؛ پس ضریب ۴٫۵ یعنی درآمد سرباز در کل حدود ۱۰ برابر عادی
    income: { soldiers: 4.5 },
    lv: { airDef: 5, groundDef: 5, navalDef: 5, barracks: 2 },
    units: {}, // مثال: { missile: 20 }
  },
  economic: { name: "اقتصادی ویژه", start: ECO5, income: ECO5, lv: {}, units: {} },
};
const tierOf = (t) => (TIERS[t] ? t : "normal");
const startRes = (tier) =>
  Object.fromEntries(
    Object.entries(START.res).map(([k, v]) => [
      k,
      v * (TIERS[tierOf(tier)].start[k] || 1),
    ]),
  );
// سطح زیرساخت‌ها در شروع بازی (پایه + اضافه‌ی رده)
const BASE_LV = {
  oilMine: 1, goldMine: 1, gasMine: 1, copperMine: 1,
  barracks: 1, bank: 1, airDef: 1, groundDef: 1, navalDef: 1,
};
const startLv = (tier) => {
  const add = TIERS[tierOf(tier)].lv || {};
  return Object.fromEntries(
    Object.entries(BASE_LV).map(([k, v]) => [k, v + (add[k] || 0)]),
  );
};
const startUnits = (tier) => {
  const add = TIERS[tierOf(tier)].units || {};
  return Object.fromEntries(
    Object.entries(START.units).map(([k, v]) => [k, v + (add[k] || 0)]),
  );
};
// وضعیت کامل اولیه‌ی یک کشور بر اساس رده‌اش (برای ساخت کشور، آزادسازی و شروع فصل)
const freshState = (tier) => ({
  res: startRes(tier),
  units: startUnits(tier),
  lv: startLv(tier),
  lastClaim: new Date(),
  lastStatement: null,
});
// مازاد منابع/سطح/نیروی اولیه‌ی یک رده نسبت به عادی (برای وقتی کشوری بعدا ویژه می‌شود)
const tierBonus = (tier) => {
  const r = {};
  for (const [k, m] of Object.entries(TIERS[tierOf(tier)].start))
    r[k] = START.res[k] * (m - 1);
  return r;
};
const tierBonusLv = (tier) => ({ ...(TIERS[tierOf(tier)].lv || {}) });
const tierBonusUnits = (tier) => ({ ...(TIERS[tierOf(tier)].units || {}) });

// ضریب کلی درآمد روزانه‌ی منابع (پول، نفت، طلا، گاز، مس، سرباز). عدد را بالاتر ببرید تا درآمد بیشتر شود.
const INCOME_MULT = 5;
const income = (k, l, tier) =>
  Math.round(
    INCOME[k][1] *
      INCOME_MULT *
      (1 + 0.6 * (l - 1)) *
      (TIERS[tierOf(tier)].income[INCOME[k][0]] || 1),
  );

// تولید روزانه‌ی تجهیزات نظامی توسط پادگان (پایگاه). هرچه سطح پادگان بالاتر باشد
// هم یگان‌های قوی‌تر باز می‌شوند و هم تعداد روزانه بیشتر می‌شود.
// کلید: [حداقل سطح پادگان برای باز شدن، تعداد روزانه در همان سطح]
// تعداد روزانه = پایه × (۱ + ۰٫۵ × (سطح پادگان − حداقل سطح)) گرد به پایین
const MIL_INCOME = {
  rocket: [1, 3],
  missile: [1, 2],
  drone: [1, 1],
  tank: [1, 1],
  commando: [2, 2],
  lightFighter: [3, 1],
  apc: [3, 1],
  boat: [3, 1],
  cruise: [5, 1],
  fighter: [5, 1],
  attackHeli: [6, 1],
  corvette: [6, 1],
  uav: [7, 1],
  artillery: [8, 1],
  ship: [10, 1],
  sub: [10, 1],
  ballistic: [10, 1],
  bomber: [12, 1],
  heavyTank: [12, 1],
  destroyer: [15, 1],
  stealth: [18, 1],
  hypersonic: [20, 1],
  nuclearSub: [22, 1],
  carrier: [25, 1],
};
const milIncome = (barracksLv) => {
  const o = {};
  for (const [k, [min, base]] of Object.entries(MIL_INCOME)) {
    if (barracksLv >= min) o[k] = Math.floor(base * (1 + 0.5 * (barracksLv - min)));
  }
  return o;
};

// سود روزانه‌ی ویژه‌ی یک کشور (فقط مقادیر مثبت)
const profitOf = (c) => {
  const p = (c && c.profit) || {};
  const o = {};
  for (const k of Object.keys(RES)) if (Number(p[k]) > 0) o[k] = Math.floor(Number(p[k]));
  return o;
};

const MAXLV = 30;
const BASE_COST = {
  oilMine: { money: 1500, copper: 100 },
  goldMine: { money: 2000, copper: 150, oil: 50 },
  gasMine: { money: 1500, copper: 100 },
  copperMine: { money: 1200, gas: 50 },
  barracks: { money: 1500, gold: 20 },
  bank: { money: 2500, gold: 40 },
  airDef: { money: 3000, copper: 200, gas: 100 },
  groundDef: { money: 2500, copper: 150, soldiers: 30 },
  navalDef: { money: 3000, copper: 200, oil: 100 },
};
const scale = (o, f) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.ceil(v * f)]));
const upCost = (k, l) => scale(BASE_COST[k], Math.pow(1.7, Math.max(l - 1, 0)));

const UNIT_COST = {
  tank: { money: 600, copper: 60, gas: 30, soldiers: 5 },
  fighter: { money: 1500, copper: 100, gas: 80, gold: 10 },
  drone: { money: 400, copper: 30, gas: 20 },
  missile: { money: 700, copper: 40, gas: 60 },
  ship: { money: 2500, copper: 200, oil: 150, gold: 20 },
  sub: { money: 2000, copper: 150, oil: 100, gold: 20 },
};

// سه نوع حمله
const TYPES = {
  ground: { name: "زمینی", units: ["soldiers", "tank"], def: "groundDef" },
  air: { name: "هوایی", units: ["fighter", "drone"], def: "airDef" },
  naval: { name: "دریایی", units: ["ship", "sub"], def: "navalDef" },
};
const POW = {
  soldiers: 1,
  tank: 25,
  fighter: 40,
  drone: 12,
  ship: 50,
  sub: 35,
  missile: 40,
};

const SHOOT_COST = { money: 300, gas: 20 };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// جنگنده‌ها در سرنگونی محموله کمک می‌کنند (سبک نصف، رادارگریز دو برابر)
const fighterEq = (c) =>
  qty(c, "fighter") + 0.5 * qty(c, "lightFighter") + 2 * qty(c, "stealth");
const shootChance = (c) =>
  clamp(0.15 + 0.07 * c.lv.airDef + 0.005 * fighterEq(c), 0.1, 0.85);

const qty = (c, k) =>
  (k === "soldiers" ? c.res.soldiers : c.units && c.units[k]) || 0;

// امتیاز تیم برای رتبه‌بندی و تعیین برنده در پایان فصل
const score = (c) =>
  Math.round(
    Object.keys(POW).reduce((s, k) => s + (qty(c, k) || 0) * POW[k], 0) +
      Object.keys(LV).reduce((a, k) => a + (c.lv[k] || 0), 0) * 40 +
      (c.res.money +
        (c.res.oil + c.res.gas + c.res.copper) * 2 +
        c.res.gold * 10) /
        100,
  );
// ---------- جان کشور (واحد: «موشک») ----------
// جان کشور دیگر یک عدد جدا (هسته) نیست؛ فقط از سه بخش ساخته می‌شود:
//   ۱) پدافندها (هوایی، زمینی، دریایی)  ← هر سطح پدافند DEF_HP موشک جان دارد
//   ۲) نیروهای زمینی (سرباز، تانک، کماندو، نفربر، توپخانه، تانک سنگین)
//   ۳) نیروهای دریایی (ناو، زیردریایی، قایق، ناوچه، ناوشکن، زیردریایی هسته‌ای، ناو هواپیمابر)
// حمله‌ی موفق به همین ترتیب این بخش‌ها را می‌خورد (اول پدافندها). وقتی هر سه بخش صفر شد کشور حذف می‌شود.
// جنگنده، پهباد و موشک تجهیزات تهاجمی‌اند و جزو جان کشور حساب نمی‌شوند.
// هر «۴۰ قدرت حمله» = یک موشک ضربه (POW.missile). همه‌ی این عددها را اینجا می‌توانید عوض کنید.
const DEF_HP = 25; // جان هر سطح پدافند
const UNIT_HP = {
  soldiers: 0.02,
  tank: 0.6,
  fighter: 1,
  drone: 0.3,
  missile: 1,
  ship: 1.25,
  sub: 0.9,
};

// ---------- یگان‌های ویژه (پله‌ای: ارزان و ضعیف ← گران و قوی) ----------
// قدرت (pow) = قدرت حمله/دفاع، hp = جان (حدود ۰٫۰۲۵ × قدرت)، cost = هزینه‌ی هر عدد.
// یگان‌های بالا طلا و مس زیادی می‌خواهند تا بازیکن تازه‌کار نتواند همه را بخرد.
// موشک‌ها (گروه missile) در هر سه نوع حمله همراه نیروها می‌روند و بعد از حمله مصرف می‌شوند.
const EXTRA = {
  // --- زمینی ---
  commando: { name: "🥷 کماندو", cat: "ground", pow: 14, hp: 0.35,
    cost: { money: 350, copper: 20, gas: 10, soldiers: 10 } },
  apc: { name: "🚙 نفربر زرهی", cat: "ground", pow: 20, hp: 0.5,
    cost: { money: 500, copper: 40, gas: 20, soldiers: 8 } },
  artillery: { name: "💣 توپخانه", cat: "ground", pow: 45, hp: 1.1,
    cost: { money: 1300, copper: 90, gas: 45, soldiers: 8 } },
  heavyTank: { name: "🛡 تانک سنگین", cat: "ground", pow: 80, hp: 2,
    cost: { money: 2600, copper: 180, gas: 100, gold: 8, soldiers: 10 } },
  // --- هوایی ---
  lightFighter: { name: "🛫 جنگنده سبک", cat: "air", pow: 22, hp: 0.55,
    cost: { money: 800, copper: 60, gas: 40, gold: 3 } },
  attackHeli: { name: "🚁 بالگرد تهاجمی", cat: "air", pow: 30, hp: 0.75,
    cost: { money: 1100, copper: 80, gas: 50 } },
  uav: { name: "🎯 پهپاد رزمی", cat: "air", pow: 28, hp: 0.7,
    cost: { money: 1200, copper: 70, gas: 60, gold: 8 } },
  bomber: { name: "🛩 بمب‌افکن", cat: "air", pow: 75, hp: 1.9,
    cost: { money: 2800, copper: 180, gas: 140, gold: 25 } },
  stealth: { name: "👻 جنگنده رادارگریز", cat: "air", pow: 110, hp: 2.75,
    cost: { money: 6500, copper: 350, gas: 250, gold: 80 } },
  // --- موشک (مصرفی) ---
  rocket: { name: "🧨 راکت", cat: "missile", pow: 15, hp: 0.4,
    cost: { money: 250, copper: 15, gas: 20 } },
  cruise: { name: "🚀 موشک کروز", cat: "missile", pow: 75, hp: 1.9,
    cost: { money: 1300, copper: 80, gas: 110, gold: 6 } },
  ballistic: { name: "☄️ موشک بالستیک", cat: "missile", pow: 140, hp: 3.5,
    cost: { money: 2400, copper: 150, gas: 200, gold: 20 } },
  hypersonic: { name: "⚡ موشک هایپرسونیک", cat: "missile", pow: 300, hp: 7.5,
    cost: { money: 5500, copper: 300, gas: 400, gold: 60 } },
  // --- دریایی ---
  boat: { name: "🚤 قایق تندرو", cat: "naval", pow: 14, hp: 0.35,
    cost: { money: 700, copper: 50, oil: 40 } },
  corvette: { name: "⛴ ناوچه", cat: "naval", pow: 30, hp: 0.75,
    cost: { money: 1500, copper: 110, oil: 80, gold: 8 } },
  destroyer: { name: "🚢 ناوشکن", cat: "naval", pow: 85, hp: 2.1,
    cost: { money: 4200, copper: 280, oil: 200, gold: 35 } },
  nuclearSub: { name: "☢️ زیردریایی هسته‌ای", cat: "naval", pow: 130, hp: 3.25,
    cost: { money: 7000, copper: 400, oil: 300, gold: 90 } },
  carrier: { name: "⚓ ناو هواپیمابر", cat: "naval", pow: 220, hp: 5.5,
    cost: { money: 12000, copper: 700, oil: 500, gold: 150 } },
};
const GROUP_NAME = {
  base: "نیروهای پایه",
  ground: "زمینی ویژه",
  air: "هوایی ویژه",
  missile: "موشک‌ها",
  naval: "دریایی ویژه",
};
// کلید موشک‌ها (مصرفی؛ در هر حمله‌ای همراه می‌روند)
const MISSILE_KEYS = ["missile"];
const UNIT_GROUP = {};
for (const k of Object.keys(UNIT_COST)) UNIT_GROUP[k] = "base";
for (const [k, e] of Object.entries(EXTRA)) {
  UNITS[k] = e.name;
  UNIT_COST[k] = e.cost;
  POW[k] = e.pow;
  UNIT_HP[k] = e.hp;
  START.units[k] = 0;
  UNIT_GROUP[k] = e.cat;
  if (e.cat === "missile") MISSILE_KEYS.push(k);
  else TYPES[e.cat].units.push(k);
}
const EXTRA_KEYS = Object.keys(EXTRA);
const isMissile = (k) => MISSILE_KEYS.includes(k);
const DEF_KEYS = ["airDef", "groundDef", "navalDef"];

// یگان‌هایی که جزو جان کشورند (زمینی + دریایی)
const LIFE_UNITS = [...TYPES.ground.units, ...TYPES.naval.units];
const groupHp = (c, keys) =>
  keys.reduce((a, k) => a + (qty(c, k) || 0) * (UNIT_HP[k] || 0), 0);

const lifeParts = (c) => {
  const defense = DEF_KEYS.reduce((a, k) => a + (c.lv[k] || 0) * DEF_HP, 0);
  const ground = groupHp(c, TYPES.ground.units);
  const naval = groupHp(c, TYPES.naval.units);
  return { defense, ground, naval, total: defense + ground + naval };
};

// ضربه‌ی h موشکی به مدافع: اول پدافندها، بعد نیروهای زمینی و دریایی. نوعِ حمله، هم‌نوع‌ها را زودتر می‌زند.
function absorb(def, hits, type) {
  let left = Math.max(0, hits);
  const lvLoss = {};
  const unitLoss = {};
  const own = TYPES[type].def;
  for (const k of [own, ...DEF_KEYS.filter((x) => x !== own)]) {
    if (left <= 0) break;
    const take = Math.min(def.lv[k] || 0, Math.floor(left / DEF_HP));
    if (take > 0) {
      lvLoss[k] = take;
      left -= take * DEF_HP;
    }
  }
  left = Math.max(0, left);
  const order = [
    ...TYPES[type].units.filter((k) => LIFE_UNITS.includes(k)),
    ...LIFE_UNITS.filter((k) => !TYPES[type].units.includes(k)),
  ];
  for (const k of order) {
    if (left <= 0) break;
    const have = qty(def, k) || 0;
    const n = Math.min(have, Math.floor(left / UNIT_HP[k]));
    if (n > 0) {
      unitLoss[k] = n;
      left -= n * UNIT_HP[k];
    }
  }
  return { lvLoss, unitLoss, hits };
}
const militaryOf = (c) =>
  c.res.soldiers +
  Object.keys(UNITS).reduce((a, k) => a + (c.units[k] || 0), 0);

const makeForce = (c, type, pct) => {
  const f = {};
  for (const k of [...TYPES[type].units, ...MISSILE_KEYS]) {
    const n = Math.floor((qty(c, k) * pct) / 100);
    if (n > 0) f[k] = n;
  }
  return f;
};

// ---------- نمایش نیروهای حمله (کل / ارسالی) ----------
const unitName = (k) => (k === "soldiers" ? RES.soldiers : UNITS[k]);
const attackKeys = (type) => [...TYPES[type].units, ...MISSILE_KEYS];
// فقط نیروهایی که کشور واقعاً دارد (تا پیام با ۲۴ نوع نیرو شلوغ نشود)
const ownedKeys = (c, type) => attackKeys(type).filter((k) => qty(c, k) > 0);
const NONE = "نیرویی ندارید.";
// کل نیروهای قابل استفاده در این نوع حمله
const totalForceText = (c, type) =>
  bold("کل نیروهای " + TYPES[type].name + " شما") +
  "\n" +
  (ownedKeys(c, type)
    .map((k) => unitName(k) + ": " + mono(fa(qty(c, k))))
    .join("\n") || NONE);
// پیش‌نمایش درصدها: «ارسالی از کل» برای هر نیرو
const previewText = (c, type, pcts) =>
  pcts
    .map(
      (pct) =>
        bold(fa(pct) + " درصد") +
        "\n" +
        (ownedKeys(c, type)
          .map(
            (k) =>
              unitName(k) +
              ": " +
              mono(fa(Math.floor((qty(c, k) * pct) / 100))) +
              " از " +
              mono(fa(qty(c, k))),
          )
          .join("\n") || NONE),
    )
    .join("\n\n");
// نیروی ارسال‌شده از کل (بعد از ارسال)
const sentForceText = (c, type, force) =>
  ownedKeys(c, type)
    .map(
      (k) =>
        unitName(k) +
        ": " +
        mono(fa(force[k] || 0)) +
        " از " +
        mono(fa(qty(c, k) || 0)),
    )
    .join("\n");
const power = (f) => Object.entries(f).reduce((s, [k, n]) => s + n * POW[k], 0);
const defPower = (c, type) => {
  const L = c.lv[TYPES[type].def];
  return (
    TYPES[type].units.reduce((s, k) => s + qty(c, k) * POW[k], 0) *
      (1 + 0.15 * L) +
    L * 30
  );
};

// نتیجه‌ی نبرد
function battle(force, type, def) {
  const atk = power(force);
  const dp = defPower(def, type);
  const a = atk * (0.9 + Math.random() * 0.2);
  const d = dp * (0.9 + Math.random() * 0.2);
  const win = a > d;
  const lossFrac = win ? clamp((d / a) * 0.4, 0.05, 0.6) : 0.7;
  const survivors = {};
  for (const k of Object.keys(force))
    survivors[k] = isMissile(k) ? 0 : Math.floor(force[k] * (1 - lossFrac));
  // حمله‌ی ناموفق: مدافع فقط کمی نیرو از دست می‌دهد
  const defFrac = clamp((a / Math.max(d, 1)) * 0.2, 0.03, 0.3);
  const defLoss = {};
  if (!win)
    for (const k of TYPES[type].units)
      defLoss[k] = Math.floor(qty(def, k) * defFrac);
  // حمله‌ی موفق: ضربه‌ها لایه‌به‌لایه می‌خورند (پدافند ← نیرو ← هسته)
  const hits = win ? Math.max(1, Math.round(a / POW.missile)) : 0;
  const hit = win ? absorb(def, hits, type) : null;
  const loot = {};
  if (win)
    for (const r of ["money", "oil", "gold", "gas", "copper"])
      loot[r] = Math.floor(def.res[r] * 0.2);
  return { win, atk, dp, survivors, defLoss, loot, hits, hit };
}

// مسیرهای $inc
const forceDelta = (f, sign) => {
  const d = {};
  for (const [k, n] of Object.entries(f))
    if (n) d[(k === "soldiers" ? "res." : "units.") + k] = sign * n;
  return d;
};
const neg = (cost) =>
  Object.fromEntries(Object.entries(cost).map(([k, v]) => ["res." + k, -v]));
const pos = (res) =>
  Object.fromEntries(Object.entries(res).map(([k, v]) => ["res." + k, v]));
const times = (cost, n) =>
  Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, v * n]));

// تغییر اتمیک موجودی؛ اگر موجودی کافی نباشد null برمی‌گرداند
async function change(id, delta, guards = {}, force = false) {
  const q = { _id: id, ...guards };
  const inc = {};
  for (const [p, v] of Object.entries(delta)) {
    if (!v) continue;
    inc[p] = v;
    if (!force && v < 0) q[p] = { $gte: -v };
  }
  if (!Object.keys(inc).length) return Country.findById(id);
  return Country.findOneAndUpdate(q, { $inc: inc }, { new: true });
}

// ---------- بسته‌ها (پک / هدیه) ----------
const bundleDelta = (b) => {
  const d = {};
  for (const [k, v] of Object.entries(b.res || {})) d["res." + k] = v;
  for (const [k, v] of Object.entries(b.units || {})) d["units." + k] = v;
  for (const [k, v] of Object.entries(b.levels || {})) d["lv." + k] = v;
  return d;
};
const merge = (a, b) => {
  const o = {
    res: { ...a.res },
    units: { ...a.units },
    levels: { ...a.levels },
  };
  for (const g of ["res", "units", "levels"])
    for (const [k, v] of Object.entries(b[g] || {}))
      o[g][k] = (o[g][k] || 0) + v;
  return o;
};
const describeBundle = (b) => {
  const l = [];
  for (const [k, v] of Object.entries(b.res || {}))
    l.push(RES[k] + ": " + mono(fa(v)));
  for (const [k, v] of Object.entries(b.units || {}))
    l.push(UNITS[k] + ": " + mono(fa(v)));
  for (const [k, v] of Object.entries(b.levels || {}))
    l.push(LV[k] + ": " + mono("+" + fa(v) + " سطح"));
  return l.join("\n");
};
const costText = (cost) =>
  Object.entries(cost)
    .map(([k, v]) => RES[k] + " " + mono(fa(v)))
    .join("، ");

// بخش‌هایی که مدیریت هنگام ساخت پک/هدیه از آن‌ها می‌پرسد
const single = (group, key, ask) => ({
  ask,
  parse: (s) => {
    const n = Math.floor(T.nums(s)[0] || 0);
    return n > 0 ? { [group]: { [key]: n } } : null;
  },
});
const LV_WORDS = [
  ["نفت", "oilMine"],
  ["طلا", "goldMine"],
  ["مس", "copperMine"],
  ["گاز", "gasMine"],
  ["بانک", "bank"],
  ["پادگان", "barracks"],
  ["پدافند هوایی", "airDef"],
  ["هوایی", "airDef"],
  ["پدافند زمینی", "groundDef"],
  ["زمینی", "groundDef"],
  ["پدافند دریایی", "navalDef"],
  ["دریایی", "navalDef"],
];
const CATS = {
  منابع: {
    ask:
      "پول نفت طلا گاز مس (با فاصله):\nمثال: " +
      mono("1000 50 20 30 30"),
    parse: (s) => {
      const n = T.nums(s);
      if (n.length < 5) return null;
      const r = {};
      ["money", "oil", "gold", "gas", "copper"].forEach((k, i) => {
        if (n[i] > 0) r[k] = Math.floor(n[i]);
      });
      return Object.keys(r).length ? { res: r } : null;
    },
  },
  "ارتقاء سطح": {
    ask:
      "نام زیرساخت و تعداد سطح را بفرستید.\nمثال: " +
      mono("نفت 2 پدافند هوایی 1 بانک 3"),
    parse: (s) => {
      const x = T.en(s);
      const r = {};
      for (const [w, k] of LV_WORDS) {
        const m = x.match(new RegExp(w + "\\s*(\\d+)"));
        if (m && !r[k]) r[k] = +m[1];
      }
      return Object.keys(r).length ? { levels: r } : null;
    },
  },
  سرباز: single("res", "soldiers", "تعداد سرباز را بفرستید."),
  جنگنده: single("units", "fighter", "تعداد جنگنده را بفرستید."),
  موشک: single("units", "missile", "تعداد موشک را بفرستید."),
  پهباد: single("units", "drone", "تعداد پهباد را بفرستید."),
  "نیروی زمینی": single("units", "tank", "تعداد تانک را بفرستید."),
  "نیروی ویژه": {
    ask: () =>
      "شماره‌ی نیرو و تعداد را بفرستید (همان شماره‌های «خرید نیرو»).\nمثال: " +
      mono("7 5") +
      "\n\n" +
      Object.keys(UNIT_COST)
        .map((k, i) => (EXTRA[k] ? fa(i + 1) + ". " + UNITS[k] : null))
        .filter(Boolean)
        .join("\n"),
    parse: (s) => {
      const n = T.nums(s);
      const k = Object.keys(UNIT_COST)[(n[0] || 0) - 1];
      const q = Math.floor(n[1] || 0);
      return k && EXTRA[k] && q > 0 ? { units: { [k]: q } } : null;
    },
  },
  "ناو و زیردریایی": {
    ask: "ناو و زیردریایی (با فاصله):\nمثال: " + mono("2 1"),
    parse: (s) => {
      const n = T.nums(s);
      if (n.length < 2) return null;
      const u = {};
      if (n[0] > 0) u.ship = Math.floor(n[0]);
      if (n[1] > 0) u.sub = Math.floor(n[1]);
      return Object.keys(u).length ? { units: u } : null;
    },
  },
};

// ---------- متن‌ها ----------
function statusText(c) {
  const l = [
    bold("وضعیت کشور") + " " + withFlag(c.name),
    "",
    bold("قدرت کشور (برحسب موشک)"),
    quote(
      "کل: " + fa(lifeParts(c).total),
      "پدافندها (اول خورده می‌شوند): " + fa(lifeParts(c).defense),
      "نیروهای زمینی: " + fa(lifeParts(c).ground),
      "نیروهای دریایی: " + fa(lifeParts(c).naval),
    ),
    "",
    bold("منابع"),
    quote(
      Object.keys(RES)
        .map((k) => RES[k] + ": " + fa(c.res[k]))
        .join("\n"),
    ),
    "",
    bold("نیروها"),
    quote(
      Object.keys(UNITS)
        .filter((k) => qty(c, k) > 0)
        .map((k) => UNITS[k] + ": " + fa(qty(c, k)))
        .join("\n") || "هنوز نیرویی ندارید.",
    ),
    "",
    bold("زیرساخت‌ها"),
    quote(
      Object.keys(LV)
        .map((k) => LV[k] + ": سطح " + fa(c.lv[k]))
        .join("\n"),
    ),
    "",
    bold("درآمد روزانه"),
    quote(
      Object.keys(INCOME)
        .map((k) => RES[INCOME[k][0]] + ": " + fa(income(k, c.lv[k], c.tier)))
        .join("\n"),
    ),
  ];
  const mi = milIncome(c.lv.barracks);
  if (Object.keys(mi).length)
    l.push("", bold("تجهیزات روزانه‌ی پادگان"), quote(describeBundle({ units: mi })));
  const pf = profitOf(c);
  if (Object.keys(pf).length)
    l.push("", bold("سود روزانه‌ی ویژه"), quote(describeBundle({ res: pf })));
  return l.join("\n");
}

const kindName = (s) =>
  s.kind === "aid" ? "ارسال کمک" : "حمله " + TYPES[s.type].name;

const shipText = (s, min) =>
  quote(bold("اعلان انتقال محموله")) +
  "\n\n" +
  [
    "نوع: " + mono(kindName(s)),
    "مبدا: " + mono(withFlag(s.fromName)),
    "مقصد: " + mono(withFlag(s.toName)),
    "کد رهگیری: " + mono(s.code),
    "زمان تقریبی رسیدن: " + mono(fa(min) + " دقیقه"),
  ].join("\n") +
  "\n\n" +
  quote(
    "سرنگونی: کد رهگیری را در بخش «سرنگونی محموله» بفرستید.",
  );

module.exports = {
  RES,
  UNITS,
  LV,
  START,
  INCOME,
  income,
  profitOf,
  TIERS,
  tierOf,
  startRes,
  tierBonus,
  tierBonusLv,
  tierBonusUnits,
  BASE_LV,
  startLv,
  startUnits,
  freshState,
  MAXLV,
  upCost,
  UNIT_COST,
  EXTRA,
  UNIT_GROUP,
  GROUP_NAME,
  MISSILE_KEYS,
  TYPES,
  POW,
  SHOOT_COST,
  shootChance,
  makeForce,
  totalForceText,
  previewText,
  sentForceText,
  power,
  defPower,
  battle,
  score,
  militaryOf,
  DEF_HP,
  LIFE_UNITS,
  INCOME_MULT,
  MIL_INCOME,
  milIncome,
  UNIT_HP,
  DEF_KEYS,
  lifeParts,
  absorb,
  forceDelta,
  neg,
  pos,
  times,
  change,
  bundleDelta,
  merge,
  describeBundle,
  costText,
  CATS,
  statusText,
  kindName,
  shipText,
};
