'use strict';
// ابزارهای متن: اعداد فارسی و استایل (مونو، نقل‌قول، بولد، پیش‌قالب، لینک)
//
// استایل‌ها با نشانگرهای نامرئی Unicode (Private Use Area) ساخته می‌شوند، نه با علامت‌های مارک‌داون.
// بنابراین هیچ متنی از کاربر (نام، بیانیه، ...) نمی‌تواند استایل را به‌هم بریزد یا استایل جعل کند.
// تبدیل نهایی به متن + metadata روبیکا در style.js انجام می‌شود.

const D = '۰۱۲۳۴۵۶۷۸۹';
const A = '٠١٢٣٤٥٦٧٨٩';

const fa = (n) =>
  String(Math.round(Number(n) || 0))
    .replace(/\B(?=(\d{3})+(?!\d))/g, '٬')
    .replace(/\d/g, (d) => D[d]);

const en = (s) =>
  String(s == null ? '' : s)
    .replace(/[۰-۹]/g, (d) => D.indexOf(d))
    .replace(/[٠-٩]/g, (d) => A.indexOf(d))
    .replace(/[٬،,]/g, '');

const nums = (s) => (en(s).match(/\d+(?:\.\d+)?/g) || []).map(Number);

// نشانگرهای استایل و کاراکترهای کنترلی ناخواسته را از ورودی کاربر پاک می‌کند
// (کاراکترهای Private Use + کنترلی به جز خط جدید)
const PUA = /[-]/g;
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (s) => String(s == null ? '' : s).replace(PUA, '').replace(CTRL, '');

const norm = (s) =>
  clean(s)
    .replace(/[‌‎‏]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ورودی کاربر برای نمایش (فقط تک‌خطی)؛ کاراکترهای قانونی مثل _ * [ ] < > حفظ می‌شوند
const safe = (s) => norm(s);
const safeMulti = (s) => clean(s).replace(/\r/g, '').trim();

// آیدی روبیکا فقط حروف انگلیسی/عدد/زیرخط است؛ غیر از این در لینک نمی‌آید
const usernameOk = (u) => typeof u === 'string' && /^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(u);

// ---- ساخت استایل (رشته‌هایی با نشانگر؛ با + قابل ترکیب‌اند) ----
const M = { Mono: ['', ''], Bold: ['', ''], Quote: ['', ''], Pre: ['', ''] };
const LINK = ['', '', '']; // باز، بسته، جداکننده‌ی آدرس
const join = (a) => a.flat(Infinity).filter((x) => x != null && x !== false).join('\n');

const mono = (s) => M.Mono[0] + (s == null ? '' : s) + M.Mono[1];
const bold = (s) => M.Bold[0] + (s == null ? '' : s) + M.Bold[1];
const pre = (s) => M.Pre[0] + (s == null ? '' : s) + M.Pre[1];
// نقل‌قول: فقط متن ساده داخلش می‌رود. هر خطی که استایل دیگری (مونو، بولد، لینک، ...) داشته باشد
// بیرون از نقل‌قول و به همان ترتیب چاپ می‌شود؛ پس هیچ استایلی هیچ‌وقت داخل استایل دیگر نیست.
const STYLED = /[\uE000-\uE00A]/;
const quote = (...l) => {
  const lines = join(l).split('\n');
  const out = [];
  let run = [];
  const flush = () => {
    if (run.some((x) => x.trim())) out.push(M.Quote[0] + run.join('\n').replace(/^\n+|\n+$/g, '') + M.Quote[1]);
    else if (run.length) out.push(...run);
    run = [];
  };
  for (const ln of lines) {
    if (STYLED.test(ln)) { flush(); out.push(ln); } else run.push(ln);
  }
  flush();
  return out.join('\n');
};
const link = (text, url) => (/^https?:\/\/[^\s"'<>-]+$/.test(String(url)) ? LINK[0] + url + LINK[2] + text + LINK[1] : String(text));

// حذف ایموجی از برچسب دکمه‌ها (برای تطبیق مسیرها)
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3]/gu;
const noEmoji = (s) => String(s == null ? '' : s).replace(EMOJI, '').replace(/\s+/g, ' ').trim();

module.exports = { noEmoji, fa, en, nums, norm, clean, safe, safeMulti, usernameOk, mono, bold, quote, pre, link };
