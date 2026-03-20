# Starter assets for Authentik branding

## `tak-gov-brand.svg`

- **Source:** Same official Team Awareness Kit shield as the infra-TAK console uses (`TAK_LOGO_URL` → `https://tak.gov/assets/logos/brand-06b80939.svg`).
- **Bundled** so installs work offline and the file is versioned with infra-TAK.

## After Authentik deploy

infra-TAK copies this file to the Authentik **host** (same machine as Docker, or your remote Authentik target):

| Install | Path |
|--------|------|
| Local | `~/authentik/media/public/infra-tak-defaults/tak-gov-brand.svg` |
| Remote | `~/authentik/media/public/infra-tak-defaults/tak-gov-brand.svg` on the Authentik server |

That directory is under the usual **`./media:/media`** compose bind mount, so the worker/server containers can read it.

## Using it in Authentik

Authentik’s **Brand** logo / favicon / flow background fields usually expect an **upload** (browser) or a **media UUID** via API — they do not auto-pick files from disk. To use this asset:

1. Open **Admin → System → Brands →** your brand.  
2. Upload `tak-gov-brand.svg` from the path above (or from this repo: `static/authentik-branding/tak-gov-brand.svg`), **or** use **Update / reconfigure** after deploy and pull the file from the server with `scp` / SFTP to your laptop and upload.

See **[docs/AUTHENTIK-LOGIN-BRANDING.md](../../docs/AUTHENTIK-LOGIN-BRANDING.md)** for CSS, dark theme, and flow text.

## Adding more starters

Drop additional **generic** (properly licensed) PNG/SVG files in this folder and extend `_ensure_authentik_starter_branding()` in `app.py` if you want them copied the same way.
