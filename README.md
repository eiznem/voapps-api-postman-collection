# VoApps DirectDrop Voicemail API: Postman collection

A ready-to-run [Postman](https://www.postman.com/) collection for the VoApps DirectDrop Voicemail REST API, built from the **API Access Guide** in the [VoApps Knowledge Base](https://voapps.com/hubfs/Client_Success/VoApps_Knowledge_Base.html#api). Every request description quotes the guide's parameter tables and links back to its guide page, so the Knowledge Base stays the source of truth.

## Use it

1. In Postman, click **Import** and choose `VoApps_API_Collection_REVAMPED.postman_collection.json`.
2. Open the collection's **Variables** tab and paste your API key as the **Current value** of `api_key`. (Your key: log in to your DirectDrop Voicemail account, select the **API Access** icon, click **Show Key**.)
3. Run the **Smoke Tests (run in order)** folder, or click **Send** on `01. GET | List Accounts`.

`VoApps_API.postman_environment.json` is an optional environment with the same variables (secrets blank).

## What is in the collection

- **Smoke Tests (run in order):** 31 numbered steps: read-only checks, a test campaign and record, optional campaign controls, Partner API checks, and error handling.
- **One folder per guide section** (Accounts, Messages, Caller Numbers, Campaigns, Transactional Records, Partner API) with every variant: filters, date formats, pagination, result codes.
- **About 550 test assertions** and **198 saved examples** (the guide's samples, every documented result code, and clearly labelled illustrative error examples).
- **Safe by default:** campaigns are created with `confirm=false` (nothing is delivered), the caller number certification (`verified_by_user`) is never made for you, and cancel / create-account stay blocked until you flip their switch variables.
- Requests send `Authorization: Token token=<your_api_key>`, the format the guide documents.

## Rebuild it

The collection is generated from the guide, so it can be regenerated whenever the guide changes. See [`postman-collection-builder/`](postman-collection-builder/README.md).

## Questions

Ask your VoApps account team.
