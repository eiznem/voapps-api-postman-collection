// Script text for the collection. String.raw keeps regex backslashes intact. No template literals or backticks
// appear inside the generated scripts themselves, so they read like hand-written Postman scripts.
const R = String.raw;

// ---------------------------------------------------------------- collection-level pre-request
const COLLECTION_PRE = R`// VoApps DirectDrop Voicemail API - runs before every request in this collection.
//
// 1) Computes helper variables (UTC dates, unique names for test data). They are request-local, so nothing is
//    written to your globals, environment or collection variables.
// 2) Stops the request (it is not sent), with a plain-English message, if the URL, query, headers or body use a
//    {{variable}} that is empty (for example account_id before you have run List Accounts).
// API keys are not checked here: a blank key simply comes back 401, and the collection-level test explains it.

const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
const hms = d => pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
const localStamp = d => {
    const m = -d.getTimezoneOffset();
    const a = Math.abs(m);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
        pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' +
        (m >= 0 ? '+' : '-') + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
};

const now = new Date();
const day = 24 * 60 * 60 * 1000;
const id = String(now.getTime());
const startTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 10, 1, 0));

const helpers = {
    run_id: id,
    now_utc: now.toISOString(),                                   // 2026-10-06T15:16:39.074Z
    now_utc_label: ymd(now) + ' ' + hms(now) + ' UTC',            // 2026-10-06 15:16:39 UTC
    now_local_offset: localStamp(now),                            // 2026-10-06 11:16:39 -04:00
    today_utc: ymd(now),                                          // 2026-10-06
    yesterday_utc: ymd(new Date(now.getTime() - day)),
    week_ago_utc: ymd(new Date(now.getTime() - 7 * day)),
    // The 10:00Z Start Rule: start campaigns no earlier than 10:00 UTC; the guide uses {date}T10:01:00Z.
    target_date: ymd(now) + 'T10:01:00Z',
    target_date_utc_label: ymd(now) + ' 10:01:00 UTC',
    target_date_local_offset: localStamp(startTime),
    new_account_name: 'postman-test-account-' + id,
    new_message_name: 'postman-test-message-' + id,
    new_message_description: 'Uploaded from Postman (' + id + '). Safe to disable or delete.',
    new_caller_number_name: 'postman-test-caller-number-' + id,
    new_campaign_name: 'postman-test-campaign-' + id
};
Object.keys(helpers).forEach(k => pm.variables.set(k, helpers[k]));

const HINTS = {
    base_url: 'Set base_url to https://directdropvoicemail.voapps.com/api/v1 (collection Variables tab).',
    account_id: 'Send "GET | List Accounts" first (it saves account_id for you), or type your account ID into the account_id variable.',
    message_id: 'Send "GET | List Messages" (or "FORM POST | Create a Message") first, or type a message ID into the message_id variable. The account must have an active message.',
    caller_number_id: 'Send "GET | List Caller Numbers" (or "POST | Create a Caller Number") first, or type an ID into caller_number_id.',
    voapps_caller_number: 'Send "GET | List Caller Numbers" first, or type a caller number (e.g. +15555551212) into voapps_caller_number. Campaigns and records take the phone number, not the caller number id.',
    new_caller_number: 'Type the phone number you want to register (e.g. 555-555-1212) into the new_caller_number variable.',
    campaign_id: 'Create a campaign first ("FORM POST | Create a Campaign (Transactional)"), or run "GET | List Campaigns" to pick up an existing one, or type a campaign ID into campaign_id.',
    record_id: 'Send "JSON POST | Create a Record" first, or type a record ID into record_id.',
    partner_user_id: 'Partners only: send "GET | List of Partner Users" first (it saves partner_user_id), or type a managed user ID into partner_user_id.'
};

const block = message => {
    // Make sure the request is NOT sent (newman and the Collection Runner keep going after a script error),
    // then throw so the message is shown.
    console.error(message);
    try {
        if (pm.execution && typeof pm.execution.skipRequest === 'function') { pm.execution.skipRequest(); }
        else { pm.request.url.update('http://blocked.invalid/'); }   // older Postman: make the request unsendable
    } catch (e) {
        pm.request.url.update('http://blocked.invalid/');
    }
    throw new Error(message);
};

let problem = null;
try {
    const req = pm.request;
    const parts = [req.url.getHost(), req.url.getPath()];
    req.url.query.each(q => { if (!q.disabled) { parts.push(q.value || ''); } });
    req.headers.each(h => { if (!h.disabled) { parts.push(h.value || ''); } });
    const body = req.body;
    if (body) {
        if (body.mode === 'formdata') { body.formdata.each(p => { if (!p.disabled && p.type !== 'file') { parts.push(p.value || ''); } }); }
        if (body.mode === 'urlencoded') { body.urlencoded.each(p => { if (!p.disabled) { parts.push(p.value || ''); } }); }
        if (body.mode === 'raw') { parts.push(body.raw || ''); }
    }
    const used = [];
    String(parts.join(' ')).replace(/\{\{\s*([^{}\s$][^{}\s]*)\s*\}\}/g, (m, name) => { if (used.indexOf(name) < 0) { used.push(name); } return m; });
    const empty = used.filter(n => {
        const v = pm.variables.get(n);
        return v === undefined || v === null || String(v).trim() === '';
    });
    if (empty.length) {
        problem = 'Cannot send "' + pm.info.requestName + '": the variable ' + empty.map(n => '{{' + n + '}}').join(', ') + ' is empty.\n' +
            empty.map(n => '- ' + n + ': ' + (HINTS[n] || 'Give it a value in the collection Variables tab (or the active environment).')).join('\n');
    }
} catch (e) {
    console.warn('Variable check skipped (' + e.message + ')');
}
if (problem) {
    block(problem);
}`;

// ---------------------------------------------------------------- collection-level test
const COLLECTION_TEST = R`// Runs after every request in this collection.
// Requests that are SUPPOSED to be rejected (the Error handling steps) set expect_rejection in their own pre-request script.
if ((pm.response.code === 401 || pm.response.code === 403) && pm.variables.get('expect_rejection') !== 'true') {
    pm.test('API key accepted (not 401/403)', () => {
        throw new Error('Got ' + pm.response.code + '. Check that api_key holds your API key (Partner API requests use partner_api_key), ' +
            'and that the account, campaign or record belongs to that key. See "Accessing Your API Key" in the VoApps Knowledge Base.');
    });
}
if (pm.response.code >= 500) {
    pm.test('VoApps did not return a server error (5xx)', () => {
        throw new Error('Got ' + pm.response.code + '. Try again in a minute; if it persists, contact your VoApps account team with the request and time.');
    });
}`;

// ---------------------------------------------------------------- shared test helpers
const HELPERS = R`const need = (obj, fields, label) => fields.forEach(f => pm.expect(obj, (label || 'object') + ' is missing "' + f + '"').to.have.property(f));
const soft = (message) => console.warn('Note: ' + message);`;

const SAVE = R`const isBlank = k => { const v = pm.variables.get(k); return v === undefined || v === null || String(v).trim() === ''; };
const save = (k, v) => {
    if (v === undefined || v === null || v === '') { return; }
    let useEnv = false;
    try { useEnv = !!pm.environment.name; } catch (e) { useEnv = false; }
    if (useEnv) { pm.environment.set(k, v); } else { pm.collectionVariables.set(k, v); }
    console.log('Saved ' + k + ' = ' + v);
};
const keepOrPickFirst = (k, ids) => {
    if (!ids.length) { return; }
    if (isBlank(k) || ids.map(String).indexOf(String(pm.variables.get(k))) < 0) { save(k, ids[0]); }
};`;

const HEAD_2XX = R`pm.test('Status code is 2xx', () => pm.expect(pm.response.code).to.be.within(200, 299));
pm.test('Response time is under 10 seconds', () => pm.expect(pm.response.responseTime).to.be.below(10000));
let body = null;
pm.test('Response body is JSON', () => { body = pm.response.json(); });
const ok = body !== null && pm.response.code >= 200 && pm.response.code < 300;`;

const HEAD_4XX = R`pm.test('Request is rejected with a 4xx status', () => pm.expect(pm.response.code).to.be.within(400, 499));
pm.test('Not a server error (5xx)', () => pm.expect(pm.response.code).to.be.below(500));
pm.test('Response time is under 10 seconds', () => pm.expect(pm.response.responseTime).to.be.below(10000));
pm.test('No resource was created or returned (body has no record, campaign, message or account object)', () => {
    let parsed = null;
    try { parsed = pm.response.json(); } catch (e) { parsed = null; }
    if (parsed && typeof parsed === 'object') {
        ['account', 'accounts', 'message', 'messages', 'caller_number', 'caller_numbers', 'campaign', 'campaigns', 'record'].forEach(k => pm.expect(parsed, 'unexpected "' + k + '" in an error response').to.not.have.property(k));
    }
});`;

const PREREQ_REQUIRE = (variable, message) => R`const block = message => {
    // Make sure the request is NOT sent (newman and the Collection Runner keep going after a script error),
    // then throw so the message is shown.
    console.error(message);
    try {
        if (pm.execution && typeof pm.execution.skipRequest === 'function') { pm.execution.skipRequest(); }
        else { pm.request.url.update('http://blocked.invalid/'); }   // older Postman: make the request unsendable
    } catch (e) {
        pm.request.url.update('http://blocked.invalid/');
    }
    throw new Error(message);
};
if (String(pm.variables.get('${variable}')).toLowerCase() !== 'true') {
    block('${message}');
}`;

const visualizerList = (arrayPath, columns, maskKeys) => {
  const cols = columns.map(c => ({ ...c }));
  return R`const rows = ${arrayPath};
const mask = v => (v ? '****' + String(v).slice(-4) : '');
const template = '<style>.t{font-family:sans-serif;font-size:14px;border-collapse:collapse;width:100%}.t th{background:#e8f0fe;text-align:left;padding:6px;border:1px solid #c5d3ea}.t td{padding:6px;border:1px solid #c5d3ea}</style>' +
    '<table class="t"><tr>${cols.map(c => '<th>' + c.title + '</th>').join('')}</tr>{{#each rows}}<tr>${cols.map(c => '<td>{{' + c.key + '}}</td>').join('')}</tr>{{/each}}</table>';
pm.visualizer.set(template, { rows: rows.map(r => ({ ${cols.map(c => c.key + ': ' + (c.mask ? 'mask(r.' + c.key + ')' : 'r.' + c.key)).join(', ')} })) });`;
};

module.exports = { COLLECTION_PRE, COLLECTION_TEST, HELPERS, SAVE, HEAD_2XX, HEAD_4XX, PREREQ_REQUIRE, visualizerList };
