// Structural validation of the revamped collection + environment.
const fs = require('fs');
const { guides } = require('./load.cjs');
const DIR = require('path').resolve(__dirname, '..');
const rawCol = fs.readFileSync(DIR + '/VoApps_API_Collection_REVAMPED.postman_collection.json', 'utf8');
const rawEnv = fs.readFileSync(DIR + '/VoApps_API.postman_environment.json', 'utf8');
const col = JSON.parse(rawCol);
const env = JSON.parse(rawEnv);
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('FAIL: ' + msg); } };
const info = msg => console.log('  ' + msg);

// ---- 1. format
ok(col.info.schema === 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', 'schema is v2.1.0');
ok(!!col.info._postman_id && !!col.info.name, 'info has _postman_id and name');
ok(col.auth && col.auth.type === 'apikey' && JSON.stringify(col.auth).includes('Token token={{api_key}}'), 'collection-level auth uses Token token={{api_key}}');
ok(env._postman_variable_scope === 'environment' && Array.isArray(env.values), 'environment file shape');

// ---- walk
const requests = [];
(function walk(items, path) {
  const seen = new Set();
  items.forEach(it => {
    ok(!seen.has(it.name), 'duplicate name in ' + (path.join(' / ') || '(root)') + ': ' + it.name);
    seen.add(it.name);
    if (it.item) walk(it.item, path.concat(it.name)); else requests.push({ it, path: path.concat(it.name) });
  });
})(col.item, []);
info('requests: ' + requests.length + ', folders: ' + (function c(items) { return items.reduce((n, i) => n + (i.item ? 1 + c(i.item) : 0), 0); })(col.item));

// ---- 2. every URL uses {{base_url}}; no hard-coded hosts anywhere in request definitions
const HOST = /https?:\/\/(?!\{\{)/i;
requests.forEach(({ it, path }) => {
  const r = it.request, n = path.join(' / ');
  ok(r.url.raw.startsWith('{{base_url}}/'), 'URL does not start with {{base_url}}: ' + n + ' -> ' + r.url.raw);
  ok(JSON.stringify(r.url.host) === '["{{base_url}}"]', 'URL host is not ["{{base_url}}"]: ' + n);
  const noDesc = (k, v) => (k === 'description' ? undefined : v);
  const fn = JSON.stringify({ u: r.url, h: r.header, b: r.body }, noDesc);
  const m = fn.match(/https?:\/\/[^"\\ ]+/g) || [];
  // values such as the guide's sample postback URL are body DATA, not request hosts: allow only example.com
  m.forEach(h => ok(/example\.com/.test(h), 'hard-coded host in ' + n + ': ' + h));
  ok(['GET', 'POST', 'PUT'].includes(r.method), 'method ' + r.method + ' in ' + n);
});

// ---- 3. every {{variable}} used in url/query/headers/body/auth is defined (collection or environment) or a dynamic $var
const defined = new Set(col.variable.map(v => v.key));
const envKeys = new Set(env.values.map(v => v.key));
const usedIn = (obj, set) => { (JSON.stringify(obj).match(/\{\{[^{}]+\}\}/g) || []).forEach(t => set.add(t.slice(2, -2).trim())); };
const used = new Set();
usedIn(col.auth, used);
(function walk(items) { items.forEach(it => { if (it.auth) usedIn(it.auth, used); if (it.item) walk(it.item); else usedIn({ u: it.request.url, h: it.request.header, b: it.request.body, a: it.request.auth }, used); }); })(col.item);
[...used].filter(k => !k.startsWith('$')).forEach(k => ok(defined.has(k), 'variable used but not defined in the collection: {{' + k + '}}'));
[...used].filter(k => !k.startsWith('$')).forEach(k => { if (!defined.has(k) && !envKeys.has(k)) ok(false, 'variable undefined everywhere: ' + k); });
info('variables used: ' + [...used].sort().join(', '));
// user-editable collection variables should be mirrored in the environment (computed ones are collection-only)
col.variable.filter(v => !/^Computed by the collection pre-request/.test(v.description)).forEach(v => ok(envKeys.has(v.key), 'collection variable missing from environment: ' + v.key));
env.values.forEach(v => ok(defined.has(v.key), 'environment variable missing from collection: ' + v.key));

// ---- 4. secrets blank / none embedded
['api_key', 'partner_api_key'].forEach(k => {
  ok((col.variable.find(v => v.key === k) || {}).value === '', k + ' is blank in the collection');
  const e = env.values.find(v => v.key === k);
  ok(e && e.value === '' && e.type === 'secret', k + ' is blank and type secret in the environment');
});
ok(!/PMAT-|access_key|api\.postman\.com/i.test(rawCol + rawEnv), 'no Postman access key / private URL in the files');
ok(!/12API7Example24Key46bXe4/.test(rawCol), 'guide sample key not embedded');
(rawCol.match(/Token token=[^"\\\s,)`]*/g) || []).forEach(t => ok(/^Token token=(\{\{(api_key|partner_api_key)\}\}|not-a-real-api-key|<[a-z_]+>)[.;:]?$/.test(t) || /^Token token=$/.test(t), 'suspicious auth text: ' + t));
ok(!/[A-Za-z0-9]{32,}/.test(JSON.stringify(col.item).replace(/https?:\/\/[^"\\ ]+/g, '')), 'no long token-like strings in requests');

// ---- 5. scripts parse
let scripts = 0;
const parseScript = (text, where) => { scripts++; try { new Function(text); } catch (e) { ok(false, 'script syntax error in ' + where + ': ' + e.message); } };
col.event.forEach(e => parseScript(e.script.exec.join('\n'), 'collection ' + e.listen));
requests.forEach(({ it, path }) => (it.event || []).forEach(e => parseScript(e.script.exec.join('\n'), path.join(' / ') + ' [' + e.listen + ']')));
info('scripts syntax-checked: ' + scripts);

// ---- 6. examples
let examples = 0;
requests.forEach(({ it, path }) => (it.response || []).forEach(r => {
  examples++;
  try { JSON.parse(r.body); } catch (e) { ok(false, 'example body is not JSON: ' + path.join(' / ') + ' / ' + r.name); }
  ok(r.originalRequest && r.originalRequest.url.raw.startsWith('{{base_url}}/'), 'example originalRequest URL: ' + r.name);
  ok(typeof r.code === 'number' && r.status, 'example has code/status: ' + r.name);
}));
info('saved examples: ' + examples);
const withSuccess = requests.filter(({ it, path }) => path[0] !== 'Smoke Tests (run in order)' || /^E\./.test(path[1])).filter(({ it }) => !/\(.*(Invalid|No Auth|Unknown|Missing|No Date|Without Pausing)/.test(it.name) && !(it.response || []).some(r => r.code >= 200 && r.code < 300));
withSuccess.forEach(({ path }) => ok(false, 'no 2xx example on non-error request: ' + path.join(' / ')));

// ---- 7. result names / house style
const CANON = ['Pending', 'Running', 'Successfully delivered', 'Expired', 'Canceled', 'Unsuccessful delivery attempt', 'Not a wireless number', 'Duplicate number', 'Not a valid US number', 'Undeliverable', 'Not in service', 'Voicemail not setup', 'Voicemail full', 'Invalid caller number', 'Invalid message id', 'Prohibited self call', 'Restricted', 'Restricted for frequency', 'Restricted geographical region', 'Restricted individual number', 'Restricted WebRecon'];
CANON.forEach(n => ok(rawCol.includes('"' + n + '"') || rawCol.includes(n), 'result name present: ' + n));
const recInfo = requests.find(({ path }) => path.join(' / ') === 'Transactional Records / GET | Record Information').it;
const exNames = recInfo.response.filter(r => r.code === 200).map(r => JSON.parse(r.body).record.delivery_status);
CANON.forEach(n => ok(exNames.includes(n), 'Record Information has an example for result: ' + n));
ok(!/—/.test(rawCol + rawEnv), 'no em dashes in the files');
ok(!/result file|response file/i.test(rawCol.replace(/results file/gi, '')), 'house terminology: "results file", never "result file"/"response file"');
ok(!/portal/i.test(rawCol.replace(/VoApps client web portal/g, '')), 'no stray "portal" wording (only the full "VoApps client web portal" is allowed)');
ok(!/DDVM/.test(rawCol), 'DDVM is spelled out');

// ---- 8. KB links resolve
const KB = 'https://voapps.com/hubfs/Client_Success/VoApps_Knowledge_Base.html';
const links = new Set((rawCol.match(/https:\/\/voapps\.com\/hubfs\/Client_Success\/VoApps_Knowledge_Base\.html#[A-Za-z0-9_\/-]*/g) || []));
let kbOk = 0;
links.forEach(l => {
  const hash = l.slice(KB.length + 1);
  const [g, s] = hash.split('/');
  const gg = guides.find(x => x.id === g);
  let good = !!gg;
  if (good && s) good = gg.steps.some(x => x.slug === s) || (gg.subAnchors && s in gg.subAnchors) || gg.steps.some(x => x.content.includes('id="' + s + '"'));
  ok(good, 'KB link does not resolve: ' + l);
  if (good) kbOk++;
});
info('distinct Knowledge Base links: ' + links.size + ' (' + kbOk + ' resolve)');

// ---- 9. every request description links to the KB
requests.forEach(({ it, path }) => ok(/VoApps_Knowledge_Base\.html/.test(it.request.description || ''), 'request description has no KB link: ' + path.join(' / ')));
ok(/VoApps_Knowledge_Base\.html/.test(col.info.description), 'collection description links to the KB');

// ---- 10. smoke order
const smoke = col.item[0];
const steps = [].concat(...smoke.item.map(f => f.item.map(i => i.name)));
steps.forEach((n, i) => ok(n.startsWith(String(i + 1).padStart(2, '0') + '. '), 'smoke step out of order: ' + n + ' at position ' + (i + 1)));
info('smoke steps: ' + steps.length);

console.log(fails ? '\n' + fails + ' FAILED of ' + checks + ' checks' : '\nAll ' + checks + ' structural checks passed');
process.exit(fails ? 1 : 0);
