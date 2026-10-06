// Guide-extraction helpers. Everything here is JSON-aware / quote-aware: it never splits HTML with a bare <[^>]+> regex.
const { guides } = require('./load.cjs');

const api = guides.find(g => g.id === 'api');
const KB = 'https://voapps.com/hubfs/Client_Success/VoApps_Knowledge_Base.html';
const TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:[^>"']|"[^"]*"|'[^']*')*>/g;

const NAMED = {
  nbsp: ' ', ndash: '–', mdash: '–', lt: '<', gt: '>', quot: '"', amp: '&', apos: "'",
  ldquo: '"', rdquo: '"', lsquo: "'", rsquo: "'", rarr: '→', minus: '−', plusmn: '±', hellip: '…', larr: '←',
};
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in NAMED ? NAMED[n.toLowerCase()] : m));
}

// Static stand-ins for the guide's <span class="live-date"> spans (the renderer fills them with "now" at view time).
const SAMPLE = {
  'iso-z': '2026-10-06T15:16:39.074Z',
  'iso-tz': '2026-10-06 11:16:39 -04:00',
  'iso-utc': '2026-10-06 15:16:39 UTC',
  'ymd': '2026-10-06',
  '': '2026-10-06',
};
function liveDates(html) {
  return html.replace(/<span class="live-date"([^>]*)><\/span>/g, (m, attrs) => {
    const f = (attrs.match(/data-format="([^"]*)"/) || [])[1] || '';
    return SAMPLE[f] || SAMPLE[''];
  });
}

function absLink(href) {
  if (/^https?:/i.test(href)) return href;
  if (href.startsWith('#')) return KB + href;
  return href;
}

// Rich inline HTML -> markdown-ish text. Keeps code, bold, italics and links.
function inline(html) {
  html = liveDates(html);
  html = html.replace(/<span class="material-symbols-rounded"[^>]*>[^<]*<\/span>/g, '');
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<(code)(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/code>/gi, (m, t, c) => '`' + strip(c) + '`');
  html = html.replace(/<(strong|b)(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/\1>/gi, (m, t, c) => (strip(c).trim() ? '**' + strip(c).trim() + '**' : ''));
  html = html.replace(/<(em|i)(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/\1>/gi, (m, t, c) => (strip(c).trim() ? '_' + strip(c).trim() + '_' : ''));
  html = html.replace(/<a\s(?:[^>"']|"[^"]*"|'[^']*')*?href=(?:"([^"]*)"|'([^']*)')(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/a>/gi,
    (m, a, b, c) => {
      const label = strip(c).replace(/#\s*$/, '').trim();
      return label ? '[' + label + '](' + absLink(decode(a || b)) + ')' : '';
    });
  return decode(strip(html)).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}
function strip(html) { return html.replace(TAG, ''); }

function stepBySlug(slug) {
  const s = api.steps.find(x => x.slug === slug);
  if (!s) throw new Error('No API guide step with slug ' + slug);
  return s;
}

// All <table> blocks of a step, each with the label text that precedes it.
function tables(slug) {
  const c = stepBySlug(slug).content;
  const out = [];
  const re = /<table[^>]*>([\s\S]*?)<\/table>/g;
  let m, last = 0;
  while ((m = re.exec(c))) {
    const before = inline(c.slice(last, m.index)).split('\n').filter(Boolean).slice(-1)[0] || '';
    const rows = [];
    const rr = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let r;
    while ((r = rr.exec(m[1]))) {
      const cells = [];
      const cr = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g;
      let cc;
      while ((cc = cr.exec(r[1]))) cells.push(inline(cc[1]).replace(/\n+/g, ' '));
      if (cells.length) rows.push(cells);
    }
    out.push({ label: before, rows });
    last = m.index + m[0].length;
  }
  return out;
}
function mdTable(rows) {
  if (!rows || !rows.length) return '';
  const esc = c => c.replace(/\|/g, '\\|');
  const w = rows[0].length;
  const norm = rows.map(r => r.concat(Array(Math.max(0, w - r.length)).fill('')).slice(0, w).map(esc));
  const lines = ['| ' + norm[0].join(' | ') + ' |', '|' + norm[0].map(() => ' --- ').join('|') + '|'];
  norm.slice(1).forEach(r => lines.push('| ' + r.join(' | ') + ' |'));
  return lines.join('\n');
}

// Callout boxes (tip/info/note/important) as {kind, text}.
function boxes(slug) {
  const c = stepBySlug(slug).content;
  const out = [];
  const re = /<div class="box-(tip|info|note|important)"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(c))) out.push({ kind: m[1], text: inline(m[2]) });
  return out;
}

// Code blocks (<pre class="code-block">) with the label that precedes them.
function codeBlocks(slug) {
  const c = stepBySlug(slug).content;
  const out = [];
  const re = /<pre class="code-block"[^>]*>([\s\S]*?)<\/pre>/g;
  let m, last = 0;
  while ((m = re.exec(c))) {
    const label = inline(c.slice(last, m.index)).split('\n').filter(Boolean).slice(-1)[0] || '';
    out.push({ label, text: decode(strip(liveDates(m[1]))) });
    last = m.index + m[0].length;
  }
  return out;
}
// The guide's "Example Response" JSON for a step, parsed. Repairs the one known-invalid sample (unescaped quotes in original_fields).
function exampleResponse(slug) {
  const b = codeBlocks(slug).find(x => /^Example Response/i.test(x.label));
  if (!b) throw new Error('No Example Response on ' + slug);
  let t = b.text;
  t = t.replace(/"original_fields":\s*"(\{[^\n]*\})"/, '"original_fields": $1');
  return JSON.parse(t);
}

// Result Codes table from the webhook step: [{name, code, postback}]
function resultCodes() {
  const t = tables('webhook-postback-url').find(x => /^Result\b/.test(x.rows[0][0]) && /Code/.test(x.rows[0][1]));
  return t.rows.slice(1).map(r => ({ name: r[0].trim(), code: parseInt(r[1], 10), postback: !/⌀/.test(r[2]) && r[2].trim() !== '' }));
}
// Timestamp reference: which result codes carry a timestamp (non-null) per the guide.
function timestampCodes() {
  const t = tables('results-timestamps').find(x => /UTC Timestamp/.test(x.rows.map(r => r.join(' ')).join(' ')) || x.rows[0].join(' ').includes('Result'));
  // rows: Result | Code | UTC Timestamp | Offset Timestamp | Postback?
  return t.rows.slice(1).filter(r => r.length >= 4).map(r => ({ name: r[0].trim(), code: parseInt(r[1], 10), hasTimestamp: r[2].replace(/[`_]/g, "").trim() !== "null" }));
}

// Parameter-table lookup: name -> "Note – Description"
function paramMap(slug, tableIndex = 0) {
  const t = tables(slug)[tableIndex];
  const map = {};
  if (!t) return map;
  t.rows.slice(1).forEach(r => {
    if (r.length < 3) return;
    const note = r[1].replace(/\s+/g, ' ').trim();
    const desc = r[2];
    r[0].split(/\s+\/\s+|\s+or\s+/).forEach(k => {
      const key = k.replace(/`/g, '').trim();
      map[key] = { note, desc, text: (note ? note + ' – ' : '') + desc };
    });
  });
  return map;
}

function kbLink(slug) { return KB + '#api/' + slug; }

module.exports = { api, KB, kbLink, inline, decode, tables, mdTable, boxes, codeBlocks, exampleResponse, resultCodes, timestampCodes, paramMap, stepBySlug, SAMPLE };
