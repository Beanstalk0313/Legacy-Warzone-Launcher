# AUTO-UPDATE SETUP GUIDE

**Delete this file when you're done.** Everything below is the one-time setup
for shipping auto-updates from GitHub Releases. The app side is already wired:

- `src/utils/updater.js` — startup check + install + relaunch
- `src/components/UpdateModal.jsx` — "Update Available" dialog (Update Now / Later, download progress, controller + keyboard support)
- `src/main.jsx` — runs the check once the security gate passes
- `src-tauri/` — `tauri-plugin-updater` + `tauri-plugin-process` registered, `createUpdaterArtifacts: true`
- `.github/workflows/release.yml` — builds + publishes the release when you push a `v*` tag

---

## Step 1 — Generate the signing key (ONCE)

The updater signs every installer with a private key; the app verifies it with
the public key. **You can't disable signing.**

```bash
npm run tauri signer generate -- -w ~/.tauri/legacy-warzone-launcher.key
```

It prints the **public key** (and writes `publickey.pem`) and saves the
**private key** to `~/.tauri/legacy-warzone-launcher.key` (outside the repo).

> ⚠️ **The private key is sacred.** Never commit it, never share it, and back
> it up somewhere safe. If you lose it you can NEVER push another update to
> machines that already have the app installed. If you generate into the
> project folder instead of `~/.tauri/`, `.gitignore` already covers `.tauri/`.

## Step 2 — Configure `src-tauri/tauri.conf.json`

Replace the two placeholders:

```jsonc
"plugins": {
  "updater": {
    "pubkey": "REPLACE_WITH_PUBLIC_KEY",   // ← paste the public key (base64, one line)
    "endpoints": [
      "https://github.com/OWNER/REPO/releases/latest/download/latest.json"  // ← your repo
    ]
  }
}
```

The public key is **safe to commit** — only the private key must stay secret.
The endpoint is a static `latest.json` that `tauri-action` uploads to every
release; the app compares its version against `latest.json` on startup.

## Step 3 — Add the private key to GitHub Actions secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The **path or contents** of `~/.tauri/legacy-warzone-launcher.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Only if you set a password when generating |

## Step 4 — Release (this is the whole flow)

1. Bump the version in **all three** places:
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `version`
   - `package.json` → `version`
2. Commit, then tag and push — the `Release` workflow takes it from there:

```bash
git tag v1.8.0
git push origin v1.8.0
```

3. The workflow (`.github/workflows/release.yml`) builds on `windows-latest`,
   signs with your secret key, and creates a **draft** GitHub Release (with
   the installer `.exe`, its `.sig` signature, and `latest.json` attached).
4. Open the release on GitHub, write notes, and hit **Publish**.

Every installed copy of the app now sees the new version on next launch and
offers **Update Now** → downloads the `.exe` → installs → relaunches.

---

## Manual alternative (no CI)

Build locally with the key in your environment (`.env` files do NOT work for
the Rust build — set a real environment variable):

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "path-or-contents-of-your-key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""   # only if you set one
npm run tauri:build
```

Then create a GitHub Release manually and upload, from
`src-tauri/target/release/bundle/nsis/`:

- `Legacy Warzone Launcher_1.8.0_x64-setup.exe` (or similar)
- the matching `.exe.sig`
- `latest.json` (generated in the bundle folder) — Tauri uses the release URL
  + the version inside it, so keep it at the path your endpoint points to.

## Versioning rules

- The release version must be **greater** than the installed version
  (standard SemVer; `v` prefix on the tag is fine).
- Same version = no update offered.
- Bump all three version fields (Step 4.1) or `latest.json`/installed version
  can disagree with the tag.

## Runtime behavior

- Check runs **once per launch**, right after the security/ban gate passes,
  only in the desktop (Tauri) build — browser dev (`npm run dev`) never checks.
- Offline / placeholder endpoint / no release yet → check fails **silently**,
  the app starts normally.
- On Windows the app auto-exits during install (Windows installer limitation);
  the updater relaunches it afterwards (`installMode` defaults to `passive` —
  a small progress window, no interaction needed).
- The Jupiter-only build (`tauri:build:jupiter`) shares the same updater
  config — one endpoint serves both.

## Troubleshooting

- **`tauri build` fails with a signing error** — `createUpdaterArtifacts: true`
  means builds now require `TAURI_SIGNING_PRIVATE_KEY`. Expected until Step 1–3.
- **Update never appears** — check the pubkey in `tauri.conf.json` matches the
  key that signed the release, the endpoint has your real `OWNER/REPO`, and the
  release is **public** (or the draft is published) with `latest.json` attached.
- **"Signature verification failed"** — the private key that signed the release
  ≠ the pubkey embedded in the installed app. Same keypair, always.
- **Release built but no assets** — the workflow makes a draft; drafts have no
  `releases/latest` URL until published. Publish it first.
