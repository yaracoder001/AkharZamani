'use strict';
// تبدیل متن استایل‌دار (نشانگرهای text.js یا آرایه‌ی قطعه‌های {t, s}) به پیام روبیکا
//
// حالت‌ها (cfg.richMode):
//   metadata  (پیش‌فرض) متن بدون علامت + metadata.meta_data_parts با from_index و length
//   plain     فقط متن ساده
//   html      parse_mode = HTML
//   markdown  parse_mode = Markdown
// cfg.metaIndex: utf16 (پیش‌فرض) یا codepoint برای شمارش from_index و length
//
// قاعده‌ها:
//  - هر متن فقط «یک» لایه استایل دارد: هیچ استایلی داخل استایل دیگر (از جمله داخل نقل‌قول) نمی‌رود.
//    (text.js در ساخت quote خطوط استایل‌دار را از نقل‌قول بیرون می‌گذارد و اینجا هم نگهبان نهایی است.)
//  - فاصله و خط جدید ابتدا/انتهای هر قطعه‌ی استایل‌دار بیرون از آن می‌افتد.
//  - مونو/بولد/لینک هیچ‌وقت چند خطی نیستند؛ نقل‌قول و پیش‌قالب بلوک چندخطی‌اند.
//  - متن طولانی روی مرز خط به چند پیام تقسیم می‌شود و هیچ استایلی بین دو پیام قطع نمی‌شود.
//  - null / undefined / false چیزی چاپ نمی‌کنند.

const cfg = require('./config');

const MODES = ['metadata', 'plain', 'html', 'markdown'];
let mode = MODES.includes(cfg.richMode) ? cfg.richMode : 'metadata';
let index = cfg.metaIndex === 'codepoint' ? 'codepoint' : 'utf16';
const setMode = (m) => { if (MODES.includes(m)) mode = m; };
const getMode = () => mode;
const setIndex = (i) => { index = i === 'codepoint' ? 'codepoint' : 'utf16'; };
const len = (x) => (index === 'utf16' ? x.length : [...x].length);

// ---------- ۱) رمزگشایی نشانگرها به قطعه‌ها ----------
const TYPE_OF = { 0xe000: 'Mono', 0xe002: 'Bold', 0xe004: 'Quote', 0xe006: 'Pre', 0xe008: 'Link' };
const SEP = '';
const flat = (kids) => kids.map((k) => k.s).join('');

// نقل‌قول → قطعه‌های سطح بالا: خط‌های ساده Quote می‌شوند، خط‌های دارای استایل بیرون می‌آیند
function expandQuote(kids) {
  const lines = [[]];
  for (const k of kids) {
    if (k.t) lines[lines.length - 1].push(k);
    else k.s.split('\n').forEach((p, i) => { if (i) lines.push([]); if (p) lines[lines.length - 1].push({ t: null, s: p }); });
  }
  const empty = (l) => l.every((x) => !x.t && !x.s.trim());
  let a = 0;
  let b = lines.length;
  while (a < b && empty(lines[a])) a++;
  while (b > a && empty(lines[b - 1])) b--;

  const out = [];
  const nl = () => out.push({ t: null, s: '\n' });
  for (let i = 0; i < a; i++) nl();
  let q = null;
  const flush = () => { if (q !== null) { out.push({ t: 'Quote', s: q }); q = null; } };
  for (let i = a; i < b; i++) {
    const ln = lines[i];
    if (ln.some((x) => x.t)) {
      flush();
      if (i > a) nl();
      out.push(...ln);
    } else {
      const text = ln.map((x) => x.s).join('');
      if (q === null) { if (i > a) nl(); q = text; } else q += '\n' + text;
    }
  }
  flush();
  for (let i = b; i < lines.length; i++) nl();
  return out;
}

function decode(str) {
  const top = [];
  const stack = [];
  let buf = '';
  const target = () => (stack.length ? stack[stack.length - 1].kids : top);
  const flush = () => { if (buf) { target().push({ t: null, s: buf }); buf = ''; } };
  const finish = (node) => {
    const parent = stack[stack.length - 1];
    if (node.t === 'Quote') {
      if (parent && parent.t === 'Quote') parent.kids.push(...node.kids);
      else if (parent) parent.kids.push({ t: null, s: flat(node.kids) });
      else top.push(...expandQuote(node.kids));
      return;
    }
    const seg = { t: node.t, s: flat(node.kids), url: node.url };
    if (parent) parent.kids.push({ t: null, s: seg.s }); // استایل داخل استایل ممنوع است: فقط متن می‌ماند (حتی داخل نقل‌قول)
    else top.push(seg);
  };

  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0xe000 || c > 0xe00a) { buf += str[i]; continue; }
    flush();
    if (c === 0xe00a) continue; // جداکننده‌ی سرگردان
    const open = c % 2 === 0;
    const t = TYPE_OF[open ? c : c - 1];
    if (open) {
      let url;
      if (t === 'Link') {
        const j = str.indexOf(SEP, i + 1);
        if (j < 0) continue;
        url = str.slice(i + 1, j);
        i = j;
      }
      stack.push({ t, url, kids: [] });
    } else {
      let k = stack.length - 1;
      while (k >= 0 && stack[k].t !== t) k--;
      if (k < 0) continue; // بستن بدون باز شدن
      while (stack.length - 1 > k) finish(stack.pop());
      finish(stack.pop());
    }
  }
  flush();
  while (stack.length) finish(stack.pop());
  return top;
}

// ورودی: رشته‌ی نشانگردار | آرایه‌ی تودرتو از رشته/null/{t,s}
function toSegs(content) {
  const arr = Array.isArray(content) ? content.flat(Infinity) : [content];
  const out = [];
  for (const x of arr) {
    if (x == null || x === false) continue;
    if (typeof x === 'object') out.push({ t: x.t || null, s: x.s == null ? '' : String(x.s), url: x.url });
    else out.push(...decode(String(x)));
  }
  return out;
}

// ---------- ۲) تقسیم به خط‌ها و پیام‌ها ----------
function toLines(segs) {
  const lines = [[]];
  segs.forEach((g, id) => {
    g.s.split('\n').forEach((p, i) => {
      if (i) lines.push([]);
      // بخش خالی فقط برای بلوک‌های چندخطی نگه داشته می‌شود (خط خالی داخل نقل‌قول)
      if (p || g.t === 'Quote' || g.t === 'Pre') lines[lines.length - 1].push({ ...g, s: p, id });
    });
  });
  return lines;
}
const lineLen = (ln) => ln.reduce((n, x) => n + x.s.length, 0);

// خط بلندتر از حد مجاز را تکه‌تکه می‌کند
function splitLong(ln, max) {
  const out = [];
  let cur = [];
  let n = 0;
  for (const g of ln) {
    let s = g.s;
    while (s.length) {
      const room = max - n;
      if (room <= 0) { out.push(cur); cur = []; n = 0; continue; }
      let take = Math.min(room, s.length);
      // سورگیت‌ها را از وسط نبُر
      if (take < s.length && /[\uD800-\uDBFF]/.test(s[take - 1])) take--;
      cur.push({ ...g, s: s.slice(0, take), id: g.id + '.' + out.length });
      n += take;
      s = s.slice(take);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function chunkLines(lines, max) {
  const chunks = [];
  let cur = [];
  let n = 0;
  const push = () => { if (cur.length) chunks.push(cur); cur = []; n = 0; };
  for (const ln of lines.flatMap((l) => (lineLen(l) > max ? splitLong(l, max) : [l]))) {
    const w = lineLen(ln) + 1;
    if (n + w > max && cur.length) push();
    cur.push(ln);
    n += w;
  }
  push();
  return chunks.length ? chunks : [[[]]];
}

// خط‌ها → قطعه‌ها؛ خط‌های پشت سر هم از «یک» بلوک (Quote/Pre با شناسه‌ی یکسان) دوباره یکی می‌شوند
function linesToSegs(lines) {
  const out = [];
  lines.forEach((ln, i) => {
    let rest = ln;
    if (i > 0) {
      const prev = lines[i - 1];
      const a = prev[prev.length - 1];
      const b = ln[0];
      if (a && b && a.id === b.id && (b.t === 'Quote' || b.t === 'Pre')) {
        out[out.length - 1].s += '\n' + b.s;
        rest = ln.slice(1);
      } else out.push({ t: null, s: '\n' });
    }
    out.push(...rest.map((x) => ({ ...x })));
  });
  return out;
}

// ---------- ۳) ساخت پیام ----------
const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const split3 = (s) => {
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return [m[1], m[2], m[3]];
};
const tidy = (t) => (t.trim() ? t : ' ');

function renderChunk(segs) {
  // متن ساده (برای حالت plain و فالبک)
  const plain = tidy(segs.map((g) => g.s).join('').trim());
  if (mode === 'plain' || !segs.some((g) => g.t && g.s.trim())) return { text: plain, plain };

  if (mode === 'html') {
    const tag = { Mono: 'code', Quote: 'blockquote', Bold: 'b', Pre: 'pre' };
    const html = segs.map((g) => {
      if (!g.t || !g.s.trim()) return esc(g.s);
      const [l, c, r] = split3(g.s);
      if (g.t === 'Link') return /^https?:\/\/[^\s"'<>]+$/.test(g.url || '') ? `${l}<a href="${g.url}">${esc(c)}</a>${r}` : esc(g.s);
      return `${l}<${tag[g.t]}>${esc(c)}</${tag[g.t]}>${r}`;
    }).join('');
    return { text: tidy(html.trim()), parse_mode: 'HTML', plain };
  }

  if (mode === 'markdown') {
    // علامت‌های مارک‌داون از متن کاربر حذف می‌شوند تا استایل جعل نشود
    const sx = (x) => x.replace(/[`*_~|[\]]/g, '');
    const md = segs.map((g) => {
      if (!g.t || !g.s.trim()) return sx(g.s);
      const [l, c, r] = split3(g.s);
      const v = sx(c);
      if (g.t === 'Mono') return `${l}\`${v}\`${r}`;
      if (g.t === 'Bold') return `${l}**${v}**${r}`;
      if (g.t === 'Pre') return `${l}\`\`\`${v}\`\`\`${r}`;
      if (g.t === 'Link') return /^https?:\/\/[^\s)]+$/.test(g.url || '') ? `${l}[${v}](${g.url})${r}` : sx(g.s);
      return l + v.split('\n').map((x) => '> ' + x).join('\n') + r; // Quote
    }).join('');
    return { text: tidy(md.trim()), parse_mode: 'Markdown', plain };
  }

  // metadata
  let text = '';
  const parts = [];
  for (const g of segs) {
    if (!g.s) continue;
    if (!g.t || !g.s.trim()) { text += g.s; continue; }
    const [l, c, r] = split3(g.s);
    text += l;
    const p = { type: g.t, from_index: len(text), length: len(c) };
    if (g.t === 'Link') {
      if (!/^https?:\/\/[^\s"'<>]+$/.test(g.url || '')) { text += c + r; continue; }
      p.link_url = g.url;
    }
    parts.push(p);
    text += c + r;
  }
  // حذف فاصله‌های ابتدای کل متن؛ آفست‌ها هم‌زمان جابه‌جا می‌شوند (سرور ممکن است متن را trim کند)
  const trimmed = text.trimStart();
  const lead = len(text.slice(0, text.length - trimmed.length));
  if (lead) parts.forEach((p) => { p.from_index -= lead; });
  text = trimmed.trimEnd();
  if (!text) return { text: ' ', plain: ' ' };
  // نگهبان نهایی: هیچ دو استایلی نباید هم‌پوشانی داشته باشند
  parts.sort((x, y) => x.from_index - y.from_index);
  const okParts = [];
  let end = 0;
  for (const q of parts) {
    if (q.from_index < end || q.length <= 0) continue;
    okParts.push(q);
    end = q.from_index + q.length;
  }
  return okParts.length ? { text, metadata: { meta_data_parts: okParts }, plain } : { text, plain };
}

// خروجی: آرایه‌ای از پیام‌ها؛ هر کدام {text, metadata | parse_mode, plain}
function build(content, max = 3800) {
  const lines = toLines(toSegs(content));
  return chunkLines(lines, max).map((ch) => renderChunk(linesToSegs(ch)));
}

// متن ساده بدون استایل
const strip = (content) => build(content, 1e9).map((p) => p.plain).join('\n');

module.exports = { build, strip, setMode, getMode, setIndex, decode, toSegs };
