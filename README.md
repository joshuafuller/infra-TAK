# infra-TAK

Team Awareness Kit Infrastructure Management Platform.

One clone. One password. One URL. Manage everything from your browser.

**Latest release: v0.8.8-alpha** — **Authentik LDAP flow stage-binding recursion fix (latent fleet-wide bug since the LDAP feature shipped).** Apr 30 2026 SMOKING GUN on a buddy's slow-disk SSDNodes box (1795 random-write 4k IOPS — between spinning rust and slow SATA SSD; 31.7 MB/s sequential write): Postgres CPU pinned at **900-1500% sustained** with five PG backends running 86-second `SELECT FROM authentik_policies_policybindingmodel` queries on a box doing **0.36 LDAP binds/sec** (essentially idle workload). Root cause: every stage binding on `ldap-authentication-flow` had **both** `evaluate_on_plan=true` AND `re_evaluate_policies=true` — a combo that causes cascading policy re-evaluation on every step of every authentication plan. Authentik 2025.10+ uses Postgres for cache + channels + tasks (no Redis), and `policybindingmodel` has only the PK as an index, so each cascading lookup is a sequential scan. Fast-disk boxes hide it (queries complete in microseconds); slow-disk boxes explode under it. **Every box** in the fleet has this latent bug — they just hide it on faster disks. The fix: ship `evaluate_on_plan=false` (matches `default-authentication-flow`, which has zero recursion and works fine on every box). Three pieces shipped: (1) **Blueprint YAML** — six occurrences of `evaluate_on_plan: true` flipped to `false` on the three `ldap-authentication-flow` stage bindings, in both YAML copies (initial deploy + post-update healing reimport). `re_evaluate_policies: true` preserved (matches default flow). (2) **`_ensure_ldap_flow_authentication_none()`** healing function — same fix on the healing path so post-update healing doesn't re-introduce the bug. (3) **NEW idempotent self-healing migration `_authentik_fix_ldap_flow_recursion(plog)`** — counts bad bindings via SQL on every console startup AND post-update; if `count > 0`, runs UPDATE and restarts `authentik-server-1` ONLY (server alone — never `--no-deps server worker`, never LDAP outpost) to clear the in-memory flow plan cache. Persists outcome to `settings.authentik_ldap_flow_recursion_fix` (`fixed` / `idempotent-noop`). **Validated on the SSDNodes box**: Postgres CPU dropped 900%+ → **~7.8% in 60 seconds** (~115x reduction), zero long-running queries persisted, LDAP outpost StartedAt unchanged (cardinal rule honored). **No UI changes** (same scope discipline as v0.8.7). Rollback feature pushed to v0.8.9. See **[docs/RELEASE-v0.8.8-alpha.md](docs/RELEASE-v0.8.8-alpha.md)**. Prior: **v0.8.7-alpha** — **Authentik stability: env var name fix (the v0.8.2 → v0.8.6 silent-ignore bug) + official tunings + runtime-config verifier.** Apr 30 2026 SMOKING GUN on tak-10: `docker top authentik-server-1` showed only **2 gunicorn workers** despite `.env` saying `AUTHENTIK_WEB_WORKERS=4` since v0.8.2. Per the [official Authentik docs](https://docs.goauthentik.io/install-config/configuration/), the correct env var name is `AUTHENTIK_WEB__WORKERS` (DOUBLE underscore — *"the double-underscores are intentional"*). Single-underscore was silently ignored on **every box in the fleet for five releases**. `ak dump_config` also confirmed all cache settings (`timeout_flows`, `timeout_policies`) at defaults (300s) and `log_level: info` — every official optimization the docs recommend, never applied. Three pieces shipped: (1) **`_authentik_apply_official_tunings(plog)`** — removes `AUTHENTIK_WEB_WORKERS` (wrong name), adds `AUTHENTIK_WEB__WORKERS=4` (correct), `AUTHENTIK_CACHE__TIMEOUT_FLOWS=600`, `AUTHENTIK_CACHE__TIMEOUT_POLICIES=600`, `AUTHENTIK_LOG_LEVEL=warning` (only if missing — never overwrites operator-set values). (2) **`_authentik_verify_runtime_config(plog)`** — closes the audit loop: runs `ak dump_config`, parses JSON, counts gunicorn workers via `docker top`; persists pass/fail to `settings.authentik_runtime_config_check`. (3) **`_recreate_authentik_server_worker(plog, reason)`** — runs `docker compose up -d --force-recreate --no-deps server worker` (NEVER touches `ldap`); called only when env vars actually change. v0.8.2 migration block superseded — now delegates to `_authentik_apply_official_tunings`. Migration runs on every console startup via `_startup_migrations` (idempotent — recreate fires only once per box). **Validated tak-10** with real 351-bind workload: server CPU p50 99% → **2.1%** (~47x reduction), Postgres p50 94% → **0.0%**, all 4 workers running per `docker top`. **No UI changes** (operator explicit). **Deleted before ship** (band-aids built on the wrong "state drift" theory): daily 04:00 periodic restart, ASGI WebSocket loop reactive trigger, admin-API safety gate. Lesson encoded as alwaysApply Cursor rule [`.cursor/rules/consult-upstream-docs.mdc`](.cursor/rules/consult-upstream-docs.mdc) — read official docs before chasing symptoms; never trust `.env` to mean the runtime is using it. See **[docs/RELEASE-v0.8.7-alpha.md](docs/RELEASE-v0.8.7-alpha.md)**. Prior: **v0.8.6-alpha** — **Azure / NAT deploy reliability — four field bugs fixed.** All four confirmed during first Azure deployment test (`tak-test-3`, D8as_v5, P10 64 GiB OS disk, ~145 MB/s sync write). (1) **Authentik containers never started on slow-disk Azure VMs.** Step 7 (`docker compose up -d`) was nested inside `elif needs_pg_update:` which is always `False` on fresh deploys — containers never launched, API poll ran 900 s, operator had to SSH and run compose manually. Fixed by un-indenting 121 lines so the bring-up runs unconditionally. (2) **`start.sh` showed private IP on Azure/AWS NAT.** `hostname -I` returns `10.0.x.x` on NAT VMs. Fixed: `curl api.ipify.org` (3 s timeout, graceful fallback); when public ≠ private both are displayed; single-line output preserved on direct-IP VPS. (3) **Dashboard disk I/O showed cached speed (998 MB/s) instead of real sync speed (145 MB/s).** `vmstat` reports Linux buffer-cache throughput, not disk throughput. Fixed: Guard Dog's `diskio_history.csv` (already uses `oflag=dsync` every 15 min) is read first; if not installed, falls back to vmstat but labels it "(vmstat, cached)"; manual test button switched from `oflag=direct` to `oflag=dsync` to match `start.sh`. (4) **LDAP SA bind check reported failure even when LDAP was working.** Two bugs: (a) ldapsearch searched `dc=takldap` (base scope) — Authentik returns LDAP error 32 "no such object" there even on successful bind, so exit code was always non-zero. Fixed: search `ou=users,dc=takldap` one-level for `cn=adm_ldapservice`. (b) `sleep(2)` was a race on Azure: the "authenticated from session" log entry landed at the same second as our `docker logs` check. Fixed: `sleep(5)`, window `--since 90s`. Added direct Docker-log fallback — if logs show "authenticated from session" for adm_ldapservice, bind is accepted without ldapsearch. Confirmed on test-3: attempt 2 passed via Docker log fallback, full clean deploy in ~4 minutes. All four changes are transparent on SSD Nodes / DigitalOcean / non-NAT fast-disk VPS. See **[docs/RELEASE-v0.8.6-alpha.md](docs/RELEASE-v0.8.6-alpha.md)**. Prior: **v0.8.5-alpha** — Proactive LDAP routing migration + gunicorn timeout bump + verifier hardening. Prior: **v0.8.4-alpha** — reverses v0.8.0 LDAP outpost routing for spiraling boxes. Prior: **v0.8.3-alpha** — `idle_in_transaction_session_timeout` 120s→30s. Prior: **v0.8.2-alpha** — auto-set `AUTHENTIK_WEB_WORKERS=4`. Prior: **v0.8.1-alpha** — LDAP migration conditional hotfix. Prior: **v0.8.0-alpha** — LDAP outpost TLS fix for fresh installs. Prior: **v0.7.9-alpha** — Authentik reconfigure waits for API ready. Prior: [v0.7.0-alpha](docs/RELEASE-v0.7.0-alpha.md) (IPAWS KML network link, zone polygons, NAPSG icons), [v0.6.8-alpha](docs/RELEASE-v0.6.8-alpha.md) (Node-RED deploy sync fix), [v0.6.7-alpha](docs/RELEASE-v0.6.7-alpha.md) (DataSync read-only missions, shared missions), [v0.6.5-alpha](docs/RELEASE-v0.6.5-alpha.md) (KML + ArcGIS stable-ID / Purge), [v0.6.4-alpha](docs/RELEASE-v0.6.4-alpha.md). Older: [v0.6.1-alpha](docs/RELEASE-v0.6.1-alpha.md), [v0.6.0-alpha](docs/RELEASE-v0.6.0-alpha.md), [v0.5.9-alpha](docs/RELEASE-v0.5.9-alpha.md), [v0.5.8-alpha](docs/RELEASE-v0.5.8-alpha.md), [v0.5.7-alpha](docs/RELEASE-v0.5.7-alpha.md), [v0.5.6-alpha](docs/RELEASE-v0.5.6-alpha.md), [v0.5.5-alpha](docs/RELEASE-v0.5.5-alpha.md), [v0.5.4-alpha](docs/RELEASE-v0.5.4-alpha.md), [v0.5.3-alpha](docs/RELEASE-v0.5.3-alpha.md), [v0.5.2-alpha](docs/RELEASE-v0.5.2-alpha.md), [v0.5.1-alpha](docs/RELEASE-v0.5.1-alpha.md), [v0.5.0-alpha](docs/RELEASE-v0.5.0-alpha.md), [v0.4.9-alpha](docs/RELEASE-v0.4.9-alpha.md), [v0.4.8-alpha](docs/RELEASE-v0.4.8-alpha.md), [v0.4.7-alpha](docs/RELEASE-v0.4.7-alpha.md), [v0.4.6-alpha](docs/RELEASE-v0.4.6-alpha.md), [v0.4.5-alpha](docs/RELEASE-v0.4.5-alpha.md), [v0.4.4-alpha](docs/RELEASE-v0.4.4-alpha.md), [v0.4.3-alpha](docs/RELEASE-v0.4.3-alpha.md), [v0.4.2-alpha](docs/RELEASE-v0.4.2-alpha.md).

**Something broken?** Wrong sidebar version, **Update Now** error, merge/rebase/tag-clobber messages, or you are not sure the VPS ever pulled the real repo → go to **[Universal recovery (SSH)](#universal-recovery-ssh)** and run the one block there. **Point people at that section**; it is the single source of truth.

**Goal: universal installer.** Currently supported platform: **Ubuntu 22.04 LTS**.

## Universal recovery (SSH)

Use this on the **VPS** when anything below is true:

- **Update Now** failed (including **`would clobber existing tag`**, merge/rebase errors, or a vague git error).
- The sidebar **VERSION** does not match the **Latest release** line at the top of this README (e.g. stuck on **v0.2.4** while the README says **v0.4.5-alpha**).
- You are unsure whether **`git remote -v`** points at **`github.com/takwerx/infra-TAK`** (forks, typos, and old mirrors leave **`origin/main`** years behind — **`git fetch origin`** is not safe until **`origin` is fixed**).

This pulls **`main` from the official repo URL** (same as **Quick Start**), checks **`VERSION`**, restarts the service. Your **`.config/`** is not touched.

```bash
cd $(grep -oP 'WorkingDirectory=\K.*' /etc/systemd/system/takwerx-console.service)
git fetch https://github.com/takwerx/infra-TAK.git main
git checkout --force -B main FETCH_HEAD
grep '^VERSION' app.py
sudo systemctl restart takwerx-console
```

**Check:** The **`grep`** line should show **`VERSION = "…"`** matching the current **Latest release** at the top (without the **`v`**, e.g. **`0.6.2-alpha`**). If it still shows an old number, you are in the wrong directory (compare with **`grep WorkingDirectory /etc/systemd/system/takwerx-console.service`**) or the fetch failed (network).

**Fix `origin` once (recommended):** so future **`git fetch origin`** hits upstream:

```bash
git remote set-url origin https://github.com/takwerx/infra-TAK.git
```

**No `grep -oP`?** Run **`grep WorkingDirectory /etc/systemd/system/takwerx-console.service`**, **`cd`** to that path, then run the four lines starting with **`git fetch https://github.com/...`** (skip the **`cd`** line).

**Shallow / single-branch clone** (`fetch` errors): [docs/PULL-AND-RESTART.md](docs/PULL-AND-RESTART.md).

**After the console is up:** If **Guard Dog** is installed, open **Guard Dog** and click **↻ Update Guard Dog** once (see **Guard Dog** note under **Quick Start**).

**Why:** Older builds used **`git pull --rebase`** or bulk **`git fetch --tags`**, which break on many field installs. Current **Update Now** (v0.4.1+) is safer, but recovery over SSH must **not** trust a wrong **`origin`** — always use the **`https://github.com/takwerx/infra-TAK.git`** fetch above.

## What Is This?

A unified web console for deploying and managing TAK ecosystem infrastructure:

- **TAK Server** — Upload your .deb, configure, deploy, manage CoreConfig — all from the browser
- **Federation Hub** — Deploy and manage a TAK Server Federation Hub on a remote VPS, with Authentik SSO, certificate management, and Guard Dog monitoring
- **Authentik** — Identity provider with automated LDAP configuration for TAK Server auth
- **TAK Portal** — User and certificate management portal with auto-configured Authentik + TAK Server integration
- **Caddy SSL** — Let's Encrypt certificates and reverse proxy management
- **CloudTAK** — Browser-based TAK client
- **MediaMTX** — Video streaming server for real-time feeds
- **Node-RED** — Flow-based automation engine, protected behind Authentik forward auth
- **Email Relay** — Outbound email for notifications and alerts
- **Guard Dog** — TAK Server health monitoring and auto-recovery (port 8089, processes, OOM, PostgreSQL, CoT DB size, disk, disk I/O performance, certificates; optional monitors for Authentik, Node-RED, MediaMTX, CloudTAK, Federation Hub)

No more SSH. No more editing XML by hand. No more running scripts and hoping.

## Quick Start

```bash
git clone --depth 1 https://github.com/takwerx/infra-TAK.git
cd infra-TAK
sudo ./start.sh
```

**First boot / automatic updates:** On a new Ubuntu VPS, **`apt`** may run right after SSH is available. **`systemctl status unattended-upgrades`** often shows **active (running)** for **`unattended-upgrade-shutdown`** — that idle process is **normal** and is **not** blocking installs. If **`apt-get`** still reports **“Could not get lock”**, wait until **`sudo fuser /var/lib/dpkg/lock-frontend`** shows nothing, then run **`sudo ./start.sh`** again. **`start.sh`** waits for **real** apt/dpkg activity and for **dpkg/apt lock files** before installing packages.

**Branches:** Default clone uses **main** (stable; tagged releases). For latest features and fixes before they're merged to main, use the **dev** branch: `git clone --depth 1 -b dev https://github.com/takwerx/infra-TAK.git`. The README and changelog here reflect main; dev may include remote deployment, UI tweaks, and fixes not yet in a release.

The script will:
1. Detect your OS (**Ubuntu 22.04 only** for now; goal is a universal installer)
2. Wait if automatic updates hold **apt/dpkg**, then install Python dependencies
3. Ask you to set an admin password
4. Start the web console

Then open your browser to the URL shown and log in.

**Updating:** After `git pull` or **Update Now**, restart the console with `sudo systemctl restart takwerx-console`. Your password and config live in the install directory's `.config/`. If you run `start.sh` from a different clone or path, the service keeps using the original install directory so your password continues to work. **Node-RED / Configurator code** (`nodered/`): after pulling **dev** on the VPS, also run **`bash nodered/deploy.sh`** from that install directory (see **[docs/PULL-AND-RESTART.md](docs/PULL-AND-RESTART.md)**).

**Guard Dog — automatic since v0.4.7-alpha:** Guard Dog scripts are automatically re-deployed when the console detects a version change. No manual button press needed after upgrading. The button still exists as a fallback if you change alert email or server nickname. Set **Notifications** → alert email and use **Send test email** to verify. Details: [docs/GUARDDOG.md](docs/GUARDDOG.md).

**Testing Update Now before you ship a release:** Maintainers should follow [docs/TESTING-UPDATES.md](docs/TESTING-UPDATES.md) on a test VPS (fake low `VERSION`, click **Update Now**, then restore). Pushing a Git **tag** is what shows customers “Update Available”; test the button before pushing the tag.

**Upgrading from v0.1.x to v0.2.0:** v0.2.0 switches from Flask dev server to gunicorn (production server). The upgrade is automatic — just `git pull` and restart. On first restart, the console installs gunicorn, rewrites the systemd service, and starts the production server transparently. No manual steps needed.

**Password not working after update?** Use the **backdoor**: **https://&lt;VPS_IP&gt;:5001**. If login spins or fails, on the server run (from the directory where you do `git pull`, e.g. `/root/infra-TAK`): **`sudo ./fix-console-after-pull.sh`** — it pins the config path in the systemd unit and prompts you to set a new password so you can log in again. Alternatively run `sudo ./reset-console-password.sh` from that same directory. After pulling, open the Caddy module and re-save your domain once so the Caddyfile (login bypass) is applied.

## Recovery / backdoor (when Authentik or Caddy is broken)

Git / version / **Update Now** issues: use **[Universal recovery (SSH)](#universal-recovery-ssh)** above, not this section.

If Authentik or Caddy is down and you can't reach **https://infratak.yourdomain.com**:

- **Backdoor:** Open **https://&lt;VPS_IP&gt;:5001** in your browser (use the server's real IP, not the domain). Log in with the **console password** you set when you ran `start.sh`. That path skips Caddy and Authentik, so you can get back into the console and fix things.

The console password is stored as a **hash** in the install directory at `.config/auth.json` (e.g. `/root/infra-TAK/.config/auth.json`). You **cannot** recover the plaintext password from that file. If you forget it:

```bash
cd /root/infra-TAK   # or your install path
sudo ./reset-console-password.sh
```

Enter a new password twice; the script updates `.config/auth.json` and restarts the console. Then use **https://&lt;VPS_IP&gt;:5001** with the new password. Store the console password somewhere safe (e.g. password manager); it's your only way in when the domain or Authentik is broken.

## Deployment Order

Deploy services in this order — each step auto-configures the next:

```
1. Caddy SSL         Set your FQDN, get Let's Encrypt certs (recommended first if using a domain)
         ↓
2. Authentik         Identity provider + LDAP outpost (automated deploy)
         ↓
3. Email Relay       Optional; configure SMTP for password recovery
         ↓
4. TAK Server        Upload .deb, deploy, configure ports + certs
         ↓
5. Connect LDAP      On TAK Server page — patches CoreConfig, creates webadmin in Authentik
         ↓
6. TAK Portal        User/cert management portal
         ↓
7. Anything else     CloudTAK, Node-RED, MediaMTX — any order
```

**Connect LDAP** runs after TAK Server deploy and wires LDAP auth to CoreConfig. 8446 webadmin login and QR enrollment work immediately after. **For MediaMTX-only (or standalone Authentik):** Deploy Authentik without TAK Server — it skips CoreConfig and webadmin; add TAK Server later and use Connect LDAP.

## Remote deployment and firewalls

Authentik, CloudTAK, MediaMTX, and Node-RED can be deployed to a **remote host** (separate from the infra-TAK console). You configure the target in each module's "Deployment target" (e.g. "On another server via SSH") and deploy from the console; the console SSHs to the remote and runs Docker/scripts there.

TAK Server supports a **two-server split**: Server One (PostgreSQL database) and Server Two (TAK Server core) on separate hosts. Configure both hosts in the TAK Server settings and deploy from the console.

**Firewall:** Depending on how you deploy, the infra-TAK host and remote host may need to reach each other for the automation to work. For example:

- **SSH:** The console must reach the remote on port 22 (or your SSH port) to run deploy and management commands.
- **Authentik remote:** After containers start, the console calls the remote Authentik API on port **9090** (e.g. `http://<remote>:9090`) to inject the LDAP outpost token. If the infra-TAK server and the remote are in different networks or behind firewalls, open port **9090** from the infra-TAK host to the remote so the token step can succeed; otherwise you'll see "Connection refused" in the deploy log and the LDAP container may stay unhealthy (403 token errors).
- **Two-server TAK:** Server Two (core) must reach Server One (database) on the **PostgreSQL port** (default 5432); open that port on Server One's firewall for Server Two's IP.

If a remote deploy fails at "token" or "API" steps, or a service reports unhealthy, check that the hosts can reach the required ports (SSH, 9090 for Authentik, 5432 for two-server DB, etc.).

## What Gets Automated

**Authentik Deploy (~7 minutes):**
Console ensures 4GB swap and starts PostgreSQL first, then server/worker after the DB is ready (reduces OOM and 502s on small VPS). Bootstrap credentials generated, LDAP blueprint installed, Docker Compose patched with standalone LDAP container, API polled for outpost token, CoreConfig.xml patched with LDAP auth block, TAK Server restarted.

**TAK Portal Deploy (~4 minutes):**
Repository cloned, container built, TAK Server certs (admin.p12, tak-ca.pem) copied into container, settings.json auto-configured with Authentik URL/token and TAK Server connection, forward auth configured in Caddy, 2-minute sync wait for Authentik outpost.

After deployment, create users in TAK Portal — they flow through Authentik → LDAP → TAK Server automatically.

## Requirements

- **Ubuntu 22.04 LTS** (currently the only supported platform; goal is a universal installer). Fresh installation recommended.
- **Root access**
- **RAM:** 8 GB+ recommended for TAK Server; more if you run the full stack (Authentik, TAK Portal, Node-RED, MediaMTX, CloudTAK, Guard Dog).
- **Disk:** At max deployment (all modules) you can sit around **26 GB** used. Plan for growth: CoT data, logs, and retention. **50 GB+** disk is recommended so you have headroom; TAK Server's own minimum is 40 GB per the official configuration guide. Apply Docker log limits (Guard Dog → Apply Docker log limits) to avoid containers filling the disk.
- **Disk I/O:** SSD-backed storage strongly recommended. **Test your VPS before deploying** — slow disk I/O causes Docker build timeouts, service startup failures, and unreliable boots. See [VPS disk I/O check](#vps-disk-io-check) below.
- **CPU:** Enough cores for all processes (TAK Server, PostgreSQL, Authentik, Caddy, Node-RED, etc.). TAK Server's minimum is 4 cores; more is better for the full stack.
- **Internet** connection for initial setup.
- **TAK Server .deb** package from [tak.gov](https://tak.gov).

### VPS disk I/O check

Run this on your VPS **before deploying**. Poor disk I/O is the #1 cause of slow deploys and unreliable service startups.

```bash
# Write speed (sequential, sync)
dd if=/dev/zero of=/tmp/testfile bs=1M count=1024 oflag=dsync 2>&1 | tail -1

# Read speed
dd if=/tmp/testfile of=/dev/null bs=1M 2>&1 | tail -1

# Clean up
rm -f /tmp/testfile
```

| Write speed | Assessment |
|-------------|------------|
| **400+ MB/s** | Good — SSD-backed, full stack will deploy and boot quickly |
| **200–400 MB/s** | Acceptable — deploys work, boot may be slightly slower |
| **< 200 MB/s** | Poor — expect slow Docker builds, service timeouts, longer boot sequences |
| **< 100 MB/s** | Bad — likely throttled or HDD-backed; migrate to a different node or provider |

Some VPS providers place instances on overloaded or HDD-backed storage nodes. If your write speed is consistently under 200 MB/s, contact your provider about migrating to a different node before troubleshooting service issues. The difference between a bad node and a good one can be 50 MB/s vs 500 MB/s on the same provider.

## Architecture

```
start.sh                    ← One CLI command to launch everything
├── app.py                  ← Gunicorn web application (HTTPS on :5001)
├── uploads/                ← Uploaded .deb packages
└── .config/                ← Auth + settings (gitignored)
```

## Ports

| Service | Port | Protocol | Description |
|---------|------|----------|-------------|
| infra-TAK Console | 5001 | HTTPS | Management web UI (backdoor: direct IP access) |
| Caddy | 80 | HTTP | Redirect to HTTPS |
| Caddy | 443 | HTTPS | Reverse proxy for all services (Let's Encrypt) |
| TAK Server | 8089 | TLS | TAK client connections (ATAK, iTAK, WinTAK) |
| TAK Server | 8443 | HTTPS | Admin WebGUI (client certificate auth) |
| TAK Server | 8446 | HTTPS | Admin WebGUI (Let's Encrypt, password/LDAP auth) |
| TAK Server | 8087 | TCP | Disabled by default (plaintext, replaced by 8089) |
| PostgreSQL | 5432 | TCP | TAK Server database (localhost or remote for two-server) |
| Authentik | 9090 | HTTP | Identity provider API + admin UI (proxied via Caddy) |
| Authentik | 9443 | HTTPS | Authentik HTTPS (direct, rarely needed) |
| LDAP Outpost | 389 | TCP | LDAP auth for TAK Server (Authentik outpost) |
| LDAP Outpost | 636 | TCP | LDAPS (TLS-wrapped LDAP) |
| TAK Portal | 3000 | HTTP | User/cert management portal (proxied via Caddy) |
| Email Relay | 25 | SMTP | Local Postfix relay (localhost only, apps send here) |
| Node-RED | 1880 | HTTP | Flow editor (proxied via Caddy) |
| MediaMTX | 8554 | RTSP | Video streaming (RTSP) |
| MediaMTX | 8889 | HTTP | WebRTC / HLS playback |
| MediaMTX | 5080 | HTTP | MediaMTX web editor |
| CloudTAK | 5000 | HTTP | Browser-based TAK client (proxied via Caddy) |

## Actions Reference (Sync, Update Config, Resync)

Each page has buttons that do specific things. Here's what they do and when to use them.

### TAK Server Page

| Button | What it does | When to use it |
|--------|-------------|----------------|
| **Update Config** | Regenerates Caddyfile, reloads Caddy, installs Let's Encrypt cert on 8446, restarts TAK Server | After changing the TAK Server domain/FQDN in Caddy settings |
| **Connect TAK Server to LDAP** | Full LDAP setup: repairs Authentik blueprint, ensures service account + webadmin, writes LDAP auth block into CoreConfig.xml (without flat-file), restarts TAK Server | After deploying Authentik (if TAK Server was deployed first), or if LDAP auth stops working |
| **Resync LDAP to TAK Server** | Same as Connect LDAP — full re-run of the LDAP fix flow | If QR registration fails, if 8446 login stops working, after pulling console updates |
| **Sync webadmin to Authentik** | Pushes the 8446 webadmin password from settings into Authentik (no TAK Server restart) | After changing the webadmin password |
| **Disable/Enable flat-file auth** | Adds or removes `UserAuthenticationFile.xml` from the CoreConfig auth block, restarts TAK Server | When you want LDAP-only auth (disable) or need local password fallback (enable) |
| **Set JVM Heap** | Writes `-Xms`/`-Xmx` to `/opt/tak/setenv.sh`, restarts TAK Server | TAK Server running out of memory (OutOfMemoryError in logs) |

### TAK Portal Page

| Button | What it does | When to use it |
|--------|-------------|----------------|
| **Sync TAK Server to TAK Portal** | Forces TAK Portal to re-read the TAK Server connection (IP, certs, API URL) | If TAK Portal dashboard doesn't show TAK Server uptime/disk usage |
| **Update Config** | Rewrites TAK Portal's `settings.json` with current Authentik + TAK Server URLs, restarts the container | After changing FQDN, after Authentik redeploy, if TAK Portal can't reach TAK Server or Authentik |
| **Sync TAK Server CA** | Copies the current `tak-ca.pem` into the TAK Portal container | After CA rotation — TAK Portal needs the new CA to generate valid client certs |

### Authentik Page

| Button | What it does | When to use it |
|--------|-------------|----------------|
| **Update Config & Reconnect** | Patches docker-compose.yml (PostgreSQL tuning, blueprint mounts), ensures all forward auth apps exist (infra-TAK, TAK Portal, Node-RED, etc.), repairs embedded outpost, updates LDAP CoreConfig, reloads Caddy | After pulling console updates, if forward auth breaks, if apps disappear from Authentik, if LDAP stops working |
| **Fix LDAP Token** | Re-fetches the LDAP outpost token from Authentik API and injects it into docker-compose.yml, restarts the LDAP container | If LDAP container shows "unhealthy" or "403 Forbidden" in logs |

### Email Relay Page

| Button | What it does | When to use it |
|--------|-------------|----------------|
| **Switch Provider** | Reconfigures Postfix with new SMTP credentials/host, restarts Postfix | Changing email provider or From address |
| **Configure Authentik** | Pushes relay settings (localhost:25, From address) into Authentik so password recovery emails work | After deploying or switching Email Relay provider |

### General Rules

- **Deploy order matters:** Caddy → Authentik → Email Relay → TAK Server → TAK Portal → everything else
- **After pulling console updates:** Hit "Update Config" on Authentik, then optionally on TAK Server if you changed FQDN
- **If TAK Portal can't reach TAK Server:** Hit "Sync TAK Server to TAK Portal" on the TAK Portal page
- **If LDAP auth breaks:** Hit "Connect TAK Server to LDAP" on the TAK Server page
- **If forward auth breaks (502/blank on FQDN URLs):** Hit "Update Config" on the Authentik page
- **After CA rotation:** Hit "Sync TAK Server CA" on the TAK Portal page, then have users re-enroll

## Access Modes

**IP Address Mode** — Self-signed certificate, works anywhere (field deployments, no DNS needed)

**FQDN Mode** — Caddy + Let's Encrypt for proper SSL. Required for TAK client QR enrollment. Can upgrade from IP mode through the web console without SSH.

## QR Code Enrollment

| Client | Status | Notes |
|--------|--------|-------|
| ATAK (Android) | ✅ Working | Requires FQDN mode with Let's Encrypt |
| TAKAware (iOS) | ✅ Working | Works in both IP and FQDN mode |

## Security

- Password required before any access (set during `./start.sh`)
- HTTPS from the start (self-signed or Let's Encrypt)
- Session-based authentication
- All config files are 600 permissions
- Authentik bootstrap credentials auto-generated per deployment

## Design notes

- **[References](docs/REFERENCES.md)** — Canonical links (e.g. [TAK Server API](https://docs.tak.gov/api/takserver)) for development and integration.
- **[Authentik login branding](docs/AUTHENTIK-LOGIN-BRANDING.md)** — Custom CSS vs **Brand → Attributes** (`theme: dark`), black backgrounds, flow wording; links to official Authentik docs and community guides.
- **[Guard Dog](docs/GUARDDOG.md)** — How Guard Dog works: monitors, 15‑minute boot delay and cooldowns, TAK Server soft start (after PostgreSQL and network), 4GB swap on deploy for memory stability, and restart-loop protection. Apply Docker container log limits from the Guard Dog page without redeploying a module.
- **[MediaMTX access driven by TAK Portal / LDAP](docs/MEDIAMTX-TAKPORTAL-ACCESS.md)** — How stream.fqdn admin vs viewer logic can be driven from TAK Portal (one place to manage users, no separate MediaMTX or Authentik user management). **Do not configure the email/SMTP portion of MediaMTX** — request access and approval notifications are handled by TAK Portal's open request-access page and Email Relay.

---

## Changelog

### v0.8.8-alpha — 2026-04-30

**Headline: LDAP flow stage-binding recursion fix — latent fleet-wide bug since the LDAP feature shipped.**
- **THE BUG:** Every infra-TAK install since the LDAP feature shipped has had `evaluate_on_plan=true` AND `re_evaluate_policies=true` on all three `ldap-authentication-flow` stage bindings. That combo causes a **cascading policy re-evaluation** on every step of every authentication plan — each step re-runs all policy lookups, which re-triggers plan generation, which re-evaluates policies, ad infinitum. Authentik 2025.10+ uses Postgres for cache + channels + tasks (no Redis), and `policybindingmodel` has only the PK as an index, so each cascading lookup is a sequential scan. **Fast-disk boxes hide it** (queries complete in microseconds); **slow-disk boxes explode** under it.
- **THE SMOKING GUN:** Apr 30 2026 on a buddy's slow-disk SSDNodes box (1795 random-write 4k IOPS, 31.7 MB/s sequential write — between spinning rust and slow SATA SSD): Postgres CPU pinned at **900-1500% sustained** with five PG backends running 86-second `policybindingmodel` queries on a box doing **0.36 LDAP binds/sec**. Setting `evaluate_on_plan=false` (matches `default-authentication-flow`, which has zero recursion and works fine on every box) + `docker restart authentik-server-1` dropped Postgres CPU **~115x in 60 seconds** (~900% → ~7.8%). Zero long-running queries persisted. LDAP outpost StartedAt unchanged.
- **Fix shipped in three places.** (1) Two YAML blueprint copies in `app.py` — six occurrences of `evaluate_on_plan: true` flipped to `false` on the three `ldap-authentication-flow` stage bindings. `re_evaluate_policies: true` preserved (matches default flow, not part of the recursion combo). (2) `_ensure_ldap_flow_authentication_none()` healing function — same fix on the healing path so post-update healing doesn't re-introduce the bug. (3) NEW idempotent self-healing migration `_authentik_fix_ldap_flow_recursion(plog)` — counts bad bindings via SQL on every console startup AND post-update; if `count > 0`, runs UPDATE and restarts `authentik-server-1` ONLY (server alone — never `--no-deps server worker`, never LDAP outpost) to clear the in-memory flow plan cache.
- **Audit trail.** Persists outcome to `settings.authentik_ldap_flow_recursion_fix` (`fixed` / `idempotent-noop`) so operators can see exactly what happened. Hooked into `_startup_migrations` (every console start) and `_post_update_auto_deploy` (after every update). On a healthy/v0.8.8-clean box: one COUNT query + one settings.json write per startup (~10ms cost).
- **Cardinal rule honored.** `docker restart authentik-server-1` (server alone, ~5-10s blip) — gentler and faster than `_recreate_authentik_server_worker`'s full compose recreate. The worker container doesn't cache flow plans; only the server does. LDAP outpost (`authentik-ldap-1`) is never touched. No thundering herd.
- **No UI changes.** Same scope discipline as v0.8.7. The rollback feature originally planned for v0.8.8 is **parked to v0.9.0 or later** — Authentik stabilization is the sole priority on the v0.8.x line until the fleet is provably stable across slow disks.
- **Fleet impact.** tak-10, responder, ssdnodes-validated, Alex's R3930 — all currently on v0.8.7-alpha and **all still have this latent bug** (fast-disk masking). After they pull v0.8.8 the migration fires once on the next console startup, audit shows `last_outcome='fixed'`, `last_bad_count=3`. Their CPU samples should show measurable drops (less dramatic than ssdnodes since their disks were hiding more, but real).

Full notes: [docs/RELEASE-v0.8.8-alpha.md](docs/RELEASE-v0.8.8-alpha.md). Plan: [docs/PLAN-v0.8.8.md](docs/PLAN-v0.8.8.md). Incident writeup: [docs/HANDOFF-LDAP-AUTHENTIK.md](docs/HANDOFF-LDAP-AUTHENTIK.md) → "April 2026 — v0.8.8 LDAP FLOW STAGE-BINDING RECURSION FIX".

---

### v0.8.7-alpha — 2026-04-30

**Headline: Authentik stability — env var name fix (silent-ignore bug since v0.8.2) + official tunings + runtime-config verifier.**
- **THE BUG WE'VE BEEN CARRYING SINCE v0.8.2:** `AUTHENTIK_WEB_WORKERS=4` (single underscore) was being silently ignored by Authentik 2026.x. Per the [official Authentik docs](https://docs.goauthentik.io/install-config/configuration/), the correct name is `AUTHENTIK_WEB__WORKERS` (DOUBLE underscore — *"the double-underscores are intentional"*). On Apr 30 2026, `docker top authentik-server-1` on tak-10 showed only **2 gunicorn workers** despite our `.env` saying 4. Every box in the fleet has been running with half the workers we thought, since late April 2026. **Fix:** the new `_authentik_apply_official_tunings(plog)` removes the wrong-name line and writes the correct double-underscore form on every box. Idempotent. Only adds keys that are missing — never overwrites operator-set values.
- **Cache and log tunings (also never applied):** `ak dump_config` revealed `cache.timeout_flows=300`, `cache.timeout_policies=300`, `log_level=info` — all defaults, every box. `_authentik_apply_official_tunings` now adds `AUTHENTIK_CACHE__TIMEOUT_FLOWS=600`, `AUTHENTIK_CACHE__TIMEOUT_POLICIES=600`, `AUTHENTIK_LOG_LEVEL=warning` (only if missing). Reduces DB pressure (cached flows/policies don't re-evaluate every 5 min) and log overhead.
- **Runtime config verifier** — new `_authentik_verify_runtime_config(plog)` closes the audit loop. Runs `docker exec authentik-worker-1 ak dump_config`, parses JSON, counts actual gunicorn workers via `docker top`. Persists pass/fail to `settings.authentik_runtime_config_check`. We can never have this silent-default scenario again.
- **`_recreate_authentik_server_worker(plog, reason)`** — single source of truth for env-var-change → server recreate. Runs `docker compose up -d --force-recreate --no-deps server worker`. **Never touches `ldap`** (preserves bind cache, zero thundering-herd risk — the cardinal rule of all v0.8.x Authentik migrations). Called by `_startup_migrations` and `_post_update_auto_deploy` only when env vars actually changed. Records outcome to `settings.authentik_last_recreate`.
- **Validated tak-10 Apr 30 2026:** 4 gunicorn workers running (was 2), `ak dump_config` confirms cache=600s and log_level=warning (were defaults), 3-min CPU soak with 351 real binds → server p50 **2.1%**, postgres p50 **0.0%** (was 99%/94% on v0.8.6 under same load). ~47x reduction at p50, with zero LDAP impact.
- **Deleted before ship (band-aids built on the wrong "state drift" theory):** the daily 04:00 periodic restart, the reactive ASGI WebSocket loop trigger, and the admin-API safety gate were all built and then removed once the real env var bug was found. With 4 workers actually running and the cache tunings active, none are needed. ~200 lines of code removed in the cleanup.
- **No UI changes.** Operator was explicit: "I just want an update to work for now. No UI changes."
- **Cursor rule shipped:** [`.cursor/rules/consult-upstream-docs.mdc`](.cursor/rules/consult-upstream-docs.mdc) (alwaysApply) institutionalizes the lesson — read official docs before chasing symptoms; never trust `.env` to mean the runtime is using it; always verify with the project's introspection command (`ak dump_config`, etc.). Five releases of band-aids would have been one PR if we'd read the docs first.

Full notes: [docs/RELEASE-v0.8.7-alpha.md](docs/RELEASE-v0.8.7-alpha.md). Plan: [docs/PLAN-v0.8.7.md](docs/PLAN-v0.8.7.md). Incident writeup: [docs/HANDOFF-LDAP-AUTHENTIK.md](docs/HANDOFF-LDAP-AUTHENTIK.md) → "April 2026 — v0.8.7 SILENT-IGNORE env var name bug" and "April 2026 — v0.8.7 band-aids that were built then DELETED before ship".

---

### v0.8.6-alpha — 2026-04-29

**Headline: Azure / NAT deploy reliability — four field bugs fixed during first Azure deployment test (`tak-test-3`, D8as_v5, P10 64 GiB OS disk, ~145 MB/s sync write).**
- **Authentik containers never started on slow-disk Azure VMs.** Step 7 (`docker compose up -d`) was nested inside `elif needs_pg_update:` which is always `False` on fresh deploys — containers never launched, API poll ran 900 s, operator had to SSH and run compose manually. Fixed by un-indenting 121 lines so the bring-up runs unconditionally.
- **`start.sh` showed private IP on Azure/AWS NAT.** `hostname -I` returns `10.0.x.x` on NAT VMs. Fixed: `curl api.ipify.org` (3 s timeout, graceful fallback); when public ≠ private both are displayed; single-line output preserved on direct-IP VPS.
- **Dashboard disk I/O showed cached vmstat speed (998 MB/s) instead of real sync speed (145 MB/s).** Guard Dog's `diskio_history.csv` (already uses `oflag=dsync` every 15 min) is read first; vmstat fallback now labeled "(vmstat, cached)"; manual test switched to `oflag=dsync`.
- **LDAP SA bind check reported failure even when LDAP was working.** Two bugs: ldapsearch searched `dc=takldap` (base scope) — Authentik returns LDAP error 32 there even on success. Fixed: `ou=users,dc=takldap` one-level + `cn=adm_ldapservice`. Race: `sleep(2)` was too short on Azure; fixed: `sleep(5)`, `--since 90s`, direct Docker-log fallback.
- All four transparent on SSD Nodes / DigitalOcean / non-NAT fast-disk VPS.

Full notes: [docs/RELEASE-v0.8.6-alpha.md](docs/RELEASE-v0.8.6-alpha.md).

---

### v0.8.5-alpha — 2026-04-28

**Headline: proactive LDAP routing migration + gunicorn timeout bump + verifier hardening (responder + tak-10 field tests)**
- **Proactive routing migration** — new `_ensure_authentik_ldap_outpost_on_fqdn()` migrates the LDAP outpost from internal direct routing (`http://authentik-server-1:9000`) to FQDN routing (`https://<fqdn>`) BEFORE a spiral manifests. Gated on `/opt/tak` installed (heavy load profile) + FQDN configured + Caddy reachable. Catches the responder-class latent misroute that the reactive detector cannot see — cached service-account session masks the spiral until the first fresh bind. Runs on Authentik deploy / TAK Server deploy / every Update Now / every 10 min via spiral monitor. Idempotent; no-op on FQDN-routed and console-only boxes.
- **Gunicorn worker timeout 30s → 120s** — new `_ensure_authentik_gunicorn_timeout()` appends `GUNICORN_CMD_ARGS=--timeout=120` to `~/authentik/.env` once and recreates only the Authentik server container. Closes the SIGABRT cascade on heavy-LDAP-load boxes (tak-10: 3.5+ binds/sec) where Authentik 2026.2.2's flow planner exceeds the upstream-default 30s gunicorn timeout, gunicorn kills the worker mid-request, in-flight TCP connections drop, Caddy returns 502, outpost retries, recursion. Idempotent — never overwrites operator override; safe everywhere because timeout never fires on fast boxes. Hooked into Authentik deploy / TAK Server deploy / Update Now (NOT periodic monitor — one-shot config). Outcome persisted to `settings.authentik_gunicorn_timeout_migration`.
- **Verifier hardening** — `_test_ldap_bind_dn` now wraps tri-state `_test_ldap_bind_dn_verdict()` (`'ok' | 'fail' | 'inconclusive'`). `_ensure_authentik_webadmin` no longer triggers DELETE+POST recreate of `webadmin` on inconclusive verdicts (which was the root cause of the responder `400 username must be unique` regression). On confirmed-fail, re-queries Authentik before POSTing to confirm DELETE actually completed. Auto-installs `ldap-utils`/`openldap-clients` to make decisive verdicts the norm.
- **Dual-signal spiral detection with two-tier markers** — field testing of v0.8.4 on busy boxes (Mission API / DataSync) showed high-volume `Bind request` traffic could push spiral markers off the `--tail 200` window. v0.8.5 dev testing on tak-10 caught a second issue: treating all markers equally produced false positives from transient container restart artifacts. New `_detect_authentik_ldap_spiral()` confirms a spiral via **either** signal: ≥**1 spiral-specific marker** in last **1000** outpost log lines (`result code 50`, `nil pointer`, `exceeded stage recursion`, 502, 503 — these don't appear on healthy boxes), **or** ≥30 connections in `idle in transaction` from `application_name LIKE '%authentik%'` in Postgres. General markers (`failed to execute flow`, `EOF`) are tracked for forensics but never trip alone — they appear from user typos and normal LDAP disconnects.
- **Periodic self-healing monitor** — new `_authentik_spiral_monitor()` daemon thread runs every 10 minutes; calls the proactive routing function first, then the reactive detector + repair. Same gates, same Caddy probe, same auto-rollback. Single-instance PID-checked lock (only one gunicorn worker runs the monitor). Reactive repair rate-limited to 1 per 6 hours; attempts persisted to `settings.authentik_spiral_last_repair`. Proactive migration outcome persisted to `settings.authentik_proactive_routing_migration`.
- **Granular gate logging** — every early-return in the routing repair now logs why it skipped, under the `routing repair: ...` / `proactive routing: ...` / `gunicorn timeout: ...` prefix. Silent skips can no longer hide bugs.
- No UI changes. Pure backend self-healing.

Full notes: [docs/RELEASE-v0.8.5-alpha.md](docs/RELEASE-v0.8.5-alpha.md).

---

### v0.8.4-alpha — 2026-04-28

**Fix: reverse v0.8.0 LDAP outpost routing for boxes spiraling on direct internal URL**
- v0.8.0 switched the LDAP outpost from `https://<fqdn>` (via Caddy) to `http://authentik-server-1:9000` (direct). On busy installs, that bypassed Caddy's request shaping and exposed Authentik 2026.2.2's slow `policybindingmodel` flow evaluation, producing a Postgres query storm (200+ active queries) and outpost panic loop.
- New post-update migration `_apply_authentik_ldap_routing_repair` detects the spiral (`Result Code 50` / `nil pointer` / `EOF` / `503` markers in outpost logs), probes that the FQDN actually serves through Caddy, and reroutes the LDAP outpost back to `https://<fqdn>` + `extra_hosts:host-gateway`. Only the LDAP container is recreated; server/worker/db are untouched. Validates within 30s; auto-rolls-back on failure.
- `needs_pg_update` generalized to detect any `idle_in_transaction_session_timeout` value other than `30s` (was hardcoded list; missed manual values like `15s`).
- No-ops on healthy boxes, on already-FQDN-routed boxes, on boxes without an FQDN configured, and on boxes where Caddy isn't ready.

Full notes: [docs/RELEASE-v0.8.4-alpha.md](docs/RELEASE-v0.8.4-alpha.md).

---

### v0.8.3-alpha — 2026-04-28

**Fix: reduce `idle_in_transaction_session_timeout` to prevent Postgres exhaustion**
- Authentik's enterprise license check leaks `idle in transaction` connections; with the old 120s timeout they pile up fast enough to exhaust the Postgres connection pool and spike CPU to 500–800%.
- `idle_in_transaction_session_timeout` reduced from 120s to 30s. PostgreSQL container is auto-recreated by the migration to apply the new command-line arg.

Full notes: [docs/RELEASE-v0.8.3-alpha.md](docs/RELEASE-v0.8.3-alpha.md).

---

### v0.8.2-alpha — 2026-04-28

**Fix: auto-set `AUTHENTIK_WEB_WORKERS=4` on update**
- Post-update migration now sets `AUTHENTIK_WEB_WORKERS=4` in `~/authentik/.env` if not already at 4+, then restarts only the server container (ldap untouched, bind caches preserved).
- Prevents thundering-herd overload on active deployments after restarts.

Full notes: [docs/RELEASE-v0.8.2-alpha.md](docs/RELEASE-v0.8.2-alpha.md).

---

### v0.8.1-alpha — 2026-04-28

**Hotfix: v0.8.0 post-update migration caused CPU spike and Postgres exhaustion**
- v0.8.0's migration patched `AUTHENTIK_HOST` and restarted the LDAP outpost on all existing installs, including healthy ones. Restarting the outpost clears all cached bind sessions — with active TAK clients this triggered a thundering-herd reconnect storm, exhausting Postgres connections and pegging CPU.
- Fix: migration now checks whether the outpost is connected (websocket + no TLS errors in recent logs) before touching anything. Skipped on healthy outposts.

Full notes: [docs/RELEASE-v0.8.1-alpha.md](docs/RELEASE-v0.8.1-alpha.md).

---

### v0.8.0-alpha — 2026-04-28

**Bug fix: LDAP outpost `tls: internal error` on fresh installs**
- On new deployments with an FQDN configured, the LDAP outpost was generated with `AUTHENTIK_HOST: https://<fqdn>` instead of the internal Docker service URL. On first boot, Caddy hasn't finished its ACME challenge yet, so it sends a TLS `internal_error` alert. The LDAP outpost then enters exponential backoff (3s → 6s → 12s → … → 12+ min between retries) and never recovers on its own.
- Fix: all three code paths that generated or overwrote the LDAP outpost URL now unconditionally use `http://authentik-server-1:9000`. No `extra_hosts` entry is generated.
- Auto-heals on update: post-update migration patches any existing broken `docker-compose.yml` and restarts the `ldap` container.

Full notes: [docs/RELEASE-v0.8.0-alpha.md](docs/RELEASE-v0.8.0-alpha.md).

---

### v0.7.2-alpha — 2026-04-24

**Patch: Node-RED EACCES crash on first update from older installs**
- `docker cp` writes files as root; Node-RED runs as `node-red` → permission denied on `/data/context/global/global.json` at startup.
- Fix: `chown -R node-red:node-red /data/context` after every `docker cp` in `deploy.sh` and `app.py` migration path.

Full notes: [docs/RELEASE-v0.7.2-alpha.md](docs/RELEASE-v0.7.2-alpha.md).

---

### v0.7.1-alpha — 2026-04-24

> ⚠️ **Existing deployments:** TAK Server page → **Resync LDAP to TAK Server** after pulling.

- **Critical: Node-RED configs no longer wiped on Update Now** — older installs without `contextStorage: localfilesystem` lost all Configurator configs on any container restart. Fix: `_auto_nodered_settings()` detects missing storage, exports live in-memory context to disk via REST API before patching, then migrates to filesystem storage. `deploy.sh` also uses REST API backup first.
- **Tablet Command AVL** — stream fire/EMS vehicle positions from Tablet Command Feature Services to ATAK as live CoT events. Per-agency config cards with known-units CSV remapping table (custom callsigns + CoT type overrides). CoT type auto-detected from radio name prefix.
- **LDAP password propagation** — `ldap-authentication-login` stage `session_duration` fixed from `seconds=0` (24-hour cache) to `seconds=120`. Password changes take effect in 2 minutes. Self-healing via Resync.
- **ArcGIS save hang fixed** — `TypeError: configs.findIndex` caused save to hang indefinitely when context stored as stringified array after deploy/restore. Fixed with `_coerceArr()` in all CRUD mutators + `unwrapCtxVal` patched to prevent re-corruption.
- **External DB** — deploy TAK Server against AWS RDS, Azure Database for PostgreSQL, Google Cloud SQL, or any PostgreSQL 15 host. Test Connection button, Guard Dog cloud-aware alerts, full setup guide in `docs/EXTERNAL-DB-SETUP.md`.
- **Cert display** — cert card green at ≥30 days, red at <30 days (renewal ran and failed). No more false orange at 40 days. Guard Dog alert threshold corrected to 25 days.

Full notes: [docs/RELEASE-v0.7.1-alpha.md](docs/RELEASE-v0.7.1-alpha.md).

---

### v0.7.0-alpha — 2026-04-22

**IPAWS — timer-based KML cache, zone polygons, NAPSG icons**
- Timer-based KML cache with configurable poll interval; NWS zone polygon fetch; NAPSG Public Alert icons via CDN; Deploy/Deactivate button in Configurator.

Full notes: [docs/RELEASE-v0.7.0-alpha.md](docs/RELEASE-v0.7.0-alpha.md).

---

### v0.6.6-alpha — 2026-04-20

**Guard Dog — disk I/O alerts fixed + controls; Node-RED — safe deploy + KML polish**
- **Disk I/O watch script:** **`bc`** percentage fix — no more false **100%** “drop” when 1h and 24h averages differ slightly.
- **Guard Dog UI:** turn **disk I/O benchmark** on/off (systemd timer); turn **email/SMS for disk I/O only** on/off (other alerts unchanged). Settings sync to **`takdiskioguard.timer`** and **`/opt/tak-guarddog/diskio_email_off`**.
- **`nodered/deploy.sh`:** **stop container → write merged flows → restore Node-RED global/flow context → start** so Configurator-backed **`global.json`** is not wiped during deploy.
- **KML engine:** removes **`require()`** from the polling path (sandbox-safe **`FN_KML_CHECK_NL`** + HTTP nodes).
- **KML Configurator:** Step 3 Save toolbar matches ArcGIS; **auto-fetch on reopen**; blank defaults on fresh Fetch; **Google Earth / ArcGIS / FAA** logos on nav and source-type buttons.

Full notes: [docs/RELEASE-v0.6.6-alpha.md](docs/RELEASE-v0.6.6-alpha.md). Node-RED pointer: [nodered/CHANGELOG-nodered-v0.6.6-alpha.md](nodered/CHANGELOG-nodered-v0.6.6-alpha.md). Maintainer pre-release: [docs/TESTING-UPDATES.md](docs/TESTING-UPDATES.md); Node-RED smoke tests: [docs/TESTING-NODERED-DEPLOYS.md](docs/TESTING-NODERED-DEPLOYS.md). Selective merge + tag: [docs/COMMANDS.md](docs/COMMANDS.md) → *Merge dev → main (selective — release only)*.

---

### v0.6.5-alpha — 2026-04-17

**Node-RED Configurator — stable ID pills, compound UIDs, strict reconcile + Purge**
- **Stable-ID Step 3** is now a **multi-select pill picker** (0 / 1 / N fields): **compound UIDs** (`c` + hash) for feeds with no single stable column (NOAA FLOOD / STORM OBJECTID rotation).
- **Multi-layer feeds:** picker shows the **union of fields** across all selected layers with **`(in X/N)`** badges; partial-presence pills are dimmed so operators avoid foot-guns.
- **Strict mission ownership** (Step 5, default on for new configs) + **Purge Orphans** per config card — cleans orphan mission UIDs from past `idField` / `uidPrefix` edits; **strict is auto-disabled on multi-layer per-layer passes** so sibling layers do not delete each other.

Full notes: [docs/RELEASE-v0.6.5-alpha.md](docs/RELEASE-v0.6.5-alpha.md). Node-RED pointer: [nodered/CHANGELOG-nodered-v0.6.5-alpha.md](nodered/CHANGELOG-nodered-v0.6.5-alpha.md).

---

### v0.6.4-alpha — 2026-04-16

**Patch — VERSION / tag alignment for Update Now**
- Bumps **`VERSION`** to **`0.6.4-alpha`** so the checked-out tag and sidebar match, the update banner clears, and **post-update auto-deploy** (Guard Dog, Node-RED `deploy.sh` flow sync) runs after upgrade. No change to shipped Node-RED flows vs v0.6.3 content.

Full notes: [docs/RELEASE-v0.6.4-alpha.md](docs/RELEASE-v0.6.4-alpha.md). Node-RED pointer: [nodered/CHANGELOG-nodered-v0.6.4-alpha.md](nodered/CHANGELOG-nodered-v0.6.4-alpha.md).

---

### v0.6.3-alpha — 2026-04-17

**Node-RED Configurator — multi-layer, per-class styling, epoch-ms time**
- **Multi-layer** ArcGIS configs (one wizard, multiple layers); **multi-geometry** (point + polygon) with geometry-aware Step 4.
- **Step 3c class mapping:** per-class icons, ATAK color swatches, **no-color** option, template **label** and **remarks** with pill field toggles; **ALL CAPS** callsign option.
- **Epoch-millisecond time field** for rolling windows on numeric epoch columns (e.g. NOAA storm reports).
- **Template export/import** for reusable feed JSON.
- **Reconciliation:** global `_lastPoll`, duplicate tab dedup on deploy, stable polygon hash, `_subscribed` reset — fewer spurious ATAK notifications after deploy.
- **UI fixes:** Step 4 visible for point + class mapping; `resetForm()` on config switch so fields don’t leak between saved feeds.

Full notes: [docs/RELEASE-v0.6.3-alpha.md](docs/RELEASE-v0.6.3-alpha.md). Node-RED file list: [nodered/CHANGELOG-nodered-v0.6.3-alpha.md](nodered/CHANGELOG-nodered-v0.6.3-alpha.md).

---

### v0.6.2-alpha — 2026-04-16

**Node-RED DataSync — enterprise operator path**
- Shipped **`flows.json`** has **no** static example ArcGIS feeds (`FEEDS` empty in `build-flows.js`). Feeds are created only in the **Configurator** (dynamic tabs; `deploy.sh` merge + template sync preserves them).
- **Console** Node-RED **docker-compose** mounts **`/opt/tak/certs/files:/certs:ro`**, **`extra_hosts: host.docker.internal:host-gateway`**; **first deploy** runs **`nodered/deploy.sh --no-pull`**. **Post-update** patches existing compose if needed and syncs flows.
- **TLS:** `tls_tak` does not ship hardcoded cert paths in git; **`deploy.sh`** fills **`/certs/admin.pem`** when present on host. Operators enter the **private key passphrase** in the Node-RED editor and **Deploy**.
- **ArcGIS:** stable feature hashing (geometry + mapped fields); recommend **IncidentId** (or **GlobalID**) instead of **OBJECTID** for feeds where IDs fluctuate.
- **Configurator** copy explains TAK TLS + passphrase step.

Full notes: [docs/RELEASE-v0.6.2-alpha.md](docs/RELEASE-v0.6.2-alpha.md). Node-RED detail: [nodered/CHANGELOG-nodered-v0.6.0-alpha.md](nodered/CHANGELOG-nodered-v0.6.0-alpha.md).

---

### v0.6.1-alpha — 2026-04-16

**Patch release** — version bump to ensure all boxes (including those that fetched the original v0.6.0-alpha tag) receive the disk I/O monitor fix via Update Now. No functional changes beyond the version string.

---

### v0.6.0-alpha — 2026-04-16

**Guard Dog — Disk I/O Performance Monitor**
- Automated 15-minute `dd` benchmarks logged to CSV (30-day retention). Alerts when last-hour average drops below 50 MB/s or falls 70%+ from the 24h rolling average (noisy-neighbor detection). Email + SMS via Guard Dog alert pipeline.
- Dashboard card with color-coded stats (current, 1h avg, 24h avg, min/max), interactive sparkline chart with warning threshold line, time range dropdown (24h–30d), and CSV report download. Chart timestamps in user's local timezone.
- Auto-deploys with Guard Dog — `takdiskioguard.timer` created and enabled alongside existing monitors.

**VPS memory stability — swappiness tuning**
- Guard Dog deploy sets `vm.swappiness=10` (persistent + immediate). Prevents aggressive swapping on VPS with slow disk I/O, which was the #1 cause of "struggling" servers with plenty of free RAM.

**Postfix installation fix**
- `debconf-set-selections` preseeds `postfix/mailname` and `postfix/main_mailer_type` before install. Fixes `meter mydomain: bad parameter value: 0` failure on some systems.

**Node-RED — ArcGIS DataSync & FAA TFR Configurator (new)**
- Stream ArcGIS Feature Service data (wildfire perimeters, weather alerts, infrastructure, custom layers) and FAA Temporary Flight Restrictions into TAK Server missions as live CoT objects.
- Web-based configurator UI inside Node-RED — no flow editing required. Add feeds, pick fields, set poll intervals, click Deploy.
- Access at `https://nodered.<your-fqdn>` → Configurator tab.
- Non-destructive updates: user flows, feed configs, TLS, TCP settings, and credentials all survive `deploy.sh` runs. Template sync auto-updates function code in existing tabs.
- Ships with cold-start guards (no post-restart churn), stable ArcGIS hashing, FAA TFR ID fix, and per-feed label/capitalize options.

Full notes: [docs/RELEASE-v0.6.0-alpha.md](docs/RELEASE-v0.6.0-alpha.md).

---

### v0.5.9-alpha — 2026-04-10

**Boot sequence hardening — cold reboot to full stack in under 5 minutes**
- **Guard Dog Boot Sequencer** stops all Docker containers on boot so TAK Server gets exclusive CPU during its ~100s Java initialization. Nothing else starts until port 8089 is listening.
- **Authentik staggered start** — PostgreSQL starts first, waits for `pg_isready`, then server/worker/LDAP come up in order. Eliminates "too many clients already" connection storms.
- **PostgreSQL tuning (idempotent)** — `max_connections=300`, idle session timeouts, TCP keepalives baked into compose. New `_ensure_authentik_compose_patches()` helper runs on every deploy/reconfigure/update so tuning can never silently disappear after upgrades.
- **Priority service ordering** — TAK Server → Authentik → TAK Portal (critical trio, under 3 min). CloudTAK and Node-RED get 30s stagger delays to prevent Docker iptables churn from disrupting active TAK client connections.
- **Tested cold boot:** TAK Server ready ~100s, Authentik healthy +54s, TAK Portal +12s, full stack ~4:42. Zero PG errors, zero LDAP 502s, LDAP binds under 1ms.

Full notes: [docs/RELEASE-v0.5.9-alpha.md](docs/RELEASE-v0.5.9-alpha.md).

---

### v0.4.7-alpha — 2026-04-08

**Auto-deploy on update** — Guard Dog, Authentik, TAK Portal, and CloudTAK configs are all automatically re-deployed when a version change is detected. No manual button presses after console updates. Authentik, TAK Portal, and CloudTAK run in parallel. Console cards show "Updating config..." while each service reconfigures. TAK Server and other services stay running throughout.

**Online database repack (pg_repack)** — new weekly Guard Dog script reclaims actual disk space from the CoT database without downtime. Runs Sunday 4 AM, auto-installs pg_repack, works in both local and two-server mode.

**Boot sequencer — two-server fix** — `tak-boot-sequencer.sh` no longer hangs for 2 minutes on two-server setups trying to reach a local PostgreSQL that doesn't exist. Detects remote DB from `guarddog.conf` or `CoreConfig.xml` and checks via TCP, completing instantly.

**TAK Portal Guard Dog monitor** — new container health monitor with alert + auto-restart after 3 failures. Previously TAK Portal had no monitoring — if it crashed, nobody knew.

**Smart Guard Dog UI** — shows "up to date" when config is current; "Update Guard Dog" button only appears when settings have changed.

**CloudTAK security fix** — removed `NODE_TLS_REJECT_UNAUTHORIZED=0` from CloudTAK `.env` and `docker-compose.override.yml` (flagged by CloudTAK developer as security flaw). Applied automatically on upgrade.

**Remote DB monitor fix** — TCP+SSH monitor now correctly shows red when Server One is unreachable (was falsely showing green).

**Guard Dog config drift prevention** — `guarddog.conf` auto-syncs with settings.json on every console startup, preventing stale remote DB IPs after migration.

### v0.4.6-alpha — 2026-04-07

**Staggered boot sequencer — cold reboot to full stack healthy in ~2 minutes**
- Full boot orchestration: pre-start stops all Docker services and waits for PostgreSQL, then TAK Server starts with exclusive CPU. Post-start waits for port 8089, then brings up Authentik (waits for healthy + LDAP 389), TAK Portal, CloudTAK, Node-RED, and MediaMTX in order. Only installed services are touched.
- Auto-restarts TAK messaging if it crashes during cold boot (config ready but messaging process died).
- Tested on fresh 12-core / 48 GB VPS (316 MB/s disk): pre-start 15s, TAK Server 9s, full stack healthy in ~2 min 15s.

**Authentik deployment resilience**
- TLS cert readiness gate: waits up to 300s for Caddy to provision a valid cert on the Authentik FQDN before restarting the LDAP outpost.
- LDAP port 389 readiness gate: waits up to 180s for the LDAP container to be listening before running bind verification.
- Improved LDAP bind verification: 24 attempts / 10s delay (was 12/5s). Log parsing prioritizes success markers over stale errors.
- Docker healthcheck `start_period` extended to 600s for Authentik server and worker (accommodates slow first-run migrations).

**Guard Dog — boot-loop prevention**
- Service-age grace (10 min), daily restart cap (3/day shared counter), clean restart (stop → kill orphans → clear Ignite → start).
- Timer delays increased to 20 min after boot.

**Certificate password fix**
- Custom cert passwords now correctly applied to all JKS files during TAK Server deploy and CA rotation. `cert-metadata.sh` is patched before cert generation with the correct variable names (`CAPASS`, `PASS`).
- All `keystorePass` and `truststorePass` attributes in CoreConfig.xml are updated to match the custom password — including `<tls>` elements that previously retained the default `atakatak`, causing TAK Server to crash with a JWT RSA key NPE on startup.
- Default password (`atakatak`) deployments were never affected.

**TAK Portal — SSH auto-configuration**
- On deploy, reconfigure, or update: generates an ed25519 keypair, installs the public key in the host's `authorized_keys`, copies the keypair into the TAK Portal container, and populates all `TAK_SSH_*` settings. No manual handshake needed.
- Only runs when TAK Server is on the same box (`/opt/tak` exists). Remote TAK Server deployments are left for manual SSH config in TAK Portal's UI.
- Existing users: click **Update Config** on the TAK Portal page to enable.

**VPS disk I/O check in installer**
- `start.sh` now runs a 256 MB write test on first boot and prints a colored speed assessment (excellent / acceptable / slow) with guidance if performance is poor.

**After upgrading to v0.4.6:** Guard Dog → ↻ Update Guard Dog, then Authentik → Update Config & Reconnect, then TAK Portal → Update Config (enables SSH). Note: v0.4.7-alpha makes all of this automatic.

Full notes: [docs/RELEASE-v0.4.6-alpha.md](docs/RELEASE-v0.4.6-alpha.md).

---

### v0.2.9-alpha — 2026-03-15

**Deep security hardening**
- Comprehensive security audit and remediation: shell injection fixes (CRITICAL/HIGH), credential handling (hardcoded passwords removed, `sshpass -e`, cert password validation), session security (cookie flags, fixation prevention, POST-only logout, XFF trust), file permissions (`settings.json` 0o600, `tempfile.mkstemp()` for sensitive temp files), information disclosure (exception truncation, secret masking in logs), and input validation (FQDN, version, `StrictHostKeyChecking`). Recommended upgrade for all deployments.

Full notes: [docs/RELEASE-v0.2.9-alpha.md](docs/RELEASE-v0.2.9-alpha.md).

---

### v0.2.8-alpha — 2026-03-20

**Security hardening**
- Input validation and sanitization across console API endpoints and internal shell commands. All user-supplied and settings-derived values that reach system commands are now validated, whitelisted, or escaped. Recommended upgrade for all deployments.

**Authentik branding**
- Starter TAK logo (`tak-gov-brand.svg`) shipped with the repo and copied to the Authentik media directory on deploy. See [docs/AUTHENTIK-LOGIN-BRANDING.md](docs/AUTHENTIK-LOGIN-BRANDING.md) for CSS, theme, and flow customization.

Full notes: [docs/RELEASE-v0.2.8-alpha.md](docs/RELEASE-v0.2.8-alpha.md).

---

### v0.2.7-alpha — 2026-03-19

**Guard Dog — alert email uses Email Relay**
- All Guard Dog **email** alerts (monitors, certificate expiry, “updates available”, etc.) now go through the **console** and the same **Email Relay** path as **Send test email** on the Guard Dog page — not the system `mail` command.
- **After upgrading:** open **Guard Dog** → **↻ Update Guard Dog** once. Set **Notifications** alert email and deploy **Email Relay**; use **Send test email** to confirm.
- **Updates email:** Reads Authentik’s installed version from `docker-compose.yml` (matches the dashboard). Does not report an update when the current version is unknown. Simpler body: only lists components with pending updates. Throttle: same set of updates ≈ one email per 24 hours until the set changes.
- **Pre-ship testing:** See [docs/TESTING-UPDATES.md](docs/TESTING-UPDATES.md) before pushing a new release tag.

Full notes: [docs/RELEASE-v0.2.7-alpha.md](docs/RELEASE-v0.2.7-alpha.md).

---

### v0.2.6-alpha — 2026-03-16

**Update Now hotfix (no rebase conflicts)**
- Fixed a field-update failure where **Update Now** could trigger rebase/cherry-pick conflict errors (`could not apply ... Add files via upload`) on some customer installs.
- Update flow now uses a deterministic **fetch + force checkout** path (latest tag, fallback `origin/main`) and first clears stale in-progress git operations (rebase/merge/cherry-pick abort attempts).
- This prevents customer boxes from getting stuck mid-update due to local branch/rebase state.

---

### v0.2.5-alpha — 2026-03-16

**MediaMTX web editor — stale overlay self-heal**
- Some upgraded infra-TAK installs had an older `/opt/mediamtx-webeditor/mediamtx_ldap_overlay.py` still injecting legacy UI logic into External Sources (duplicate Private/Share controls and broken layout). **Patch web editor** now always syncs the live overlay file from the current infra-TAK repo before restarting the web editor, so existing installs converge to the same behavior as clean deploys.

**Guard Dog — Updates monitor recovery**
- **↻ Update Guard Dog** now reinstalls `takupdatesguard.service` and `takupdatesguard.timer`, runs `daemon-reload`, and enables/starts the timer. This fixes boxes where the Updates monitor stayed red because the timer unit was missing.
- Guard Dog update UX is clearer: button text is now **↻ Update Guard Dog** and the success message auto-clears after a few seconds.

---

### v0.2.4-alpha — 2026-03-16

**MediaMTX web editor — duplicate endpoint patch**
- After deploying the LDAP overlay, the web editor could crash with Flask "View function mapping is overwriting an existing endpoint" for shared and share-links routes. The console now applies an **endpoint patch** (shared_stream_page, shared_hls_proxy, api_share_links_list, api_share_links_generate, api_share_links_revoke) so the overlay and core don't conflict. Use **Patch web editor** on the MediaMTX page if the editor is in a restart loop; the same patch runs automatically on deploy and via the heal script at service start.

**Console Update Now — no more "still see update" loop**
- **Update Now** used to only run `git pull` on the current branch. If the latest release was a tag (e.g. v0.2.3-alpha) and the branch wasn't at that commit, the restarted app still showed the old version and "Update Available" stayed. Update Now now **fetches and checks out the latest release tag** after pull, so the restarted process runs the tagged version and the banner disappears after refresh.

---

### v0.2.3-alpha — 2026-03-15

**Guard Dog**
- Update check runs every **6 hours** (configurable). When the set of available updates changes, Guard Dog sends **one email** with the full list so you're notified without inbox spam.

**Ku-band (MediaMTX web editor)**
- When the console installs or updates the **web editor**, it now copies the **simulator scripts** into the editor install so the **Simulate** link works without manual copying.

---

### v0.2.2-alpha — 2026-03-14

**CSRF behind Caddy**
- Same-origin check now uses **X-Forwarded-Host** (and X-Forwarded-Port when non-standard) so the console works when accessed through Caddy or another reverse proxy. Fixes 403 "CSRF validation failed" when clicking Update CloudTAK, Apply log limits, etc. Ensure Caddy forwards Host (e.g. `header_up Host {host}`); see COMMANDS.md.

**CloudTAK deploy and update**
- **Deploy** and **Update** both use **`docker compose build --no-cache`** so the running CloudTAK version matches the tag (e.g. v12.103.0). Previously Docker could reuse cached layers and serve an older version.
- **Deploy log** ends with explicit "Deploy finished — CloudTAK is running." (and "✓ Containers built and restarted" / "✓ Restart complete.") so you can tell when the restart is done.
- **Access** links (Web UI, Tile Server, Video, Install Dir) are hidden until deploy/update is complete.

---

### v0.2.1-alpha — 2026-03-14

**Security hardening**
- Auth header trust gated to local proxy (loopback only). CloudTAK logs endpoint hardened (container name allowlist, argv-style subprocess). TAK package uploads use `secure_filename()`. CSRF baseline: same-origin validation for state-changing APIs. Rate limiting: 12 login attempts / 5 min, 240 API writes / min per IP. Security headers: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, CSP, HSTS on HTTPS. See [SECURITY-AUDIT-v0.2.0-alpha.md](docs/SECURITY-AUDIT-v0.2.0-alpha.md).

**Server metrics**
- Console dashboard and module detail pages show **server metrics** (CPU, RAM, disk) for the local host and for remote deployment targets. Remote metrics are fetched via SSH so you can see resource usage per server.

**TAK Server — JVM heap**
- TAK Server page shows **recommended heap** from total RAM and **current heap** (if set via systemd drop-in). You can set a custom **JVM heap** (e.g. 4G, 8G) via the Controls area; the console writes `/etc/systemd/system/takserver.service.d/heap.conf` and restarts TAK Server.

**Guard Dog — server nickname**
- In **Guard Dog → Notifications** you can set an optional **Server nickname** (e.g. Production, Staging). Alerts then include the nickname plus IP/FQDN so you can tell which server sent the alert when monitoring multiple infra-TAK hosts. **Save email & nickname** applies the nickname without redeploying.

**CA rotation and TAK Portal**
- **Rotate CA** now **replaces the server cert** with one signed by the new CA (no "keep existing server cert" option). After rotation, users re-enroll by scanning the new QR; no need to delete the server first. **Sync TAK Server CA** button in TAK Portal (Controls) pushes `tak-ca.pem` to the portal so enrollment and API use the current CA. Revoke section hides when there are no old CAs; CA/revoke state refetches on visibility and pageshow so the Revoke option disappears after use. Deploy/sync/revoke/rotate use only `tak-ca.pem` (no caCert.p12 or transition bundle).

**Caddy — certificate expiration**
- Caddy (Let's Encrypt) **cert expiration** is shown on the **dashboard card**. On the **Caddy module page**, the top row currently shows only status and URL (e.g. "Caddy is active · test8.taktical.net"); cert expiration is not yet in that top row — planned: show it in the top row after the URL.

---

### v0.2.0-alpha — 2026-03-12

**Two-server TAK Server (split core and database)**
- Deploy TAK Server across two hosts: **Server One** (PostgreSQL database) and **Server Two** (TAK Server core). Server One is configured entirely from the console — installs PostgreSQL, opens remote access, captures the DB password, and configures `pg_hba.conf` for Server Two's IP.
- SSH key management UI: generate or use an existing key for Server One access, with a button to copy the public key.
- Per-server health monitoring: separate status dots for core and database, with dedicated **Restart DB** / **Restart Both** buttons.
- Guard Dog is two-server aware and monitors the remote database host.
- TAK Server version detection works across both hosts (`takserver-core` on Server Two, `takserver-database` on Server One).

**Remote deployments**
- Authentik, CloudTAK, MediaMTX, and Node-RED can each be deployed to a **remote host** via SSH. Choose "On another server via SSH" in the Deployment Target section, enter host/user/port, and deploy from the console.
- Remote module status (running/stopped) is checked via SSH and shown in the sidebar and console cards.
- Remote health metrics (CPU, RAM, disk) shown on module detail pages.

**Gunicorn production server (auto-upgrade)**
- The console now runs on **gunicorn** instead of the Flask dev server. Existing v0.1.x installs auto-upgrade transparently on first restart after pull — no manual steps needed.

**Staggered Docker boot**
- A systemd `docker-stagger.service` starts Docker containers in dependency order on server reboot: Authentik DB → Authentik → LDAP outpost → TAK Portal → CloudTAK DB → CloudTAK. Prevents OOM crashes and 502s from all containers starting simultaneously on small VPS. Updated automatically on every deploy/uninstall.

**Light / high-contrast mode**
- Toggle in the sidebar switches between dark mode and a high-contrast light mode designed for outdoor/sunlight use. Preference saved to localStorage and persists across sessions and pages.

**Unified controls UI**
- All module pages now have a consistent **Controls** section immediately below the status banner, matching the TAK Server page layout. Same `control-btn` styling across every page.
- **Deployment Target** sections only appear when a module is not yet deployed; once deployed, they disappear.
- All pages are full-width, flush with the sidebar.

**CloudTAK — stable release pinning and update awareness**
- Deployments pinned to the **latest stable GitHub release** instead of HEAD. Console card and detail page show **update availability** when a newer stable release exists. One-click **Update** button with glowing indicator.

**Authentik — update awareness and auto-fetch**
- Deploy automatically fetches the **latest stable Authentik release** from GitHub. Console card and detail page display update availability with glowing **Update** button.

**Authentik — reconfigure improvements (local and remote)**
- Remote reconfigure runs entirely against the remote host (SSH + API on `http://<remote>:9090`). No local `~/authentik` required.
- Local reconfigure creates/repairs all four Authentik applications (infra-TAK, MediaMTX, Node-RED, TAK Portal) and ensures all providers are on the embedded outpost.
- Outpost safety: adding a provider never removes existing ones.
- Reconfigure shows a live deploy log instead of immediate redirect.
- Enables the **show password eyeball** on all Authentik login stages (for existing deployments, run "Update config & reconnect").

**TAK Portal — updates preserve custom branding**
- All TAK Portal operations (Update, Update config, reconfigure) now preserve user-configured settings like `BRAND_LOGO_URL` (custom logo/photo). Custom branding survives all updates.

**Email Relay — Authentik SMTP auto-configuration**
- Deploying Email Relay automatically configures Authentik's SMTP settings and sets up the password recovery flow.

**Console UI and branding**
- Version display in the sidebar logo area. **Orbitron** font for "infra-TAK" in the sidebar, matching the login page.
- TAK Server and CloudTAK versions shown on console cards and detail pages.
- Module update indicators on dashboard cards.

**LDAP credential auto-resync**
- Detects when Authentik LDAP credentials have drifted from CoreConfig and auto-resyncs, preventing silent group sync failures.

---

### v0.1.9-alpha — 2026-03-04

**Guard Dog**
- Guard Dog appears in the sidebar **directly under Console** when installed (high-priority placement).
- **Apply Docker log limits** button on the Guard Dog page — set 50 MB × 3 files per container without redeploying Authentik, Node-RED, or another Docker module. Reduces risk of a single container log filling the disk (e.g. Node-RED).
- **Collapsible sections** on the Guard Dog page: Notifications, Database maintenance (CoT), and Activity log are now collapsible (click header to expand/collapse), matching the TAK Server and Help page style.
- **4GB swap on deploy** — When Guard Dog is deployed (or auto-deployed with TAK Server), the console ensures a 4GB swap file at `/swapfile` exists and is enabled. Matches the reference TAK Server Hardening script for memory stability under load.

**Connect LDAP / CoreConfig**
- When writing CoreConfig (full replace or password resync), the console ensures `adminGroup="ROLE_ADMIN"` is present in the LDAP block (adds if missing, verifies after write). Prevents wrong admin console access and "no channels" issues.

**CloudTAK**
- Step 6 waits for the CloudTAK API (`/api/connections` returns 200/401/403) before declaring backend ready, not just port 5000 — avoids 502 when Caddy proxies before the backend is up. Step 4 build output streamed; Step 5 timeout 600s.

**MediaMTX**
- Web editor systemd unit is created and enabled only when `mediamtx_config_editor.py` is present (clone or local fallback). If the editor file is missing, MediaMTX streaming still works; no restart loop. Clone uses default branch of `takwerx/mediamtx-installer`; LDAP overlay applied from repo.

**Unattended upgrades**
- Spinner on the toggle so "Disabling…" is visible while the request runs.

**Docs**
- [GUARDDOG.md](docs/GUARDDOG.md) documents the 4GB swap step and Docker log limits. [COMMANDS.md](docs/COMMANDS.md) has pull-then-restart (two steps), server impact and memory (`free -h`, `docker stats`, `top`), disk-full recovery, CloudTAK 502/backend readiness, and TAK client "no channels" / new-groups sync delay.

---

### v0.1.8-alpha — 2026-03-02

**LDAP QR Registration Fix**
LDAP application was restricted to authentik Admins, blocking QR code enrollment for non-admin users. LDAP is now open to all authenticated users. Connect LDAP / Resync LDAP applies this fix automatically.

**Fresh Deploy Flow**
8446 webadmin login and QR registration now work on initial deployment without manual Sync webadmin or Resync LDAP. LDAP outpost restart runs at end of TAK Server deploy and during Connect LDAP.

**Authentik Deploy**
Caddy reload timeout (30s) prevents indefinite hang. Progress message "Updating Caddy config..." before slow steps.

**Recommended deployment order:** Caddy → Authentik → Email Relay → TAK Server → Connect LDAP → TAK Portal → Node-RED / CloudTAK / MediaMTX

---

### v0.1.7-alpha — 2026-02-24

**Node-RED Authentik Integration**
Node-RED is now protected behind Authentik forward auth at `nodered.{fqdn}`. Requires Authentik login — same flow as TAK Portal.

**Bug Fix: Node-RED proxy provider was never created**
The provider creation payload used `authentication_flow` instead of `authorization_flow` (typo). Every POST returned 400 validation error, not "duplicate" — so the provider was never created. Also added the missing `invalidation_flow` field.

**Bug Fix: Orphaned Node-RED application**
Previous failed deploys created the application with no provider linked. The deploy now PATCHes the existing application to link the provider if it already exists.

**Bug Fix: Update mechanism didn't restart the service**
Clicking "Update Now" ran `git pull` but never restarted `takwerx-console`. Users saw "Updated!" but the old code kept running. The update now triggers a delayed `systemctl restart` after responding.

---

### v0.1.6 — 2026-02-22

**Rebranding:** Project renamed from `takwerx-console` to `tak-infra`. The console interface is now a component within the broader TAK-infra platform.

**Bug Fix: Console not loading after fresh deploy**
The auto-generated Caddyfile was missing the `tls` directive in the console reverse proxy transport block. Since the Flask app runs on HTTPS, Caddy was unable to forward requests to it, causing browsers to spin indefinitely. The TAK Server block already had the correct configuration — the console block now matches.

- `app.py`: Added `tls` to console Caddy transport block

---

### v0.1.5-alpha — 2026-02-21

**LDAP Authentication Fixed**
Authentik blueprint was setting `authentication_flow` instead of `authorization_flow` on the LDAP provider. This was the root cause of "Flow does not apply to current user" errors on every deploy since LDAP was introduced.

**Duplicate LDAP Provider Removed**
A second LDAP provider was being created via API after the blueprint, pointing to the wrong authentication flow. The API block has been removed. The deploy now waits for the blueprint worker to create the correct provider and injects its token directly.

**Token Injection Retry Loop**
LDAP outpost token fetch now retries indefinitely at 5-second intervals instead of timing out. No more manual token injection required after deploy.

**Caddy Reverse Proxy Redirect Fix**
TAK Server behind a reverse proxy was sending `Location: 127.0.0.1:8446` redirects back to the browser after login. Caddy now rewrites these headers to the correct FQDN automatically.

**TAK Portal Forward Auth**
Forward auth and invalidation flow lookups now retry indefinitely. TAK Portal deploy waits 2 minutes after completion for Authentik's embedded outpost to fully sync. Public paths bypass forward auth to support self-service enrollment.

**UX Improvements**
Deploy logs for Authentik and TAK Portal persist after completion. Completion screens show direct launch buttons for each service.

---

### v0.1.4-alpha — 2026-02-18

**GitHub Update Checker**
Switched from Releases API to Tags API — the previous implementation hit `/releases/latest` which returns 404 unless a Release is manually created on GitHub. Now uses `/tags` with semver sorting and 1-hour cache.

**Deploy State Reset**
TAK Server, Authentik, and TAK Portal pages now clear the `deploy_done` flag when services are running. Previously, refreshing after a deploy would keep showing the log instead of the running state.

**CoreConfig LDAP Auth**
`default="ldap"` preserved in the auth block — required for TAK Portal QR code enrollment.

---

### v0.1.3-alpha — 2026-02-18

**CoreConfig LDAP Auth**
`default="ldap"` preserved and File auth listed before LDAP in the auth block.

**Deploy State Reset**
All three module pages (TAK Server, Authentik, TAK Portal) now reset deploy state correctly on refresh.

---

### v0.1.2-alpha — 2026-02-17

**CoreConfig Auth Default Fix**
Changed `default` from `ldap` to `file` to fix `webadmin` access on port 8446. Password auth uses flat file, LDAP users still authenticate via the LDAP block, x509 cert auth still routes groups through LDAP.

**TAK Portal Container Log Cleanup**
Filtered `npm error`, `SIGTERM`, and `command failed` messages from container log display — these were cosmetic restart noise with no functional impact.

**Console Cross-Navigation**
Added links between Authentik, TAK Portal, and TAK Server pages.

---

### v0.1.1-alpha — 2026-02-17

**Authentik Module — Automated Deploy**
Full 10-step automated deployment: bootstrap credentials, LDAP blueprint, Docker Compose patching, API-driven token retrieval, CoreConfig.xml auto-patch, TAK Server restart. Smart API polling handles the full 503 → 403 → 200 startup progression.

**TAK Portal Module — Automated Deploy**
6-step automated deployment: repository clone, container build, TAK Server certificate copy, settings.json auto-configuration.

**Console UI**
Cross-service navigation between all module pages. Real-time step-by-step deploy logging.

---

### v0.1.0-alpha — 2026-02-16

Initial release.

- Services dashboard with live TAK Server process monitoring (Messaging, API, Config, Plugin Manager, Retention)
- Live server log streaming with color-coded ERROR/WARN highlighting
- Certificates page with file browser and direct download
- Deployment improvements: countdown timers, unattended-upgrades detection, cancel button, log reconnection
- Upload management: duplicate detection, cancellation, remove button
- Ubuntu 22.04 support

---

## License

MIT

## Credits

Built by [TAKWERX](https://github.com/takwerx) for emergency services.
