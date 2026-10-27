// Builds the revamped VoApps API Postman collection + environment from the API Access Guide in kb-content.js.
// Run: node build.cjs   (reads kb-content.js fresh every time, so re-running picks up guide edits)
const fs = require('fs');
const L = require('./lib.cjs');
const S = require('./scripts.cjs');
const R = String.raw;

const path = require('path');
const OUT = path.resolve(__dirname, '..'); // the project folder (where kb-content.js lives)
const ORIGINAL_POSTMAN_ID = '060d871e-9d65-4dda-bd51-35857d4b2302'; // same id as the live collection, so Postman's Import offers "Replace"
const REVISION = '2026-10-06';
const BASE = 'https://directdropvoicemail.voapps.com/api/v1';
const KB = L.KB;
const kbp = (path, label) => '[' + label + '](' + KB + '#' + path + ')';
const kbHome = '[VoApps Knowledge Base](' + KB + ')';

// ------------------------------------------------------------------ facts pulled from the guide
const RESULTS = L.resultCodes();
const TS_CODES = new Set(L.timestampCodes().filter(t => t.hasTimestamp).map(t => t.code));
const TIMEZONES = L.codeBlocks('create-an-account').find(b => /America\/New_York/.test(b.text) && !/curl/.test(b.text)).text.split(/\s+/).filter(Boolean);
const campRows = L.tables('list-campaigns')[1].rows;
const rowOf = k => campRows.find(r => r[0].replace(/`/g, '') === k)[1];
const STATUS = rowOf('status').match(/Simplified status for automation:\s*([^.]*)\./)[1].replace(/,?\s+or\s+/, ', ').split(/,\s*/);
const STATE = rowOf('state').match(/Detailed state:\s*([^.]*)\./)[1].replace(/,?\s+or\s+/, ', ').split(/,\s*/);
if (RESULTS.length !== 21 || STATUS.length !== 8 || STATE.length !== 12 || TIMEZONES.length !== 29) {
  throw new Error('Guide structure changed: results=' + RESULTS.length + ' status=' + STATUS.length + ' state=' + STATE.length + ' tz=' + TIMEZONES.length);
}
const RESULT_MAP = {};
RESULTS.forEach(r => { RESULT_MAP[String(r.code)] = r.name; });

// ------------------------------------------------------------------ variables
// [key, value, kind, description]; kind: user (collection + environment), secret (same, secret in env), computed (collection only), switch
const VARS = [
  ['base_url', BASE, 'user', 'VoApps API base URL. Every request starts with {{base_url}}.'],
  ['api_key', '', 'secret', 'REQUIRED. Your API key (DirectDrop Voicemail account > API Access icon > Show Key). Sent as: Authorization: Token token=<your_api_key>.'],
  ['partner_api_key', '', 'secret', 'VoApps partners only. A separate credential from your account API key. Used only by the Partner API folder.'],
  ['account_id', '', 'user', 'The account to work in. Filled in automatically by "GET | List Accounts" (or type it).'],
  ['message_id', '', 'user', 'A message in that account. Filled in by "GET | List Messages" or "FORM POST | Create a Message".'],
  ['caller_number_id', '', 'user', 'A caller number\'s internal id (used only to address the caller-number endpoints). Filled in by "GET | List Caller Numbers".'],
  ['voapps_caller_number', '', 'user', 'The caller number as a phone number, e.g. +15555551212. Campaigns and records take this, not the caller number id. Filled in by "GET | List Caller Numbers".'],
  ['campaign_id', '', 'user', 'A campaign in that account. Filled in when you create a campaign or list campaigns.'],
  ['record_id', '', 'user', 'A record in that campaign. Filled in by "JSON POST | Create a Record".'],
  ['partner_user_id', '', 'user', 'Partners only: the managed user to act on behalf of (sent as the VOAPPS_API_USER_ID header). Filled in by "GET | List of Partner Users".'],
  ['account_timezone', 'America/New_York', 'user', 'Timezone for "POST | Create an Account". Must be one of the supported timezone strings.'],
  ['new_caller_number', '', 'user', 'The phone number you want to register with "POST | Create a Caller Number", e.g. 555-555-1212.'],
  ['phone_number', '111-555-1010', 'user', 'Phone number used by the record requests (the guide\'s sample number). Replace it to test real delivery.'],
  ['voapps_zip_code', '90210', 'user', 'Recommended on records: zip code that helps VoApps respect the contact window.'],
  ['voapps_voice_append', '00001067', 'user', 'Alphanumeric value spoken at the end of the message (the guide\'s sample).'],
  ['voapps_postback_url', 'https://your-url.example.com/endpoint/for/1115551010', 'user', 'Webhook URL that receives each record\'s result (the guide\'s sample; replace with your own HTTPS endpoint).'],
  ['campaign_pace', '50', 'user', 'Pace (successful deliveries per hour, 50 to 8000) sent when creating a campaign.'],
  ['campaign_new_pace', '100', 'user', 'Pace sent by "PUT | Update a Campaign (Change Pace)".'],
  ['confirm_campaign', 'false', 'switch', 'SAFETY SWITCH. Campaigns are created with confirm=false (a test: nothing is delivered). Set to true only when you really want the campaign to run.'],
  ['verified_by_user', 'false', 'switch', 'SAFETY SWITCH. Caller Number Certification. Set to true only if you can truthfully give the certification quoted on "POST | Create a Caller Number".'],
  ['confirm_cancel', 'false', 'switch', 'SAFETY SWITCH. Canceling is final (the guide documents no way to undo it). Set to true to allow the Cancel requests to be sent.'],
  ['confirm_create_account', 'false', 'switch', 'SAFETY SWITCH. The guide documents no way to remove an account through the API. Set to true to allow "POST | Create an Account" to be sent.'],
  ['postback_signing_secret', '', 'secret', 'Your account postback signing secret (set in the Postback settings). Used to verify the X-VoApps-Signature HMAC on inbound postbacks. Leave blank in a shared collection.'],
  ['sample_postback_destination', 'https://your-endpoint.example.com/voapps/postback', 'user', 'Reference only (Postback Signature folder): the destination URL the sample signature is computed over.'],
  ['sample_postback_body', '{"record":{"id":1050502871,"number":"+15555551010","original_fields":{"phone_number":"5555551010"},"delivery_status":"Successful delivery","delivery_status_code":200,"campaign_name":"11 Day Payment Reminder","voapps_timestamp":"2026-10-26 15:38:38 UTC"}}', 'user', 'Reference only (Postback Signature folder): the sample postback JSON the signature is computed over.'],
  ['sample_postback_timestamp', '', 'user', 'Reference only (Postback Signature folder): unix-seconds timestamp set by the request pre-request script.'],
  ['computed_postback_signature', '', 'user', 'Reference only (Postback Signature folder): the X-VoApps-Signature recomputed by the request scripts.'],
];
const COMPUTED = [
  ['run_id', 'Milliseconds timestamp that makes test-data names unique.'],
  ['now_utc', 'Now in UTC, ISO 8601 with Z, e.g. 2026-10-06T15:16:39.074Z.'],
  ['now_utc_label', 'Now in UTC with a "UTC" label, e.g. 2026-10-06 15:16:39 UTC.'],
  ['now_local_offset', 'Now with your local UTC offset, e.g. 2026-10-06 11:16:39 -04:00.'],
  ['today_utc', 'Today\'s date in UTC (YYYY-MM-DD).'],
  ['yesterday_utc', 'Yesterday\'s date in UTC.'],
  ['week_ago_utc', 'The date 7 days ago in UTC.'],
  ['target_date', 'Today at 10:01 UTC, ISO 8601 with Z. See The 10:00Z Start Rule.'],
  ['target_date_utc_label', 'Same moment with a "UTC" label.'],
  ['target_date_local_offset', 'Same moment written with your local UTC offset.'],
  ['new_account_name', 'Unique account name for Create an Account.'],
  ['new_message_name', 'Unique message name for Create a Message.'],
  ['new_message_description', 'Description sent with Create a Message.'],
  ['new_caller_number_name', 'Unique name for Create a Caller Number.'],
  ['new_campaign_name', 'Unique campaign name for Create a Campaign (names must be unique per account).'],
];

// ------------------------------------------------------------------ small helpers
const STATUS_TEXT = { 200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found' };
const clone = o => JSON.parse(JSON.stringify(o));
const join = (...a) => a.filter(Boolean).join('\n');
const exec = text => text.split('\n');
const ev = (listen, text) => ({ listen, script: { type: 'text/javascript', exec: exec(text) } });
const ILL = '[Illustrative] ';
// Error response bodies per the KB "Errors & Status Codes" page: 400 is {"error":"<message>"},
// 403 {"error":"not_authorized"}, 404 {"error":"not-found"}; 401 has an empty body.
const errBody = (code, msg) => code === 403 ? { error: 'not_authorized' }
  : code === 404 ? { error: 'not-found' }
  : code === 401 ? { error: 'missing or invalid API key' }
  : { error: msg || 'validation failed' };

const guideEx = slug => L.exampleResponse(slug);
const pm = (map, key) => (map[key] ? map[key].text : '');

function urlOf(path, query) {
  const q = (query || []).filter(x => !x.disabled);
  const raw = '{{base_url}}/' + path.join('/') + (q.length ? '?' + q.map(x => x.key + '=' + x.value).join('&') : '');
  const url = { raw, host: ['{{base_url}}'], path: path.slice() };
  if (query && query.length) url.query = query.map(x => { const o = { key: x.key, value: x.value }; if (x.description) o.description = x.description; if (x.disabled) o.disabled = true; return o; });
  return url;
}

function descriptionOf(o) {
  const out = [];
  if (o.summary) out.push(o.summary);
  out.push('`' + o.method + ' {{base_url}}/' + o.path.join('/') + '`');
  (o.tables || []).forEach(([idx, title]) => {
    const t = L.tables(o.slug)[idx];
    out.push('**' + title + '** (quoted from the API Access Guide)\n\n' + L.mdTable(t.rows));
  });
  if (o.showBoxes !== false) L.boxes(o.slug).forEach(b => out.push('> ' + b.text.replace(/\n/g, '\n> ')));
  if (o.notes && o.notes.length) out.push('**In this collection**\n\n' + o.notes.map(n => '- ' + n).join('\n'));
  const see = (o.see || []).map(([label, path]) => kbp(path, label));
  out.push('**VoApps Knowledge Base:** ' + [kbp('api/' + o.slug, 'API Access Guide – ' + L.stepBySlug(o.slug).title)].concat(see).join(' · ') + ' · ' + kbHome);
  return out.join('\n\n');
}

// Builds a Postman request item. o: name, method, path[], query[], form[] | urlencoded[], headers[], auth, pre, test, examples[]
function req(o) {
  const request = { method: o.method, header: o.headers || [], url: urlOf(o.path, o.query) };
  if (o.auth) request.auth = o.auth;
  if (o.form) request.body = { mode: 'formdata', formdata: o.form };
  if (o.urlencoded) request.body = { mode: 'urlencoded', urlencoded: o.urlencoded };
  request.description = descriptionOf(o);
  const item = { name: o.name, request, response: [] };
  item.event = [];
  if (o.pre) item.event.push(ev('prerequest', o.pre));
  if (o.test) item.event.push(ev('test', o.test));
  if (!item.event.length) delete item.event;
  const orig = clone(request); delete orig.description; delete orig.auth;
  (o.examples || []).forEach(x => {
    item.response.push({
      name: x.name, originalRequest: clone(orig), status: STATUS_TEXT[x.code] || String(x.code), code: x.code,
      _postman_previewlanguage: 'json', header: [{ key: 'Content-Type', value: 'application/json; charset=utf-8' }], cookie: [],
      body: JSON.stringify(x.body, null, 2),
    });
  });
  item._meta = { slug: o.slug, expect: o.expect || '2xx' }; // stripped before writing (used by the test harness)
  return item;
}
const text = (key, value, description, disabled) => { const f = { key, value, type: 'text' }; if (description) f.description = description; if (disabled) f.disabled = true; return f; };
const q = (key, value, description, disabled) => { const f = { key, value }; if (description) f.description = description; if (disabled) f.disabled = true; return f; };

const ok200 = (name, body) => ({ name, code: 200, body });
const bad = (name, code, msg, doc) => ({ name: (doc ? '' : ILL) + name, code, body: errBody(code, msg) });
const unauthorized = () => bad('401 – missing or invalid API key', 401);
const notFound = what => bad('404 – ' + what + ' not found', 404);

// ------------------------------------------------------------------ shared test blocks
const campaignBlock = R`const STATUS = ${JSON.stringify(STATUS)};
const STATE = ${JSON.stringify(STATE)};
const items = Array.isArray(body.campaigns) ? body.campaigns : [body.campaign];
pm.test('Each campaign has id, name, state, status and uri', () => items.forEach(c => need(c, ['id', 'name', 'state', 'status', 'uri'], 'campaign')));
pm.test('status is one of the documented values (' + STATUS.join(', ') + ')', () => items.forEach(c => pm.expect(STATUS, 'status "' + c.status + '"').to.include(c.status)));
pm.test('state is a non-empty string', () => items.forEach(c => pm.expect(String(c.state).length).to.be.above(0)));
items.forEach(c => { if (STATE.indexOf(c.state) < 0) { soft('state "' + c.state + '" is not in the documented state list'); } });
pm.test('uri is an https VoApps campaign link', () => items.forEach(c => pm.expect(String(c.uri)).to.match(/^https:\/\/[^\s]+\/accounts\/\d+\/campaigns\/\d+/)));
pm.test('progress is between 0 and 100 when present', () => items.forEach(c => { if (c.progress !== undefined && c.progress !== null && c.progress !== '') { pm.expect(Number(c.progress)).to.be.within(0, 100); } }));
pm.test('pace, records_count and successfully_delivered are numeric when present', () => items.forEach(c => ['pace', 'records_count', 'successfully_delivered'].forEach(f => { if (c[f] !== undefined && c[f] !== null && c[f] !== '') { pm.expect(Number.isFinite(Number(c[f])), f + ' = ' + c[f]).to.eql(true); } })));
pm.test('successfully_delivered does not exceed records_count', () => items.forEach(c => { if (Number.isFinite(Number(c.records_count)) && Number.isFinite(Number(c.successfully_delivered))) { pm.expect(Number(c.successfully_delivered)).to.be.at.most(Number(c.records_count)); } }));
pm.test('export is an https file link when present', () => items.forEach(c => { if (c.export) { pm.expect(String(c.export)).to.match(/^https:\/\//); } }));
items.forEach(c => { if (c.caller_number && !/^\+\d{10,15}$/.test(String(c.caller_number))) { soft('caller_number "' + c.caller_number + '" is not in +E.164 format'); } });
items.forEach(c => { const missing = ['pace', 'progress', 'target_date', 'export', 'records_count', 'successfully_delivered', 'caller_number', 'message_id'].filter(f => !(f in c)); if (missing.length) { soft('campaign ' + c.id + ' is missing documented field(s): ' + missing.join(', ')); } });`;

const accountsBlock = R`pm.test('"accounts" is an array', () => pm.expect(body.accounts).to.be.an('array'));
pm.test('Every account has id, name and timezone', () => body.accounts.forEach(a => need(a, ['id', 'name', 'timezone'], 'account')));
pm.test('Every timezone looks like an IANA timezone (Area/Location)', () => body.accounts.forEach(a => pm.expect(String(a.timezone)).to.match(/^[A-Za-z_]+\/[A-Za-z_\/]+$/)));
pm.test('Account ids are unique', () => { const ids = body.accounts.map(a => a.id); pm.expect(new Set(ids).size).to.eql(ids.length); });`;

const messageBlock = R`pm.test('Each message has id, name, description, duration and file_url', () => items.forEach(m => need(m, ['id', 'name', 'description', 'duration', 'file_url'], 'message')));
pm.test('duration is a number of seconds', () => items.forEach(m => pm.expect(Number.isFinite(Number(m.duration)) && Number(m.duration) > 0, 'duration = ' + m.duration).to.eql(true)));
pm.test('file_url is an https link', () => items.forEach(m => pm.expect(String(m.file_url)).to.match(/^https:\/\//)));`;

const callerBlock = R`pm.test('Each caller number has id, name and number', () => items.forEach(c => need(c, ['id', 'name', 'number'], 'caller number')));
pm.test('number is in +E.164 format (e.g. +15555551212)', () => items.forEach(c => pm.expect(String(c.number)).to.match(/^\+\d{10,15}$/)));`;

// ------------------------------------------------------------------ AUTH
const apikeyAuth = variable => ({ type: 'apikey', apikey: [{ key: 'key', value: 'Authorization', type: 'string' }, { key: 'value', value: 'Token token={{' + variable + '}}', type: 'string' }, { key: 'in', value: 'header', type: 'string' }] });
const badKeyAuth = { type: 'apikey', apikey: [{ key: 'key', value: 'Authorization', type: 'string' }, { key: 'value', value: 'Token token=not-a-real-api-key', type: 'string' }, { key: 'in', value: 'header', type: 'string' }] };
const noAuth = { type: 'noauth' };

// ================================================================== ACCOUNTS
const accountsEx = [
  ok200('200 – one account (guide example)', guideEx('list-accounts')),
  ok200('200 – several accounts', { accounts: [{ id: 123, name: 'a-really-great-account', timezone: 'America/New_York' }, { id: 124, name: 'west-coast-collections', timezone: 'America/Los_Angeles' }, { id: 125, name: 'hidden-test-account', timezone: 'America/Chicago' }] }),
  ok200('200 – no accounts', { accounts: [] }),
  unauthorized(),
];
const listAccountsTest = (save, extra) => join(S.HEAD_2XX, S.HELPERS, save ? S.SAVE : '', 'if (ok) {', accountsBlock,
  save ? "    keepOrPickFirst('account_id', body.accounts.map(a => a.id));" : '',
  save ? S.visualizerList('body.accounts', [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name' }, { key: 'timezone', title: 'Timezone' }]) : '',
  extra || '', '}');
const lap = L.paramMap('list-accounts');
const GET_LIST_ACCOUNTS = req({
  name: 'GET | List Accounts', method: 'GET', path: ['accounts'], slug: 'list-accounts',
  query: [q('filter', 'all', pm(lap, 'filter'), true)],
  summary: 'Lists the accounts for this API key. Hidden accounts are left out unless you add the `filter` query parameter (disabled here; see the "Hidden Only" and "All Including Hidden" variants).',
  tables: [[0, 'Parameters'], [1, 'Response fields']],
  notes: ['Saves **account_id** for you (keeps your current one if it is still in the list).', 'Tests: 2xx, JSON, `accounts` array, id/name/timezone on every account, IANA-style timezones, unique ids.'],
  test: listAccountsTest(true), examples: accountsEx,
});
const GET_LIST_ACCOUNTS_HIDDEN = req({
  name: 'GET | List Accounts (Hidden Only)', method: 'GET', path: ['accounts'], slug: 'list-accounts',
  query: [q('filter', 'hidden', pm(lap, 'filter'))],
  summary: 'Returns only hidden accounts (`filter=hidden`).', tables: [[0, 'Parameters']], showBoxes: false,
  test: listAccountsTest(false), examples: [ok200('200 – hidden accounts only', { accounts: [{ id: 125, name: 'hidden-test-account', timezone: 'America/Chicago' }] }), ok200('200 – none hidden', { accounts: [] }), unauthorized()],
});
const GET_LIST_ACCOUNTS_ALL = req({
  name: 'GET | List Accounts (All Including Hidden)', method: 'GET', path: ['accounts'], slug: 'list-accounts',
  query: [q('filter', 'all', pm(lap, 'filter'))],
  summary: 'Returns every account, hidden ones included (`filter=all`).', tables: [[0, 'Parameters']], showBoxes: false,
  test: listAccountsTest(false), examples: [ok200('200 – all accounts including hidden', accountsEx[1].body), unauthorized()],
});

const cap = L.paramMap('create-an-account');
const POST_CREATE_ACCOUNT = req({
  name: 'POST | Create an Account', method: 'POST', path: ['accounts'], slug: 'create-an-account',
  form: [text('name', '{{new_account_name}}', pm(cap, 'name')), text('timezone', '{{account_timezone}}', pm(cap, 'timezone'))],
  summary: 'Creates a new account. **The guide documents no way to remove an account through the API**, so this request is blocked until you set the `confirm_create_account` variable to `true`.',
  tables: [[0, 'Parameters'], [1, 'Response fields']].slice(0, 1), showBoxes: false,
  notes: ['Name is `postman-test-account-<timestamp>` (names must be unique for the user); timezone comes from **account_timezone**.', 'Saves the new account\'s id to **account_id**, so later requests target the new account. Set it back to return to another account.', 'Tests: 2xx, JSON, `accounts[0]` has id/name/timezone, name and timezone echo what was sent, timezone is one of the 29 supported strings.'],
  pre: S.PREREQ_REQUIRE('confirm_create_account', 'The guide documents no way to remove an account through the API. Set the confirm_create_account variable to true, then send this request again.'),
  test: join(S.HEAD_2XX, S.HELPERS, S.SAVE, 'const TIMEZONES = ' + JSON.stringify(TIMEZONES) + ';', 'if (ok) {',
    "    pm.test('\"accounts\" is a non-empty array', () => pm.expect(body.accounts).to.be.an('array').that.is.not.empty);",
    "    const a = body.accounts[0];",
    "    pm.test('Account has id, name and timezone', () => need(a, ['id', 'name', 'timezone'], 'account'));",
    "    pm.test('Name echoes the name that was sent', () => pm.expect(a.name).to.eql(pm.variables.get('new_account_name')));",
    "    pm.test('Timezone echoes the timezone that was sent', () => pm.expect(a.timezone).to.eql(pm.variables.get('account_timezone')));",
    "    pm.test('Timezone is one of the supported timezone strings', () => pm.expect(TIMEZONES).to.include(a.timezone));",
    "    save('account_id', a.id);", '}'),
  examples: [ok200('200 – account created (guide example)', guideEx('create-an-account')),
    bad('400 – validation error (e.g. duplicate name or unsupported timezone)', 400, 'Name must be unique for this user'), bad('400 – name missing', 400, "Name can't be blank"), unauthorized()],
});

// ================================================================== MESSAGES
const lmp = L.paramMap('list-messages');
const listMessagesTest = save => join(S.HEAD_2XX, S.HELPERS, save ? S.SAVE : '', 'if (ok) {',
  "    pm.test('\"messages\" is an array', () => pm.expect(body.messages).to.be.an('array'));",
  '    const items = body.messages;', messageBlock,
  "    pm.test('Message ids are unique', () => { const ids = items.map(m => m.id); pm.expect(new Set(ids).size).to.eql(ids.length); });",
  save ? "    keepOrPickFirst('message_id', items.map(m => m.id));" : '', '}');
const messagesEx = guideEx('list-messages');
const GET_LIST_MESSAGES = req({
  name: 'GET | List Messages', method: 'GET', path: ['accounts', '{{account_id}}', 'messages'], slug: 'list-messages',
  query: [q('filter', 'all', pm(lmp, 'filter'), true)],
  summary: 'Lists the messages in an account. Disabled messages are left out unless you add `filter`.',
  tables: [[0, 'Parameters'], [1, 'Response fields']], see: [['Message Content Ideas', 'message']],
  notes: ['Saves **message_id** (keeps yours if it is still in the list).', 'Tests: 2xx, JSON, `messages` array, id/name/description/duration/file_url on every message, positive duration, https file_url, unique ids.'],
  test: listMessagesTest(true),
  examples: [ok200('200 – two messages (guide example)', messagesEx), ok200('200 – no messages yet', { messages: [] }), notFound('account'), unauthorized()],
});
const GET_LIST_MESSAGES_DISABLED = req({
  name: 'GET | List Messages (Disabled Only)', method: 'GET', path: ['accounts', '{{account_id}}', 'messages'], slug: 'list-messages',
  query: [q('filter', 'disabled', pm(lmp, 'filter'))], summary: 'Returns only disabled messages (`filter=disabled`).', tables: [[0, 'Parameters']], showBoxes: false,
  test: listMessagesTest(false), examples: [ok200('200 – one disabled message', { messages: [{ id: 3, name: 'Old Message', description: null, duration: '18.0', file_url: 'https://voapps.s3.amazonaws.com/your/old_message/file.wav' }] }), ok200('200 – none disabled', { messages: [] })],
});
const GET_LIST_MESSAGES_ALL = req({
  name: 'GET | List Messages (All Including Disabled)', method: 'GET', path: ['accounts', '{{account_id}}', 'messages'], slug: 'list-messages',
  query: [q('filter', 'all', pm(lmp, 'filter'))], summary: 'Returns every message, disabled ones included (`filter=all`).', tables: [[0, 'Parameters']], showBoxes: false,
  test: listMessagesTest(false), examples: [ok200('200 – all messages', { messages: messagesEx.messages.concat([{ id: 3, name: 'Old Message', description: null, duration: '18.0', file_url: 'https://voapps.s3.amazonaws.com/your/old_message/file.wav' }]) })],
});
const cmp = L.paramMap('create-a-message');
const FORM_POST_CREATE_MESSAGE = req({
  name: 'FORM POST | Create a Message', method: 'POST', path: ['accounts', '{{account_id}}', 'messages'], slug: 'create-a-message',
  form: [
    { key: 'message_file', type: 'file', src: [], description: pm(cmp, 'message_file') },
    text('name', '{{new_message_name}}', pm(cmp, 'name')),
    text('method', 'upload', pm(cmp, 'method')),
    text('description', '{{new_message_description}}', pm(cmp, 'description')),
  ],
  summary: 'Uploads a WAV or MP3 recording as a new message. **Before sending, open the Body tab and click "Select files" on the `message_file` row.**',
  tables: [[0, 'Parameters'], [1, 'Response fields']], see: [['Message Content Ideas', 'message']],
  notes: ['Saves **message_id**.', 'Tests: 2xx, JSON, `message` has id/name/description/duration/file_url, name and description echo what was sent, positive duration, https file_url.'],
  test: join(S.HEAD_2XX, S.HELPERS, S.SAVE, 'if (ok) {', "    pm.test('\"message\" is an object', () => pm.expect(body.message).to.be.an('object'));", '    const items = [body.message];', messageBlock,
    "    pm.test('Name echoes the name that was sent', () => pm.expect(body.message.name).to.eql(pm.variables.get('new_message_name')));",
    "    pm.test('Description echoes the description that was sent', () => pm.expect(body.message.description).to.eql(pm.variables.get('new_message_description')));",
    "    save('message_id', body.message.id);", '}'),
  examples: [ok200('200 – message created (guide example)', guideEx('create-a-message')), bad('400 – name or message_file missing', 400, "Name can't be blank"), bad('400 – file is not a supported audio type', 400, 'Message file must be a valid audio file'), unauthorized()],
});
const GET_MESSAGE_INFO = req({
  name: 'GET | Message Information', method: 'GET', path: ['accounts', '{{account_id}}', 'messages', '{{message_id}}'], slug: 'message-information',
  summary: 'Fetches one message.', tables: [[0, 'Parameters']],
  notes: ['Tests: 2xx, JSON, `message` fields, the returned id matches **message_id**, positive duration, https file_url.'],
  test: join(S.HEAD_2XX, S.HELPERS, 'if (ok) {', "    pm.test('\"message\" is an object', () => pm.expect(body.message).to.be.an('object'));", '    const items = [body.message];', messageBlock,
    "    pm.test('Returned id matches message_id', () => pm.expect(String(body.message.id)).to.eql(String(pm.variables.get('message_id'))));", '}'),
  examples: [ok200('200 – message (guide example)', guideEx('message-information')), notFound('message'), unauthorized()],
});

// ================================================================== CALLER NUMBERS
const lcp = L.paramMap('list-caller-numbers');
const listCallersTest = save => join(S.HEAD_2XX, S.HELPERS, save ? S.SAVE : '', 'if (ok) {',
  "    pm.test('\"caller_numbers\" is an array', () => pm.expect(body.caller_numbers).to.be.an('array'));",
  '    const items = body.caller_numbers;', callerBlock,
  "    pm.test('Caller number ids are unique', () => { const ids = items.map(c => c.id); pm.expect(new Set(ids).size).to.eql(ids.length); });",
  save ? R`    if (items.length) {
        const current = items.find(c => String(c.id) === String(pm.variables.get('caller_number_id')));
        const pick = current || items[0];
        save('caller_number_id', pick.id);
        if (isBlank('voapps_caller_number') || !items.some(c => c.number === pm.variables.get('voapps_caller_number'))) { save('voapps_caller_number', pick.number); }
    }` : '', '}');
const callersEx = guideEx('list-caller-numbers');
const GET_LIST_CALLERS = req({
  name: 'GET | List Caller Numbers', method: 'GET', path: ['accounts', '{{account_id}}', 'caller_numbers'], slug: 'list-caller-numbers',
  query: [q('filter', 'all', pm(lcp, 'filter'), true)],
  summary: 'Lists the caller numbers in an account. Disabled numbers are left out unless you add `filter`.',
  tables: [[0, 'Parameters']],
  notes: ['Saves **caller_number_id** and **voapps_caller_number** (the phone number that campaigns and records need).', 'Tests: 2xx, JSON, `caller_numbers` array, id/name/number on every item, +E.164 numbers, unique ids.'],
  test: listCallersTest(true),
  examples: [ok200('200 – two caller numbers (guide example)', callersEx), ok200('200 – none yet', { caller_numbers: [] }), notFound('account'), unauthorized()],
});
const GET_LIST_CALLERS_DISABLED = req({
  name: 'GET | List Caller Numbers (Disabled Only)', method: 'GET', path: ['accounts', '{{account_id}}', 'caller_numbers'], slug: 'list-caller-numbers',
  query: [q('filter', 'disabled', pm(lcp, 'filter'))], summary: 'Returns only disabled caller numbers (`filter=disabled`).', tables: [[0, 'Parameters']], showBoxes: false,
  test: listCallersTest(false), examples: [ok200('200 – one disabled number', { caller_numbers: [{ id: 3, name: 'Old Caller Number', number: '+15555551214' }] }), ok200('200 – none disabled', { caller_numbers: [] })],
});
const GET_LIST_CALLERS_ALL = req({
  name: 'GET | List Caller Numbers (All Including Disabled)', method: 'GET', path: ['accounts', '{{account_id}}', 'caller_numbers'], slug: 'list-caller-numbers',
  query: [q('filter', 'all', pm(lcp, 'filter'))], summary: 'Returns every caller number, disabled ones included (`filter=all`).', tables: [[0, 'Parameters']], showBoxes: false,
  test: listCallersTest(false), examples: [ok200('200 – all caller numbers', { caller_numbers: callersEx.caller_numbers.concat([{ id: 3, name: 'Old Caller Number', number: '+15555551214' }]) })],
});
const ccp = L.paramMap('create-a-caller-number');
const POST_CREATE_CALLER = req({
  name: 'POST | Create a Caller Number', method: 'POST', path: ['accounts', '{{account_id}}', 'caller_numbers'], slug: 'create-a-caller-number',
  form: [text('name', '{{new_caller_number_name}}', pm(ccp, 'name')), text('number', '{{new_caller_number}}', pm(ccp, 'number')), text('verified_by_user', '{{verified_by_user}}', pm(ccp, 'verified_by_user'))],
  summary: 'Registers a caller number. **`verified_by_user` is a legal certification, so this collection never makes it for you:** the variable defaults to `false`, so nothing is certified until you set it to `true` yourself.',
  tables: [[0, 'Parameters'], [1, 'Response parameters']],
  notes: ['Set **new_caller_number** to the number you want to register (the request will not send while it is empty).', 'Saves **caller_number_id** (and **voapps_caller_number** only if it was empty).', 'Tests: 2xx, JSON, `caller_number` has id/name/number, name echoes what was sent, number is +E.164.'],
  test: join(S.HEAD_2XX, S.HELPERS, S.SAVE, 'if (ok) {', "    pm.test('\"caller_number\" is an object', () => pm.expect(body.caller_number).to.be.an('object'));", '    const items = [body.caller_number];', callerBlock,
    "    pm.test('Name echoes the name that was sent', () => pm.expect(body.caller_number.name).to.eql(pm.variables.get('new_caller_number_name')));",
    "    save('caller_number_id', body.caller_number.id);", "    if (isBlank('voapps_caller_number')) { save('voapps_caller_number', body.caller_number.number); }", '}'),
  examples: [ok200('200 – caller number created (guide example)', guideEx('create-a-caller-number')), bad('400 – verified_by_user terms not accepted', 400, 'Verified by user Terms must be accepted', true), bad('400 – number missing or invalid', 400, 'Number must be a valid US number', true), unauthorized()],
});
const GET_CALLER_INFO = req({
  name: 'GET | Caller Number Information', method: 'GET', path: ['accounts', '{{account_id}}', 'caller_numbers', '{{caller_number_id}}'], slug: 'caller-number-information',
  summary: 'Fetches one caller number.', tables: [[0, 'Parameters']],
  notes: ['Tests: 2xx, JSON, `caller_number` fields, the returned id matches **caller_number_id**, +E.164 number.'],
  test: join(S.HEAD_2XX, S.HELPERS, 'if (ok) {', "    pm.test('\"caller_number\" is an object', () => pm.expect(body.caller_number).to.be.an('object'));", '    const items = [body.caller_number];', callerBlock,
    "    pm.test('Returned id matches caller_number_id', () => pm.expect(String(body.caller_number.id)).to.eql(String(pm.variables.get('caller_number_id'))));", '}'),
  examples: [ok200('200 – caller number (guide example)', guideEx('caller-number-information')), notFound('caller number'), unauthorized()],
});

// ================================================================== CAMPAIGNS
const lcmp = L.paramMap('list-campaigns');
const listCampaignsTest = (save, extra) => join(S.HEAD_2XX, S.HELPERS, save ? S.SAVE : '', 'if (ok) {',
  "    pm.test('\"campaigns\" is an array', () => pm.expect(body.campaigns).to.be.an('array'));",
  "    pm.test('A page holds at most 25 campaigns', () => pm.expect(body.campaigns.length).to.be.at.most(25));",
  "    pm.test('Campaign ids are unique', () => { const ids = body.campaigns.map(c => c.id); pm.expect(new Set(ids).size).to.eql(ids.length); });",
  campaignBlock,
  save ? "    if (isBlank('campaign_id') && body.campaigns.length) { save('campaign_id', body.campaigns[0].id); }" : '', extra || '', '}');
const campaignsEx = guideEx('list-campaigns');
const campaignSample = status => { const c = clone(campaignsEx.campaigns[0]); c.status = status; c.state = status === 'running' ? c.state : status; return c; };
const listCampaignQuery = which => {
  const dateNote = pm(lcmp, 'created_date');
  const rangeNote = pm(lcmp, 'created_date_start');
  const single = !!which.single;
  return [
    q('created_date', which.single || '{{today_utc}}', dateNote, !single),
    q('created_date_start', '{{week_ago_utc}}', rangeNote, single),
    q('created_date_end', '{{today_utc}}', pm(lcmp, 'created_date_end') || rangeNote, single),
    q('page', which.page || '2', pm(lcmp, 'page'), !which.page),
    q('filter', which.filter || 'all', pm(lcmp, 'filter'), !which.filter),
  ];
};
const campaignListReq = (name, which, summary, examples, extraTest, saveIds) => req({
  name, method: 'GET', path: ['accounts', '{{account_id}}', 'campaigns'], slug: 'list-campaigns', query: listCampaignQuery(which), summary,
  tables: [[0, 'Parameters'], [1, 'Response fields']], expect: which.expect || '2xx',
  notes: ['Dates are UTC (YYYY-MM-DD). **today_utc** and **week_ago_utc** are computed for you on every send.', 'Tests: 2xx, JSON, `campaigns` array, at most 25 per page, unique ids, and on every campaign: required fields, documented `status` values, numeric and 0 to 100 ranges, https `uri`/`export`.'],
  see: [['The campaign status and state values (FAQ)', 'api/what-are-the-possible-values-for-status']],
  test: listCampaignsTest(saveIds, extraTest), examples,
});
const GET_LIST_CAMPAIGNS_SINGLE = campaignListReq('GET | List Campaigns (Single Date)', { single: '{{today_utc}}' },
  'Lists campaigns for one date (`created_date`, YYYY-MM-DD UTC). Use `created_date` **or** the start/end pair, not both.',
  [ok200('200 – one running campaign (guide example)', campaignsEx), ok200('200 – campaigns in several statuses', { campaigns: ['running', 'paused', 'completed', 'canceled'].map((s, i) => Object.assign(campaignSample(s), { id: i + 1 })) }), ok200('200 – no campaigns on this date', { campaigns: [] }), bad('400 – no date filter supplied', 400, 'created_date is required'), notFound('account'), unauthorized()], '', true);
const GET_LIST_CAMPAIGNS_RANGE = campaignListReq('GET | List Campaigns (Date Range)', { noDate: true },
  'Lists campaigns between `created_date_start` and `created_date_end` (YYYY-MM-DD UTC), newest first. Defaults to the last 7 days.',
  [ok200('200 – campaigns in range (guide example)', campaignsEx), ok200('200 – no campaigns in range', { campaigns: [] })], '', true);
const GET_LIST_CAMPAIGNS_OFFSET = campaignListReq('GET | List Campaigns (Date With Time and Offset)', { single: '{{today_utc}} 00:00:00 -05:00' },
  'Single-date filter with a time and UTC offset, to shift the day boundary to another timezone (the guide: "Add time and offset to adjust timezone").',
  [ok200('200 – campaigns for that day (guide example)', campaignsEx), ok200('200 – none', { campaigns: [] })], '', false);
const GET_LIST_CAMPAIGNS_PAGE2 = campaignListReq('GET | List Campaigns (Page 2)', { noDate: true, page: '2' },
  'Second page of a date-range listing (25 campaigns per page).',
  [ok200('200 – second page', { campaigns: [Object.assign(campaignSample('completed'), { id: 26 })] }), ok200('200 – past the last page', { campaigns: [] })], '', false);
const GET_LIST_CAMPAIGNS_HIDDEN = campaignListReq('GET | List Campaigns (Hidden Only)', { noDate: true, filter: 'hidden' },
  'Returns only hidden campaigns (`filter=hidden`) in the date range.', [ok200('200 – hidden campaigns', { campaigns: [Object.assign(campaignSample('archived'), { id: 7 })] }), ok200('200 – none hidden', { campaigns: [] })], '', false);
const GET_LIST_CAMPAIGNS_ALL = campaignListReq('GET | List Campaigns (All Including Hidden)', { noDate: true, filter: 'all' },
  'Returns every campaign in the date range, hidden ones included (`filter=all`).', [ok200('200 – all campaigns', { campaigns: [campaignSample('running'), Object.assign(campaignSample('archived'), { id: 7 })] })], '', false);

const crp = L.paramMap('create-a-campaign');
const campaignCreateTest = R`if (ok) {
    pm.test('"campaign" is an object with id, name, uri and target_date', () => { pm.expect(body.campaign).to.be.an('object'); need(body.campaign, ['id', 'name', 'uri', 'target_date'], 'campaign'); });
    pm.test('Name echoes the unique name that was sent', () => pm.expect(body.campaign.name).to.eql(pm.variables.get('new_campaign_name')));
    pm.test('uri is an https link into this account\'s campaigns', () => pm.expect(String(body.campaign.uri)).to.include('/accounts/' + pm.variables.get('account_id') + '/campaigns/'));
    pm.test('id is present', () => pm.expect(String(body.campaign.id).length).to.be.above(0));
    save('campaign_id', body.campaign.id);
}`;
const campaignCreateEvents = () => join(S.HEAD_2XX, S.HELPERS, S.SAVE, campaignCreateTest);
const campaignForm = o => {
  const f = [
    text('message_id', '{{message_id}}', pm(crp, 'message_id')),
    text('caller_number', '{{voapps_caller_number}}', pm(crp, 'caller_number')),
  ];
  if (o.csv) f.push({ key: 'campaign_import', type: 'file', src: [], description: pm(crp, 'campaign_import') });
  f.push(text('name', '{{new_campaign_name}}', pm(crp, 'name')));
  f.push(text('target_date', o.target || '{{target_date}}', pm(crp, 'target_date'), !!o.noTarget));
  f.push(text('transactional', 'true', pm(crp, 'transactional'), !!o.csv));
  f.push(text('confirm', '{{confirm_campaign}}', pm(crp, 'confirm')));
  f.push(text('pace', '{{campaign_pace}}', pm(crp, 'pace')));
  return f;
};
const campaignCreateExamples = [ok200('200 – campaign created (guide example)', guideEx('create-a-campaign')), bad('400 – name already used in this account', 400, 'Name must be unique for this account', true), bad('400 – message_id not owned by this account', 400, 'Message must be a valid message for this account', true), bad('400 – caller_number missing or invalid', 400, 'Caller number must be a valid caller number for this account', true), bad('400 – campaign_import missing (non-transactional campaign)', 400, 'Campaign import file must include a number field, either number or phone_number', true), notFound('account'), unauthorized()];
const campaignCreateNotes = ['Safe by default: **confirm** is `{{confirm_campaign}}` (`false`), which the guide describes as "test campaign creation without delivery".', 'Name is `postman-test-campaign-<timestamp>`, because campaign names must be unique per account.', 'Saves **campaign_id**.', 'Tests: 2xx, JSON, `campaign` has id/name/uri/target_date, name echoes what was sent, uri points into this account\'s campaigns.'];
const campaignSee = [['Pacing Calculator', 'user/creating-a-campaign-pace-setting'], ['The 10:00Z Start Rule', 'integration/the-10-00z-start-rule'], ['CSV File Format Requirements', 'user/csv-file-format-requirements']];
const mkCreateCampaign = (name, summary, o, targetDesc) => req({
  name, method: 'POST', path: ['accounts', '{{account_id}}', 'campaigns'], slug: 'create-a-campaign', form: campaignForm(o), summary,
  tables: [[0, 'Parameters'], [1, 'Response fields']].slice(0, 1), notes: campaignCreateNotes, see: campaignSee,
  test: campaignCreateEvents(), examples: campaignCreateExamples,
});
const FORM_POST_CREATE_CAMPAIGN_CSV = mkCreateCampaign('FORM POST | Create a Campaign (CSV)',
  'Creates a campaign from a CSV of phone numbers. **Open the Body tab and click "Select files" on the `campaign_import` row first.** The CSV must include a column named `number` or `phone_number`.', { csv: true, noTarget: true }, 'csv');
const FORM_POST_CREATE_CAMPAIGN_TX = mkCreateCampaign('FORM POST | Create a Campaign (Transactional)',
  'Creates a **transactional** campaign (no CSV; add records one at a time with Create a Record). `target_date` uses the guide\'s `{date}T10:01:00Z` pattern, in "Z" form. VoApps recommends creating the campaign first and then adding records to it.', {}, 'z');
const FORM_POST_CREATE_CAMPAIGN_TX_OFFSET = mkCreateCampaign('FORM POST | Create a Campaign (Transactional, Target Date With Offset)',
  'Same as the transactional request, with `target_date` written with a numeric UTC offset (one of the three formats the guide accepts).', { target: '{{target_date_local_offset}}' }, 'offset');
const FORM_POST_CREATE_CAMPAIGN_TX_LABEL = mkCreateCampaign('FORM POST | Create a Campaign (Transactional, Target Date UTC Label)',
  'Same as the transactional request, with `target_date` written with a plain "UTC" label (one of the three formats the guide accepts).', { target: '{{target_date_utc_label}}' }, 'utc-label');
const FORM_POST_CREATE_CAMPAIGN_TX_NOW = mkCreateCampaign('FORM POST | Create a Campaign (Transactional, No Target Date)',
  '`target_date` is left out (disabled), so the campaign runs immediately once confirmed ("Runs immediately if not specified").', { noTarget: true }, 'none');

const campaignInfoTest = join(S.HEAD_2XX, S.HELPERS, 'if (ok) {', "    pm.test('\"campaign\" is an object', () => pm.expect(body.campaign).to.be.an('object'));", campaignBlock,
  "    pm.test('Returned id matches campaign_id', () => pm.expect(String(body.campaign.id)).to.eql(String(pm.variables.get('campaign_id'))));",
  "    pm.test('uri points into this account', () => pm.expect(String(body.campaign.uri)).to.include('/accounts/' + pm.variables.get('account_id') + '/'));", '}');
const GET_CAMPAIGN_INFO = req({
  name: 'GET | Campaign Information', method: 'GET', path: ['accounts', '{{account_id}}', 'campaigns', '{{campaign_id}}'], slug: 'campaign-information',
  summary: 'Fetches one campaign\'s status and details.', tables: [[0, 'Parameters']],
  notes: ['Tests: 2xx, JSON, campaign fields, documented `status` values, numeric/range checks, returned id matches **campaign_id**, uri points into this account.'],
  see: [['Campaign status and state values (FAQ)', 'api/what-are-the-possible-values-for-status']],
  test: campaignInfoTest,
  examples: [ok200('200 – running (guide example)', guideEx('campaign-information')), ok200('200 – paused', { campaign: campaignSample('paused') }), ok200('200 – completed', { campaign: campaignSample('completed') }), ok200('200 – canceled', { campaign: campaignSample('canceled') }), ok200('200 – archived', { campaign: campaignSample('archived') }), notFound('campaign'), unauthorized()],
});

const ucp = L.paramMap('update-a-campaign');
const updateTest = (expectedStatus, label) => join(S.HEAD_2XX, S.HELPERS, 'if (ok) {',
  "    pm.test('\"campaign\" is an object with id, status, pace, progress and uri', () => { pm.expect(body.campaign).to.be.an('object'); need(body.campaign, ['id', 'status', 'pace', 'progress', 'uri'], 'campaign'); });",
  "    pm.test('Returned id matches campaign_id', () => pm.expect(String(body.campaign.id)).to.eql(String(pm.variables.get('campaign_id'))));",
  '    pm.test(\'status is one of the documented values\', () => pm.expect(' + JSON.stringify(STATUS) + ').to.include(body.campaign.status));',
  "    pm.test('pace is within the documented 50 to 8000 range', () => pm.expect(Number(body.campaign.pace)).to.be.within(50, 8000));",
  expectedStatus ? "    if (body.campaign.status !== " + JSON.stringify(expectedStatus) + ") { soft('expected status \"" + expectedStatus + "\" after " + label + ", got \"' + body.campaign.status + '\" (status can lag behind a state change)'); }" : '',
  label === 'a pace change' ? "    if (Number(body.campaign.pace) !== Number(pm.variables.get('campaign_new_pace'))) { soft('pace is ' + body.campaign.pace + ', not the ' + pm.variables.get('campaign_new_pace') + ' that was sent'); }" : '', '}');
const updateReq = (name, summary, fields, expectedStatus, label, pre, examples) => req({
  name, method: 'PUT', path: ['accounts', '{{account_id}}', 'campaigns', '{{campaign_id}}'], slug: 'update-a-campaign', urlencoded: fields, summary,
  tables: [[0, 'Parameters']], showBoxes: false, pre, see: [['Pacing Calculator', 'user/creating-a-campaign-pace-setting']],
  notes: ['Sent as a form-encoded body, like the guide\'s `-d` example.', 'Tests: 2xx, JSON, `campaign` has id/status/pace/progress/uri, id matches **campaign_id**, documented status, pace within 50 to 8000.'],
  test: updateTest(expectedStatus, label), examples,
});
const camp = (status, pace) => ({ campaign: Object.assign({}, guideEx('update-a-campaign').campaign, { status, pace: pace || 50 }) });
const PUT_PAUSE = updateReq('PUT | Update a Campaign (Pause)', 'Pauses a campaign (`method=pause`). A campaign must be paused before it can be canceled.', [text('method', 'pause', pm(ucp, 'method'))], 'paused', 'a pause', null,
  [ok200('200 – paused', camp('paused')), notFound('campaign'), bad('400 – campaign cannot be paused in its current state', 400, 'Campaign cannot be paused in its current state'), unauthorized()]);
const PUT_UNPAUSE = updateReq('PUT | Update a Campaign (Unpause)', 'Resumes a paused campaign (`method=unpause`).', [text('method', 'unpause', pm(ucp, 'method'))], 'running', 'an unpause', null,
  [ok200('200 – unpaused', camp('running')), bad('400 – campaign is not paused', 400, 'Campaign is not paused'), notFound('campaign'), unauthorized()]);
const PUT_PACE = updateReq('PUT | Update a Campaign (Change Pace)', 'Changes the pace (`pace`, successful deliveries per hour, 50 to 8000). The value comes from **campaign_new_pace**.', [text('pace', '{{campaign_new_pace}}', pm(ucp, 'pace'))], null, 'a pace change', null,
  [ok200('200 – pace changed', camp('running', 100)), bad('400 – pace is not a number', 400, 'Pace is not a number'), notFound('campaign'), unauthorized()]);
const CANCEL_GUARD = S.PREREQ_REQUIRE('confirm_cancel', 'Canceling a campaign is final (the guide documents no way to undo it). Set the confirm_cancel variable to true, then send this request again.');
const PUT_CANCEL = updateReq('PUT | Update a Campaign (Cancel)', '**Cancels a campaign. The guide documents no way to undo this**, so the request is blocked until you set the `confirm_cancel` variable to `true`. The campaign must be paused first.', [text('method', 'cancel', pm(ucp, 'method'))], 'canceled', 'a cancel', CANCEL_GUARD,
  [ok200('200 – canceled', camp('canceled')), bad('400 – campaign must be paused before it can be canceled', 400, 'Campaign must be paused before it can be canceled'), notFound('campaign'), unauthorized()]);

// ================================================================== TRANSACTIONAL RECORDS
const rcp = L.paramMap('create-a-record', 1);
const recordJson = fields => '{' + fields.map(([k, v]) => '"' + k + '": "' + v + '"').join(', ') + '}';
const BASE_FIELDS = [['number', '{{phone_number}}'], ['voapps_zip_code', '{{voapps_zip_code}}'], ['voapps_voice_append', '{{voapps_voice_append}}'], ['voapps_postback_url', '{{voapps_postback_url}}']];
const recordAttrs = fields => [text('record_attributes', recordJson(fields), L.paramMap('create-a-record')['record_attributes'] ? L.paramMap('create-a-record')['record_attributes'].text : '')];
const recordCreateTest = join(S.HEAD_2XX, S.HELPERS, S.SAVE, 'if (ok) {',
  "    pm.test('\"record\" is an object with an id', () => { pm.expect(body.record).to.be.an('object'); need(body.record, ['id'], 'record'); });",
  "    pm.test('record.id is a positive number', () => pm.expect(Number(body.record.id)).to.be.above(0));",
  "    save('record_id', body.record.id);", '}');
const recordCreateExamples = [ok200('200 – record created (guide example)', guideEx('create-a-record')), bad('400 – number or phone_number missing', 400, "Number can't be blank"), bad('400 – campaign is no longer running', 400, 'Campaign is no longer running.', true), notFound('campaign'), unauthorized()];
const recordSee = [['Webhook (Postback URL)', 'api/webhook-postback-url'], ['The 10:00Z Start Rule', 'integration/the-10-00z-start-rule'], ['Results Timestamps', 'api/results-timestamps']];
const mkRecord = (name, summary, fields, o) => req({
  name, method: 'POST', path: o && o.convenience ? ['accounts', '{{account_id}}', 'records'] : ['accounts', '{{account_id}}', 'campaigns', '{{campaign_id}}', 'records'], slug: 'create-a-record',
  urlencoded: recordAttrs(fields), summary, tables: [[0, 'Parameters'], [1, 'record_attributes JSON fields']],
  notes: ['`record_attributes` is a JSON string in a form-encoded body, as in the guide\'s `-d record_attributes=\'{...}\'` example.', 'The sample postback URL (`your-url.example.com`) does not exist; replace **voapps_postback_url** with your own HTTPS endpoint to receive results.', 'Saves **record_id**.', 'Tests: 2xx, JSON, `record.id` present and positive.'].concat(o && o.notes ? o.notes : []),
  see: recordSee, test: recordCreateTest, examples: recordCreateExamples,
});
const JSON_POST_CREATE_RECORD = mkRecord('JSON POST | Create a Record', 'Adds one phone number to a **transactional** campaign. The preferred route: it names the campaign explicitly (`campaign_id`).', BASE_FIELDS);
const JSON_POST_CREATE_RECORD_PHONE_KEY = mkRecord('JSON POST | Create a Record (phone_number Key and Additional Fields)', 'Uses the `phone_number` key instead of `number`, plus additional fields. "Any additional JSON fields are included in the export CSV but not returned in API calls."',
  [['phone_number', '{{phone_number}}'], ['voapps_zip_code', '{{voapps_zip_code}}'], ['account', '12345'], ['field_label', 'field value'], ['voapps_postback_url', '{{voapps_postback_url}}']]);
const JSON_POST_CREATE_RECORD_OVERRIDES = mkRecord('JSON POST | Create a Record (Message and Caller Number Overrides)', 'Overrides the campaign\'s default message and caller number for this one record. Remember that `voapps_caller_number` takes the phone number, not the caller number id.',
  BASE_FIELDS.concat([['voapps_message_id', '{{message_id}}'], ['voapps_caller_number', '{{voapps_caller_number}}']]));
const JSON_POST_CREATE_RECORD_TARGET_Z = mkRecord('JSON POST | Create a Record (Target Date, Z Suffix)', 'Adds `voapps_target_date` in ISO 8601 UTC with a "Z" suffix.', BASE_FIELDS.concat([['voapps_target_date', '{{now_utc}}']]));
const JSON_POST_CREATE_RECORD_TARGET_OFFSET = mkRecord('JSON POST | Create a Record (Target Date, UTC Offset)', 'Adds `voapps_target_date` written with a numeric UTC offset.', BASE_FIELDS.concat([['voapps_target_date', '{{now_local_offset}}']]));
const JSON_POST_CREATE_RECORD_TARGET_LABEL = mkRecord('JSON POST | Create a Record (Target Date, UTC Label)', 'Adds `voapps_target_date` written with a plain "UTC" label.', BASE_FIELDS.concat([['voapps_target_date', '{{now_utc_label}}']]));
const JSON_POST_CREATE_RECORD_CONVENIENCE = mkRecord('JSON POST | Create a Record (Convenience Method)', 'The "convenience" route: no `campaign_id`. **VoApps recommends starting ALL campaigns with the Campaigns endpoint instead.** It appends to the newest running transactional campaign, or creates one with your account defaults if none is running.', BASE_FIELDS, { convenience: true });
JSON_POST_CREATE_RECORD_CONVENIENCE.request.description = JSON_POST_CREATE_RECORD_CONVENIENCE.request.description.replace(/\*\*VoApps Knowledge Base:\*\* \[API Access Guide – [^\]]*\]\([^)]*\)/, m => '> **Convenience Method Note** (quoted from "Transactional Records"): ' + L.boxes('transactional-records')[0].text.replace(/\n/g, '\n> ') + '\n\n' + m);

// Record Information: one saved example per documented result code (+ offset timestamps)
const recordExample = (r, tsKind) => {
  const base = clone(guideEx('record-information'));
  base.record.delivery_status = r.name; base.record.delivery_status_code = r.code;
  base.record.voapps_timestamp = TS_CODES.has(r.code) ? (tsKind === 'offset' ? '2026-10-06 11:16:39 -04:00' : '2026-10-06 15:16:39 UTC') : null;
  return ok200(r.code + ' ' + r.name + (TS_CODES.has(r.code) ? (tsKind === 'offset' ? ' (account-timezone offset timestamp)' : ' (UTC timestamp)') : ' (no timestamp)'), base);
};
const recordInfoExamples = [];
RESULTS.forEach(r => { recordInfoExamples.push(recordExample(r, 'utc')); if (TS_CODES.has(r.code)) recordInfoExamples.push(recordExample(r, 'offset')); });
recordInfoExamples.push(notFound('record'), unauthorized());
const recordInfoTest = join(S.HEAD_2XX, S.HELPERS, 'const RESULTS = ' + JSON.stringify(RESULT_MAP) + ';', 'if (ok) {',
  "    pm.test('\"record\" is an object', () => pm.expect(body.record).to.be.an('object'));",
  "    const r = body.record;",
  "    pm.test('Record has id, number, delivery_status, delivery_status_code, voapps_timestamp and original_fields', () => need(r, ['id', 'number', 'delivery_status', 'delivery_status_code', 'voapps_timestamp', 'original_fields'], 'record'));",
  "    pm.test('Returned id matches record_id', () => pm.expect(String(r.id)).to.eql(String(pm.variables.get('record_id'))));",
  "    pm.test('delivery_status_code is one of the 21 documented result codes', () => pm.expect(Object.keys(RESULTS), 'code ' + r.delivery_status_code).to.include(String(r.delivery_status_code)));",
  "    pm.test('delivery_status is the documented name for that code', () => pm.expect(r.delivery_status).to.eql(RESULTS[String(r.delivery_status_code)]));",
  "    pm.test('voapps_timestamp is empty or in the documented format', () => { const t = r.voapps_timestamp; if (t !== null && t !== undefined && t !== '') { pm.expect(String(t)).to.match(/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} (UTC|[+-]\\d{2}:\\d{2})$/); } });",
  "    pm.test('original_fields holds the fields that were sent', () => pm.expect(['object', 'string']).to.include(typeof r.original_fields));",
  "    if (typeof r.original_fields === 'string') { soft('original_fields came back as a string; the webhook payload shows an object'); }", '}');
const GET_RECORD_INFO = req({
  name: 'GET | Record Information', method: 'GET', path: ['accounts', '{{account_id}}', 'campaigns', '{{campaign_id}}', 'records', '{{record_id}}'], slug: 'record-information',
  summary: 'Fetches one record and its delivery result. The saved examples cover **every documented result code** (and both timestamp formats).',
  tables: [[0, 'Parameters'], [1, 'Response fields']].slice(0, 2), see: [['Result Codes Defined', 'understanding/result-codes-defined'], ['Results Timestamps', 'api/results-timestamps'], ['Webhook (Postback URL)', 'api/webhook-postback-url']],
  notes: ['Tests: 2xx, JSON, all six documented fields, id matches **record_id**, `delivery_status_code` is one of the 21 documented codes **and** `delivery_status` is the exact documented name for that code, `voapps_timestamp` is empty or `yyyy-MM-dd HH:mm:ss UTC` / `±HH:MM`.'],
  test: recordInfoTest, examples: recordInfoExamples,
});

// ================================================================== PARTNER API
const PARTNER_AUTH = apikeyAuth('partner_api_key');
const partnerUsersEx = guideEx('list-of-partner-users');
const GET_PARTNER_USERS = req({
  name: 'GET | List of Partner Users', method: 'GET', path: ['partners', 'users'], slug: 'list-of-partner-users',
  summary: '**Partners only.** Lists the users managed under your partner account. Uses **partner_api_key** (set on the Partner API folder).',
  tables: [[0, 'Parameters'], [1, 'Response fields']], see: [['Partner API overview', 'api/partner-api']],
  notes: ['Saves **partner_user_id** (keeps yours if it is still in the list). Each user\'s `api_key` is never printed to the console, and the visualizer masks it.', 'Tests: 2xx, JSON, `users` array, id/email/api_key on every user, plausible email, unique ids.'],
  test: join(S.HEAD_2XX, S.HELPERS, S.SAVE, 'if (ok) {',
    "    pm.test('\"users\" is an array', () => pm.expect(body.users).to.be.an('array'));",
    "    pm.test('Every user has id, email and api_key', () => body.users.forEach(u => need(u, ['id', 'email', 'api_key'], 'user')));",
    "    pm.test('Every email looks like an email address', () => body.users.forEach(u => pm.expect(String(u.email)).to.match(/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/)));",
    "    pm.test('User ids are unique', () => { const ids = body.users.map(u => u.id); pm.expect(new Set(ids).size).to.eql(ids.length); });",
    "    keepOrPickFirst('partner_user_id', body.users.map(u => u.id));",
    S.visualizerList('body.users', [{ key: 'id', title: 'User ID' }, { key: 'email', title: 'Email' }, { key: 'api_key', title: 'API key (masked)', mask: true }]), '}'),
  examples: [ok200('200 – users (guide example)', partnerUsersEx), ok200('200 – no managed users yet', { users: [] }), bad('403 – not a partner API key', 403), unauthorized()],
});
const gpp = L.paramMap('general-partner-api-usage');
const GET_PARTNER_USAGE = req({
  name: 'GET | General Partner API Usage', method: 'GET', path: ['accounts'], slug: 'general-partner-api-usage',
  headers: [{ key: 'VOAPPS_API_USER_ID', value: '{{partner_user_id}}', description: pm(gpp, 'VOAPPS_API_USER_ID') }],
  summary: '**Partners only.** The List Accounts endpoint, called with your partner API key plus the `VOAPPS_API_USER_ID` header to act on a managed user\'s behalf.',
  tables: [[0, 'Parameters']], see: [['List Accounts', 'api/list-accounts']],
  notes: ['Uses **partner_api_key** and **partner_user_id** (send "GET | List of Partner Users" first).', 'Tests: same as List Accounts.'],
  test: listAccountsTest(false, S.visualizerList('body.accounts', [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name' }, { key: 'timezone', title: 'Timezone' }])),
  examples: [ok200('200 – accounts for the managed user', guideEx('list-accounts')), bad('403 – not a partner API key', 403), unauthorized()],
});

// ================================================================== NOT IN THE GUIDE
const GET_RECORD_INFO_NO_CAMPAIGN = req({
  name: 'GET | Record Information (Without Campaign ID)', method: 'GET', path: ['accounts', '{{account_id}}', 'records', '{{record_id}}'], slug: 'record-information',
  summary: '**Not documented in the API Access Guide.** Kept from the previous Postman collection: the record lookup without a campaign id. The guide only documents the campaign-scoped lookup, so treat this as unsupported until VoApps confirms it.',
  tables: [], showBoxes: false, notes: ['Same tests as "GET | Record Information".'], test: recordInfoTest, examples: [recordInfoExamples[4]].filter(Boolean),
});
GET_RECORD_INFO_NO_CAMPAIGN.response = [clone(GET_RECORD_INFO.response.find(x => /^200 Successfully delivered \(UTC/.test(x.name)))];
GET_RECORD_INFO_NO_CAMPAIGN.response[0].originalRequest = clone(GET_RECORD_INFO_NO_CAMPAIGN.request); delete GET_RECORD_INFO_NO_CAMPAIGN.response[0].originalRequest.description;
const GET_RECORD_INFO_PARTNER = req({
  name: 'GET | Record Information (Partner Key)', method: 'GET', path: ['accounts', '{{account_id}}', 'campaigns', '{{campaign_id}}', 'records', '{{record_id}}'], slug: 'record-information',
  auth: PARTNER_AUTH, headers: [{ key: 'VOAPPS_API_USER_ID', value: '{{partner_user_id}}', description: pm(gpp, 'VOAPPS_API_USER_ID'), disabled: true }],
  summary: '**Not documented in the API Access Guide.** Kept from the previous collection ("[Partner] Get Record Information"): the campaign-scoped record lookup sent with the **partner** API key. The `VOAPPS_API_USER_ID` header is included but disabled; enable it to act for a managed user. Unverified.',
  tables: [], showBoxes: false, notes: ['Same tests as "GET | Record Information".'], test: recordInfoTest, examples: [],
});
GET_RECORD_INFO_PARTNER.response = [clone(GET_RECORD_INFO.response.find(x => /^200 Successfully delivered \(UTC/.test(x.name)))];
GET_RECORD_INFO_PARTNER.response[0].originalRequest = clone(GET_RECORD_INFO_PARTNER.request); delete GET_RECORD_INFO_PARTNER.response[0].originalRequest.description; delete GET_RECORD_INFO_PARTNER.response[0].originalRequest.auth;

// ================================================================== SMOKE TESTS (ordered)
const smoke = (num, item, o = {}) => {
  const c = clone(item);
  c.name = String(num).padStart(2, '0') + '. ' + (o.name || item.name);
  c.response = [];
  if (o.extraTest) {
    const t = c.event && c.event.find(e => e.listen === 'test');
    t.script.exec = t.script.exec.concat(exec(o.extraTest));
  }
  c.request.description = (o.intro ? o.intro + '\n\n' : '') + c.request.description;
  c._meta = Object.assign({}, item._meta, o.meta || {});
  return c;
};
const errReq = (name, o) => {
  // expect_rejection tells the collection-level test that a 401/403 is the point of this request
  const pre = join("pm.variables.set('expect_rejection', 'true');", o.pre);
  return req(Object.assign({ expect: '4xx', showBoxes: false, tables: [], test: S.HEAD_4XX }, o, { name, pre }));
};

const SMOKE_INTRO_A = 'Smoke test step. Read-only: nothing is created.';
const A = [
  smoke(1, GET_LIST_ACCOUNTS, { intro: '**Step 1 of 31. Start here.** Confirms your API key works and fills in `account_id`.' }),
  smoke(2, GET_LIST_MESSAGES, { intro: SMOKE_INTRO_A + ' Needs at least one active message in the account.' }),
  smoke(3, GET_MESSAGE_INFO, { intro: SMOKE_INTRO_A }),
  smoke(4, GET_LIST_CALLERS, { intro: SMOKE_INTRO_A + ' Needs at least one active caller number in the account.' }),
  smoke(5, GET_CALLER_INFO, { intro: SMOKE_INTRO_A }),
  smoke(6, GET_LIST_CAMPAIGNS_RANGE, { intro: SMOKE_INTRO_A + ' Lists campaigns created in the last 7 days (may be empty).' }),
];
const listedSoft = R`    if (!body.campaigns.some(c => String(c.id) === String(pm.variables.get('campaign_id')))) { soft('the campaign created in step 7 is not in today\'s list (it may be excluded until it is confirmed, or the UTC date changed during the run)'); }`;
const GET_LIST_CAMPAIGNS_TODAY = clone(GET_LIST_CAMPAIGNS_SINGLE);
const B = [
  smoke(7, FORM_POST_CREATE_CAMPAIGN_TX, { intro: 'Creates one **unconfirmed** transactional test campaign (`confirm_campaign` is `false`, so nothing is delivered).' }),
  smoke(8, GET_CAMPAIGN_INFO, { intro: 'Reads back the campaign created in step 7.' }),
  smoke(9, GET_LIST_CAMPAIGNS_TODAY, { intro: 'Lists today\'s campaigns (UTC). Logs a note if the step 7 campaign is not in the list.', extraTest: 'if (ok) {\n' + listedSoft + '\n}' }),
  smoke(10, JSON_POST_CREATE_RECORD, { intro: 'Adds one record (the guide\'s sample number) to the step 7 campaign. Nothing is delivered while the campaign is unconfirmed.' }),
  smoke(11, GET_RECORD_INFO, { intro: 'Reads back the record from step 10. A new record is normally Pending (100) or Running (101).' }),
];
const OPTIONAL_C = '**Optional:** needs a campaign that is running or paused, which usually means a campaign you have confirmed (`confirm_campaign` = `true`). If the step 7 campaign was never confirmed, VoApps may reject these. ';
const CANCEL_WITHOUT_PAUSE = errReq('PUT | Update a Campaign (Cancel Without Pausing)', {
  method: 'PUT', path: ['accounts', '{{account_id}}', 'campaigns', '{{campaign_id}}'], slug: 'update-a-campaign', urlencoded: [text('method', 'cancel', pm(ucp, 'method'))],
  summary: 'The guide says "A campaign must be paused before it can be canceled", so canceling a running campaign should be rejected. Blocked until `confirm_cancel` is `true`. **If it is not rejected, the campaign really is canceled.**', pre: CANCEL_GUARD,
  notes: ['Expected: a 4xx response.'],
});
const C = [
  smoke(12, CANCEL_WITHOUT_PAUSE, { intro: OPTIONAL_C + '**Expect a 4xx.**' }),
  smoke(13, PUT_PAUSE, { intro: OPTIONAL_C }),
  smoke(14, PUT_PACE, { intro: OPTIONAL_C }),
  smoke(15, PUT_UNPAUSE, { intro: OPTIONAL_C }),
  smoke(16, PUT_PAUSE, { intro: OPTIONAL_C + 'Pausing again so step 17 can cancel.' }),
  smoke(17, PUT_CANCEL, { intro: OPTIONAL_C + '**Cancels the campaign (the guide documents no way to undo this).** Blocked until `confirm_cancel` is `true`.' }),
];
const D = [
  smoke(18, GET_PARTNER_USERS, { intro: '**Partners only.** Skip this folder if you do not have a partner API key.' }),
  smoke(19, GET_PARTNER_USAGE, { intro: '**Partners only.**' }),
];
const e = (name, o) => errReq(name, o);
const BAD_ID = '0';
const E = [
  smoke(20, e('GET | List Accounts (Invalid API Key)', { method: 'GET', path: ['accounts'], slug: 'list-accounts', auth: badKeyAuth, summary: 'Sends a made-up API key. Expect **401 or 403**.', test: S.HEAD_4XX + "\npm.test('Status is 401 or 403', () => pm.expect([401, 403]).to.include(pm.response.code));" }), { intro: '**Error check: expect a rejection.**' }),
  smoke(21, e('GET | List Accounts (No Authorization Header)', { method: 'GET', path: ['accounts'], slug: 'list-accounts', auth: noAuth, summary: 'Sends no Authorization header at all. Expect **401 or 403**.', test: S.HEAD_4XX + "\npm.test('Status is 401 or 403', () => pm.expect([401, 403]).to.include(pm.response.code));" }), { intro: '**Error check: expect a rejection.**' }),
  smoke(22, e('GET | Message Information (Unknown Message)', { method: 'GET', path: ['accounts', '{{account_id}}', 'messages', BAD_ID], slug: 'message-information', summary: 'Asks for message `0`, which does not exist. Expect a 4xx (404 is typical).', test: S.HEAD_4XX + "\nif (pm.response.code !== 404) { console.warn('Note: expected 404, got ' + pm.response.code); }" }), { intro: '**Error check: expect a rejection.**' }),
  smoke(23, e('GET | Caller Number Information (Unknown Caller Number)', { method: 'GET', path: ['accounts', '{{account_id}}', 'caller_numbers', BAD_ID], slug: 'caller-number-information', summary: 'Asks for caller number `0`, which does not exist. Expect a 4xx.', test: S.HEAD_4XX + "\nif (pm.response.code !== 404) { console.warn('Note: expected 404, got ' + pm.response.code); }" }), { intro: '**Error check: expect a rejection.**' }),
  smoke(24, e('GET | Campaign Information (Unknown Campaign)', { method: 'GET', path: ['accounts', '{{account_id}}', 'campaigns', BAD_ID], slug: 'campaign-information', summary: 'Asks for campaign `0`, which does not exist. Expect a 4xx.', test: S.HEAD_4XX + "\nif (pm.response.code !== 404) { console.warn('Note: expected 404, got ' + pm.response.code); }" }), { intro: '**Error check: expect a rejection.**' }),
  smoke(25, e('GET | Record Information (Unknown Record)', { method: 'GET', path: ['accounts', '{{account_id}}', 'campaigns', '{{campaign_id}}', 'records', BAD_ID], slug: 'record-information', summary: 'Asks for record `0` in your campaign, which does not exist. Expect a 4xx.', test: S.HEAD_4XX + "\nif (pm.response.code !== 404) { console.warn('Note: expected 404, got ' + pm.response.code); }" }), { intro: '**Error check: expect a rejection.**' }),
  smoke(26, e('GET | List Campaigns (No Date Filter)', { method: 'GET', path: ['accounts', '{{account_id}}', 'campaigns'], slug: 'list-campaigns', summary: 'Leaves out `created_date` and the date range. The guide says List Campaigns "requires date filter", so expect a 4xx.' }), { intro: '**Error check: expect a rejection.**' }),
  smoke(27, e('POST | Create an Account (Missing Required Fields)', { method: 'POST', path: ['accounts'], slug: 'create-an-account', form: [], summary: 'Sends no `name` or `timezone`, both required. Expect a 4xx. Nothing can be created without them.' }), { intro: '**Error check: expect a rejection.**' }),
  smoke(28, e('FORM POST | Create a Message (Missing Required Fields)', { method: 'POST', path: ['accounts', '{{account_id}}', 'messages'], slug: 'create-a-message', form: [text('method', 'upload')], summary: 'Sends only `method=upload`, with no `name` or `message_file`. Expect a 4xx.' }), { intro: '**Error check: expect a rejection.**' }),
  smoke(29, e('POST | Create a Caller Number (Missing Required Fields)', { method: 'POST', path: ['accounts', '{{account_id}}', 'caller_numbers'], slug: 'create-a-caller-number', form: [text('name', 'postman-negative-test')], summary: 'Sends a name but no `number` and no `verified_by_user`. Expect a 4xx. Nothing can be registered without a number.' }), { intro: '**Error check: expect a rejection.**' }),
  smoke(30, e('FORM POST | Create a Campaign (Missing Required Fields)', { method: 'POST', path: ['accounts', '{{account_id}}', 'campaigns'], slug: 'create-a-campaign', form: [text('name', 'postman-negative-test-{{run_id}}'), text('confirm', 'false')], summary: 'Sends no `message_id` and no `caller_number`, both required, with `confirm=false`. Expect a 4xx.' }), { intro: '**Error check: expect a rejection.**' }),
  smoke(31, e('JSON POST | Create a Record (Missing Number)', { method: 'POST', path: ['accounts', '{{account_id}}', 'campaigns', '{{campaign_id}}', 'records'], slug: 'create-a-record', urlencoded: [text('record_attributes', '{"account": "12345"}')], summary: 'Sends `record_attributes` with no `number` or `phone_number`, which is required. Expect a 4xx.' }), { intro: '**Error check: expect a rejection.**' }),
];
// Give the error requests saved examples too
const errExamplesFor = it => [bad('400 – rejected', 400)];
E.forEach(it => {
  const orig = clone(it.request); delete orig.description; delete orig.auth;
  const is401 = /Invalid API Key|No Authorization/.test(it.name), is404 = /Unknown/.test(it.name);
  const code = is401 ? 401 : is404 ? 404 : 400;
  it.response = [{ name: ILL + code + ' – rejected as expected', originalRequest: orig, status: STATUS_TEXT[code], code, _postman_previewlanguage: 'json', header: [{ key: 'Content-Type', value: 'application/json; charset=utf-8' }], cookie: [], body: JSON.stringify(errBody(code), null, 2) }];
});

const folder = (name, description, items, extra) => Object.assign({ name, description, item: items }, extra || {});

const SMOKE = folder('Smoke Tests (run in order)',
  [
    '**Run this folder top to bottom** (right-click the folder > Run folder, or click Send on each step in order). 31 numbered steps; each one saves what the next one needs.',
    '',
    '| Part | Steps | What it does | Needs |',
    '| --- | --- | --- | --- |',
    '| A. Read-only checks | 01-06 | Key works; lists and fetches accounts, messages, caller numbers, campaigns | An account with a message and a caller number |',
    '| B. Test campaign and record | 07-11 | Creates one **unconfirmed** transactional campaign and one record, then reads them back | Part A (nothing is delivered while `confirm_campaign` is `false`) |',
    '| C. Campaign controls | 12-17 | Cancel-without-pause (expects 4xx), pause, pace, unpause, pause, cancel | **Optional.** A running or paused campaign; `confirm_cancel` must be `true` for cancel steps |',
    '| D. Partner API | 18-19 | Partner users and acting on a managed user\'s behalf | **Partners only** (`partner_api_key`) |',
    '| E. Error handling | 20-31 | Bad key, no key, unknown ids, missing fields: each must be **rejected with a 4xx** | Part B for the campaign steps |',
    '',
    'Tip: in the Collection Runner, untick parts C and D unless you need them. These steps reuse the requests in the folders below; the saved success examples (guide samples, every result code) live on those matching requests.',
    '',
    'Safety defaults: campaigns are created with `confirm=false`, the caller-number certification is never made for you, and cancel/create-account are blocked until you flip their switch variables. See the collection description.',
    '',
    kbp('api', 'API Access Guide') + ' · ' + kbHome,
  ].join('\n'),
  [
    folder('A. Read-only checks (01-06)', 'Nothing is created. Confirms authentication and reads your account data.', A),
    folder('B. Test campaign and record (07-11)', 'Creates one unconfirmed transactional campaign and one record. Nothing is delivered while `confirm_campaign` is `false`.', B),
    folder('C. Campaign controls (12-17, optional)', 'Needs a running or paused campaign. Cancel steps are blocked until `confirm_cancel` is `true`.', C),
    folder('D. Partner API (18-19, partners only)', 'Needs `partner_api_key`. ' + kbp('api/partner-api', 'Partner API'), D, { auth: PARTNER_AUTH }),
    folder('E. Error handling (20-31, expect 4xx)', 'Every request here is **supposed to be rejected** with a 4xx. A passing test means VoApps refused the request. ' + kbp('api', 'API Access Guide'), E),
  ]);

// ================================================================== POSTBACK SIGNATURE (verify inbound postbacks)
const PRE_VERIFY = R`// HOW VOAPPS SIGNS A POSTBACK (this reference request simulates it)
// signing string = timestamp + "." + destination + "." + rawBody   (joined by literal dots)
// header value   = "v1=" + HMAC-SHA256(signingString, <your postback signing secret>)  in hex
const secret = pm.collectionVariables.get('postback_signing_secret') || 'replace-with-your-account-signing-secret';
const ts   = String(Math.floor(Date.now() / 1000));
const dest = pm.collectionVariables.get('sample_postback_destination') || 'https://your-endpoint.example.com/voapps/postback';
const body = pm.collectionVariables.get('sample_postback_body') || '{}';
const sig  = 'v1=' + CryptoJS.HmacSHA256(ts + '.' + dest + '.' + body, secret).toString(CryptoJS.enc.Hex);
pm.collectionVariables.set('sample_postback_timestamp', ts);
pm.collectionVariables.set('sample_postback_destination', dest);
pm.collectionVariables.set('computed_postback_signature', sig);
console.log('X-VoApps-Timestamp  :', ts);
console.log('X-VoApps-Destination:', dest);
console.log('X-VoApps-Signature  :', sig);`;
const TEST_VERIFY = R`// HOW YOUR ENDPOINT VERIFIES A RECEIVED POSTBACK
// Recompute from the received X-VoApps-Timestamp / -Destination headers and the RAW body,
// then compare to the X-VoApps-Signature header. In production use a constant-time compare,
// and optionally reject timestamps older than a few minutes (replay protection).
const secret   = pm.collectionVariables.get('postback_signing_secret') || 'replace-with-your-account-signing-secret';
const ts       = pm.collectionVariables.get('sample_postback_timestamp');
const dest     = pm.collectionVariables.get('sample_postback_destination');
const rawBody  = pm.collectionVariables.get('sample_postback_body');
const received = pm.collectionVariables.get('computed_postback_signature'); // production: the 'X-VoApps-Signature' request header
const expected = 'v1=' + CryptoJS.HmacSHA256(ts + '.' + dest + '.' + rawBody, secret).toString(CryptoJS.enc.Hex);
pm.test('Recomputed HMAC-SHA256 matches the X-VoApps-Signature header', () => pm.expect(expected).to.eql(received));
pm.test('Signature uses the v1=<hex> scheme', () => pm.expect(expected).to.match(/^v1=[0-9a-f]{64}$/));`;
const POSTBACK_VERIFY_ITEM = {
  name: 'Verify a Postback Signature (reference)',
  request: {
    method: 'POST',
    header: [
      { key: 'Content-Type', value: 'application/json' },
      { key: 'X-VoApps-Timestamp', value: '{{sample_postback_timestamp}}' },
      { key: 'X-VoApps-Destination', value: '{{sample_postback_destination}}' },
      { key: 'X-VoApps-Signature', value: '{{computed_postback_signature}}' },
    ],
    url: { raw: 'https://your-endpoint.example.com/voapps/postback', protocol: 'https', host: ['your-endpoint', 'example', 'com'], path: ['voapps', 'postback'] },
    body: { mode: 'raw', raw: '{{sample_postback_body}}', options: { raw: { language: 'json' } } },
    description: 'Reference only — you do **not** send this to VoApps. VoApps POSTs each delivery result to your `voapps_postback_url` with `X-VoApps-Timestamp`, `X-VoApps-Destination` and `X-VoApps-Signature` (`v1=` + HMAC-SHA256 over `timestamp.destination.raw_body`, keyed with your account **postback signing secret**). The **pre-request script** shows how VoApps signs; the **test script** shows how your endpoint verifies: recompute from the received headers and raw body, then compare. Set `postback_signing_secret` to run it with your own secret. ' + kbp('api/webhook-postback-url', 'Webhook (Postback URL)'),
    auth: { type: 'noauth' },
  },
  response: [],
  event: [ev('prerequest', PRE_VERIFY), ev('test', TEST_VERIFY)],
  _meta: { slug: 'verify-postback-signature', expect: '2xx' },
};
const POSTBACK_FOLDER = folder('Postback Signature (verify)', 'Verify the HMAC signature on inbound DirectDrop Voicemail postbacks before trusting them. ' + kbp('api/webhook-postback-url', 'Webhook (Postback URL)'), [POSTBACK_VERIFY_ITEM]);

// ================================================================== REFERENCE FOLDERS
const REF = [
  folder('Accounts', 'List and create accounts. ' + kbp('api/accounts', 'Guide: Accounts'), [GET_LIST_ACCOUNTS, GET_LIST_ACCOUNTS_HIDDEN, GET_LIST_ACCOUNTS_ALL, POST_CREATE_ACCOUNT]),
  folder('Messages', 'Audio message files. ' + kbp('api/messages', 'Guide: Messages'), [GET_LIST_MESSAGES, GET_LIST_MESSAGES_DISABLED, GET_LIST_MESSAGES_ALL, FORM_POST_CREATE_MESSAGE, GET_MESSAGE_INFO]),
  folder('Caller Numbers', 'The phone numbers shown as caller ID. ' + kbp('api/caller-numbers', 'Guide: Caller Numbers'), [GET_LIST_CALLERS, GET_LIST_CALLERS_DISABLED, GET_LIST_CALLERS_ALL, POST_CREATE_CALLER, GET_CALLER_INFO]),
  folder('Campaigns', 'Create, monitor and control campaigns. ' + kbp('api/campaigns', 'Guide: Campaigns') + '\n\nThe update requests depend on the campaign\'s current state (unpause and cancel need a paused campaign), so send them one at a time. **Smoke Tests, part C** runs them in a working order: pause, change pace, unpause, pause, cancel.', [
    GET_LIST_CAMPAIGNS_SINGLE, GET_LIST_CAMPAIGNS_RANGE, GET_LIST_CAMPAIGNS_OFFSET, GET_LIST_CAMPAIGNS_PAGE2, GET_LIST_CAMPAIGNS_HIDDEN, GET_LIST_CAMPAIGNS_ALL,
    FORM_POST_CREATE_CAMPAIGN_CSV, FORM_POST_CREATE_CAMPAIGN_TX, FORM_POST_CREATE_CAMPAIGN_TX_OFFSET, FORM_POST_CREATE_CAMPAIGN_TX_LABEL, FORM_POST_CREATE_CAMPAIGN_TX_NOW,
    GET_CAMPAIGN_INFO, PUT_PAUSE, PUT_UNPAUSE, PUT_PACE, PUT_CANCEL]),
  folder('Transactional Records', 'Add numbers one at a time and read their results. ' + kbp('api/transactional-records', 'Guide: Transactional Records') + ' · ' + kbp('api/webhook-postback-url', 'Webhook (Postback URL)'), [
    JSON_POST_CREATE_RECORD, JSON_POST_CREATE_RECORD_PHONE_KEY, JSON_POST_CREATE_RECORD_OVERRIDES, JSON_POST_CREATE_RECORD_TARGET_Z, JSON_POST_CREATE_RECORD_TARGET_OFFSET, JSON_POST_CREATE_RECORD_TARGET_LABEL, JSON_POST_CREATE_RECORD_CONVENIENCE, GET_RECORD_INFO]),
  POSTBACK_FOLDER,
  folder('Partner API', '**Partners only.** Uses `partner_api_key`, not your account API key. ' + kbp('api/partner-api', 'Guide: Partner API'), [GET_PARTNER_USERS, GET_PARTNER_USAGE], { auth: PARTNER_AUTH }),
  folder('Not in the guide', 'Requests kept from the previous collection that the API Access Guide does **not** document. Treat them as unsupported until VoApps confirms. They are not part of the Smoke Tests.', [GET_RECORD_INFO_NO_CAMPAIGN, GET_RECORD_INFO_PARTNER]),
];

// ================================================================== COLLECTION DESCRIPTION
const retry = L.boxes('webhook-postback-url')[0].text.replace(/^\*\*Retry Behavior:\*\*\s*/, '');
const resultsTable = L.mdTable([['Result', 'Code', 'Triggers a postback?']].concat(RESULTS.map(r => [r.name, String(r.code), r.postback ? 'Yes' : 'No'])));
const varTable = L.mdTable([['Variable', 'What it is']].concat(VARS.map(v => ['`' + v[0] + '`', v[3]])));
const COLLECTION_DESC = [
  '# VoApps DirectDrop Voicemail API',
  'Ready-to-run requests for the VoApps REST API, built from the **API Access Guide** in the ' + kbHome + '. Every request description quotes the guide\'s parameter tables and links back to its guide page, so the Knowledge Base stays the source of truth: [' + KB + '](' + KB + ').',
  '- **Base URL:** `{{base_url}}` = ' + BASE,
  '- **Authentication:** `Authorization: Token token=<your_api_key>`, the format the API Access Guide documents, set once on this collection (Authorization tab) from the `api_key` variable. The previous version of this collection sent a Bearer token from a variable named `API key`; if you imported that one, import this version again and set `api_key`.',
  '- **Collection revision:** ' + REVISION + '. Guide content quoted as of that date; if a request here ever disagrees with the guide, the guide wins.',
  '## Set up in 3 steps',
  '1. **Get your API key.** Log in to your DirectDrop Voicemail account, select the **API Access** icon and click **Show Key** (' + kbp('api/accessing-your-api-key', 'Accessing Your API Key') + ').',
  '2. **Paste it into `api_key`:** open this collection\'s **Variables** tab (or the optional **VoApps API** environment) and paste the key as the **Current value**. Partners also set `partner_api_key`.',
  '3. **Run the Smoke Tests.** Open **Smoke Tests (run in order)** and run the folder, or click Send on **01. GET | List Accounts**. It confirms your key works and fills in `account_id` for the steps that follow.',
  '## How the collection is organized',
  ['| Folder | Purpose |', '| --- | --- |',
    '| **Smoke Tests (run in order)** | 31 numbered steps in five parts: read-only checks, a test campaign and record, optional campaign controls, partner checks, and error handling. |',
    '| **Accounts, Messages, Caller Numbers, Campaigns, Transactional Records, Partner API** | One folder per guide section, with every variant (filters, date formats, pagination, result codes). |',
    '| **Not in the guide** | Requests from the old collection that the guide does not document. |'].join('\n'),
  'The numbered **Smoke Tests** are the ordered run. The other folders hold individual reference requests (every filter, date format and variant), best sent one at a time.',
  'Request names use the same method labels as the Knowledge Base sidebar: `GET`, `POST`, `FORM POST`, `JSON POST`, `PUT`.',
  '## Safe by default',
  '- Campaigns are created with `confirm=false`: the guide describes this as testing campaign creation **without delivery**. Set `confirm_campaign` to `true` only when you want a campaign to run.',
  '- `verified_by_user` (the Caller Number Certification) defaults to `false`; the collection never makes that certification for you.',
  '- Cancel requests and account creation are blocked until `confirm_cancel` / `confirm_create_account` is `true` (the guide documents no way to undo a cancel or remove an account).',
  '- A request is skipped (not sent), with a plain-English message in the **Postman Console**, if a variable it needs is empty (for example, `account_id` before List Accounts). The same happens to blocked Cancel and Create an Account requests.',
  '- The sample phone number (`111-555-1010`) and postback URL (`your-url.example.com`) come from the guide and are not real.',
  '## Variables', varTable,
  'Computed on every send (do not edit): ' + COMPUTED.map(c => '`' + c[0] + '`').join(', ') + '.',
  '## Saved examples',
  'Each request carries saved examples. **Success examples come from the guide\'s own samples** (and every documented result code on "GET | Record Information"). **Error examples use the HTTP status codes the KB documents** (its *Errors & Status Codes* page): `400` validation with an `{"error":"..."}` body, plus `401` / `403` (`not_authorized`) / `404` (`not-found`) / `500`. Where the KB documents the exact message (e.g. "Name must be unique for this account") the example uses it; the few remaining paraphrases stay marked **"[Illustrative]"**. Use Postman\'s "Save as example" to replace them with real responses.',
  '## Webhooks and results',
  'When a record includes `voapps_postback_url`, VoApps sends an HTTP POST with the delivery result (' + kbp('api/webhook-postback-url', 'Webhook (Postback URL)') + ').',
  '> **Retry behavior:** ' + retry,
  resultsTable,
  'Timestamps (`voapps_timestamp`) are `yyyy-MM-dd HH:mm:ss UTC`, or `yyyy-MM-dd HH:mm:ss ±HH:MM` if your account uses account-timezone results file timestamps (' + kbp('api/results-timestamps', 'Results Timestamps') + '). Result codes are explained in ' + kbp('understanding/result-codes-defined', 'Result Codes Defined') + '.',
  '## Learn more in the Knowledge Base',
  ['- ' + kbp('api', 'API Access Guide') + ' (the source for this collection)', '- ' + kbp('integration', 'API Integration Outline') + ' (planning an integration), including ' + kbp('integration/the-10-00z-start-rule', 'The 10:00Z Start Rule') + ' and ' + kbp('integration/utc-date-logic-implementation-pattern', 'UTC Date Logic'),
    '- ' + kbp('api/frequently-asked-questions', 'API FAQ') + ' (webhooks, authentication, campaign values)', '- ' + kbp('understanding', 'Understanding Your Results'), '- ' + kbp('user/creating-a-campaign-pace-setting', 'Pacing Calculator')].join('\n'),
  'Need access or help? Ask your VoApps account team.',
].join('\n\n');

// ================================================================== ASSEMBLE
const collection = {
  info: { _postman_id: ORIGINAL_POSTMAN_ID, name: 'VoApps DirectDrop Voicemail API', description: COLLECTION_DESC, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [SMOKE].concat(REF),
  auth: apikeyAuth('api_key'),
  event: [ev('prerequest', S.COLLECTION_PRE), ev('test', S.COLLECTION_TEST)],
  variable: VARS.map(v => ({ key: v[0], value: v[1], type: 'string', description: v[3] })).concat(COMPUTED.map(c => ({ key: c[0], value: '', type: 'string', description: 'Computed by the collection pre-request script on every send; do not edit. ' + c[1] }))),
};

// side metadata for the harness, then strip it from the output
const meta = {};
(function walk(items, path) { items.forEach(it => { if (it.item) walk(it.item, path.concat(it.name)); else { meta[path.concat(it.name).join(' / ')] = it._meta; delete it._meta; } }); })(collection.item, []);

fs.writeFileSync(OUT + '/VoApps_API_Collection_REVAMPED.postman_collection.json', JSON.stringify(collection, null, 2) + '\n');

const environment = {
  id: 'b7f1c6a0-5d0e-4f4e-9a52-6a3f6f0c2a11',
  name: 'VoApps API',
  values: VARS.map(v => ({ key: v[0], value: v[1], type: v[2] === 'secret' ? 'secret' : 'default', enabled: true })),
  _postman_variable_scope: 'environment',
  _postman_exported_at: REVISION + 'T00:00:00.000Z',
  _postman_exported_using: 'Postman/11',
};
fs.writeFileSync(OUT + '/VoApps_API.postman_environment.json', JSON.stringify(environment, null, 2) + '\n');

let count = 0; (function c(items) { items.forEach(i => (i.item ? c(i.item) : count++)); })(collection.item);
let ex = 0; (function c(items) { items.forEach(i => (i.item ? c(i.item) : (ex += i.response.length))); })(collection.item);
console.log('requests:', count, '| saved examples:', ex, '| bytes:', fs.statSync(OUT + '/VoApps_API_Collection_REVAMPED.postman_collection.json').size);
