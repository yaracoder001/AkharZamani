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
      hp: n(100), // سلامت کشور؛ صفر شدن = حذف تیم
      res: { money: n(), oil: n(), gold: n(), gas: n(), copper: n(), soldiers: n() },
      units: { tank: n(), fighter: n(), drone: n(), missile: n(), ship: n(), sub: n() },
      lv: {
        oilMine: n(1), goldMine: n(1), gasMine: n(1), copperMine: n(1),
        barracks: n(1), bank: n(1),
        airDef: n(0), groundDef: n(0), navalDef: n(0),
      },
      lastClaim: { type: Date, default: Date.now },
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

module.exports = { User, Country, Pack, Order, Shipment, Setting };
