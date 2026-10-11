'use strict';
const cfg = require('./src/config');
cfg.check();

const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(cfg.mongo);
  console.log('متصل به MongoDB');
  require('./src/scheduler').start();
  await require('./src/bot').poll();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
