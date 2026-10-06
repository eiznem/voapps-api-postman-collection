// Loads the KB content (kb-content.js) with the same JSON-aware loader the KB tooling uses.
// Default location: one folder up (the KB project). Elsewhere, set KB_CONTENT=/path/to/kb-content.js.
const fs = require('fs');
const path = require('path');
const file = process.env.KB_CONTENT || path.join(__dirname, '..', 'kb-content.js');
if (!fs.existsSync(file)) {
  throw new Error('kb-content.js not found at ' + file + '\nPut the KB project\'s kb-content.js one folder above this one, or set KB_CONTENT=/path/to/kb-content.js');
}
const raw = fs.readFileSync(file, 'utf8');
const guides = new Function(raw + '\nreturn guides;')();
module.exports = { guides, raw };
