# Node-RED — v0.6.5-alpha (ArcGIS Configurator + KML Configurator)

See **[docs/RELEASE-v0.6.5-alpha.md](../docs/RELEASE-v0.6.5-alpha.md)** for the full operator summary.

**Touch points:** `nodered/build-flows.js`, `nodered/configurator.html`, `nodered/flows.json`, `nodered/template-functions.json` — template keys `arcgis.parse_cot` / `arcgis.reconcile` sync via existing **`deploy.sh`** on deploy/post-update.

---

## Changes in this release

### ArcGIS Configurator

- **Stable ID pill picker** — replaces single `idField` select with multi-select pills; compound UIDs (`c` + djb2 hash) when multiple fields chosen; multi-layer presence badges (`in X/N`)
- **Strict mission ownership** — Step 5 checkbox (default on); reconcile deletes UIDs not in current result set; hotfix disables strict on per-layer passes to prevent cross-layer deletion
- **Purge Orphans** — one-shot strict reconcile from config card sidebar; `POST /arcgis-tak/tak/purge-orphans`

### KML Configurator (new)

- **Full KML Configurator flow** (`kmlStep1` → `kmlStep2` → `kmlStep3`) built to mirror ArcGIS Configurator layout and interaction patterns
- **Fetch button** — `POST /arcgis-tak/kml/fetch` endpoint; implemented as a chain of Node-RED `http request` nodes (`hi_kml_fetch` → `fn_kml_prep` → `hr_kml_main` → `fn_kml_check_nl` → `hr_kml_inner` → `fn_kml_parse` → `ho_kml_fetch`) to avoid async function-node hangs
- **NetworkLink follow** — automatically resolves and fetches inner URL when KML root contains `<NetworkLink>`; handles relative, protocol-relative, and absolute hrefs
- **Attribute discovery** — `fn_kml_parse` / `FN_KML_PARSE_FIELDS` extracts keys and samples from up to 20 geometry-bearing placemarks; supports ArcGIS-style HTML attribute tables in `<description>`, `<ExtendedData>` / `<SimpleData>`, and `name` / `OBJECTID`
- **Sample attributes table** — rendered in step 1 after Fetch (mirrors ArcGIS sample features table); up to 15 rows, truncates long values
- **Stable ID pills** — same pill picker pattern as ArcGIS; fresh fetch leaves all fields blank (no auto-selection)
- **Label template pills** — click-to-compose callsign template; custom prefix text; live preview; blank on fresh config
- **Remarks pills** — click-to-add fields in order; blank on fresh config
- **Time field + epoch ms** — select populated from Fetch results; epoch-ms checkbox (same as ArcGIS)
- **Deduplicate by** — select populated from Fetch results; keep latest per value (same as ArcGIS); confirmed working (e.g. `dedup by source: 7 -> 4 features`)
- **Time window (TTL)** — value + unit (Minutes / Hours / Days) in step 3 before Save; `0` = no filter / default CoT stale
- **Poll interval** — configurable (step 1 + step 3 in sync)
- **Save section matches ArcGIS exactly** — Save & Generate Config JSON, Copy to Clipboard, Download, Export Template, Import Template buttons; status div; config output
- **Auto-fetch on reopen** — loading a saved config triggers a live Fetch to show sample table, then restores all saved field selections (ID, time, dedup, label, remarks)
- **`buildKmlConfigObject()`** extracted so copy/download/export share the same config builder as save
- **Google Earth logo** — embedded in source type selector card and top nav pill

### KML Engine (new + fixed)

- **`makeKmlEngineTab()`** — generates a KML polling engine tab reusing ArcGIS parse/reconcile nodes; initial version used `require('url'/'https'/'http')` in a function node which crashes in Node-RED's sandbox
- **Fix: `require` removed** — engine tab now uses the same node chain pattern as the configurator fetch: `build_kml → GET KML → check_nl (2 outputs) → GET inner KML → parse_kml → parse/reconcile`; `FN_KML_CHECK_NL` handles NetworkLink resolution with `new URL()` (no require); `FN_KML_TO_FEATURES` is pure synchronous parsing
- **Confirmed working** — `KML CA AIR INTEL`: polling, dedup, CoT build, PUT/DELETE reconcile all clean in production

### Documentation

- `docs/TESTING-NODERED-DEPLOYS.md` — new; covers git sync, `deploy.sh --no-pull`, smoke tests, and the ⛔ never-raw-`docker cp` rule
- `docs/NODERED-DEPLOY.md` and `docs/TESTING-UPDATES.md` — cross-links to testing doc
- `.cursorrules` — permanent rule: never run `docker cp flows.json nodered:/data/flows.json` directly
