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
// نقل‌قول: چند خط را با خط جدید به هم می‌چسباند
const quote = (...l) => M.Quote[0] + join(l) + M.Quote[1];
const link = (text, url) => (/^https?:\/\/[^\s"'<>-]+$/.test(String(url)) ? LINK[0] + url + LINK[2] + text + LINK[1] : String(text));

module.exports = { fa, en, nums, norm, clean, safe, safeMulti, usernameOk, mono, bold, quote, pre, link };
