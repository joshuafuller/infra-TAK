# Node-RED — v0.6.6-alpha (deploy safety + Guard Dog console)

See **[docs/RELEASE-v0.6.6-alpha.md](../docs/RELEASE-v0.6.6-alpha.md)** for the full release summary (Guard Dog disk I/O + process).

**Touch points:** `nodered/deploy.sh`, `nodered/build-flows.js`, `nodered/configurator.html`, `nodered/flows.json`, `nodered/template-functions.json` — regenerate via **`./nodered/deploy.sh`** (or **`--no-pull`** after `git pull`).

---

## Changes in this release

### `deploy.sh` — Configurator data safety

- **Install merged flows without hot-reload data loss:** **`docker stop`** the Node-RED container before copying merged **`flows.json`** into **`/data/`**, then **`docker start`**. Prevents a race where the editor loads before global context is on disk and **empty state gets persisted** (wiping ArcGIS/KML Configurator saves).
- **Context backup/restore:** Before merge, copies **`/data/context/global/global.json`** and **`flow_arcgis_cfg.json`** (legacy tab) to host temps; after **`flows.json`** + **`flows_cred.json`** are installed, restores those context files so **`arcgis_configs` / `tak_settings`** survive the deploy.
- Replaces the previous **`docker restart`**-only path for the final install step; log line: **`Installing merged flows (stop → write → restore context → start)`**.

### Configurator / `build-flows.js`

- Incremental **Configurator** and **build-flows** updates bundled with v0.6.6 (template HTML + flow graph regeneration). Always run **`deploy.sh`** after pulling — the Configurator page is **baked into** the template node in **`flows.json`**, not served live from `configurator.html` on disk.

### Documentation

- Operator testing: **[docs/TESTING-NODERED-DEPLOYS.md](../docs/TESTING-NODERED-DEPLOYS.md)** (smoke tests, **`curl`** examples, **never** raw **`docker cp flows.json`**).
