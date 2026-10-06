#!/usr/bin/env node
// FALLBACK for replacing the shared VoApps Postman collection when Postman's Import does not offer "Replace".
// It keeps the collection id (so the shared link and its access key keep working).
//
// Needs YOUR Postman API key in the POSTMAN_API_KEY environment variable. The key is never written to disk or printed.
// Create one in Postman: Settings > API keys > Generate API Key. Then, in a terminal:
//
//   export POSTMAN_API_KEY=...            # type or paste it yourself
//   node push_to_postman.cjs              # DRY RUN: shows what it would do, sends nothing
//   node push_to_postman.cjs --yes        # backs up the live collection to ../_backups/, then replaces it
//
// The collection file is ../VoApps_API_Collection_REVAMPED.postman_collection.json (run `node build.cjs` first if the guide changed).
const fs = require('fs');
const path = require('path');

const FILE = process.env.COLLECTION_FILE || path.resolve(__dirname, '..', 'VoApps_API_Collection_REVAMPED.postman_collection.json');
const OWNER_ID = process.env.POSTMAN_OWNER_ID || '34531787';              // the Postman user id that owns the collection (the prefix of its uid)
const BASE = process.env.POSTMAN_API_BASE || 'https://api.getpostman.com';
const BACKUPS = process.env.BACKUP_DIR || path.resolve(__dirname, '..', '_backups');
const go = process.argv.includes('--yes');

const die = (msg) => { console.error(msg); process.exit(1); };
const key = process.env.POSTMAN_API_KEY;
if (!key) die('POSTMAN_API_KEY is not set. Create a key in Postman (Settings > API keys), then run:\n  export POSTMAN_API_KEY=<your key>\n  node push_to_postman.cjs');

const collection = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (!collection.info || !collection.info._postman_id || !Array.isArray(collection.item)) die('Not a Postman collection: ' + FILE);
// never push a collection that carries a key
(collection.variable || []).filter(v => /api_key/.test(v.key) && String(v.value || '').trim() !== '').forEach(v => die('Refusing to push: variable "' + v.key + '" has a value. API keys must stay blank in the shared collection.'));

const uid = OWNER_ID + '-' + collection.info._postman_id;
let requests = 0; (function c(items) { items.forEach(i => (i.item ? c(i.item) : requests++)); })(collection.item);
console.log('Collection : ' + collection.info.name + ' (' + requests + ' requests)');
console.log('Replaces   : ' + uid + ' at ' + BASE + '/collections/' + uid);
if (!go) { console.log('\nDRY RUN: nothing was sent. Re-run with --yes to back up the live collection and replace it.'); process.exit(0); }

(async () => {
  const headers = { 'X-API-Key': key, 'Content-Type': 'application/json' };
  const got = await fetch(BASE + '/collections/' + uid, { headers });
  const text = await got.text();
  if (!got.ok) die('Could not read the live collection first (HTTP ' + got.status + '). Nothing was changed.\n' + text.slice(0, 300));
  fs.mkdirSync(BACKUPS, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backup = path.join(BACKUPS, 'postman-LIVE-collection-before-push-' + ts + '.json');
  fs.writeFileSync(backup, text);
  console.log('Backed up the live collection to ' + backup);

  const put = await fetch(BASE + '/collections/' + uid, { method: 'PUT', headers, body: JSON.stringify({ collection }) });
  const out = await put.text();
  if (!put.ok) die('Replace FAILED (HTTP ' + put.status + '). The live collection was not changed; the backup is above.\n' + out.slice(0, 600));
  console.log('Replaced. HTTP ' + put.status + '. Open the shared link in a private window to confirm it now serves "' + collection.info.name + '".');
})().catch(e => die('Failed: ' + e.message));
