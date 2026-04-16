# Node-RED Enhancements — v0.6.0-alpha

Reference chat: [TFR fix & cold-start guards](69bff012-da63-4038-a09c-558e829d64b0)

## Files changed

- `nodered/build-flows.js`
- `nodered/configurator.html`
- `nodered/deploy.sh`
- `nodered/template-functions.json` (generated)

---

## 1. FAA TFR ID fix

**Problem:** TFRs displayed incorrect identifiers on ATAK (e.g. `tfr-3-4160`) that didn't match the FAA website (`tfr-6-4160`). The "Associated Link" used the wrong ID and linked to the generic FAA TFR listing instead of the specific TFR detail page.

**Fix:** The TFR CoT builder now uses `notam_id` from the FAA API list response to construct both the display label and the associated link URL. Links now point directly to the TFR detail page (`tfr.faa.gov/tfr3/?page=detail_...`).

**Files:** `build-flows.js` — `FN_TFR_PARSE_BUILD_COT`

---

## 2. Cold-start guards (ArcGIS + TFR)

**Problem:** After every Node-RED restart, all feeds would "churn" — deleting and re-adding every item in the mission, causing ATAK to show large notification counts (e.g. "119 new items" that were actually re-adds of existing data).

**Root causes:**
- ArcGIS feeds: `_featureHashes` (flow context) was empty after restart, so every feature looked "new."
- TFR feeds: `_tfrUids` was empty after restart, so reconcile deleted everything from the mission.

**Fixes:**
- **ArcGIS reconcile:** If ArcGIS API returns 0 features, the previous `_featureHashes` are preserved instead of being overwritten with an empty object. On cold start, features already in the mission are seeded into the hash map without re-streaming.
- **TFR reconcile:** If `_tfrUids` is empty (poll hasn't produced data yet), reconcile skips entirely instead of deleting everything.
- **TFR filter:** If the filter produces 0 TFRs after filtering, the previous `_tfrUids` are preserved and the pipeline stops — preventing false deletions on intermittent empty polls.

**Files:** `build-flows.js` — `FN_RECONCILE`, `FN_TFR_RECONCILE`, `FN_TFR_FILTER_SPLIT`

---

## 3. Template sync for dynamic engine tabs

**Problem:** Code fixes in `build-flows.js` templates did not propagate to dynamic engine tabs created via the configurator. Users had to manually delete and recreate tabs to pick up template changes.

**Fix:** Introduced a template sync mechanism:
- Each function node in ArcGIS and TFR engine templates gets a `_templateKey` identifier.
- `build-flows.js` generates `template-functions.json` mapping each `_templateKey` to its function code.
- `deploy.sh` loads this map during the merge step and updates any dynamic tab function nodes whose code differs from the template.
- Includes migration for older nodes without `_templateKey` — infers the key from node name and tab type.

**Result:** `deploy.sh` now automatically updates function code in all dynamic tabs. No manual tab recreation needed.

**Files:** `build-flows.js`, `deploy.sh`, `template-functions.json`

---

## 4. TFR configurator enhancements

- **Labels on/off toggle:** Per-feed "Show labels on map" checkbox. Default ON.
- **Capitalize names:** New per-feed "Capitalize names" checkbox. Uppercases TFR callsigns (e.g. `tfr-6-4160` → `TFR-6-4160`). Default OFF.
- **Label mode clarification:** `faa_sequence` option text updated to show FAA NOTAM ID format.

**Files:** `build-flows.js` — `FN_TFR_PARSE_BUILD_COT`, `configurator.html`

---

## 5. Deploy process — flow preservation

`deploy.sh` is designed so that deploying code updates **never destroys user-created flows or configurator configs.**

### How it works

1. `git pull` brings down the latest code.
2. `build-flows.js` runs inside the container and generates a fresh `flows.json` with the static/template tabs (Configurator, static engine tabs).
3. The merge step reads the **currently running** `flows.json` from the container and identifies all nodes that belong to dynamic tabs (created via the configurator) or user-created flows.
4. These "preserved" nodes (dynamic engine tabs, their wiring, configs, etc.) are merged back into the new `flows.json`.
5. Template sync runs: any function nodes in preserved tabs with a `_templateKey` get their code updated from `template-functions.json` if it differs from the template — so you get code fixes without losing your tab or config.
6. TLS settings, TCP node config, and credentials are carried forward from the running container.
7. The merged `flows.json` is written to the container and Node-RED is restarted.

### What survives a deploy

- All configurator-created engine tabs (ArcGIS feeds, TFR feeds)
- All user-created Node-RED flows/tabs
- Configurator configs (stored in flow context on the Docker volume)
- TLS certificates and credentials
- TCP connection settings

### What gets replaced on deploy

- Static template tabs (Configurator tab, static engine tab templates)
- Function node code inside dynamic tabs (via template sync — only the code, not the config/wiring)
