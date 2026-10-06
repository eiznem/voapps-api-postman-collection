// Local MOCK of the VoApps REST API, built from the API Access Guide. For exercising the Postman collection only:
// it checks collection MECHANICS (auth header, body encodings, variable chaining, scripts) in real newman, not API truth.
// Assumptions are marked "ASSUMPTION" (the guide does not say): error status codes/bodies, unconfirmed campaigns cannot be paused.
const http = require('http');

const TIMEZONES = ['America/New_York', 'America/Detroit', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello', 'America/Indiana/Indianapolis', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Vevay', 'America/Chicago', 'America/Indiana/Tell_City', 'America/Indiana/Knox', 'America/Menominee', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah', 'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome', 'America/Adak', 'Pacific/Honolulu'];

function parseMultipart(buf, boundary) {
  const fields = {}, files = {};
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  while (pos >= 0) {
    const next = buf.indexOf(delim, pos + delim.length);
    if (next < 0) break;
    const part = buf.slice(pos + delim.length + 2, next - 2); // strip CRLF after delimiter and before next
    const split = part.indexOf('\r\n\r\n');
    if (split > 0) {
      const head = part.slice(0, split).toString('utf8');
      const body = part.slice(split + 4);
      const name = (head.match(/name="([^"]*)"/) || [])[1];
      const filename = (head.match(/filename="([^"]*)"/) || [])[1];
      if (name !== undefined) { if (filename !== undefined) files[name] = { filename, size: body.length }; else fields[name] = body.toString('utf8'); }
    }
    pos = next;
  }
  return { fields, files };
}

function start(port) {
  let S;
  const log = [];
  const reset = () => {
    S = {
      nextId: { account: 3600, message: 30000, caller: 100, campaign: 1700000, record: 1234 },
      accounts: [{ id: 3530, name: 'acme-main', timezone: 'America/New_York', hidden: false }, { id: 3531, name: 'acme-archive', timezone: 'America/Chicago', hidden: true }],
      messages: { 3530: [{ id: 22038, name: 'Payment Reminder', description: null, duration: '23.5', file_url: 'https://voapps.s3.amazonaws.com/your/message/file.wav', disabled: false }] },
      callers: { 3530: [{ id: 1, name: 'Main line', number: '+18557371597', disabled: false }] },
      campaigns: { 3530: [] },
      records: {},
    };
  };
  reset();

  const camp = (c) => ({ id: c.id, name: c.name, state: c.state, pace: c.pace, progress: c.progress, status: c.status, uri: `https://directdropvoicemail.voapps.com/accounts/${c.account}/campaigns/${c.id}`, target_date: c.target_date, export: `https://voapps-production.s3.amazonaws.com/campaign_export_${c.id}.csv`, records_count: String(c.records_count), successfully_delivered: String(c.successfully_delivered), caller_number: c.caller_number, message_id: String(c.message_id) });
  const normTarget = (v) => {
    if (!v) return null;
    let s = String(v).trim().replace(/ UTC$/, 'Z').replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T').replace(/ ([+-]\d{2}:\d{2})$/, '$1');
    const d = new Date(s);
    return isNaN(d) ? undefined : d.toISOString();
  };
  const normNumber = (v) => { const d = String(v || '').replace(/\D/g, ''); if (d.length === 10) return '+1' + d; if (d.length === 11 && d[0] === '1') return '+' + d; return null; };
  const fmtNumber = (v) => { const d = String(v || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v); };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const ct = req.headers['content-type'] || '';
      let fields = {}, files = {};
      if (/multipart\/form-data/.test(ct)) ({ fields, files } = parseMultipart(buf, ct.match(/boundary=(.+)$/)[1]));
      else if (/urlencoded/.test(ct)) fields = Object.fromEntries(new URLSearchParams(buf.toString('utf8')));
      const entry = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization || null, contentType: ct.split(';')[0], userIdHeader: req.headers['voapps_api_user_id'] || null, fields, files, status: null };
      log.push(entry);
      const send = (code, obj) => { entry.status = code; const body = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(body); };
      const err = (code, msg) => send(code, { error: msg }); // ASSUMPTION: error body shape

      const m = (req.headers.authorization || '').match(/^Token token=(.*)$/);
      const key = m ? m[1] : null;
      const role = key === 'test-key' ? 'account' : key === 'test-partner-key' ? 'partner' : null;
      if (!role) return err(401, 'Unauthorized');
      const p = url.pathname.replace(/^\/api\/v1/, '');
      let r;

      // ---- partner
      if (req.method === 'GET' && p === '/partners/users') {
        if (role !== 'partner') return err(403, 'Forbidden');
        return send(200, { users: [{ id: 456, email: 'user@example.com', api_key: 'abcdef0123456789abcdef0123456789' }] });
      }
      // ---- accounts
      if (p === '/accounts' && req.method === 'GET') {
        const f = url.searchParams.get('filter');
        const list = S.accounts.filter(a => f === 'all' ? true : f === 'hidden' ? a.hidden : !a.hidden);
        return send(200, { accounts: list.map(a => ({ id: a.id, name: a.name, timezone: a.timezone })) });
      }
      if (p === '/accounts' && req.method === 'POST') {
        if (!fields.name || !fields.timezone) return err(422, 'name and timezone are required');
        if (!TIMEZONES.includes(fields.timezone)) return err(422, 'unsupported timezone');
        if (S.accounts.some(a => a.name === fields.name)) return err(422, 'name must be unique');
        const a = { id: S.nextId.account++, name: fields.name, timezone: fields.timezone, hidden: false };
        S.accounts.push(a); S.messages[a.id] = []; S.callers[a.id] = []; S.campaigns[a.id] = [];
        return send(201, { accounts: [{ id: a.id, name: a.name, timezone: a.timezone }] });
      }
      // ---- account-scoped
      if ((r = p.match(/^\/accounts\/(\d+)(\/.*)?$/))) {
        const acc = Number(r[1]), rest = r[2] || '';
        if (!S.accounts.some(a => a.id === acc)) return err(404, 'Account not found');
        const msgs = S.messages[acc] || (S.messages[acc] = []), calls = S.callers[acc] || (S.callers[acc] = []), camps = S.campaigns[acc] || (S.campaigns[acc] = []);
        const filt = (list, f) => list.filter(x => f === 'all' ? true : f === 'disabled' ? x.disabled : !x.disabled);
        const f = url.searchParams.get('filter');
        let q;
        // messages
        if (rest === '/messages' && req.method === 'GET') return send(200, { messages: filt(msgs, f).map(({ disabled, ...x }) => x) });
        if (rest === '/messages' && req.method === 'POST') {
          if (!fields.name || fields.method !== 'upload' || !files.message_file || !files.message_file.size) return err(422, 'name, method=upload and message_file are required');
          const x = { id: S.nextId.message++, name: fields.name, description: fields.description || null, duration: '23.5', file_url: 'https://voapps.s3.amazonaws.com/your/message/' + files.message_file.filename, disabled: false };
          msgs.push(x); const { disabled, ...out } = x; return send(201, { message: out });
        }
        if ((q = rest.match(/^\/messages\/(\d+)$/)) && req.method === 'GET') { const x = msgs.find(y => y.id === Number(q[1])); if (!x) return err(404, 'Message not found'); const { disabled, ...out } = x; return send(200, { message: out }); }
        // caller numbers
        if (rest === '/caller_numbers' && req.method === 'GET') return send(200, { caller_numbers: filt(calls, f).map(({ disabled, ...x }) => x) });
        if (rest === '/caller_numbers' && req.method === 'POST') {
          const n = normNumber(fields.number);
          if (!fields.name || !n || fields.verified_by_user !== 'true') return err(422, 'name, number and verified_by_user=true are required');
          const x = { id: S.nextId.caller++, name: fields.name, number: n, disabled: false }; calls.push(x);
          return send(201, { caller_number: { id: x.id, name: x.name, number: x.number } });
        }
        if ((q = rest.match(/^\/caller_numbers\/(\d+)$/)) && req.method === 'GET') { const x = calls.find(y => y.id === Number(q[1])); if (!x) return err(404, 'Caller number not found'); const { disabled, ...out } = x; return send(200, { caller_number: out }); }
        // campaigns
        if (rest === '/campaigns' && req.method === 'GET') {
          const one = url.searchParams.get('created_date'), s = url.searchParams.get('created_date_start'), e = url.searchParams.get('created_date_end');
          if (!one && !(s && e)) return err(422, 'created_date or created_date_start and created_date_end are required');
          let list = camps.filter(c => f === 'all' ? true : f === 'hidden' ? c.hidden : !c.hidden);
          if (one) list = list.filter(c => c.created === one.slice(0, 10)); else list = list.filter(c => c.created >= s.slice(0, 10) && c.created <= e.slice(0, 10));
          list = list.slice().reverse();
          const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
          return send(200, { campaigns: list.slice((page - 1) * 25, page * 25).map(camp) });
        }
        if (rest === '/campaigns' && req.method === 'POST') {
          if (!msgs.some(x => String(x.id) === String(fields.message_id))) return err(422, 'message_id must belong to this account');
          if (!fields.caller_number) return err(422, 'caller_number is required');
          if (!fields.name || camps.some(c => c.name === fields.name)) return err(422, 'name is required and must be unique per account');
          const tx = fields.transactional === 'true';
          if (!tx && !(files.campaign_import && files.campaign_import.size)) return err(422, 'campaign_import is required for non-transactional campaigns');
          const target = normTarget(fields.target_date); if (target === undefined) return err(422, 'target_date is not a valid ISO 8601 date');
          let pace = fields.pace ? parseInt(fields.pace, 10) : 8000; if (isNaN(pace)) return err(422, 'pace must be numeric'); pace = Math.min(8000, Math.max(50, pace));
          const confirmed = fields.confirm === 'true';
          const c = { id: S.nextId.campaign++, account: acc, name: fields.name, tx, hidden: false, created: new Date().toISOString().slice(0, 10), status: confirmed ? 'running' : 'setup', state: confirmed ? 'running' : 'created', pace, progress: 0, target_date: target || new Date().toISOString(), records_count: 0, successfully_delivered: 0, caller_number: fields.caller_number, message_id: fields.message_id };
          camps.push(c);
          return send(201, { campaign: { id: c.id, name: c.name, uri: camp(c).uri, target_date: c.target_date } });
        }
        if ((q = rest.match(/^\/campaigns\/(\d+)$/))) {
          const c = camps.find(y => y.id === Number(q[1])); if (!c) return err(404, 'Campaign not found');
          if (req.method === 'GET') return send(200, { campaign: camp(c) });
          if (req.method === 'PUT') {
            if (c.status === 'canceled') return err(422, 'campaign is canceled');
            if (fields.method === 'pause') { if (c.status !== 'running') return err(422, 'only a running campaign can be paused'); c.status = c.state = 'paused'; } // ASSUMPTION: unconfirmed ("setup") campaigns cannot be paused
            else if (fields.method === 'unpause') { if (c.status !== 'paused') return err(422, 'campaign is not paused'); c.status = c.state = 'running'; }
            else if (fields.method === 'cancel') { if (c.status !== 'paused') return err(422, 'a campaign must be paused before it can be canceled'); c.status = c.state = 'canceled'; }
            else if (fields.method) return err(422, 'unknown method');
            if (fields.pace) { const pc = parseInt(fields.pace, 10); if (isNaN(pc)) return err(422, 'pace must be numeric'); c.pace = Math.min(8000, Math.max(50, pc)); }
            const o = camp(c); return send(200, { campaign: { id: o.id, name: o.name, pace: o.pace, progress: o.progress, status: o.status, uri: o.uri, target_date: o.target_date, export: o.export } });
          }
        }
        // records
        const addRecord = (c) => {
          let attrs; try { attrs = JSON.parse(fields.record_attributes); } catch (e) { return err(422, 'record_attributes must be JSON'); }
          const num = attrs.number || attrs.phone_number; if (!num) return err(422, 'number or phone_number is required');
          if (attrs.voapps_target_date && normTarget(attrs.voapps_target_date) === undefined) return err(422, 'voapps_target_date is not valid');
          const id = S.nextId.record++; (S.records[c.id] = S.records[c.id] || {})[id] = { id, number: fmtNumber(num), original_fields: attrs }; c.records_count++;
          return send(201, { record: { id } });
        };
        if ((q = rest.match(/^\/campaigns\/(\d+)\/records$/)) && req.method === 'POST') {
          const c = camps.find(y => y.id === Number(q[1])); if (!c) return err(404, 'Campaign not found');
          if (!c.tx || c.status === 'canceled' || c.status === 'completed') return err(422, 'campaign does not accept records');
          return addRecord(c);
        }
        if (rest === '/records' && req.method === 'POST') {
          let c = camps.slice().reverse().find(y => y.tx && y.status === 'running');
          if (!c) { const msg = msgs[0], cn = calls[0]; if (!msg || !cn) return err(422, 'no default message or caller number'); c = { id: S.nextId.campaign++, account: acc, name: 'auto-' + Date.now(), tx: true, hidden: false, created: new Date().toISOString().slice(0, 10), status: 'running', state: 'running', pace: 8000, progress: 0, target_date: new Date().toISOString(), records_count: 0, successfully_delivered: 0, caller_number: cn.number, message_id: msg.id }; camps.push(c); }
          return addRecord(c);
        }
        const recGet = (rid, cid) => { const rec = ((cid ? S.records[cid] : Object.values(S.records).reduce((a, b) => Object.assign(a, b), {})) || {})[rid]; return rec; };
        if ((q = rest.match(/^\/campaigns\/(\d+)\/records\/(\d+)$/)) && req.method === 'GET') {
          if (!camps.some(y => y.id === Number(q[1]))) return err(404, 'Campaign not found');
          const rec = recGet(Number(q[2]), Number(q[1])); if (!rec) return err(404, 'Record not found');
          return send(200, { record: { id: rec.id, number: rec.number, delivery_status: 'Pending', delivery_status_code: 100, voapps_timestamp: null, original_fields: rec.original_fields } });
        }
        if ((q = rest.match(/^\/records\/(\d+)$/)) && req.method === 'GET') { // not in the guide
          const rec = recGet(Number(q[1]), null); if (!rec) return err(404, 'Record not found');
          return send(200, { record: { id: rec.id, number: rec.number, delivery_status: 'Pending', delivery_status_code: 100, voapps_timestamp: null, original_fields: rec.original_fields } });
        }
      }
      return err(404, 'Not found');
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ port, log, reset, close: () => new Promise(r => server.close(r)), state: () => S })));
}
module.exports = { start };
