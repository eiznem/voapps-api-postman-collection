# VoApps API Postman collection builder

Generates the VoApps API Postman collection and its environment file from the **API Access Guide** in the Knowledge Base (`../kb-content.js`):

- `../VoApps_API_Collection_REVAMPED.postman_collection.json`
- `../VoApps_API.postman_environment.json` (secrets blank)

The guide is the source of truth. Request descriptions quote the guide's parameter tables, and the result codes and names, the 29 supported timezones, the campaign `status` and `state` values and the example responses are all read from the guide, not retyped. **When the guide changes, re-run the build** and re-import the collection.

## Commands

Run from this folder (needs Node, no install for the first three):

```bash
# KB_CONTENT=/path/to/kb-content.js   (only if it is not one folder up)
node build.cjs        # regenerate the collection + environment files
node validate.cjs     # structural checks: JSON parses, {{base_url}} in every URL, variables defined, names unique, no secrets, KB links resolve
node harness.cjs      # runs every script against every saved example in a mock of Postman's pm sandbox
```

Real newman against a local mock API (installs newman into `node_modules` here, about 60 MB):

```bash
npm install
node newman/run_newman.cjs
```

`npm run check` does all of the above in order.

## What is in here

| File | Purpose |
| --- | --- |
| `build.cjs` | Assembles every request, folder, saved example, the description text, the environment file |
| `scripts.cjs` | The Postman scripts: collection pre-request (UTC helpers and the empty-variable guard), collection test, shared test helpers |
| `lib.cjs` | Reads the guide: tables, callouts, examples, result codes (JSON-aware, never a bare tag regex) |
| `load.cjs` | Loads `../kb-content.js` (or `$KB_CONTENT`) |
| `validate.cjs` | Structural validation of the two output files |
| `harness.cjs` | Script-logic tests with a mock `pm` (tests vs every example, guard, safety switches, saving ids) |
| `newman/mock_api.cjs` | Local mock of the VoApps API built from the guide |
| `newman/run_newman.cjs` | Runs the collection in real newman against the mock (smoke run, whole collection, guards, wrong key) |
| `push_to_postman.cjs` | Fallback to replace the shared collection through Postman's API when Import does not offer Replace (dry run by default, needs your own `POSTMAN_API_KEY`) |

## Things to know

- **Authentication.** Requests send `Authorization: Token token={{api_key}}`, the format the API Access Guide documents. The previous shared collection sent a Bearer token from a variable named `API key`.
- **Same collection id.** `info._postman_id` is deliberately the id of the live shared collection, so Postman's Import offers **Replace** and the shared access-key link keeps working.
- **Safety switches** default to `false`: `confirm_campaign`, `verified_by_user`, `confirm_cancel`, `confirm_create_account`. Blocked requests are skipped (not sent) with a message in the Postman Console.
- **Never put real keys in these files.** `api_key` and `partner_api_key` stay blank; `validate.cjs` fails if a key-like string or the private Postman URL appears.
- **Saved error examples are illustrative.** The guide documents no error bodies, so they are labelled `[Illustrative]`. The mock API is also built from the guide plus a few marked `ASSUMPTION`s (error codes and bodies, unconfirmed campaigns cannot be paused); it checks the collection's mechanics, not the real API's behavior.
- **Order matters in Smoke Tests only.** The reference folders (Accounts, Messages, ...) hold individual requests to send one at a time.
- **`kb-content.js` is not part of this repo.** Put the KB project's copy one folder above `postman-collection-builder/`, or set `KB_CONTENT=/path/to/kb-content.js`.
- Editing `kb-content.js` is a separate job: follow the KB edit conventions (backup first, JSON-aware edits, `node --check`).
