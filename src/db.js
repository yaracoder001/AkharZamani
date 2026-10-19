'use strict';
const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const n = (d = 0) => ({ type: Number, default: d });
const Mixed = Schema.Types.Mixed;

const User = model(
  'User',
  new Schema(
    {
      userId: { type: String, unique: true },
      pwFails: n(), // تلاش ناموفق ورود به پنل
      pwLock: n(), // زمان پایان قفل ورود (میلی‌ثانیه)
      chatId: String,
      name: String,
      username: String,
      countryId: { type: Schema.Types.ObjectId, default: null },
      banned: { type: Boolean, default: false },
      // نشست پنل‌ها (با تغییر رمز در env خودکار باطل می‌شود)
      isOwner: { type: Boolean, default: false },
      ownerKey: String,
      isAdmin: { type: Boolean, default: false },
      adminKey: String,
      adminAllowed: { type: Boolean, default: false }, // تعریف‌شده توسط مدیریت اصلی
      state: { type: Mixed, default: {} },
    },
    { timestamps: true, minimize: false }
  )
);

const Country = model(
  'Country',
  new Schema(
    {
      name: { type: String, unique: true },
      code: { type: String, unique: true },
      ownerId: { type: String, default: null },
      status: { type: String, default: 'active' }, // active | destroyed
      hp: n(1000), // قدیمی و بی‌استفاده: جان کشور حالا فقط از پدافندها و نیروهای زمینی و دریایی حساب می‌شود
      tier: { type: String, default: 'normal' }, // normal | military | economic
      res: { money: n(), oil: n(), gold: n(), gas: n(), copper: n(), soldiers: n() },
      units: Object.fromEntries(
        [
          'tank', 'fighter', 'drone', 'missile', 'ship', 'sub',
          // یگان‌های ویژه (باید با EXTRA در game.js یکی باشد)
          'commando', 'apc', 'artillery', 'heavyTank',
          'lightFighter', 'attackHeli', 'uav', 'bomber', 'stealth',
          'rocket', 'cruise', 'ballistic', 'hypersonic',
          'boat', 'corvette', 'destroyer', 'nuclearSub', 'carrier',
        ].map((k) => [k, n()])
      ),
      // سود روزانه‌ی ویژه (تعیین‌شده توسط مدیریت)؛ علاوه بر درآمد معمولی برداشت می‌شود
      profit: { money: n(), oil: n(), gold: n(), gas: n(), copper: n(), soldiers: n() },
      lv: {
        oilMine: n(1), goldMine: n(1), gasMine: n(1), copperMine: n(1),
        barracks: n(1), bank: n(1),
        airDef: n(0), groundDef: n(0), navalDef: n(0),
      },
      lastClaim: { type: Date, default: Date.now },
      carry: { type: Mixed, default: {} }, // باقی‌مانده‌ی کسری تجهیزات روزانه‌ی پادگان (تا از بین نرود)
      lastStatement: { type: Date, default: null },
    },
    { timestamps: true }
  )
);

const Pack = model(
  'Pack',
  new Schema(
    { name: String, price: String, bundle: Mixed, active: { type: Boolean, default: true } },
    { timestamps: true, minimize: false }
  )
);

const Order = model(
  'Order',
  new Schema(
    {
      code: { type: String, unique: true },
      countryId: Schema.Types.ObjectId,
      countryName: String,
      userId: String,
      packName: String,
      price: String,
      bundle: Mixed,
      status: { type: String, default: 'pending' }, // pending | done | rejected
    },
    { timestamps: true, minimize: false }
  )
);

const Shipment = model(
  'Shipment',
  new Schema(
    {
      code: { type: String, unique: true },
      kind: String, // aid | attack
      type: { type: String }, // ground | air | naval
      fromId: Schema.Types.ObjectId,
      fromName: String,
      toId: Schema.Types.ObjectId,
      toName: String,
      payload: { type: Mixed, default: {} },
      status: { type: String, default: 'flying', index: true }, // flying | landing | delivered | shot | returned
      arriveAt: { type: Date, index: true },
      attempts: { type: [String], default: [] },
    },
    { timestamps: true, minimize: false }
  )
);

const Setting = model(
  'Setting',
  new Schema({ key: { type: String, unique: true }, value: String })
);

// پیام‌های پردازش‌شده (جلوگیری از پردازش دوباره‌ی آپدیت تکراری؛ خودکار بعد از ۲ ساعت پاک می‌شود)
const Seen = model('Seen', new Schema({ key: { type: String, unique: true }, at: { type: Date, default: Date.now, expires: 7200 } }));

// اتصال مشترک به مونگو؛ در Vercel بین درخواست‌ها نگه داشته می‌شود
let connecting = null;
async function connect() {
  const c = mongoose.connection;
  if (c && c.readyState === 1) return;
  if (!connecting) {
    connecting = mongoose
      .connect(require('./config').mongo, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 })
      .catch((e) => {
        connecting = null;
        throw e;
      });
  }
  await connecting;
  await migrateHp();
}

// یک‌بار: کشورهای قدیمی که جانشان از مقیاس ۱۰۰ بود به مقیاس ۱۰۰۰ می‌روند
let migrated = false;
async function migrateHp() {
  if (migrated) return;
  migrated = true;
  try {
    await Setting.create({ key: 'hpmig1000', value: '1' });
  } catch (e) {
    return; // قبلا انجام شده (یا هم‌زمان توسط سرور دیگر)
  }
  try {
    await Country.updateMany({}, [{ $set: { hp: { $multiply: ['$hp', 10] } } }]);
    console.log('[migrate] جان کشورها به مقیاس ۱۰۰۰ تبدیل شد');
  } catch (e) {
    console.error('[migrate]', e.message);
    await Setting.deleteOne({ key: 'hpmig1000' }).catch(() => {});
    migrated = false;
  }
}

module.exports = { User, Country, Pack, Order, Shipment, Setting, Seen, connect };
