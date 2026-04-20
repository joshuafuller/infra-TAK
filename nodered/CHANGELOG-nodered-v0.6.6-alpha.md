# Node-RED — v0.6.6-alpha (deploy safety + Guard Dog console + KML polish)

See **[docs/RELEASE-v0.6.6-alpha.md](../docs/RELEASE-v0.6.6-alpha.md)** for the full release summary (Guard Dog + Node-RED).

**Touch points:** `nodered/deploy.sh`, `nodered/build-flows.js`, `nodered/configurator.html`, `nodered/flows.json`, `nodered/template-functions.json` — ship via **`./nodered/deploy.sh`** after pulling.

---

## Changes in this release

### `deploy.sh` — Configurator data safety

- **Install merged flows without hot-reload data loss:** **`docker stop`** the Node-RED container before copying merged **`flows.json`** into **`/data/`**, then **`docker start`**. Prevents a race where the editor loads before global context is on disk and **empty state gets persisted** (wiping ArcGIS/KML Configurator saves).
- **Context backup/restore:** Before merge, copies **`/data/context/global/global.json`** and **`flow_arcgis_cfg.json`** (legacy tab) to host temps; after **`flows.json`** + **`flows_cred.json`** are installed, restores those context files so **`arcgis_configs` / `tak_settings`** survive the deploy.
- Log line: **`Installing merged flows (stop → write → restore context → start)`**.

### KML engine (`build-flows.js` + flows)

- **Removed `require()` from KML polling path** — Node-RED function nodes are sandboxed; `require('url'|'https'|'http')` threw at runtime.
- **New node chain:** `build_kml` → HTTP GET root KML → **`FN_KML_CHECK_NL`** (sync, 2 outputs: inner URL vs direct parse) → HTTP GET inner KML when NetworkLink → **`parse_kml`** → existing parse/reconcile stack.
- **`FN_KML_CHECK_NL`** uses **`new URL()`** for href resolution (no `require`).

### KML Configurator (`configurator.html` → baked into `flows.json`)

- **Step 3** mirrors ArcGIS: full Save toolbar (generate, copy, download, export template, import template), status div, config JSON output.
- **Poll interval** in Step 3 and kept in sync with Step 1.
- **Fresh Fetch:** stable ID / label / remarks start **blank** (no auto-pill selection).
- **Load saved KML config:** triggers **Fetch** to refresh sample table, then reapplies all stored mappings.
- **`buildKmlConfigObject()`** centralizes config JSON for save/copy/download/export.

### Visual

- **Google Earth** asset on KML nav pill and source-type card.
- **ArcGIS** and **FAA** logos on source-type selection buttons.

### Documentation

- **[CHANGELOG-nodered-v0.6.5-alpha.md](CHANGELOG-nodered-v0.6.5-alpha.md)** / **[docs/RELEASE-v0.6.5-alpha.md](../docs/RELEASE-v0.6.5-alpha.md)** — expanded detail on KML save, auto-fetch on reopen, and engine behavior (historical doc accuracy).
- Operator testing: **[docs/TESTING-NODERED-DEPLOYS.md](../docs/TESTING-NODERED-DEPLOYS.md)** (smoke tests, **`curl`**, never raw **`docker cp flows.json`**).
