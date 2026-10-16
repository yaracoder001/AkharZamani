"use strict";
// قوانین بازی: منابع، ارتقاء، نیروها، نبرد و پک‌ها
const T = require("./text");
const { Country } = require("./db");
const { fa, mono, bold, quote } = T;

const RES = {
  money: "پول",
  oil: "نفت",
  gold: "طلا",
  gas: "گاز",
  copper: "مس",
  soldiers: "سرباز",
};
const UNITS = {
  tank: "تانک",
  fighter: "جنگنده",
  drone: "پهباد",
  missile: "موشک",
  ship: "ناو",
  sub: "زیردریایی",
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
// رده‌ی کشور: عادی | نظامی ویژه (سرباز ۱۰ برابر) | اقتصادی ویژه (منابع ۵ برابر)
// ضریب‌ها را اینجا عوض کنید. start = ضریب منابع اولیه، income = ضریب درآمد روزانه
const ECO5 = { money: 5, oil: 5, gold: 5, gas: 5, copper: 5 };
const TIERS = {
  normal: { name: "عادی", start: {}, income: {} },
  military: {
    name: "نظامی ویژه",
    start: { soldiers: 10 },
    income: { soldiers: 10 },
  },
  economic: { name: "اقتصادی ویژه", start: ECO5, income: ECO5 },
};
const tierOf = (t) => (TIERS[t] ? t : "normal");
const startRes = (tier) =>
  Object.fromEntries(
    Object.entries(START.res).map(([k, v]) => [
      k,
      v * (TIERS[tierOf(tier)].start[k] || 1),
    ]),
  );
// مازاد منابع اولیه‌ی یک رده نسبت به عادی (برای وقتی کشوری بعدا ویژه می‌شود)
const tierBonus = (tier) => {
  const r = {};
  for (const [k, m] of Object.entries(TIERS[tierOf(tier)].start))
    r[k] = START.res[k] * (m - 1);
  return r;
};

const income = (k, l, tier) =>
  Math.round(
    INCOME[k][1] *
      (1 + 0.6 * (l - 1)) *
      (TIERS[tierOf(tier)].income[INCOME[k][0]] || 1),
  );

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
const shootChance = (c) =>
  clamp(0.15 + 0.07 * c.lv.airDef + 0.005 * c.units.fighter, 0.1, 0.85);

const qty = (c, k) => (k === "soldiers" ? c.res.soldiers : c.units[k]);

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
// جان هر کشور یک عدد ۱۰۰ تایی الکی نیست؛ از سه لایه ساخته می‌شود و حمله‌ی موفق به همین ترتیب آن‌ها را می‌خورد:
//   ۱) پدافندها (هوایی، زمینی، دریایی)  ← هر سطح پدافند DEF_HP موشک جان دارد
//   ۲) نیروها (سرباز، تانک، جنگنده، پهباد، موشک، ناو، زیردریایی) ← هر واحد وزن خودش را دارد
//   ۳) هسته‌ی کشور (hp)  ← HP_MAX = ۱۰۰۰ موشک؛ صفر شدنش یعنی حذف تیم
// هر «۴۰ قدرت حمله» = یک موشک ضربه (POW.missile). همه‌ی این عددها را اینجا می‌توانید عوض کنید.
const HP_MAX = 1000;
const HP_REGEN = 100; // بازسازی روزانه‌ی هسته (۱۰ درصد)
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
const DEF_KEYS = ["airDef", "groundDef", "navalDef"];

const lifeParts = (c) => {
  const defense = DEF_KEYS.reduce((a, k) => a + (c.lv[k] || 0) * DEF_HP, 0);
  const forces = Object.keys(UNIT_HP).reduce(
    (a, k) => a + (qty(c, k) || 0) * UNIT_HP[k],
    0,
  );
  const core = Math.max(0, c.hp);
  return { defense, forces, core, total: defense + forces + core };
};

// ضربه‌ی h موشکی به مدافع: اول پدافندها، بعد نیروها، بعد هسته. نوعِ حمله، هم‌نوع‌ها را زودتر می‌زند.
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
    ...TYPES[type].units,
    ...Object.keys(UNIT_HP).filter((k) => !TYPES[type].units.includes(k)),
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
  left = Math.max(0, left);
  const hpLoss = Math.min(Math.max(0, def.hp), Math.round(left));
  return { lvLoss, unitLoss, hpLoss, hits };
}
const militaryOf = (c) =>
  c.res.soldiers +
  Object.keys(UNITS).reduce((a, k) => a + (c.units[k] || 0), 0);

const makeForce = (c, type, pct) => {
  const f = {};
  for (const k of [...TYPES[type].units, "missile"]) {
    const n = Math.floor((qty(c, k) * pct) / 100);
    if (n > 0) f[k] = n;
  }
  return f;
};
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
    survivors[k] = k === "missile" ? 0 : Math.floor(force[k] * (1 - lossFrac));
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
      "پول، نفت، طلا، گاز و مس را با فاصله بفرستید.\nمثال: " +
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
  "ناو و زیردریایی": {
    ask: "تعداد ناو و زیردریایی را با فاصله بفرستید.\nمثال: " + mono("2 1"),
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
    bold("وضعیت کشور") + " " + c.name,
    "",
    bold("جان کشور (برحسب موشک)"),
    quote(
      "جان کل: " + fa(lifeParts(c).total),
      "پدافندها (اول خورده می‌شوند): " + fa(lifeParts(c).defense),
      "نیروها (بعد از پدافند): " + fa(lifeParts(c).forces),
      "هسته‌ی کشور (آخر): " + fa(lifeParts(c).core) + " از " + fa(HP_MAX),
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
        .map((k) => UNITS[k] + ": " + fa(c.units[k]))
        .join("\n"),
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
        .map((k) => RES[INCOME[k][0]] + ": " + fa(income(k, c.lv[k])))
        .join("\n"),
    ),
  ];
  return l.join("\n");
}

const kindName = (s) =>
  s.kind === "aid" ? "ارسال کمک" : "حمله " + TYPES[s.type].name;

const shipText = (s, min) =>
  quote(bold("اعلان انتقال محموله")) +
  "\n\n" +
  [
    "نوع: " + mono(kindName(s)),
    "مبدا: " + mono(s.fromName),
    "مقصد: " + mono(s.toName),
    "کد رهگیری: " + mono(s.code),
    "زمان تقریبی رسیدن: " + mono(fa(min) + " دقیقه"),
  ].join("\n") +
  "\n\n" +
  quote(
    "برای سرنگونی محموله، از بخش «سرنگونی محموله» در ربات کد رهگیری را ارسال کنید.",
  );

module.exports = {
  RES,
  UNITS,
  LV,
  START,
  INCOME,
  income,
  TIERS,
  tierOf,
  startRes,
  tierBonus,
  MAXLV,
  upCost,
  UNIT_COST,
  TYPES,
  POW,
  SHOOT_COST,
  shootChance,
  makeForce,
  power,
  defPower,
  battle,
  score,
  militaryOf,
  HP_MAX,
  HP_REGEN,
  DEF_HP,
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
