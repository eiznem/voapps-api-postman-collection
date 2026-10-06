// Runs the REVAMPED collection in real newman against the local mock API. Scratch-only copies; the project files are never modified.
const fs = require('fs');
const path = require('path');
const newman = require('newman');
const { start } = require('./mock_api.cjs');

const SRC = process.env.COLLECTION || path.resolve(__dirname, '..', '..', 'VoApps_API_Collection_REVAMPED.postman_collection.json');
const PORT = 18743;
fs.mkdirSync(path.join(__dirname, 'fixtures'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'fixtures/message.wav'), Buffer.from('RIFF....WAVEfmt fake audio for the mock'));
fs.writeFileSync(path.join(__dirname, 'fixtures/numbers.csv'), 'phone_number\n111-555-1010\n');

const base = JSON.parse(fs.readFileSync(SRC, 'utf8'));
// ---- scratch copy: attach files, and a second Pause before Cancel in the reference Campaigns folder
const patched = JSON.parse(JSON.stringify(base));
(function walk(items) {
  items.forEach(it => {
    if (it.item) walk(it.item);
    else if (it.request.body && it.request.body.formdata) it.request.body.formdata.forEach(p => { if (p.type === 'file') p.src = p.key === 'message_file' ? 'fixtures/message.wav' : 'fixtures/numbers.csv'; });
  });
})(patched.item);
// scratch copy only: Cancel ends the campaign that later folders use, so move it (after one more Pause) to the very end
const campaigns = patched.item.find(i => i.name === 'Campaigns');
const pause = campaigns.item.find(i => i.name === 'PUT | Update a Campaign (Pause)');
const again = JSON.parse(JSON.stringify(pause)); again.name = 'PUT | Update a Campaign (Pause, again before Cancel)';
const cancelIdx = campaigns.item.findIndex(i => i.name === 'PUT | Update a Campaign (Cancel)');
const cancel = campaigns.item.splice(cancelIdx, 1)[0];
patched.item.push({ name: 'Final steps (scratch)', item: [again, cancel] });
const findItem = (items, name) => { for (const i of items) { if (i.item) { const r = findItem(i.item, name); if (r) return r; } else if (i.name === name) return i; } };
const mini = (names) => Object.assign({}, patched, { item: names.map(n => findItem(patched.item, n)) });

const ENV = (over) => Object.entries(Object.assign({ api_key: 'test-key', partner_api_key: 'test-partner-key', confirm_campaign: 'true', confirm_cancel: 'true', confirm_create_account: 'false', verified_by_user: 'true', new_caller_number: '555-555-1212' }, over || {}))
  .map(([key, value]) => ({ key, value }));

let consoleLines = [];
function run(collection, { folder, env }) {
  consoleLines = [];
  return new Promise((resolve, reject) => newman.run({ collection, envVar: ENV(env).concat([{ key: 'base_url', value: 'http://127.0.0.1:' + PORT + '/api/v1' }]), folder, workingDir: __dirname, insecureFileRead: true, reporters: [], timeoutRequest: 15000 },
    (err, summary) => (err ? reject(err) : resolve(summary))).on('console', (e, o) => consoleLines.push((o.level || 'log') + ': ' + (o.messages || []).join(' '))));
}
const norm = s => s.error ? s : s;
function digest(summary) {
  const ex = summary.run.executions;
  const stats = summary.run.stats;
  const failures = summary.run.failures.map(f => ({ at: f.at, source: f.source && f.source.name, test: f.error && f.error.test, message: (f.error && f.error.message || '').split('\n')[0].slice(0, 260) }));
  return { executions: ex.length, assertions: stats.assertions, requests: stats.requests, failures, names: ex.map(e => e.item.name) };
}

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL: ' + m); } else console.log('  ok:   ' + m); };

(async () => {
  const mock = await start(PORT);
  const SMOKE = 'Smoke Tests (run in order)';

  console.log('\n=== S1  Smoke Tests, all switches on (campaign confirmed, cancel allowed)');
  mock.reset(); mock.log.length = 0;
  let d = digest(await run(patched, { folder: SMOKE }));
  console.log('  requests run:', d.requests.total, '| assertions:', JSON.stringify(d.assertions), '| failures:', d.failures.length);
  d.failures.forEach(f => console.log('   ', f.source, '|', f.test, '|', f.message));
  ok(d.requests.total === 31 && d.failures.length === 0, 'all 31 smoke steps ran with zero failures');
  const L = mock.log;
  const find = (fn) => L.filter(fn);
  ok(find(e => e.path === '/api/v1/accounts' && e.method === 'GET' && e.auth === 'Token token=test-key').length >= 1, 'account requests sent "Authorization: Token token=<api_key>"');
  ok(find(e => e.auth === 'Token token=not-a-real-api-key').length === 1 && find(e => e.auth === null).length === 1, 'step 20 sent the bad key and step 21 sent no Authorization header');
  const cc = find(e => e.method === 'POST' && /\/campaigns$/.test(e.path) && e.fields.transactional === 'true' && e.fields.message_id)[0];
  ok(cc && cc.contentType === 'multipart/form-data' && cc.fields.confirm === 'true' && /^\d{4}-\d{2}-\d{2}T10:01:00Z$/.test(cc.fields.target_date) && /^postman-test-campaign-\d+$/.test(cc.fields.name) && /^\+/.test(cc.fields.caller_number), 'Create a Campaign (Transactional) went out as multipart with confirm, 10:01Z target_date, unique name and a +E.164 caller number');
  const cr = find(e => e.method === 'POST' && /\/records$/.test(e.path) && e.fields.record_attributes && !e.fields.record_attributes.includes('"account": "12345"'))[0];
  ok(cr && cr.contentType === 'application/x-www-form-urlencoded' && JSON.parse(cr.fields.record_attributes).number === '111-555-1010', 'Create a Record went out form-encoded with parseable JSON record_attributes');
  ok(find(e => e.method === 'PUT').every(e => e.contentType === 'application/x-www-form-urlencoded'), 'every PUT went out form-encoded');
  ok(find(e => e.method === 'GET').every(e => Object.keys(e.fields).length === 0), 'no GET carried a body');
  ok(find(e => e.path === '/api/v1/partners/users')[0].auth === 'Token token=test-partner-key', 'partner request used partner_api_key');
  ok(find(e => e.path === '/api/v1/accounts' && e.userIdHeader === '456').length === 1 && find(e => e.path === '/api/v1/accounts' && e.userIdHeader === '456')[0].auth === 'Token token=test-partner-key', 'General Partner API Usage sent partner key + VOAPPS_API_USER_ID header (id saved from List of Partner Users)');
  const camp = Object.values(mock.state().campaigns).flat();
  ok(camp.length === 1 && camp[0].status === 'canceled', 'the test campaign went running -> paused -> running -> paused -> canceled; exactly one campaign was created');

  console.log('\n=== S2  Smoke Tests with DEFAULT safety switches (confirm_campaign=false, confirm_cancel=false)');
  mock.reset(); mock.log.length = 0;
  d = digest(await run(patched, { folder: SMOKE, env: { confirm_campaign: 'false', confirm_cancel: 'false' } }));
  const failedSteps = [...new Set(d.failures.map(f => (f.source || '').slice(0, 2)))].sort();
  console.log('  requests sent:', d.requests.total, '| failing steps:', failedSteps.join(', '), '| total failures:', d.failures.length);
  ok(JSON.stringify(failedSteps) === JSON.stringify(['13', '15', '16']), 'by default only 13, 15 and 16 fail (an unconfirmed campaign cannot be paused: mock ASSUMPTION); the cancel steps do not fail, they are skipped');
  ok(d.requests.total === 29, 'steps 12 and 17 (the cancel steps) were skipped, not sent: 29 of 31 requests went out');
  ok(consoleLines.filter(l => /^error: .*confirm_cancel/.test(l)).length === 2, 'newman console shows the plain-English confirm_cancel message for both skipped steps');
  ok(mock.log.filter(e => e.method === 'PUT' && e.fields.method === 'cancel').length === 0, 'no cancel request reached the API');
  const unconf = Object.values(mock.state().campaigns).flat()[0];
  ok(unconf && unconf.status === 'setup', 'with confirm_campaign=false the test campaign stayed unconfirmed (status setup)');
  const ePart = d.names.filter(n => /^(2\d|3[01])\./.test(n));
  ok(d.failures.filter(f => /^(2\d|3[01])\./.test(f.source || '')).length === 0 && ePart.length === 12, 'all 12 error-handling steps pass (every one was rejected with a 4xx)');

  console.log('\n=== S3  WHOLE collection (Smoke + every reference folder), switches on except create-account');
  mock.reset(); mock.log.length = 0;
  d = digest(await run(patched, {}));
  console.log('  requests run:', d.requests.total, '| assertions:', JSON.stringify(d.assertions), '| failures:', d.failures.length);
  d.failures.forEach(f => console.log('   ', f.at, '|', f.source, '|', f.test || '', '|', f.message));
  ok(d.requests.total === 73 && d.failures.length === 0, 'every request passes: 73 sent (74 in this scratch copy, minus the skipped Create an Account), 0 failures');
  ok(mock.log.filter(e => e.method === 'POST' && e.path === '/api/v1/accounts' && e.fields.name).length === 0, 'POST | Create an Account was skipped by its switch and never sent (step 27 sends an empty POST on purpose)');
  ok(consoleLines.some(l => /^error: .*confirm_create_account/.test(l)), 'newman console shows the plain-English confirm_create_account message');
  const posted = mock.log.filter(e => e.method === 'POST' && /\/campaigns$/.test(e.path));
  ok(posted.length >= 7, 'campaign create variants all reached the API (' + posted.length + ' creates)');
  ok(mock.log.some(e => /\/campaigns$/.test(e.path) && e.method === 'POST' && / [+-]\d\d:\d\d$/.test(e.fields.target_date || '')) && mock.log.some(e => /\/campaigns$/.test(e.path) && e.method === 'POST' && / UTC$/.test(e.fields.target_date || '')), 'target_date was sent in the offset form and the UTC-label form');
  ok(mock.log.some(e => /\/messages$/.test(e.path) && e.method === 'POST' && e.files.message_file && e.files.message_file.filename === 'message.wav'), 'Create a Message uploaded the attached file');
  ok(mock.log.some(e => /\/campaign/.test(e.path) === false && e.method === 'POST' && /\/caller_numbers$/.test(e.path) && e.fields.verified_by_user === 'true' && e.fields.number === '555-555-1212'), 'Create a Caller Number sent verified_by_user=true only because the switch was set');

  console.log('\n=== S4  Accounts folder alone with create-account allowed');
  mock.reset(); mock.log.length = 0;
  d = digest(await run(patched, { folder: 'Accounts', env: { confirm_create_account: 'true' } }));
  console.log('  requests run:', d.requests.total, '| failures:', d.failures.length);
  ok(d.requests.total === 4 && d.failures.length === 0, 'POST | Create an Account passes when confirm_create_account=true (account created, echo + timezone tests pass)');

  console.log('\n=== S5  Empty-variable guard in the real sandbox (List Messages with account_id empty)');
  mock.reset(); mock.log.length = 0;
  d = digest(await run(mini(['GET | List Messages']), {}));
  const msg = consoleLines.find(l => /^error: /.test(l)) || '';
  console.log('  console:', msg.replace(/\n/g, ' / ').slice(0, 330));
  ok(/\{\{account_id\}\}/.test(msg) && /List Accounts/.test(msg), 'plain-English message names {{account_id}} and tells the user to run List Accounts');
  ok(mock.log.length === 0 && d.requests.total === 0, 'nothing was sent to the API (request skipped)');

  console.log('\n=== S6  Wrong API key');
  mock.reset(); mock.log.length = 0;
  d = digest(await run(mini(['GET | List Accounts']), { env: { api_key: 'wrong-key' } }));
  d.failures.forEach(f => console.log('   ', f.at, '|', f.test, '|', f.message.slice(0, 120)));
  ok(d.failures.some(f => /API key accepted/.test(f.test || '')) && d.failures.some(f => /Status code is 2xx/.test(f.test || '')), 'a wrong key produces the friendly "API key accepted (not 401/403)" failure plus the status failure');

  console.log('\n=== S7  Blank API key');
  mock.reset(); mock.log.length = 0;
  d = digest(await run(mini(['GET | List Accounts']), { env: { api_key: '' } }));
  ok(d.failures.some(f => /API key accepted/.test(f.test || '')), 'a blank key is reported as 401 with the friendly message (not a script crash)');

  await mock.close();
  console.log(fails ? '\n' + fails + ' NEWMAN CHECK(S) FAILED' : '\nAll newman scenario checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('RUNNER ERROR', e); process.exit(2); });
