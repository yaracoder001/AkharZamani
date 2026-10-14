"use strict";
const crypto = require("crypto");
const cfg = require("./config");
const rb = require("./rubika");
const T = require("./text");
const G = require("./game");
const N = require("./notify");
const S = require("./season");
const { COUNTRIES } = require("./countries");
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

// ---------- عمومی ----------
const HELP = [
  quote(bold("راهنمای بازی جنگ جهانی")),
  "",
  "شما مدیریت یک کشور را بر عهده دارید و با پول، نفت، طلا، گاز، مس و سرباز آن را قدرتمند می‌کنید.",
  "",
  "برداشت درآمد: درآمد روزانه تا ۲۴ ساعت ذخیره می‌شود.",
  "ارتقاء زیرساخت: معادن، پادگان، بانک و سه پدافند.",
  "خرید نیرو: تانک، جنگنده، پهباد، موشک، ناو و زیردریایی.",
  "حمله: سه نوع زمینی، هوایی و دریایی.",
  "ارسال محموله: کمک منابع به کشور دیگر.",
  "محموله‌ها " +
    cfg.travelMin +
    " دقیقه در راه‌اند و با کد رهگیری قابل سرنگونی‌اند.",
  "پک‌های ویژه فقط با پول واقعی خریداری می‌شوند.",
  "",
  "هر فصل بازی " +
    fa(cfg.seasonDays) +
    " روز است. تیمی که نابود شود حذف می‌شود و آخرین تیم باقی‌مانده، یا قوی‌ترین تیم در پایان فصل، برنده است. حمله فقط در زمان فصل فعال ممکن است. هر حمله‌ی موفق از سلامت کشور هدف کم می‌کند و سلامت صفر یعنی حذف. سلامت هر روز کمی بازسازی می‌شود. روزها را مدیریت پیش می‌برد.",
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
    return ask(
      u,
      "code",
      quote("این کشور قبلاً به کاربر دیگری اختصاص یافته است."),
    );
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
  if (!ok)
    return ask(
      u,
      "code",
      quote("این کشور قبلاً به کاربر دیگری اختصاص یافته است."),
    );
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
    return home(
      u,
      quote("تلاش ناموفق زیاد بود. چند دقیقه بعد دوباره امتحان کنید."),
    );
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
      return home(
        u,
        quote("تلاش ناموفق زیاد بود. ۱۰ دقیقه بعد دوباره امتحان کنید."),
      );
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
    const inc = {};
    const got = {};
    for (const k in G.INCOME) {
      const r = G.INCOME[k][0];
      const v = Math.floor((G.income(k, c.lv[k], c.tier) * hrs) / 24);
      if (v > 0) {
        inc["res." + r] = v;
        got[r] = v;
      }
    }
    const upd = await Country.findOneAndUpdate(
      { _id: c._id, lastClaim: c.lastClaim },
      { $inc: inc, $set: { lastClaim: new Date(now) } },
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
        G.describeBundle({ res: got }),
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
        mono(fa(c.lv[k])) +
        "\n    هزینه: " +
        G.costText(G.upCost(k, c.lv[k])),
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
    const lines = Object.keys(G.UNIT_COST).map(
      (k, i) =>
        fa(i + 1) +
        ". " +
        G.UNITS[k] +
        "\n    هر عدد: " +
        G.costText(G.UNIT_COST[k]),
    );
    return ask(
      u,
      "buy",
      quote(bold("خرید نیرو")) +
        "\n\n" +
        lines.join("\n") +
        "\n\n" +
        quote("شماره و تعداد را بفرستید. مثال: " + mono("2 5")),
    );
  }),
);
steps.buy = P(async (u, c, t) => {
  const n = T.nums(t);
  const k = Object.keys(G.UNIT_COST)[(n[0] || 0) - 1];
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
  const se = await S.get();
  if (se.state === "running") return null;
  return quote(
    se.state === "ended"
      ? "فصل پایان یافته است و حمله ممکن نیست."
      : "فصل هنوز شروع نشده است. حمله فقط در زمان فصل فعال ممکن است.",
  );
};
R(
  "حمله",
  P(async (u, c) => {
    const blk = await attackBlock();
    if (blk) return say(u, blk);
    const l = await listTargets(c);
    if (!l) return say(u, quote("هدفی برای حمله وجود ندارد."));
    return ask(
      u,
      "atk_target",
      quote(bold("حمله")) +
        "\n\nکشورهای قابل حمله:\n" +
        l +
        "\n\n" +
        quote("نام کشور هدف را ارسال کنید."),
    );
  }),
);
steps.atk_target = P(async (u, c, t) => {
  const to = await Country.findOne({ name: T.norm(t), ...targetsOf(c) });
  if (!to) return ask(u, "atk_target", quote("کشوری با این نام پیدا نشد."));
  return askK(u, "atk_type", quote("نوع حمله را انتخاب کنید."), M.types, {
    to: String(to._id),
  });
});
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
  return askK(
    u,
    "atk_pct",
    quote("چند درصد از نیروهای این نوع و موشک‌ها ارسال شود؟"),
    M.pct,
    { ...u.state.data, type },
  );
});
steps.atk_pct = P(async (u, c, t) => {
  const blk = await attackBlock();
  if (blk) return home(u, blk);
  const d = u.state.data;
  const pct = Math.min(100, Math.max(1, Math.floor(T.nums(t)[0] || 0)));
  const to = await Country.findOne({ _id: d.to, ...targetsOf(c) });
  if (!to) return home(u, quote("هدف دیگر معتبر نیست."));
  const force = G.makeForce(c, d.type, pct);
  if (G.power(force) <= 0)
    return home(u, quote("برای این نوع حمله نیروی کافی ندارید."));
  const ok = await G.change(c._id, G.forceDelta(force, -1));
  if (!ok)
    return home(u, quote("موجودی نیروها تغییر کرده است. دوباره تلاش کنید."));
  const s = await launch(
    c,
    to,
    { kind: "attack", type: d.type, payload: { force } },
    "attack",
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
  return home(u, sentText(s));
});

R(
  "ارسال محموله",
  P(async (u, c) => {
    const l = await listTargets(c);
    if (!l) return say(u, quote("کشور دیگری وجود ندارد."));
    return ask(
      u,
      "aid_target",
      quote(bold("ارسال محموله")) +
        "\n\nکشورها:\n" +
        l +
        "\n\n" +
        quote("نام کشور مقصد را ارسال کنید."),
    );
  }),
);
steps.aid_target = P(async (u, c, t) => {
  const to = await Country.findOne({ name: T.norm(t), ...targetsOf(c) });
  if (!to) return ask(u, "aid_target", quote("کشوری با این نام پیدا نشد."));
  return ask(
    u,
    "aid_amount",
    quote(
      "مقدار را به ترتیب بفرستید: پول، نفت، طلا، گاز، مس، سرباز",
      "مثال: " + mono("1000 0 0 50 50 0"),
    ),
    { to: String(to._id) },
  );
});
steps.aid_amount = P(async (u, c, t) => {
  const n = T.nums(t);
  const res = {};
  Object.keys(G.RES).forEach((k, i) => {
    if (n[i] > 0) res[k] = Math.floor(n[i]);
  });
  if (!Object.keys(res).length)
    return ask(u, "aid_amount", quote("مقدار نامعتبر است."), u.state.data);
  const to = await Country.findOne({ _id: u.state.data.to, ...targetsOf(c) });
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
  P((u) =>
    ask(
      u,
      "shoot",
      quote(
        bold("سرنگونی محموله"),
        "کد رهگیری را ارسال کنید.",
        "هزینه هر شلیک: " + G.costText(G.SHOOT_COST),
      ),
    ),
  ),
);
steps.shoot = P(async (u, c, t) => {
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
    return home(u, quote("شلیک ناموفق بود. محموله به مسیر خود ادامه می‌دهد."));
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

R(
  "ارسال بیانیه",
  P(async (u, c) => {
    if (!(await N.groupId()))
      return say(u, quote("گروه اعلان هنوز تنظیم نشده است."));
    if (c.lastStatement && Date.now() - c.lastStatement.getTime() < 300000)
      return say(u, quote("هر ۵ دقیقه یک بیانیه مجاز است."));
    return ask(u, "stmt", quote("متن بیانیه را ارسال کنید (حداکثر ۷۰۰ حرف)."));
  }),
);
steps.stmt = P(async (u, c, t, m) => {
  const body = T.safeMulti(m.text).slice(0, 700);
  if (body.length < 3) return ask(u, "stmt", quote("متن بیانیه کوتاه است."));
  await refreshProfile(u);
  const who = T.usernameOk(u.username)
    ? T.link("@" + u.username, "https://rubika.ir/" + u.username)
    : mono(u.name || "ناشناس") + " ـ شناسه: " + mono(u.userId);
  await Country.updateOne(
    { _id: c._id },
    { $set: { lastStatement: new Date() } },
  );
  await N.announce(
    quote(bold("بیانیه رسمی کشور " + c.name)) +
      "\n\n" +
      quote(body) +
      "\n\nارسال‌کننده: " +
      who,
  );
  return home(u, quote("بیانیه ارسال شد."));
});

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
    res: G.startRes("normal"),
    units: G.START.units,
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
R(
  "لیست کشورها",
  O(async (u) => {
    const l = await Country.find().sort({ createdAt: 1 });
    if (!l.length) return say(u, quote("هنوز کشوری ساخته نشده است."));
    return say(
      u,
      quote(bold("کشورها و کدها")) +
        "\n\n" +
        l
          .map(
            (c, i) =>
              fa(i + 1) +
              ". " +
              mono(c.name) +
              " ـ " +
              stateName(c) +
              "\n    کد: " +
              mono(c.code),
          )
          .join("\n"),
    );
  }),
);
R(
  "لیست کشورها",
  A(async (u) => {
    const l = await Country.find().sort({ createdAt: 1 });
    if (!l.length) return say(u, quote("هنوز کشوری ساخته نشده است."));
    return say(
      u,
      quote("کشورها") +
        "\n\n" +
        l
          .map(
            (c, i) =>
              fa(i + 1) +
              ". " +
              c.name +
              " ـ " +
              stateName(c) +
              "  -  " +
              c.code,
          )
          .join("\n"),
    );
  }),
);
R(
  "اطلاعات کشور",
  A((u) => ask(u, "info_name", quote("نام کشور را ارسال کنید."))),
);
steps.info_name = A(async (u, t) => {
  const c = await Country.findOne({ name: T.norm(t) });
  if (!c) return ask(u, "info_name", quote("کشوری با این نام پیدا نشد."));
  return home(u, G.statusText(c) + "\n\n" + quote("وضعیت: " + stateName(c)));
});

const dropOwner = (id) =>
  User.updateMany({ countryId: id }, { $set: { countryId: null } });

R(
  "نابودی کشور",
  O((u) =>
    ask(u, "ds_name", quote("نام کشوری که باید نابود شود را ارسال کنید.")),
  ),
);
steps.ds_name = O(async (u, t) => {
  const c = await Country.findOne({ name: T.norm(t), status: "active" });
  if (!c) return ask(u, "ds_name", quote("کشور فعالی با این نام پیدا نشد."));
  return askK(
    u,
    "ds_ok",
    quote("کشور " + mono(c.name) + " نابود شود؟"),
    M.yes,
    { id: String(c._id) },
  );
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
            res: G.startRes(tier),
            units: G.START.units,
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
            " برابر)",
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

R(
  "ویژه کردن کشور",
  O((u) => ask(u, "tier_name", quote("نام کشور را ارسال کنید."))),
);
steps.tier_name = O(async (u, t) => {
  const c = await Country.findOne({ name: T.norm(t) });
  if (!c) return ask(u, "tier_name", quote("کشوری با این نام پیدا نشد."));
  return askK(
    u,
    "tier_pick",
    quote(
      "رده‌ی کشور " + mono(c.name) + " را انتخاب کنید.",
      "رده‌ی فعلی: " + G.TIERS[G.tierOf(c.tier)].name,
    ),
    M.tiers,
    { id: String(c._id) },
  );
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
  const bonus = tier !== G.tierOf(c.tier) ? G.tierBonus(tier) : {};
  const upd = { $set: { tier } };
  if (Object.keys(bonus).length) upd.$inc = G.pos(bonus);
  await Country.updateOne({ _id: c._id }, upd);
  await N.dm(
    c.ownerId,
    quote(
      bold("رده‌ی کشور شما تغییر کرد"),
      "رده‌ی جدید: " + mono(G.TIERS[tier].name),
    ) +
      (Object.keys(bonus).length
        ? "\n" + G.describeBundle({ res: bonus })
        : ""),
  );
  return home(
    u,
    quote("رده‌ی " + mono(c.name) + " ← " + mono(G.TIERS[tier].name)) +
      (Object.keys(bonus).length
        ? "\n" + G.describeBundle({ res: bonus })
        : ""),
  );
});

R(
  "آزادسازی کشور",
  O((u) =>
    ask(
      u,
      "rl_name",
      quote(
        "نام کشوری که باید آزاد شود را ارسال کنید.",
        "کشور نابود شده دوباره با منابع اولیه فعال می‌شود.",
      ),
    ),
  ),
);
steps.rl_name = O(async (u, t) => {
  const c = await Country.findOne({ name: T.norm(t) });
  if (!c) return ask(u, "rl_name", quote("کشوری با این نام پیدا نشد."));
  const set = {
    ownerId: null,
    code: gen(8),
    status: "active",
    lastClaim: new Date(),
  };
  if (c.status === "destroyed") {
    Object.assign(set, {
      res: G.startRes(c.tier),
      units: G.START.units,
      lv: {
        oilMine: 1,
        goldMine: 1,
        gasMine: 1,
        copperMine: 1,
        barracks: 1,
        bank: 1,
        airDef: 0,
        groundDef: 0,
        navalDef: 0,
      },
      hp: G.HP_MAX,
    });
  }
  await Country.updateOne({ _id: c._id }, { $set: set });
  await dropOwner(c._id);
  await N.dm(c.ownerId, quote("کشور شما آزاد شد و دسترسی شما قطع گردید."));
  await S.checkWinner();
  return home(
    u,
    quote(
      bold("کشور آزاد شد"),
      "نام: " + mono(c.name),
      "کد جدید: " + mono(set.code),
    ),
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
      "یک بخش انتخاب کنید. برای حالت میکس چند بخش را پشت سر هم اضافه کنید و در پایان «پایان و ذخیره» را بزنید.",
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
  return askK(u, "bb_input", quote(bold(t), c.ask), M.back, d);
});
steps.bb_input = O(async (u, t) => {
  const d = u.state.data;
  const b = G.CATS[d.cat].parse(t);
  if (!b)
    return askK(
      u,
      "bb_input",
      quote("ورودی نامعتبر است.", G.CATS[d.cat].ask),
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
      quote("بخش دیگری اضافه کنید یا پایان و ذخیره را بزنید."),
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

  const t = T.norm(text);
  if (t === "بازگشت" || t === "/start" || t === "منو" || t === "شروع")
    return home(u);

  const step = u.state && u.state.step;
  const inPassword = step === "pw_owner" || step === "pw_admin";
  if (!inPassword && routes[t]) {
    await setState(u, null);
    return routes[t](u, t, msg);
  }
  if (step && steps[step]) return steps[step](u, t, msg);
  return home(u, quote("گزینه نامعتبر است. از منوی پایین استفاده کنید."));
}

async function onGroup(chatId, senderId, text) {
  if (T.norm(text) !== "ثبت گروه") return;
  const u = await User.findOne({ userId: senderId });
  if (!u || !u.isOwner || u.ownerKey !== H(cfg.ownerPass)) return;
  await Setting.updateOne(
    { key: "announce" },
    { $set: { value: chatId } },
    { upsert: true },
  );
  await rb.send(chatId, quote(bold("گروه اعلان‌ها ثبت شد.")));
}

module.exports = { onPrivate, onGroup };
