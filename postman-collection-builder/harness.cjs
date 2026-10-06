// Executes the collection's REAL scripts against a mock of Postman's `pm` sandbox.
// Not Postman itself: it checks script logic (tests vs the saved examples, guard, switches, variable saving).
const fs = require('fs');
const DIR = require('path').resolve(__dirname, '..');
const col = JSON.parse(fs.readFileSync(DIR + '/VoApps_API_Collection_REVAMPED.postman_collection.json', 'utf8'));

// ------------------------------------------------------------ mini chai
class AssertionError extends Error {}
function expect(val, msg) {
  const pre = msg ? msg + ': ' : '';
  const mk = (neg) => {
    const fail = (what) => { throw new AssertionError(pre + 'expected ' + JSON.stringify(val) + (neg ? ' not ' : ' ') + what); };
    const check = (cond, what) => { if (neg ? cond : !cond) fail(what); };
    const chain = {};
    const self = () => proxy;
    const methods = {
      a: t => { const actual = Array.isArray(val) ? 'array' : val === null ? 'null' : typeof val; check(actual === t, 'to be a ' + t + ' (was ' + actual + ')'); return proxy; },
      property: p => { check(val !== null && val !== undefined && Object.prototype.hasOwnProperty.call(Object(val), p), 'to have property ' + p); return proxy; },
      within: (a, b) => { check(typeof val === 'number' && val >= a && val <= b, 'to be within ' + a + '..' + b); return proxy; },
      below: n => { check(val < n, 'to be below ' + n); return proxy; },
      above: n => { check(val > n, 'to be above ' + n); return proxy; },
      least: n => { check(val >= n, 'to be at least ' + n); return proxy; },
      most: n => { check(val <= n, 'to be at most ' + n); return proxy; },
      oneOf: arr => { check(arr.indexOf(val) >= 0, 'to be one of ' + JSON.stringify(arr)); return proxy; },
      eql: o => { check(JSON.stringify(val) === JSON.stringify(o), 'to deeply equal ' + JSON.stringify(o)); return proxy; },
      include: x => { check(typeof val === 'string' ? val.indexOf(x) >= 0 : Array.isArray(val) ? val.indexOf(x) >= 0 : (val && x in val), 'to include ' + JSON.stringify(x)); return proxy; },
      match: re => { check(re.test(String(val)), 'to match ' + re); return proxy; },
      lengthOf: n => { check(val.length === n, 'to have length ' + n); return proxy; },
    };
    methods.an = methods.a; methods.equal = methods.eql; methods.equals = methods.eql; methods.eq = methods.eql; methods.contain = methods.include; methods.includes = methods.include;
    const props = {
      ok: () => check(!!val, 'to be truthy'), exist: () => check(val !== null && val !== undefined, 'to exist'),
      empty: () => check((Array.isArray(val) || typeof val === 'string') ? val.length === 0 : Object.keys(val || {}).length === 0, 'to be empty'),
      true: () => check(val === true, 'to be true'), false: () => check(val === false, 'to be false'),
    };
    const words = new Set(['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'does', 'still', 'also', 'not_']);
    const proxy = new Proxy(chain, {
      get(_, k) {
        if (k === 'not') return mk(!neg);
        if (words.has(k)) return proxy;
        if (k in props) { props[k](); return proxy; }
        if (k in methods) return methods[k];
        throw new Error('mini-chai: unsupported assertion ".' + String(k) + '" (use only documented chai assertions)');
      },
    });
    return proxy;
  };
  return mk(false);
}

// ------------------------------------------------------------ pm mock
function propertyList(arr) { return { each: fn => arr.forEach(fn), all: () => arr, has: k => arr.some(x => x.key === k) }; }
function makePm({ item, scopes, response, envName, localVars }) {
  const results = [], logs = [], warns = [];
  const local = Object.assign({}, localVars);
  const envVars = scopes.env, colVars = scopes.col;
  const get = k => (k in local ? local[k] : (envName && k in envVars) ? envVars[k] : colVars[k]);
  const r = item.request;
  const q = ((r.url.query) || []).map(x => ({ key: x.key, value: x.value, disabled: !!x.disabled }));
  const hdr = (r.header || []).map(x => ({ key: x.key, value: x.value, disabled: !!x.disabled }));
  const body = r.body ? { mode: r.body.mode, formdata: propertyList((r.body.formdata || []).map(p => ({ key: p.key, value: p.value, type: p.type, src: p.src, disabled: !!p.disabled }))), urlencoded: propertyList((r.body.urlencoded || []).map(p => ({ key: p.key, value: p.value, disabled: !!p.disabled }))), raw: r.body.raw } : null;
  const state = { skipped: false, urlUpdated: null };
  const pmObj = {
    execution: { skipRequest: () => { state.skipped = true; } },
    variables: { get, set: (k, v) => { local[k] = v; }, has: k => get(k) !== undefined },
    environment: { name: envName, get: k => envVars[k], set: (k, v) => { envVars[k] = v; } },
    collectionVariables: { get: k => colVars[k], set: (k, v) => { colVars[k] = v; } },
    info: { requestName: item.name },
    request: { url: { update: u => { state.urlUpdated = u; }, getHost: () => r.url.host.join('.'), getPath: () => '/' + r.url.path.join('/'), query: propertyList(q), toString: () => r.url.raw }, headers: propertyList(hdr), body },
    response: response && {
      code: response.code, responseTime: 120, json: () => JSON.parse(response.body), text: () => response.body,
      headers: { get: () => 'application/json; charset=utf-8' },
    },
    test(name, fn) { try { fn(); results.push({ name, pass: true }); } catch (e) { results.push({ name, pass: false, error: e.message }); } },
    expect,
    visualizer: { set() {} },
  };
  const con = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => warns.push(a.join(' ')) };
  return { pm: pmObj, results, logs, warns, local, state };
}
const run = (script, ctx) => new Function('pm', 'console', script)(ctx.pm, { log: (...a) => ctx.logs.push(a.join(' ')), warn: (...a) => ctx.warns.push(a.join(' ')), error: (...a) => ctx.warns.push('ERROR ' + a.join(' ')) });
const scriptOf = (events, listen) => { const e = (events || []).find(x => x.listen === listen); return e ? e.script.exec.join('\n') : ''; };

// ------------------------------------------------------------ gather items
const items = [];
(function walk(list, path) { list.forEach(i => (i.item ? walk(i.item, path.concat(i.name)) : items.push({ item: i, path: path.concat(i.name) }))); })(col.item, []);
const baseName = n => n.replace(/^\d\d\. /, '');
const refExamples = {};
items.filter(x => x.path[0] !== 'Smoke Tests (run in order)').forEach(x => { refExamples[x.item.name] = x.item.response; });

const sampleScopes = (withKey = true) => {
  const colv = {};
  col.variable.forEach(v => { colv[v.key] = v.value; });
  Object.assign(colv, { api_key: withKey ? 'k-test' : '', partner_api_key: 'pk-test', account_id: '3530', message_id: '123', caller_number_id: '123', voapps_caller_number: '+15555551212', campaign_id: '1', record_id: '1234', partner_user_id: '456', new_caller_number: '555-555-1212' });
  return { col: colv, env: {} };
};

let fails = 0, asserts = 0, testsRun = 0, scriptsRun = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('FAIL: ' + m); } };
const fmtFails = r => r.filter(t => !t.pass).map(t => '"' + t.name + '" -> ' + t.error).join(' | ');

// ---- A. guard + helper variables
{
  const pre = col.event.find(e => e.listen === 'prerequest').script.exec.join('\n');
  const ctx = makePm({ item: items[0].item, scopes: sampleScopes(), response: null, envName: null });
  run(pre, ctx); scriptsRun++;
  const L = ctx.local;
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(L.now_utc), 'now_utc is ISO with Z: ' + L.now_utc);
  ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/.test(L.now_utc_label), 'now_utc_label: ' + L.now_utc_label);
  ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$/.test(L.now_local_offset), 'now_local_offset: ' + L.now_local_offset);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(L.today_utc) && L.today_utc === L.now_utc.slice(0, 10), 'today_utc matches now_utc date');
  ok(L.target_date === L.today_utc + 'T10:01:00Z', 'target_date follows {date}T10:01:00Z: ' + L.target_date);
  ok(new Date(L.target_date_utc_label.replace(' UTC', 'Z').replace(' ', 'T')).getTime() === new Date(L.target_date).getTime(), 'target_date_utc_label is the same instant');
  ok(new Date(L.target_date_local_offset.replace(' ', 'T').replace(' ', '')).getTime() === new Date(L.target_date).getTime(), 'target_date_local_offset is the same instant: ' + L.target_date_local_offset);
  const wk = (new Date(L.today_utc) - new Date(L.week_ago_utc)) / 86400000;
  ok(wk >= 6 && wk <= 8, 'week_ago_utc is ~7 days earlier');
  ok(L.new_campaign_name === 'postman-test-campaign-' + L.run_id, 'new_campaign_name uses run_id');
}
// guard: every request, blank each non-computed variable it uses -> must throw naming that variable; fully configured -> must not throw
const COMPUTED = new Set(col.variable.filter(v => /^Computed by/.test(v.description)).map(v => v.key));
let guardChecks = 0;
items.forEach(({ item, path }) => {
  const pre = col.event.find(e => e.listen === 'prerequest').script.exec.join('\n');
  const r = item.request;
  const used = new Set();
  const active = JSON.stringify({ u: (r.url.query || []).filter(x => !x.disabled), p: r.url.path, h: (r.header || []).filter(x => !x.disabled), b: r.body ? { f: (r.body.formdata || []).filter(x => !x.disabled && x.type !== 'file'), u: (r.body.urlencoded || []).filter(x => !x.disabled) } : null });
  (active.match(/\{\{[^{}]+\}\}/g) || []).forEach(t => { const k = t.slice(2, -2).trim(); if (!k.startsWith('$') && !COMPUTED.has(k)) used.add(k); });
  // configured: no throw
  const ctx = makePm({ item, scopes: sampleScopes(), response: null, envName: null });
  try { run(pre, ctx); guardChecks++; } catch (e) { ok(false, 'guard threw on a fully configured request: ' + path.join(' / ') + ': ' + e.message); }
  used.forEach(k => {
    const sc = sampleScopes(); sc.col[k] = '';
    const c2 = makePm({ item, scopes: sc, response: null, envName: null });
    let thrown = null;
    try { run(pre, c2); } catch (e) { thrown = e; }
    ok(thrown && thrown.message.includes('{{' + k + '}}') && c2.state.skipped, 'guard did not stop (throw + skip) ' + path.join(' / ') + ' when {{' + k + '}} is empty');
    guardChecks++;
  });
});

// ---- B. safety switches
const switchCases = [['confirm_cancel', 'PUT | Update a Campaign (Cancel)'], ['confirm_cancel', 'PUT | Update a Campaign (Cancel Without Pausing)'], ['confirm_create_account', 'POST | Create an Account']];
switchCases.forEach(([v, name]) => {
  const it = items.find(x => baseName(x.item.name) === name).item;
  const src = scriptOf(it.event, 'prerequest');
  const mk = val => { const sc = sampleScopes(); sc.col[v] = val; return makePm({ item: it, scopes: sc, response: null, envName: null }); };
  const m1 = mk('false'); let t = null; try { run(src, m1); } catch (e) { t = e; }
  ok(t && /Set the .* variable to true/.test(t.message) && m1.state.skipped, name + ' is blocked (thrown AND request skipped) while ' + v + ' = false');
  const m2 = mk('true'); let t2 = null; try { run(src, m2); } catch (e) { t2 = e; }
  ok(!t2 && !m2.state.skipped, name + ' is allowed (not skipped) when ' + v + ' = true');
  guardChecks += 2;
});
// default switches are all false
['confirm_campaign', 'verified_by_user', 'confirm_cancel', 'confirm_create_account'].forEach(k => ok(col.variable.find(v => v.key === k).value === 'false', k + ' defaults to false'));

// ---- C. tests vs saved examples
const seedFor = (body) => {
  const s = {};
  try {
    const j = JSON.parse(body);
    if (j.accounts && j.accounts[0]) { s.new_account_name = j.accounts[0].name; s.account_timezone = j.accounts[0].timezone; }
    if (j.message) { s.new_message_name = j.message.name; s.new_message_description = j.message.description; s.message_id = String(j.message.id); }
    if (j.caller_number) { s.new_caller_number_name = j.caller_number.name; s.caller_number_id = String(j.caller_number.id); }
    if (j.campaign) { s.new_campaign_name = j.campaign.name; s.campaign_id = String(j.campaign.id); }
    if (j.record) { s.record_id = String(j.record.id); }
  } catch (e) { /* error bodies */ }
  return s;
};
const collTest = col.event.find(e => e.listen === 'test').script.exec.join('\n');
let exampleRuns = 0, successPass = 0, errorHandled = 0;
const perRequest = [];
items.forEach(({ item, path }) => {
  const exs = item.response && item.response.length ? item.response : (refExamples[baseName(item.name)] || []);
  const testSrc = scriptOf(item.event, 'test');
  const expects4xx = /^E\./.test(path[1] || '');
  const isNegSmoke = expects4xx || /Cancel Without Pausing/.test(item.name);
  exs.forEach(ex => {
    exampleRuns++;
    const sc = sampleScopes();
    sc.col.confirm_cancel = 'true'; sc.col.confirm_create_account = 'true';
    const seed = seedFor(ex.body);
    Object.assign(sc.col, seed);
    // pre-seed the run-local helper names the tests compare against
    const local = Object.assign({ run_id: '1', new_account_name: sc.col.new_account_name, account_timezone: sc.col.account_timezone }, seed);
    const ctx = makePm({ item, scopes: sc, response: ex, envName: null, localVars: local });
    let crashed = null;
    try { const preSrc = scriptOf(item.event, 'prerequest'); if (preSrc) { run(preSrc, ctx); scriptsRun++; } run(testSrc, ctx); run(collTest, ctx); scriptsRun += 2; } catch (e) { crashed = e; }
    testsRun += ctx.results.length;
    const failed = ctx.results.filter(t => !t.pass);
    const is2xx = ex.code >= 200 && ex.code < 300;
    ok(!crashed, 'script CRASHED on example "' + ex.name + '" of ' + path.join(' / ') + ': ' + (crashed && crashed.message));
    if (isNegSmoke) {
      // negative requests: a 4xx example must pass every test
      ok(failed.length === 0, 'negative request failed on its own 4xx example: ' + path.join(' / ') + ' / ' + ex.name + ' :: ' + fmtFails(ctx.results));
      successPass++;
    } else if (is2xx) {
      ok(failed.length === 0, 'success example failed tests: ' + path.join(' / ') + ' / ' + ex.name + ' :: ' + fmtFails(ctx.results));
      successPass++;
    } else {
      // error example on a success-expecting request: the status test must catch it, and nothing may crash
      ok(failed.some(t => /Status code is 2xx/.test(t.name)), 'error example not caught by status test: ' + path.join(' / ') + ' / ' + ex.name);
      errorHandled++;
    }
  });
  perRequest.push({ n: path.join(' / '), tests: (testSrc.match(/pm\.test\(/g) || []).length, ex: exs.length });
});

// ---- D. saving behaviour (collection vs environment, keep-or-pick-first)
{
  const it = items.find(x => x.item.name === 'GET | List Accounts').item;
  const ex = it.response[1]; // several accounts (ids 123,124,125)
  const run1 = (scopes, envName) => { const ctx = makePm({ item: it, scopes, response: ex, envName }); run(scriptOf(it.event, 'test'), ctx); return ctx; };
  let sc = { col: { account_id: '' }, env: {} };
  run1(sc, null); ok(sc.col.account_id === 123, 'blank account_id is filled with the first account (collection scope): ' + sc.col.account_id);
  sc = { col: { account_id: '124' }, env: {} };
  run1(sc, null); ok(sc.col.account_id === '124', 'a saved account_id that is still in the list is kept');
  sc = { col: { account_id: '999' }, env: {} };
  run1(sc, null); ok(sc.col.account_id === 123, 'a stale account_id (not in the list) is replaced with the first account');
  sc = { col: { account_id: '' }, env: { account_id: '' } };
  run1(sc, 'VoApps API'); ok(sc.env.account_id === 123 && sc.col.account_id === '', 'with an environment selected the id is saved to the ENVIRONMENT, not the collection');
  // caller numbers: id + number saved together
  const cit = items.find(x => x.item.name === 'GET | List Caller Numbers').item;
  const csc = { col: { caller_number_id: '', voapps_caller_number: '' }, env: {} };
  run(scriptOf(cit.event, 'test'), makePm({ item: cit, scopes: csc, response: cit.response[0], envName: null }));
  ok(csc.col.caller_number_id === 1 && csc.col.voapps_caller_number === '+15555551212', 'List Caller Numbers saves id and phone number together: ' + JSON.stringify(csc.col));
  // create caller number must NOT overwrite an existing voapps_caller_number
  const ccit = items.find(x => x.item.name === 'POST | Create a Caller Number').item;
  const ccs = { col: { voapps_caller_number: '+18005550000', new_caller_number_name: 'my-caller-number' }, env: {} };
  run(scriptOf(ccit.event, 'test'), makePm({ item: ccit, scopes: ccs, response: ccit.response[0], envName: null, localVars: { new_caller_number_name: 'my-caller-number' } }));
  ok(ccs.col.voapps_caller_number === '+18005550000' && ccs.col.caller_number_id === 123, 'Create a Caller Number saves caller_number_id but keeps an existing voapps_caller_number');
  // create record saves record_id
  const rit = items.find(x => x.item.name === 'JSON POST | Create a Record').item;
  const rs = { col: { record_id: '' }, env: {} };
  run(scriptOf(rit.event, 'test'), makePm({ item: rit, scopes: rs, response: rit.response[0], envName: null }));
  ok(rs.col.record_id === 123, 'Create a Record saves record_id');
  // partner users: api_key never logged
  const pit = items.find(x => x.item.name === 'GET | List of Partner Users').item;
  const ps = { col: { partner_user_id: '' }, env: {} };
  const pctx = makePm({ item: pit, scopes: ps, response: pit.response[0], envName: null });
  run(scriptOf(pit.event, 'test'), pctx);
  ok(ps.col.partner_user_id === 456, 'List of Partner Users saves partner_user_id');
  ok(!pctx.logs.concat(pctx.warns).some(l => /api_key|\.\.\./.test(l) && /key/i.test(l) && /\.\.\./.test(l)), 'partner users\' api_key values are not logged');
}

// ---- E. a tampered response is caught (the tests would flag real problems)
{
  const it = items.find(x => x.item.name === 'GET | Record Information').item;
  const bad = JSON.parse(it.response[0].body);
  bad.record.delivery_status = 'Delivered'; // wrong name for code 100
  const ctx = makePm({ item: it, scopes: Object.assign(sampleScopes(), {}), response: { code: 200, body: JSON.stringify(bad) }, envName: null, localVars: { record_id: '1234' } });
  run(scriptOf(it.event, 'test'), ctx);
  ok(ctx.results.some(t => !t.pass && /documented name/.test(t.name)), 'a wrong result name for a code is caught');
  const bad2 = JSON.parse(it.response[0].body); bad2.record.voapps_timestamp = '10/06/2026 3pm';
  const ctx2 = makePm({ item: it, scopes: sampleScopes(), response: { code: 200, body: JSON.stringify(bad2) }, envName: null, localVars: { record_id: '1234' } });
  run(scriptOf(it.event, 'test'), ctx2);
  ok(ctx2.results.some(t => !t.pass && /timestamp/.test(t.name)), 'a badly formatted timestamp is caught');
  const ca = items.find(x => x.item.name === 'GET | Campaign Information').item;
  const bc = JSON.parse(ca.response[0].body); bc.campaign.status = 'on-fire';
  const ctx3 = makePm({ item: ca, scopes: sampleScopes(), response: { code: 200, body: JSON.stringify(bc) }, envName: null, localVars: {} });
  run(scriptOf(ca.event, 'test'), ctx3);
  ok(ctx3.results.some(t => !t.pass && /status is one of/.test(t.name)), 'an undocumented campaign status is caught');
}

const tot = perRequest.reduce((n, r) => n + r.tests, 0);
console.log('\nrequests: ' + items.length + ' | test assertions defined: ' + tot + ' | example runs: ' + exampleRuns + ' (success/negative passed: ' + successPass + ', error examples handled: ' + errorHandled + ') | pm.test results executed: ' + testsRun + ' | guard checks: ' + guardChecks);
console.log(fails ? fails + ' FAILED of ' + asserts + ' harness checks' : 'All ' + asserts + ' harness checks passed');
if (process.argv[2] === '-v') perRequest.forEach(r => console.log(String(r.tests).padStart(3) + ' tests, ' + String(r.ex).padStart(2) + ' examples  ' + r.n));
process.exit(fails ? 1 : 0);
