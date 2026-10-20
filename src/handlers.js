"use strict";
const crypto = require("crypto");
const cfg = require("./config");
const rb = require("./rubika");
const T = require("./text");
const G = require("./game");
const N = require("./notify");
const S = require("./season");
const Gate = require("./gate");
const { COUNTRIES, withFlag } = require("./countries");
const M = require("./menus");
const { User, Country, Pack, Order, Shipment, Setting } = require("./db");
const { fa, mono, bold, quote } = T;

// ---------- ابزارها ----------
const H = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const eq = (a, b) =>
  crypto.timingSafeEqual(Buffer.from(H(a)), Buffer.from(H(b)));
const gen = (n = 6) => {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (const b of crypto.randomBytes(n)) s += A[b % A.length];
  return s;
};

const routes = {};
const steps = {};
const R = (name, fn) => {
  routes[T.norm(name)] = fn;
};

const setState = async (u, step, data = {}) => {
  u.state = step ? { step, data } : {};
  await User.updateOne({ _id: u._id }, { $set: { state: u.state } });
};
const menuFor = (u) =>
  u.isOwner ? M.owner : u.isAdmin ? M.admin : u.countryId ? M.player : M.guest;
const say = (u, text, rows) => rb.send(u.chatId, text, rows || menuFor(u));
const askK = async (u, step, text, rows, data) => {
  await setState(u, step, data);
  return rb.send(u.chatId, text, rows);
};
const ask = (u, step, text, data) => askK(u, step, text, M.back, data);
const home = async (u, text) => {
  await setState(u, null);
  return say(u, text || quote("منوی اصلی"));
};

async function getC(u) {
  const c = u.countryId && (await Country.findById(u.countryId));
  if (c && c.status === "active" && c.ownerId === u.userId) return c;
  if (u.countryId) {
    u.countryId = null;
    await User.updateOne({ _id: u._id }, { $set: { countryId: null } });
  }
  await home(u, quote("کشوری به حساب شما متصل نیست."));
  return null;
}

const deny = (u) => say(u, quote("شما به این بخش دسترسی ندارید."));
const O = (f) => (u, t, m) => (u.isOwner ? f(u, t, m) : deny(u));
const A = (f) => (u, t, m) => (u.isOwner || u.isAdmin ? f(u, t, m) : deny(u));
const P = (f) => async (u, t, m) => {
  const c = await getC(u);
  return c ? f(u, c, t, m) : null;
};

async function refreshProfile(u) {
  const r = await rb.getChat(u.chatId);
  const ch = r.data && r.data.chat;
  if (!ch) return;
  u.name =
    T.safe([ch.first_name, ch.last_name].filter(Boolean).join(" ")).slice(
      0,
      60,
    ) || u.name;
  u.username = T.usernameOk(ch.username) ? ch.username : null;
  await User.updateOne(
    { _id: u._id },
    { $set: { name: u.name, username: u.username } },
  );
}

// ---------- انتخاب کشور: «تایپی» یا «انتخاب از لیست» ----------
// با ۱۰۰ کشور، هر بخشی که نام کشور می‌خواهد دو حالت دارد: نام را تایپ کنید، یا از کیبوردِ لیست (صفحه‌به‌صفحه) بزنید.
const PAGE = 12;
const pickActs = {};
// نام کشور از متن کاربر یا دکمه (با پرچم یا بدون پرچم)
const findByName = async (query, t) =>
  (await Country.findOne({ ...query, name: T.norm(t) })) ||
  (await Country.findOne({ ...query, name: T.noEmoji(t) }));
const LEVEL = { O: O, A: A, P: P };
const can = (u, lv) =>
  lv === "O" ? u.isOwner : lv === "A" ? u.isOwner || u.isAdmin : !!u.countryId;

// act: شناسه‌ی عملیات | label: نام دکمه‌ی منو | level: O مدیریت اصلی، A ادمین یا مدیریت، P بازیکن
// filter(u, mine): شرط پیدا کردن کشورهای قابل انتخاب | pre(u, mine): پیام مسدودکننده (اختیاری)
// then(u, target, mine): کار بعد از انتخاب
function PICK(act, label, { level, title, filter, pre, then }) {
  pickActs[act] = { level, title, filter, pre, then };
  R(
    label,
    LEVEL[level](async (...a) => {
      const u = a[0];
      const mine = level === "P" ? a[1] : null;
      if (pre) {
        const blk = await pre(u, mine);
        if (blk) return say(u, blk);
      }
      return askK(
        u,
        "pick_mode",
        quote(title, "روش انتخاب کشور را بزنید."),
        M.pickMode,
        { act },
      );
    }),
  );
}

async function pickCtx(u) {
  const d = (u.state && u.state.data) || {};
  const a = pickActs[d.act];
  if (!a || !can(u, a.level)) {
    await home(u, quote("گزینه نامعتبر است."));
    return null;
  }
  const mine = a.level === "P" ? await getC(u) : null;
  if (a.level === "P" && !mine) return null;
  const query = a.filter ? await a.filter(u, mine) : {};
  return { d, a, mine, query };
}

async function showPickList(u, ctx, page) {
  const names = (
    await Country.find(ctx.query).sort({ createdAt: 1 }).limit(300)
  ).map((c) => c.name);
  if (!names.length) return home(u, quote("کشوری برای انتخاب وجود ندارد."));
  const pages = Math.ceil(names.length / PAGE);
  const pg = Math.min(Math.max(0, page), pages - 1);
  const slice = names.slice(pg * PAGE, pg * PAGE + PAGE).map(withFlag);
  const rows = [];
  for (let i = 0; i < slice.length; i += 3) rows.push(slice.slice(i, i + 3));
  const nav = [];
  if (pg > 0) nav.push(M.NAV.prev);
  if (pg < pages - 1) nav.push(M.NAV.next);
  if (nav.length) rows.push(nav);
  rows.push(["↩️ بازگشت"]);
  return askK(
    u,
    "pick_list",
    quote(
      bold(ctx.a.title),
      "یکی از کشورها را بزنید.",
      "صفحه " +
        fa(pg + 1) +
        " از " +
        fa(pages) +
        " ـ " +
        fa(names.length) +
        " کشور",
    ),
    rows,
    { act: ctx.d.act, page: pg },
  );
}

async function pickDone(u, ctx, c) {
  return ctx.a.then(u, c, ctx.mine);
}

steps.pick_mode = async (u, t) => {
  const ctx = await pickCtx(u);
  if (!ctx) return;
  if (t === "تایپی")
    return askK(
      u,
      "pick_type",
      quote(bold(ctx.a.title), "نام کشور را تایپ کنید."),
      M.back,
      { act: ctx.d.act },
    );
  if (t === "انتخاب از لیست") return showPickList(u, ctx, 0);
  return askK(
    u,
    "pick_mode",
    quote("یکی از گزینه‌ها را انتخاب کنید."),
    M.pickMode,
    { act: ctx.d.act },
  );
};
steps.pick_type = async (u, t) => {
  const ctx = await pickCtx(u);
  if (!ctx) return;
  const c = await findByName(ctx.query, t);
  if (!c)
    return askK(
      u,
      "pick_type",
      quote("کشوری با این نام پیدا نشد. دوباره تایپ کنید."),
      M.back,
      { act: ctx.d.act },
    );
  return pickDone(u, ctx, c);
};
steps.pick_list = async (u, t) => {
  const ctx = await pickCtx(u);
  if (!ctx) return;
  const pg = Number(ctx.d.page) || 0;
  if (t === "صفحه بعد") return showPickList(u, ctx, pg + 1);
  if (t === "صفحه قبل") return showPickList(u, ctx, pg - 1);
  const c = await findByName(ctx.query, t);
  if (!c) return showPickList(u, ctx, pg);
  return pickDone(u, ctx, c);
};

// ---------- عمومی ----------
const HELP = [
  quote(bold("راهنما")),
  "",
  "درآمد: هر روز جمع می‌شود (تا ۲۴ ساعت ذخیره). پادگان هر روز موشک، جنگنده و تجهیزات نظامی هم تولید می‌کند و هرچه سطحش بالاتر باشد، تجهیزات قوی‌تر و بیشتری می‌دهد.",
  "ارتقاء: معادن، پادگان، بانک، پدافند.",
  "نیرو: تانک، جنگنده، پهباد، موشک، ناو، زیردریایی.",
  "حمله: زمینی، هوایی، دریایی (فقط در زمان فصل).",
  "محموله: کمک یا حمله؛ " +
    fa(cfg.travelMin) +
    " دقیقه در راه است و با کد رهگیری قابل سرنگونی است.",
  "",
  "قدرت کشور: پدافندها، نیروهای زمینی و نیروهای دریایی. اگر هر سه نابود شوند کشور حذف می‌شود.",
  "فصل " +
    fa(cfg.seasonDays) +
    " روزه است؛ آخرین تیم یا قوی‌ترین تیم برنده است.",
].join("\n");

R("راهنما", (u) => say(u, HELP));
R("شناسه من", (u) => say(u, quote("شناسه شما") + "\n" + mono(u.userId)));

R("ورود به کشور", (u) => ask(u, "code", quote("کد کشور را ارسال کنید.")));
steps.code = async (u, t) => {
  const c = await Country.findOne({
    code: t.replace(/\s/g, "").toUpperCase(),
    status: "active",
  });
  if (!c) return ask(u, "code", quote("کد نامعتبر است. دوباره ارسال کنید."));
  if (c.ownerId && c.ownerId !== u.userId)
    return ask(u, "code", quote("این کشور برای کاربر دیگری است."));
  if (u.countryId && String(u.countryId) !== String(c._id))
    return home(u, quote("شما از قبل یک کشور دارید."));
  const ok = await Country.findOneAndUpdate(
    { _id: c._id, ownerId: { $in: [null, u.userId] } },
    {
      $set: {
        ownerId: u.userId,
        ...(c.ownerId ? {} : { lastClaim: new Date() }),
      },
    },
    { new: true },
  );
  if (!ok) return ask(u, "code", quote("این کشور برای کاربر دیگری است."));
  u.countryId = ok._id;
  await User.updateOne({ _id: u._id }, { $set: { countryId: ok._id } });
  return home(
    u,
    quote(
      bold("خوش آمدید"),
      "شما اکنون مدیر کشور " + mono(ok.name) + " هستید.",
    ) +
      "\n\n" +
      G.statusText(ok),
  );
};

// ---------- ورود به پنل‌ها ----------
R("ورود به پنل", (u) =>
  say(u, quote("نوع پنل را انتخاب کنید."), M.panelChoice),
);
R("ورود مدیریت اصلی", (u) =>
  ask(u, "pw_owner", quote("رمز مدیریت اصلی را ارسال کنید.")),
);
R("ورود ادمین", (u) => ask(u, "pw_admin", quote("رمز ادمین را ارسال کنید.")));

// قفل ورود در دیتابیس نگه داشته می‌شود (در Vercel حافظه‌ی پایدار نداریم)
async function login(u, m, role) {
  await rb.deleteMessage(u.chatId, m.message_id).catch(() => {});
  if ((u.pwLock || 0) > Date.now())
    return home(u, quote("تلاش زیاد؛ کمی بعد امتحان کنید."));
  const pass = role === "owner" ? cfg.ownerPass : cfg.adminPass;
  if (!eq(String(m.text || "").trim(), pass)) {
    const n = (u.pwFails || 0) + 1;
    if (n >= 5) {
      u.pwFails = 0;
      u.pwLock = Date.now() + 600000;
      await User.updateOne(
        { _id: u._id },
        { $set: { pwFails: 0, pwLock: u.pwLock } },
      );
      return home(u, quote("تلاش زیاد؛ ۱۰ دقیقه بعد امتحان کنید."));
    }
    u.pwFails = n;
    await User.updateOne({ _id: u._id }, { $set: { pwFails: n } });
    return ask(u, "pw_" + role, quote("رمز نادرست است."));
  }
  if (u.pwFails) await User.updateOne({ _id: u._id }, { $set: { pwFails: 0 } });
  if (role === "admin" && !u.adminAllowed) {
    return home(
      u,
      quote(
        "شما به عنوان ادمین تعریف نشده‌اید.",
        "شناسه شما را به مدیریت اصلی بدهید:",
      ) +
        "\n" +
        mono(u.userId),
    );
  }
  const set =
    role === "owner"
      ? { isOwner: true, ownerKey: H(pass) }
      : { isAdmin: true, adminKey: H(pass) };
  Object.assign(u, set);
  await User.updateOne({ _id: u._id }, { $set: set });
  return home(u, quote("ورود موفق بود."));
}
steps.pw_owner = (u, t, m) => login(u, m, "owner");
steps.pw_admin = (u, t, m) => login(u, m, "admin");

R("خروج از پنل", async (u) => {
  u.isOwner = false;
  u.isAdmin = false;
  await User.updateOne(
    { _id: u._id },
    { $set: { isOwner: false, isAdmin: false } },
  );
  return home(u, quote("از پنل خارج شدید."));
});

// ---------- بازیکن ----------
R(
  "دارایی",
  P(async (u, c) => {
    const se = await S.get();
    const hdr =
      se.state === "running"
        ? quote("روز " + fa(se.day) + " از " + fa(se.maxDays)) + "\n"
        : "";
    return say(u, hdr + G.statusText(c));
  }),
);
R("وضعیت فصل", async (u) => say(u, await S.text()));

R(
  "برداشت درآمد",
  P(async (u, c) => {
    const now = Date.now();
    const hrs = Math.min((now - c.lastClaim.getTime()) / 3.6e6, 24);
    if (hrs < 1 / 60)
      return say(u, quote("هنوز درآمدی جمع نشده است. کمی بعد تلاش کنید."));
    const got = {};
    const add = (r, v) => {
      if (v > 0) got[r] = (got[r] || 0) + v;
    };
    for (const k in G.INCOME)
      add(G.INCOME[k][0], Math.floor((G.income(k, c.lv[k], c.tier) * hrs) / 24));
    // سود روزانه‌ی ویژه‌ی کشور (اگر مدیریت تعیین کرده باشد)
    for (const [r, v] of Object.entries(G.profitOf(c)))
      add(r, Math.floor((v * hrs) / 24));
    const inc = Object.fromEntries(
      Object.entries(got).map(([r, v]) => ["res." + r, v]),
    );
    // تجهیزات روزانه‌ی پادگان (موشک، جنگنده و ...)؛ کسر هر یگان برای برداشت بعدی نگه داشته می‌شود
    const gotUnits = {};
    const carry = { ...(c.carry || {}) };
    for (const [k, perDay] of Object.entries(G.milIncome(c.lv.barracks))) {
      const total = (perDay * hrs) / 24 + (Number(carry[k]) || 0);
      const whole = Math.floor(total + 1e-9);
      carry[k] = Math.max(0, total - whole);
      if (whole > 0) {
        gotUnits[k] = whole;
        inc["units." + k] = whole;
      }
    }
    if (!Object.keys(inc).length)
      return say(u, quote("هنوز درآمدی جمع نشده است. کمی بعد تلاش کنید."));
    const upd = await Country.findOneAndUpdate(
      { _id: c._id, lastClaim: c.lastClaim },
      { $inc: inc, $set: { lastClaim: new Date(now), carry } },
      { new: true },
    );
    if (!upd) return say(u, quote("لطفاً دوباره تلاش کنید."));
    return say(
      u,
      quote(
        bold("درآمد برداشت شد"),
        "مدت جمع‌آوری: " + mono(fa(hrs * 60) + " دقیقه"),
      ) +
        "\n" +
        G.describeBundle({ res: got, units: gotUnits }),
    );
  }),
);

R(
  "ارتقاء زیرساخت",
  P((u, c) => {
    const lines = Object.keys(G.LV).map(
      (k, i) =>
        fa(i + 1) +
        ". " +
        G.LV[k] +
        " ـ سطح " +
        fa(c.lv[k]) +
        "\n    هزینه: " +
        G.costText(G.upCost(k, c.lv[k])) +
        "\n",
    );
    return ask(
      u,
      "upgrade",
      quote(bold("ارتقاء زیرساخت")) +
        "\n\n" +
        lines.join("\n") +
        "\n\n" +
        quote("شماره مورد نظر را ارسال کنید."),
    );
  }),
);
steps.upgrade = P(async (u, c, t) => {
  const k = Object.keys(G.LV)[(T.nums(t)[0] || 0) - 1];
  if (!k)
    return ask(u, "upgrade", quote("شماره نامعتبر است. دوباره ارسال کنید."));
  const lv = c.lv[k];
  if (lv >= G.MAXLV)
    return home(u, quote("این زیرساخت به حداکثر سطح رسیده است."));
  const cost = G.upCost(k, lv);
  const upd = await G.change(
    c._id,
    { ...G.neg(cost), ["lv." + k]: 1 },
    { ["lv." + k]: lv },
  );
  if (!upd)
    return home(
      u,
      quote("منابع کافی ندارید.") + "\nهزینه: " + G.costText(cost),
    );
  return home(
    u,
    quote(bold("ارتقاء انجام شد"), G.LV[k] + " ← سطح " + mono(fa(lv + 1))),
  );
});

R(
  "خرید نیرو",
  P((u) => {
    const sections = [];
    G.GROUP_ORDER.forEach((g) => {
      const lines = [];
      G.BUY_ORDER.forEach((k, i) => {
        if (G.UNIT_GROUP[k] !== g) return;
        lines.push(
          fa(i + 1) +
            ". " +
            G.UNITS[k] +
            " (قدرت " +
            fa(G.POW[k]) +
            ")\n    " +
            G.costText(G.UNIT_COST[k]),
        );
      });
      if (lines.length)
        sections.push(bold(G.GROUP_NAME[g]) + "\n" + quote(lines.join("\n")));
    });
    return ask(
      u,
      "buy",
      quote(bold("خرید نیرو")) +
        "\n\n" +
        sections.join("\n\n") +
        "\n\n" +
        quote("شماره و تعداد را بفرستید. مثال: " + mono("2 5")),
    );
  }),
);
steps.buy = P(async (u, c, t) => {
  const n = T.nums(t);
  const k = G.BUY_ORDER[(n[0] || 0) - 1];
  const q = Math.floor(n[1] || 0);
  if (!k || q < 1 || q > 100000)
    return ask(u, "buy", quote("ورودی نامعتبر است. مثال: " + mono("2 5")));
  const cost = G.times(G.UNIT_COST[k], q);
  const upd = await G.change(c._id, { ...G.neg(cost), ["units." + k]: q });
  if (!upd)
    return home(
      u,
      quote("منابع کافی ندارید.") + "\nهزینه: " + G.costText(cost),
    );
  return home(
    u,
    quote(bold("خرید انجام شد"), mono(fa(q)) + " عدد " + G.UNITS[k]),
  );
});

// محموله‌ها (کمک و حمله)
const targetsOf = (c) => ({
  status: "active",
  ownerId: { $ne: null },
  _id: { $ne: c._id },
});
// پیدا کردن هدفِ انتخاب‌شده با شناسه (نباید _id را targetsOf بازنویسی کند؛ باگ «حمله به کشور اشتباه»)
const targetById = (c, id) =>
  !id || String(id) === String(c._id)
    ? null
    : Country.findOne({ ...targetsOf(c), _id: id });
const listTargets = async (c) =>
  (await Country.find(targetsOf(c)).limit(60))
    .map((x) => mono(x.name))
    .join("\n");

async function launch(c, to, extra, img) {
  const s = await Shipment.create({
    code: gen(6),
    fromId: c._id,
    fromName: c.name,
    toId: to._id,
    toName: to.name,
    arriveAt: new Date(Date.now() + cfg.travelMin * 60000),
    ...extra,
  });
  await N.announce(G.shipText(s, cfg.travelMin), img);
  return s;
}
const sentText = (s) =>
  quote(
    bold("محموله ارسال شد"),
    "کد رهگیری: " + mono(s.code),
    "رسیدن تقریبی: " + mono(fa(cfg.travelMin) + " دقیقه"),
  );

const attackBlock = async () => {
  const gb = await Gate.blockText();
  if (gb) return gb;
  const se = await S.get();
  if (se.state === "running") return null;
  return quote(
    se.state === "ended"
      ? "فصل پایان یافته است و حمله ممکن نیست."
      : "فصل شروع نشده است.",
  );
};
PICK("atk", "حمله", {
  level: "P",
  title: "حمله",
  pre: async () => attackBlock(),
  filter: (u, c) => targetsOf(c),
  then: (u, to) =>
    askK(u, "atk_type", quote("نوع حمله را انتخاب کنید."), M.types, {
      to: String(to._id),
    }),
});
// نام تمیز (بدون ایموجی) برای تطبیق دکمه/متن کاربر با نام یگان
const cleanName = (x) => T.norm(T.noEmoji(x));
const unitRows = (keys) => {
  const rows = [];
  for (let i = 0; i < keys.length; i += 2)
    rows.push(keys.slice(i, i + 2).map((k) => G.unitName(k)));
  rows.push(["↩️ بازگشت"]);
  return rows;
};
steps.atk_type = P(async (u, c, t) => {
  const type = { زمینی: "ground", هوایی: "air", دریایی: "naval" }[t];
  if (!type)
    return askK(
      u,
      "atk_type",
      quote("یکی از گزینه‌ها را انتخاب کنید."),
      M.types,
      u.state.data,
    );
  const keys = G.ownedKeys(c, type);
  if (!keys.length)
    return home(u, quote("برای حمله‌ی " + G.TYPES[type].name + " نیرویی ندارید."));
  return askK(
    u,
    "atk_unit",
    quote(
      G.optionsText(c, type, keys),
      "",
      "با کدام نیرو حمله شود؟ دکمه را بزنید یا شماره را بفرستید.",
    ),
    unitRows(keys),
    { ...u.state.data, type, keys },
  );
});
steps.atk_unit = P(async (u, c, t) => {
  const d = u.state.data;
  const keys = d.keys || [];
  const n = /^[0-9۰-۹٠-٩]+$/.test(t) ? T.nums(t)[0] : 0;
  const k = n ? keys[n - 1] : keys.find((x) => cleanName(G.unitName(x)) === cleanName(t));
  if (!k)
    return askK(
      u,
      "atk_unit",
      quote("یکی از نیروهای لیست را انتخاب کنید."),
      unitRows(keys),
      d,
    );
  const have = Math.floor(G.qty(c, k));
  if (have < 1) return home(u, quote("از این نیرو موجودی ندارید."));
  return askK(
    u,
    "atk_qty",
    quote(
      G.unitName(k) + ": " + mono(fa(have)) + " عدد موجود",
      "",
      "چند عدد ارسال شود؟ عدد را بفرستید یا «همه» را بزنید.",
    ),
    M.qty,
    { ...d, unit: k },
  );
});
steps.atk_qty = P(async (u, c, t) => {
  const blk = await attackBlock();
  if (blk) return home(u, blk);
  const d = u.state.data;
  const have = Math.floor(G.qty(c, d.unit));
  const n = t === "همه" ? have : Math.floor(T.nums(t)[0] || 0);
  if (n < 1 || n > have)
    return askK(
      u,
      "atk_qty",
      quote(
        "تعداد نامعتبر است.",
        "عددی بین " + mono(fa(1)) + " و " + mono(fa(have)) + " بفرستید.",
      ),
      M.qty,
      d,
    );
  const to = await targetById(c, d.to);
  if (!to) return home(u, quote("هدف دیگر معتبر نیست."));
  const force = G.makeForce(d.unit, n);
  if (G.power(force) <= 0)
    return home(u, quote("برای این نوع حمله نیروی کافی ندارید."));
  const ok = await G.change(c._id, G.forceDelta(force, -1));
  if (!ok) return home(u, quote("موجودی تغییر کرد. دوباره تلاش کنید."));
  const s = await launch(
    c,
    to,
    { kind: "attack", type: d.type, payload: { force } },
    "attack_" + d.type,
  );
  await N.dm(
    to.ownerId,
    quote(
      bold("هشدار"),
      "محموله‌ی " +
        G.kindName(s) +
        " از سوی " +
        mono(c.name) +
        " به سمت شما در حرکت است.",
      "کد رهگیری: " + mono(s.code),
    ),
  );
  return home(
    u,
    sentText(s) +
      "\n" +
      quote(
        bold("نیروهای ارسالی (از کل)"),
        G.sentForceText(c, force),
      ),
  );
});

PICK("aid", "ارسال محموله", {
  level: "P",
  title: "ارسال محموله",
  pre: async () => Gate.blockText(),
  filter: (u, c) => targetsOf(c),
  then: (u, to) =>
    ask(
      u,
      "aid_amount",
      quote(
        "به ترتیب: پول، نفت، طلا، گاز، مس، سرباز",
        "مثال: " + mono("1000 0 0 50 50 0"),
      ),
      { to: String(to._id) },
    ),
});
steps.aid_amount = P(async (u, c, t) => {
  const gb = await Gate.blockText();
  if (gb) return home(u, gb);
  const n = T.nums(t);
  const res = {};
  Object.keys(G.RES).forEach((k, i) => {
    if (n[i] > 0) res[k] = Math.floor(n[i]);
  });
  if (!Object.keys(res).length)
    return ask(u, "aid_amount", quote("مقدار نامعتبر است."), u.state.data);
  const to = await targetById(c, u.state.data.to);
  if (!to) return home(u, quote("مقصد دیگر معتبر نیست."));
  const ok = await G.change(c._id, G.neg(res));
  if (!ok) return home(u, quote("منابع کافی ندارید."));
  const s = await launch(c, to, { kind: "aid", payload: { res } }, "shipment");
  await N.dm(
    to.ownerId,
    quote(
      bold("اعلان"),
      "محموله‌ای از " + mono(c.name) + " به سمت شما در حرکت است.",
      "کد رهگیری: " + mono(s.code),
    ),
  );
  return home(u, sentText(s));
});

R(
  "سرنگونی محموله",
  P(async (u) => {
    const gb = await Gate.blockText();
    if (gb) return say(u, gb);
    return ask(
      u,
      "shoot",
      quote(
        bold("سرنگونی محموله"),
        "کد رهگیری را ارسال کنید.",
        "هزینه هر شلیک: " + G.costText(G.SHOOT_COST),
      ),
    );
  }),
);
steps.shoot = P(async (u, c, t) => {
  const gb = await Gate.blockText();
  if (gb) return home(u, gb);
  const s = await Shipment.findOne({
    code: t.replace(/\s/g, "").toUpperCase(),
  });
  if (!s || s.status !== "flying" || s.arriveAt <= new Date())
    return ask(u, "shoot", quote("محموله‌ای با این کد در حال حرکت نیست."));
  if (String(s.fromId) === String(c._id))
    return home(u, quote("نمی‌توانید محموله‌ی خودتان را هدف بگیرید."));
  if (s.attempts.includes(String(c._id)))
    return home(u, quote("قبلاً برای این محموله تلاش کرده‌اید."));
  const paid = await G.change(c._id, G.neg(G.SHOOT_COST));
  if (!paid)
    return home(
      u,
      quote("هزینه‌ی شلیک را ندارید.") + "\nهزینه: " + G.costText(G.SHOOT_COST),
    );
  await Shipment.updateOne(
    { _id: s._id },
    { $push: { attempts: String(c._id) } },
  );
  if (Math.random() >= G.shootChance(c))
    return home(u, quote("شلیک ناموفق بود."));
  const hit = await Shipment.findOneAndUpdate(
    { _id: s._id, status: "flying", arriveAt: { $gt: new Date() } },
    { $set: { status: "shot" } },
  );
  if (!hit) return home(u, quote("دیر شد؛ محموله رسیده است."));
  await N.announce(
    quote(bold("محموله سرنگون شد")) +
      "\n\nکد رهگیری: " +
      mono(s.code) +
      "\nمبدا: " +
      mono(s.fromName) +
      "\nمقصد: " +
      mono(s.toName) +
      "\nسرنگون‌کننده: " +
      mono(c.name),
    "shootdown",
  );
  const from = await Country.findById(s.fromId);
  await N.dm(
    from && from.ownerId,
    quote("محموله " + mono(s.code) + " توسط " + mono(c.name) + " سرنگون شد."),
  );
  return home(u, quote(bold("محموله سرنگون شد.")));
});

// عکس معتبر داخل پیام (برای بیانیه و ارسال به کانال/گروه)
const photoOf = (m) => {
  const f = m && m.file;
  if (!f || !f.file_id) return null;
  return !f.file_name || /\.(jpe?g|png|webp|gif)$/i.test(f.file_name)
    ? String(f.file_id)
    : null;
};

R(
  "ارسال بیانیه",
  P(async (u, c) => {
    if (!(await N.statementId()))
      return say(u, quote("گروه بیانیه‌ها تنظیم نشده است."));
    if (c.lastStatement && Date.now() - c.lastStatement.getTime() < 300000)
      return say(u, quote("هر ۵ دقیقه یک بیانیه مجاز است."));
    return ask(u, "stmt", quote("متن بیانیه (حداکثر ۷۰۰ حرف):"));
  }),
);
steps.stmt = P(async (u, c, t, m) => {
  const body = T.safeMulti(m.text).slice(0, 700);
  if (body.length < 3) return ask(u, "stmt", quote("متن بیانیه کوتاه است."));
  return askK(
    u,
    "stmt_photo",
    quote("بیانیه همراه عکس ارسال شود؟"),
    M.photoAsk,
    { body },
  );
});
steps.stmt_photo = P(async (u, c, t) => {
  const d = u.state.data;
  if (t === "با عکس")
    return askK(u, "stmt_img", quote("عکس را ارسال کنید."), M.back, d);
  if (t === "بدون عکس") return sendStatement(u, c, d.body, null);
  return askK(
    u,
    "stmt_photo",
    quote("یکی از گزینه‌ها را انتخاب کنید."),
    M.photoAsk,
    d,
  );
});
steps.stmt_img = P(async (u, c, t, m) => {
  const d = u.state.data;
  const f = photoOf(m);
  if (!f)
    return askK(
      u,
      "stmt_img",
      quote("عکس معتبر نیست. یک عکس بفرستید."),
      M.back,
      d,
    );
  return sendStatement(u, c, d.body, f);
});
async function sendStatement(u, c, body, fileId) {
  await refreshProfile(u);
  const who = T.usernameOk(u.username)
    ? T.link("@" + u.username, "https://rubika.ir/" + u.username)
    : mono(u.name || "ناشناس") + " ـ شناسه: " + mono(u.userId);
  const r = await N.statement(
    bold("بیانیه رسمی کشور " + c.name) +
      "\n\n" +
      quote(body) +
      "\n\nارسال‌کننده: " +
      who,
    { fileId },
  );
  if (!r.ok)
    return home(u, quote("ارسال بیانیه ممکن نشد. به مدیریت خبر بدهید."));
  await Country.updateOne(
    { _id: c._id },
    { $set: { lastStatement: new Date() } },
  );
  return home(
    u,
    quote(
      fileId && !r.photo ? "بیانیه ارسال شد (عکس نرفت)." : "بیانیه ارسال شد.",
    ),
  );
}

// ---------- پک‌ها (کاربر) ----------
R(
  "پک‌های ویژه",
  P(async (u) => {
    const ps = await Pack.find({ active: true }).sort({ createdAt: 1 });
    if (!ps.length) return say(u, quote("در حال حاضر پکی موجود نیست."));
    const body = ps
      .map(
        (p, i) =>
          fa(i + 1) +
          ". " +
          mono(p.name) +
          "\n" +
          G.describeBundle(p.bundle) +
          "\nقیمت: " +
          mono(p.price),
      )
      .join("\n\n");
    return ask(
      u,
      "buy_pack",
      quote(bold("پک‌های ویژه"), "خرید فقط با پول واقعی") +
        "\n\n" +
        body +
        "\n\n" +
        quote("شماره پک را برای ثبت درخواست خرید بفرستید."),
      { ids: ps.map((p) => String(p._id)) },
    );
  }),
);
steps.buy_pack = P(async (u, c, t) => {
  const id = u.state.data.ids[(T.nums(t)[0] || 0) - 1];
  const p = id && (await Pack.findOne({ _id: id, active: true }));
  if (!p) return ask(u, "buy_pack", quote("شماره نامعتبر است."), u.state.data);
  const o = await Order.create({
    code: gen(5),
    countryId: c._id,
    countryName: c.name,
    userId: u.userId,
    packName: p.name,
    price: p.price,
    bundle: p.bundle,
  });
  const owners = await User.find({ isOwner: true });
  await N.broadcast(
    owners,
    quote(
      bold("سفارش جدید پک"),
      "کد: " + mono(o.code),
      "کشور: " + mono(c.name),
      "پک: " + mono(p.name),
      "قیمت: " + mono(p.price),
    ),
  );
  return home(
    u,
    quote(
      bold("درخواست خرید ثبت شد"),
      "کد سفارش: " + mono(o.code),
      "پک: " + mono(p.name),
      "قیمت: " + mono(p.price),
    ) +
      "\n\n" +
      cfg.payInfo,
  );
});

// ---------- پنل مدیریت و ادمین ----------
R(
  "ساخت کشور",
  A((u) => ask(u, "mk_name", quote("نام کشور جدید را ارسال کنید."))),
);
steps.mk_name = A(async (u, t) => {
  const name = T.safe(t).slice(0, 30);
  if (name.length < 2) return ask(u, "mk_name", quote("نام نامعتبر است."));
  if (await Country.exists({ name }))
    return ask(u, "mk_name", quote("این نام قبلاً ثبت شده است."));
  const c = await Country.create({
    name,
    code: gen(8),
    ...G.freshState("normal"),
  });
  return home(
    u,
    quote(
      bold("کشور ساخته شد"),
      "نام: " + mono(c.name),
      "کد ورود: " + mono(c.code),
    ),
  );
});

const stateName = (c) =>
  (c.status === "destroyed"
    ? "نابود شده"
    : c.ownerId
      ? "دارای بازیکن"
      : "آزاد") +
  (G.tierOf(c.tier) !== "normal" ? " ـ " + G.TIERS[G.tierOf(c.tier)].name : "");
// مدیریت اصلی: همراه کد ورود | ادمین: بدون کد (کد را از «دریافت کد کشور» می‌گیرد)
R(
  "لیست کشورها",
  A(async (u) => {
    const l = await Country.find();
    if (!l.length) return say(u, quote("هنوز کشوری ساخته نشده است."));
    const isOwner = u.isOwner;
    const title = bold(isOwner ? "کشورها و کدها" : "کشورها");
    const chunkSize = 60;
    for (let start = 0; start < l.length; start += chunkSize) {
      const end = Math.min(start + chunkSize, l.length);
      let text = title + ` (${fa(start + 1)} تا ${fa(end)})\n\n`;
      for (let i = start; i < end; i++) {
        const c = l[i];
        text +=
          fa(i + 1) + ". " + mono(withFlag(c.name)) + " ـ " + stateName(c);
        if (isOwner) text += " | " + mono(c.code);
        text += "\n";
      }
      await say(u, text);
    }
  }),
);
PICK("info", "اطلاعات کشور", {
  level: "A",
  title: "اطلاعات کشور",
  then: (u, c) =>
    home(u, G.statusText(c) + "\n\n" + quote("وضعیت: " + stateName(c))),
});

// دریافت کد ورود کشور (مدیریت اصلی و ادمین)
PICK("getcode", "دریافت کد کشور", {
  level: "A",
  title: "دریافت کد کشور",
  then: (u, c) =>
    home(
      u,
      bold("کد ورود کشور") +
        "\n\nنام: " +
        mono(c.name) +
        "\nکد: " +
        mono(c.code) +
        "\n\n" +
        quote("وضعیت: " + stateName(c)),
    ),
});

const dropOwner = (id) =>
  User.updateMany({ countryId: id }, { $set: { countryId: null } });

PICK("destroy", "نابودی کشور", {
  level: "O",
  title: "نابودی کشور",
  filter: () => ({ status: "active" }),
  then: (u, c) =>
    askK(u, "ds_ok", quote("کشور " + mono(c.name) + " نابود شود؟"), M.yes, {
      id: String(c._id),
    }),
});
steps.ds_ok = O(async (u, t) => {
  if (t !== "بله") return home(u, quote("لغو شد."));
  const c = await Country.findById(u.state.data.id);
  if (!c) return home(u, quote("کشور پیدا نشد."));
  const ok = await S.eliminate(c, "نابود شدن توسط مدیریت");
  return home(
    u,
    quote(
      ok
        ? "کشور " + mono(c.name) + " نابود شد."
        : "این کشور قبلاً نابود شده است.",
    ),
  );
});

// ساخت ۱۰۰ کشور (کشورهای موجود با همین نام دست نمی‌خورند) + رده‌ی ویژه
R(
  "ساخت ۱۰۰ کشور",
  O(async (u) => {
    const have = new Set((await Country.find()).map((c) => c.name));
    let made = 0;
    for (const [name, tier] of COUNTRIES) {
      if (have.has(name)) continue;
      for (let t = 0; t < 3; t++) {
        try {
          await Country.create({
            name,
            code: gen(8),
            tier,
            ...G.freshState(tier),
          });
          made++;
          break;
        } catch (e) {
          if (!e || e.code !== 11000) throw e; // کد تکراری: دوباره با کد جدید
        }
      }
    }
    const total = await Country.countDocuments();
    const cnt = (t) => COUNTRIES.filter((x) => x[1] === t).length;
    return say(
      u,
      quote(
        bold("کشورها ساخته شد"),
        "تازه ساخته‌شده: " + mono(fa(made)),
        "از قبل موجود: " + mono(fa(COUNTRIES.length - made)),
        "کل کشورها: " + mono(fa(total)),
      ) +
        "\n\n" +
        "نظامی ویژه: " +
        mono(
          fa(cnt("military")) +
            " کشور (سرباز " +
            fa(G.TIERS.military.start.soldiers) +
            " برابر، پدافندها +" +
            fa(G.TIERS.military.lv.airDef) +
            " سطح، پادگان +" +
            fa(G.TIERS.military.lv.barracks) +
            " سطح)",
        ) +
        "\n" +
        "اقتصادی ویژه: " +
        mono(
          fa(cnt("economic")) +
            " کشور (منابع " +
            fa(G.TIERS.economic.start.money) +
            " برابر)",
        ) +
        "\n\n" +
        quote("کدها را از «لیست کشورها و کدها» ببینید."),
    );
  }),
);

PICK("tier", "ویژه کردن کشور", {
  level: "O",
  title: "ویژه کردن کشور",
  then: (u, c) =>
    askK(
      u,
      "tier_pick",
      quote(
        "رده‌ی کشور " + mono(c.name) + " را انتخاب کنید.",
        "رده‌ی فعلی: " + G.TIERS[G.tierOf(c.tier)].name,
      ),
      M.tiers,
      { id: String(c._id) },
    ),
});
steps.tier_pick = O(async (u, t) => {
  const tier = {
    عادی: "normal",
    "نظامی ویژه": "military",
    "اقتصادی ویژه": "economic",
  }[t];
  if (!tier)
    return askK(
      u,
      "tier_pick",
      quote("یکی از گزینه‌ها را انتخاب کنید."),
      M.tiers,
      u.state.data,
    );
  const c = await Country.findById(u.state.data.id);
  if (!c) return home(u, quote("کشور پیدا نشد."));
  // ارتقاء به رده‌ی ویژه: یک‌بار مازاد منابع اولیه‌ی آن رده هم داده می‌شود
  const change = tier !== G.tierOf(c.tier);
  const bonus = change ? G.tierBonus(tier) : {};
  const bLv = change ? G.tierBonusLv(tier) : {};
  const bUnits = change ? G.tierBonusUnits(tier) : {};
  const upd = { $set: { tier } };
  const inc = {
    ...G.pos(bonus),
    ...Object.fromEntries(Object.entries(bLv).map(([k, v]) => ["lv." + k, v])),
    ...Object.fromEntries(
      Object.entries(bUnits).map(([k, v]) => ["units." + k, v]),
    ),
  };
  if (Object.keys(inc).length) upd.$inc = inc;
  await Country.updateOne({ _id: c._id }, upd);
  await N.dm(
    c.ownerId,
    quote(
      bold("رده‌ی کشور شما تغییر کرد"),
      "رده‌ی جدید: " + mono(G.TIERS[tier].name),
    ) +
      (Object.keys(inc).length
        ? "\n" + G.describeBundle({ res: bonus, units: bUnits, levels: bLv })
        : ""),
  );
  return home(
    u,
    quote("رده‌ی " + mono(c.name) + " ← " + mono(G.TIERS[tier].name)) +
      (Object.keys(inc).length
        ? "\n" + G.describeBundle({ res: bonus, units: bUnits, levels: bLv })
        : ""),
  );
});

PICK("release", "آزادسازی کشور", {
  level: "O",
  title: "آزادسازی کشور",
  then: async (u, c) => {
    const set = {
      ownerId: null,
      code: gen(8),
      status: "active",
      lastClaim: new Date(),
    };
    if (c.status === "destroyed") {
      // کشور نابودشده دوباره با منابع اولیه فعال می‌شود
      Object.assign(set, G.freshState(c.tier));
    }
    await Country.updateOne({ _id: c._id }, { $set: set });
    await dropOwner(c._id);
    await N.dm(c.ownerId, quote("کشور شما آزاد شد و دسترسی شما قطع گردید."));
    await S.checkWinner();
    return home(
      u,
      quote(bold("کشور آزاد شد")) +
        "\nنام: " +
        mono(c.name) +
        "\nکد جدید: " +
        mono(set.code),
    );
  },
});

// ---------- ریست کل / ریست یک کشور ----------
// پایان مرحله: وضعیت پاک می‌شود و منوی اصلی با پیام نمایش داده می‌شود
const done = async (u, text, rows) => {
  await setState(u, null);
  return say(u, text, rows);
};

R(
  "ریست کل",
  O((u) =>
    askK(
      u,
      "rst_all",
      quote(
        bold("ریست کل"),
        "همه‌ی کشورها به حالت اولیه‌ی رده‌ی خودشان برمی‌گردند (منابع، نیروها، سطح‌ها).",
        "رده، کد ورود و صاحب کشورها حفظ می‌شود و محموله‌های در راه لغو می‌شوند.",
        "فصل و بازی دست نمی‌خورند و اعلانی ارسال نمی‌شود.",
        "مطمئنید؟",
      ),
      M.yes,
    ),
  ),
);
steps.rst_all = O(async (u, t) => {
  if (t !== "بله") return home(u, quote("لغو شد."));
  const n = await S.resetAll();
  return home(u, quote(bold("ریست کل انجام شد"), "تعداد کشور: " + mono(fa(n))));
});

PICK("rstc", "ریست کشور", {
  level: "O",
  title: "ریست کشور",
  then: (u, c) =>
    askK(
      u,
      "rstc_tier",
      quote(
        "کشور " + mono(c.name) + " به چه حالتی ریست شود؟",
        "رده‌ی فعلی: " + G.TIERS[G.tierOf(c.tier)].name,
        "«همین رده» یعنی با همان رده‌ی فعلی از نو ساخته شود.",
      ),
      M.resetTiers,
      { id: String(c._id) },
    ),
});
steps.rstc_tier = O(async (u, t) => {
  const pick = {
    عادی: "normal",
    "نظامی ویژه": "military",
    "اقتصادی ویژه": "economic",
    "همین رده": "same",
  }[t];
  if (!pick)
    return askK(
      u,
      "rstc_tier",
      quote("یکی از گزینه‌ها را انتخاب کنید."),
      M.resetTiers,
      u.state.data,
    );
  const c = await Country.findById(u.state.data.id);
  if (!c) return home(u, quote("کشور پیدا نشد."));
  const tier = pick === "same" ? G.tierOf(c.tier) : pick;
  const f = G.freshState(tier);
  const set = {
    tier,
    res: f.res,
    units: f.units,
    lv: f.lv,
    lastClaim: f.lastClaim,
    lastStatement: null,
    status: "active",
  };
  if (c.status === "destroyed") set.ownerId = null; // کشور نابودشده آزاد و فعال می‌شود
  await Country.updateOne({ _id: c._id }, { $set: set });
  await Shipment.updateMany(
    { fromId: c._id, status: "flying" },
    { $set: { status: "returned" } },
  );
  if (c.status !== "destroyed")
    await N.dm(
      c.ownerId,
      quote(
        bold("کشور شما ریست شد"),
        "حالت جدید: " + mono(G.TIERS[tier].name),
      ),
    );
  return home(
    u,
    quote(
      bold("کشور ریست شد"),
      "نام: " + mono(c.name),
      "حالت: " + mono(G.TIERS[tier].name),
    ),
  );
});

// ---------- سود ویژه‌ی یک کشور ----------
PICK("profit", "سود کشور", {
  level: "O",
  title: "سود کشور",
  then: (u, c) => {
    const cur = G.describeBundle({ res: G.profitOf(c) });
    return ask(
      u,
      "profit_set",
      quote(
        bold("سود روزانه‌ی " + c.name),
        "این مقدار هر روز علاوه بر درآمد معمولی به کشور اضافه می‌شود و با «برداشت درآمد» گرفته می‌شود.",
        "به ترتیب: پول، نفت، طلا، گاز، مس، سرباز",
        "مثال: " + mono("500 0 0 20 0 0"),
        "برای برداشتن سود: " + mono("حذف"),
      ) +
        "\n\n" +
        quote("سود فعلی:") +
        "\n" +
        (cur || mono("ندارد")),
      { id: String(c._id) },
    );
  },
});
steps.profit_set = O(async (u, t) => {
  const keys = Object.keys(G.RES);
  const p = {};
  if (t === "حذف") keys.forEach((k) => (p[k] = 0));
  else {
    const n = T.nums(t);
    if (!n.length)
      return ask(u, "profit_set", quote("ورودی نامعتبر است. مثال: " + mono("500 0 0 20 0 0")), u.state.data);
    keys.forEach((k, i) => (p[k] = Math.floor(n[i] > 0 ? n[i] : 0)));
  }
  const c = await Country.findById(u.state.data.id);
  if (!c) return home(u, quote("کشور پیدا نشد."));
  await Country.updateOne({ _id: c._id }, { $set: { profit: p } });
  const shown = G.describeBundle({ res: G.profitOf({ profit: p }) });
  return home(
    u,
    quote(bold("سود کشور ثبت شد"), "کشور: " + mono(c.name)) +
      "\n" +
      (shown || quote("سود برداشته شد.")),
  );
});

// ---------- کنترل بازی (بدون اعلان): دستی یا خودکار با ساعت شروع و پایان ----------
R("کنترل بازی", O(async (u) => say(u, await Gate.text(), M.gate)));
R("وضعیت بازی", O(async (u) => say(u, await Gate.text(), M.gate)));
R(
  "شروع بازی",
  O(async (u) => {
    await Gate.setManual(true);
    return say(u, quote("بازی شروع شد (حالت دستی).", "اعلانی ارسال نشد."), M.gate);
  }),
);
R(
  "توقف بازی",
  O(async (u) => {
    await Gate.setManual(false);
    return say(
      u,
      quote("بازی متوقف شد (حالت دستی).", "اعلانی ارسال نشد.", "با «شروع بازی» دوباره باز می‌شود."),
      M.gate,
    );
  }),
);
R(
  "حالت دستی",
  O(async (u) => {
    await Gate.setManual(await Gate.isOpen());
    return say(u, (await Gate.text()) + "\n" + quote("حالت دستی فعال شد."), M.gate);
  }),
);
R(
  "حالت خودکار",
  O((u) =>
    ask(
      u,
      "gate_from",
      quote(
        bold("حالت خودکار"),
        "ساعت شروع روزانه را بفرستید (به وقت تهران).",
        "مثال: " + mono("16") + " یا " + mono("16:30"),
      ),
    ),
  ),
);
steps.gate_from = O((u, t) => {
  const from = Gate.parseTime(t);
  if (from == null)
    return ask(u, "gate_from", quote("ساعت نامعتبر است. مثال: " + mono("16:30")));
  return ask(
    u,
    "gate_to",
    quote(
      "ساعت شروع: " + mono(Gate.hhmm(from)),
      "حالا ساعت پایان روزانه را بفرستید.",
      "اگر پایان بعد از نیمه‌شب باشد (مثلاً " + mono("2") + ") مشکلی نیست.",
    ),
    { from },
  );
});
steps.gate_to = O(async (u, t) => {
  const to = Gate.parseTime(t);
  if (to == null)
    return ask(u, "gate_to", quote("ساعت نامعتبر است. مثال: " + mono("23:00")), u.state.data);
  await Gate.setAuto(u.state.data.from, to);
  return done(
    u,
    (await Gate.text()) + "\n" + quote("حالت خودکار فعال شد.", "اعلانی ارسال نشد."),
    M.gate,
  );
});

// مدیریت فصل
R(
  "مدیریت فصل",
  O(async (u) =>
    say(
      u,
      (await S.text()) +
        "\n\n" +
        quote(
          "روز بعد را فقط مدیریت اصلی می‌زند." +
            (cfg.dayHours > 0
              ? " (هر " + fa(cfg.dayHours) + " ساعت خودکار هم پیش می‌رود)"
              : ""),
        ),
      M.season,
    ),
  ),
);
R(
  "شروع فصل",
  O(async (u) => {
    const r = await S.start();
    return say(
      u,
      quote(r.ok ? "فصل شروع شد و در گروه اعلام شد." : r.msg),
      M.season,
    );
  }),
);
R(
  "روز بعد",
  O((u) => askK(u, "day_ok", quote("به روز بعد برویم؟"), M.yes)),
);
steps.day_ok = O(async (u, t) => {
  if (t !== "بله") return home(u, quote("لغو شد."));
  const r = await S.advanceDay();
  return say(
    u,
    quote(
      r.ok
        ? r.ended
          ? "روز آخر تمام شد و فصل پایان یافت."
          : "روز " + fa(r.season.day) + " آغاز شد."
        : r.msg,
    ),
    M.season,
  );
});
R(
  "پایان فصل",
  O((u) =>
    askK(u, "end_ok", quote("فصل همین الان تمام و برنده اعلام شود؟"), M.yes),
  ),
);
steps.end_ok = O(async (u, t) => {
  if (t !== "بله") return home(u, quote("لغو شد."));
  const r = await S.finish("manual");
  return say(u, quote(r.ok ? "فصل پایان یافت." : r.msg), M.season);
});

// پک‌ها و هدیه همگانی (با پرسیدن بخش‌ها)
const startBundle = (u, purpose, meta) =>
  askK(
    u,
    "bb_menu",
    quote(
      "برای چه بخشی؟",
      "بخش را انتخاب کنید. برای میکس چند بخش اضافه و «پایان و ذخیره» بزنید.",
    ),
    M.bundle,
    { purpose, meta, bundle: { res: {}, units: {}, levels: {} } },
  );

steps.bb_menu = O(async (u, t) => {
  const d = u.state.data;
  if (t === "لغو") return home(u, quote("لغو شد."));
  if (t === "پایان و ذخیره") return finishBundle(u, d);
  const c = G.CATS[t];
  if (!c)
    return askK(
      u,
      "bb_menu",
      quote("یکی از گزینه‌های منو را انتخاب کنید."),
      M.bundle,
      d,
    );
  d.cat = t;
  return askK(
    u,
    "bb_input",
    quote(bold(t), typeof c.ask === "function" ? c.ask() : c.ask),
    M.back,
    d,
  );
});
steps.bb_input = O(async (u, t) => {
  const d = u.state.data;
  const b = G.CATS[d.cat].parse(t);
  if (!b)
    return askK(
      u,
      "bb_input",
      quote(
        "ورودی نامعتبر است.",
        typeof G.CATS[d.cat].ask === "function"
          ? G.CATS[d.cat].ask()
          : G.CATS[d.cat].ask,
      ),
      M.back,
      d,
    );
  d.bundle = G.merge(d.bundle, b);
  return askK(
    u,
    "bb_menu",
    quote("ثبت شد. محتوای فعلی:") +
      "\n" +
      G.describeBundle(d.bundle) +
      "\n\n" +
      quote("بخش دیگر اضافه کنید یا ذخیره کنید."),
    M.bundle,
    d,
  );
});
async function finishBundle(u, d) {
  const delta = G.bundleDelta(d.bundle);
  if (!Object.keys(delta).length)
    return askK(u, "bb_menu", quote("هنوز چیزی اضافه نکرده‌اید."), M.bundle, d);
  if (d.purpose === "pack") {
    await Pack.create({
      name: d.meta.name,
      price: d.meta.price,
      bundle: d.bundle,
    });
    return home(
      u,
      quote(
        bold("پک ذخیره شد"),
        "نام: " + d.meta.name,
        "قیمت: " + d.meta.price,
      ) +
        "\n" +
        G.describeBundle(d.bundle),
    );
  }
  const r = await Country.updateMany({ status: "active" }, { $inc: delta });
  await N.broadcast(
    await User.find({ countryId: { $ne: null } }),
    quote(bold("هدیه همگانی")) + "\n" + G.describeBundle(d.bundle),
  );
  return home(
    u,
    quote(
      bold("هدیه به همه کشورها داده شد"),
      "تعداد کشور: " + mono(fa(r.modifiedCount)),
    ) +
      "\n" +
      G.describeBundle(d.bundle),
  );
}

R(
  "هدیه همگانی",
  O((u) => startBundle(u, "gift", {})),
);
R(
  "مدیریت پک‌ها",
  O((u) => say(u, quote("مدیریت پک‌ها"), M.packs)),
);
R(
  "ساخت پک جدید",
  O((u) => ask(u, "pk_name", quote("نام پک را ارسال کنید."))),
);
steps.pk_name = O((u, t) => {
  const name = T.safe(t).slice(0, 40);
  if (name.length < 2) return ask(u, "pk_name", quote("نام نامعتبر است."));
  return ask(
    u,
    "pk_price",
    quote("قیمت پک را ارسال کنید. مثال: " + mono("۱۰۰٬۰۰۰ تومان")),
    { name },
  );
});
steps.pk_price = O((u, t) => {
  const price = T.safe(t).slice(0, 40);
  if (!price)
    return ask(u, "pk_price", quote("قیمت نامعتبر است."), u.state.data);
  return startBundle(u, "pack", { name: u.state.data.name, price });
});
R(
  "لیست پک‌ها",
  O(async (u) => {
    const ps = await Pack.find({ active: true }).sort({ createdAt: 1 });
    if (!ps.length) return say(u, quote("پکی ثبت نشده است."), M.packs);
    return say(
      u,
      ps
        .map(
          (p, i) =>
            fa(i + 1) +
            ". " +
            mono(p.name) +
            " ـ " +
            mono(p.price) +
            "\n" +
            G.describeBundle(p.bundle),
        )
        .join("\n\n"),
      M.packs,
    );
  }),
);
R(
  "حذف پک",
  O(async (u) => {
    const ps = await Pack.find({ active: true }).sort({ createdAt: 1 });
    if (!ps.length) return say(u, quote("پکی ثبت نشده است."), M.packs);
    return ask(
      u,
      "pk_del",
      quote("شماره پکی که حذف می‌شود را بفرستید.") +
        "\n" +
        ps.map((p, i) => fa(i + 1) + ". " + mono(p.name)).join("\n"),
      { ids: ps.map((p) => String(p._id)) },
    );
  }),
);
steps.pk_del = O(async (u, t) => {
  const id = u.state.data.ids[(T.nums(t)[0] || 0) - 1];
  if (!id) return ask(u, "pk_del", quote("شماره نامعتبر است."), u.state.data);
  await Pack.updateOne({ _id: id }, { $set: { active: false } });
  return home(u, quote("پک حذف شد."));
});

// سفارش‌های پک
R(
  "سفارش‌های پک",
  O(async (u) => {
    const os = await Order.find({ status: "pending" })
      .sort({ createdAt: 1 })
      .limit(30);
    if (!os.length) return say(u, quote("سفارش در انتظاری وجود ندارد."));
    const body = os
      .map(
        (o) =>
          "کد: " +
          mono(o.code) +
          " ـ " +
          mono(o.countryName) +
          "\n    پک: " +
          mono(o.packName) +
          " ـ " +
          mono(o.price),
      )
      .join("\n");
    return ask(
      u,
      "order_act",
      quote(bold("سفارش‌های در انتظار")) +
        "\n\n" +
        body +
        "\n\n" +
        quote(
          "برای تایید و اعطا، کد سفارش را بفرستید.",
          "برای رد: " + mono("رد کد"),
        ),
    );
  }),
);
steps.order_act = O(async (u, t) => {
  const reject = t.startsWith("رد ");
  const o = await Order.findOne({
    code: t.replace(/^رد /, "").replace(/\s/g, "").toUpperCase(),
    status: "pending",
  });
  if (!o) return ask(u, "order_act", quote("سفارش در انتظاری با این کد نیست."));
  if (reject) {
    await Order.updateOne({ _id: o._id }, { $set: { status: "rejected" } });
    await N.dm(o.userId, quote("سفارش " + mono(o.code) + " رد شد."));
    return home(u, quote("سفارش رد شد."));
  }
  const done = await Order.findOneAndUpdate(
    { _id: o._id, status: "pending" },
    { $set: { status: "done" } },
  );
  if (!done) return home(u, quote("این سفارش قبلاً بررسی شده است."));
  await Country.updateOne(
    { _id: o.countryId },
    { $inc: G.bundleDelta(o.bundle) },
  );
  await N.dm(
    o.userId,
    quote(bold("پک شما فعال شد"), "سفارش: " + mono(o.code)) +
      "\n" +
      G.describeBundle(o.bundle),
  );
  return home(u, quote("پک به کشور " + mono(o.countryName) + " اعطا شد."));
});

// مدیریت ادمین‌ها
R(
  "مدیریت ادمین‌ها",
  O((u) => say(u, quote("مدیریت ادمین‌ها"), M.admins)),
);
R(
  "لیست ادمین‌ها",
  O(async (u) => {
    const l = await User.find({ adminAllowed: true });
    return say(
      u,
      l.length
        ? l
            .map(
              (x, i) =>
                fa(i + 1) +
                ". " +
                mono(x.name || "بدون نام") +
                " ـ " +
                mono(x.userId),
            )
            .join("\n")
        : quote("ادمینی تعریف نشده است."),
      M.admins,
    );
  }),
);
R(
  "افزودن ادمین",
  O((u) =>
    ask(
      u,
      "adm_add",
      quote(
        "شناسه کاربر را ارسال کنید.",
        "کاربر با دکمه «شناسه من» آن را می‌بیند.",
      ),
    ),
  ),
);
steps.adm_add = O(async (u, t, m) => {
  const id = String(m.text || "").trim();
  if (id.length < 8) return ask(u, "adm_add", quote("شناسه نامعتبر است."));
  await User.updateOne(
    { userId: id },
    { $set: { adminAllowed: true } },
    { upsert: true },
  );
  return home(
    u,
    quote("ادمین اضافه شد.", "او با رمز ادمین می‌تواند وارد پنل شود."),
  );
});
R(
  "حذف ادمین",
  O((u) => ask(u, "adm_del", quote("شناسه ادمین را ارسال کنید."))),
);
steps.adm_del = O(async (u, t, m) => {
  const id = String(m.text || "").trim();
  await User.updateOne(
    { userId: id },
    { $set: { adminAllowed: false, isAdmin: false } },
  );
  return home(u, quote("ادمین حذف شد."));
});

// کاربران
R(
  "کاربران",
  O(async (u) => {
    const n = await User.countDocuments();
    return say(u, quote("مدیریت کاربران", "تعداد کل: " + mono(fa(n))), M.users);
  }),
);
R(
  "لیست کاربران",
  O(async (u) => {
    const l = await User.find().sort({ createdAt: -1 }).limit(40);
    const cs = await Country.find({
      _id: { $in: l.map((x) => x.countryId).filter(Boolean) },
    });
    const nm = Object.fromEntries(cs.map((c) => [String(c._id), c.name]));
    return say(
      u,
      l
        .map(
          (x, i) =>
            fa(i + 1) +
            ". " +
            mono(x.name || "بدون نام") +
            (x.banned ? " (مسدود)" : "") +
            "\n    شناسه: " +
            mono(x.userId) +
            (x.countryId
              ? "\n    کشور: " + mono(nm[String(x.countryId)] || "-")
              : ""),
        )
        .join("\n"),
      M.users,
    );
  }),
);
R(
  "مسدود کردن",
  O((u) => ask(u, "ban", quote("شناسه کاربر را ارسال کنید."))),
);
R(
  "رفع مسدودیت",
  O((u) => ask(u, "unban", quote("شناسه کاربر را ارسال کنید."))),
);
const setBan = (v) =>
  O(async (u, t, m) => {
    const r = await User.updateOne(
      { userId: String(m.text || "").trim() },
      { $set: { banned: v } },
    );
    return home(
      u,
      quote(
        r.matchedCount
          ? v
            ? "کاربر مسدود شد."
            : "مسدودیت برداشته شد."
          : "کاربری با این شناسه نیست.",
      ),
    );
  });
steps.ban = setBan(true);
steps.unban = setBan(false);

R(
  "پیام همگانی",
  O((u) => ask(u, "bc", quote("متن پیام همگانی را ارسال کنید."))),
);
steps.bc = O(async (u, t, m) => {
  const body = T.safeMulti(m.text).slice(0, 1500);
  if (!body) return ask(u, "bc", quote("متن خالی است."));
  const users = await User.find({ chatId: { $ne: null }, banned: false });
  await N.broadcast(users, quote(bold("پیام مدیریت")) + "\n\n" + body);
  return home(
    u,
    quote(
      "پیام برای " + mono(fa(users.length)) + " کاربر در صف ارسال قرار گرفت.",
    ),
  );
});

// ---------- ارسال پیام به کانال / گروه (مدیریت و ادمین؛ عکس اختیاری) ----------
const DEST = { کانال: "channel", گروه: "group", "هر دو": "both" };
const DEST_NAME = { channel: "کانال", group: "گروه" };

R(
  "ارسال به کانال/گروه",
  A((u) =>
    askK(
      u,
      "pub_dest",
      quote(bold("ارسال پیام"), "مقصد را انتخاب کنید."),
      M.dest,
      {},
    ),
  ),
);
steps.pub_dest = A(async (u, t) => {
  const dest = DEST[t];
  if (!dest)
    return askK(
      u,
      "pub_dest",
      quote("یکی از گزینه‌ها را انتخاب کنید."),
      M.dest,
      {},
    );
  const miss = [];
  if ((dest === "channel" || dest === "both") && !(await N.channelId()))
    miss.push("کانال");
  if ((dest === "group" || dest === "both") && !(await N.groupChatId()))
    miss.push("گروه");
  if (miss.length)
    return home(u, quote("کانال/گروه " + miss.join(" و ") + " ثبت نشده است."));
  return ask(u, "pub_text", quote("متن پیام را ارسال کنید."), { dest });
});
steps.pub_text = A(async (u, t, m) => {
  const body = T.safeMulti(m.text).slice(0, 3000);
  if (body.length < 2)
    return ask(u, "pub_text", quote("متن خالی است."), u.state.data);
  return askK(u, "pub_photo", quote("پیام همراه عکس ارسال شود؟"), M.photoAsk, {
    ...u.state.data,
    body,
  });
});
steps.pub_photo = A(async (u, t) => {
  const d = u.state.data;
  if (t === "با عکس")
    return askK(u, "pub_img", quote("عکس را ارسال کنید."), M.back, d);
  if (t === "بدون عکس") return doPublish(u, d, null);
  return askK(
    u,
    "pub_photo",
    quote("یکی از گزینه‌ها را انتخاب کنید."),
    M.photoAsk,
    d,
  );
});
steps.pub_img = A(async (u, t, m) => {
  const d = u.state.data;
  const f = photoOf(m);
  if (!f)
    return askK(
      u,
      "pub_img",
      quote("عکس معتبر نیست. یک عکس بفرستید."),
      M.back,
      d,
    );
  return doPublish(u, d, f);
});
async function doPublish(u, d, fileId) {
  const r = await N.publish(d.dest, d.body, { fileId });
  const lines = Object.entries(r).map(
    ([k, v]) =>
      DEST_NAME[k] +
      ": " +
      (v.ok
        ? fileId && !v.photo
          ? "ارسال شد (بدون عکس)"
          : "ارسال شد"
        : "ناموفق"),
  );
  return home(u, quote(bold("نتیجه ارسال"), ...lines));
}

// ---------- کانال و گروه (ثبت با لینک؛ گروه‌ها آیدی عمومی ندارند) ----------
const chatLine = (label, id) => label + ": " + mono(id || "تنظیم نشده");
async function chatSettingsText() {
  const [ch, gr, chl, grl] = [
    await N.channelId(),
    await N.groupChatId(),
    await N.getLink("channel"),
    await N.getLink("group"),
  ];
  return (
    bold("کانال و گروه") +
    "\n\n" +
    chatLine("کانال (اعلان‌ها)", ch ? "ثبت شده" : "") +
    (chl ? "\nلینک کانال: " + chl : "") +
    "\n" +
    chatLine("گروه (بیانیه‌ها)", gr ? "ثبت شده" : "") +
    (grl ? "\nلینک گروه: " + grl : "") +
    "\n\n" +
    quote(
      "کانال: اعلان‌ها (لینک یا آیدی). گروه: بیانیه‌ها (فقط لینک).",
      "ربات باید ادمین باشد.",
    )
  );
}
R(
  "کانال و گروه",
  O(async (u) => say(u, await chatSettingsText(), M.chatSet)),
);
R(
  "مشاهده تنظیمات",
  O(async (u) => say(u, await chatSettingsText(), M.chatSet)),
);
R(
  "ثبت لینک کانال",
  O((u) =>
    ask(u, "set_channel", quote("لینک یا آیدی کانال (مثل @name). حذف: «حذف»")),
  ),
);
R(
  "ثبت لینک گروه",
  O((u) => ask(u, "set_group", quote("لینک گروه را بفرستید. حذف: «حذف»"))),
);
const LINK_RE = /^(?:https?:\/\/)?(?:www\.)?rubika\.ir\/([^\s?#]+)/i;
const getChatInfo = async (cand) => {
  try {
    const r = await rb.getChat(cand);
    const ch = r && r.data && r.data.chat;
    return ch && ch.chat_id ? ch : null;
  } catch (e) {
    return null;
  }
};
const setChatStep = (kind) =>
  O(async (u, t, m) => {
    const raw = String(m.text || "").trim();
    const name = kind === "channel" ? "کانال" : "گروه";
    if (raw === "حذف") {
      await N.setChat(kind, null);
      await N.setLink(kind, null);
      return say(u, quote(name + " حذف شد."), M.chatSet);
    }
    const lm = raw.match(LINK_RE);
    if (lm) {
      const link = raw.startsWith("http") ? raw : "https://" + raw;
      await N.setLink(kind, link);
      let found = null;
      const last = lm[1].split("/").pop();
      for (const cand of [...new Set([lm[1], last, last.replace(/^@/, "")])]) {
        found = await getChatInfo(cand);
        if (found) break;
      }
      if (found) await N.setChat(kind, found.chat_id);
      const title = found && (found.title || found.first_name);
      return say(
        u,
        quote(
          "لینک " + name + " ثبت شد.",
          found
            ? "چت پیدا شد."
            : kind === "group"
              ? "گروه پیدا نشد. ربات را ادمین کنید و در گروه بنویسید: ثبت گروه"
              : "کانال پیدا نشد. آیدی کانال (مثل @name) را هم بفرستید.",
        ) +
          "\nلینک: " +
          mono(link) +
          (title ? "\nنام: " + mono(title) : ""),
        M.chatSet,
      );
    }
    // گروه فقط لینک می‌گیرد
    if (kind === "group")
      return ask(u, "set_group", quote("فقط لینک گروه را بفرستید."));
    // کانال: آیدی با @ یا بدون @
    const id = raw.replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{3,64}$/.test(id))
      return ask(u, "set_channel", quote("لینک یا آیدی کانال را بفرستید."));
    const found = await getChatInfo(id);
    await N.setChat(kind, found ? found.chat_id : id);
    const title = found && (found.title || found.first_name);
    return say(
      u,
      quote(
        name + " ثبت شد.",
        found ? "" : "ربات کانال را پیدا نکرد؛ ادمین بودن ربات را بررسی کنید.",
      ) + (title ? "\nنام: " + mono(title) : ""),
      M.chatSet,
    );
  });
steps.set_channel = setChatStep("channel");
steps.set_group = setChatStep("group");

// ---------- ورودی اصلی ----------
async function onPrivate(chatId, senderId, text, msg) {
  const u = await User.findOneAndUpdate(
    { userId: senderId },
    { $set: { chatId } },
    { upsert: true, new: true },
  );
  if (u.banned) return rb.send(chatId, quote("دسترسی شما مسدود شده است."));
  if (!u.name) await refreshProfile(u);

  // ابطال نشست با تغییر رمز در env یا حذف ادمین
  if (u.isOwner && u.ownerKey !== H(cfg.ownerPass)) {
    u.isOwner = false;
    await User.updateOne({ _id: u._id }, { $set: { isOwner: false } });
  }
  if (u.isAdmin && (!u.adminAllowed || u.adminKey !== H(cfg.adminPass))) {
    u.isAdmin = false;
    await User.updateOne({ _id: u._id }, { $set: { isAdmin: false } });
  }

  // دکمه‌ها ایموجی دارند؛ متن دکمه به نام تمیز (بدون ایموجی) تبدیل می‌شود
  const t = M.resolve(text);
  const step = u.state && u.state.step;
  // عکس بدون متن فقط وقتی پذیرفته می‌شود که ربات منتظر عکس باشد
  if (!t && !(step === "stmt_img" || step === "pub_img")) return;
  if (t === "بازگشت" || t === "/start" || t === "منو" || t === "شروع")
    return home(u);

  const inPassword = step === "pw_owner" || step === "pw_admin";
  if (!inPassword && routes[t]) {
    await setState(u, null);
    return routes[t](u, t, msg);
  }
  if (step && steps[step]) return steps[step](u, t, msg);
  return home(u, quote("از منوی پایین انتخاب کنید."));
}

async function onGroup(chatId, senderId, text) {
  if (T.norm(text) !== "ثبت گروه") return;
  const u = await User.findOne({ userId: senderId });
  if (!u || !u.isOwner || u.ownerKey !== H(cfg.ownerPass)) return;
  // گروه بیانیه‌ها؛ اگر هنوز کانال/چت اعلان تنظیم نشده، همین گروه اعلان‌ها هم می‌شود (مثل قبل)
  await N.setChat("group", chatId);
  if (!(await N.channelId())) await N.setChat("channel", chatId);
  await rb.send(chatId, quote(bold("گروه بیانیه‌ها ثبت شد.")));
}

module.exports = { onPrivate, onGroup };
