# Signing — PrintNinja

How to sign PrintNinja builds for **free, internal use** (company PCs),
without buying a code-signing certificate.

Today signing is **local-only**: nothing in the pipeline signs
automatically. `release-local.mjs` and the CI build jobs produce
*unsigned* desktop installers; if you want a signed MSI, build it, sign
it, and put the signed file back on the draft release (see
`docs/RELEASE.md`).

This page complements `docs/RELEASE.md` (section 2); it does not
replace it.

## What this does and does not give you

| | Self-signed (this guide) | Paid certificate / store |
|---|---|---|
| Cost | Free | Paid yearly (Windows) |
| Trusted on your company machines | Yes, after you install the `.cer` once | Yes |
| Trusted on any other machine | No (Windows still warns) | Yes |
| Good for | Internal tools, staff PCs, pilots | Public or customer distribution |

If you later ship to customers outside the company, buy a certificate
from a public provider. The steps below do not carry over to that.

## Rules for the secrets

- `scripts/certs/` holds the private files (`windows.pfx` and its
  public `.cer`'s private half). They are **never committed**.
- The directory does not exist in the repo yet. When you create it, add
  `scripts/certs/` to `.gitignore` and check with
  `git check-ignore scripts/certs/windows.pfx` before you sign anything.
- Only the public `.cer` is shared with other people or machines.
- Keep a backup of the `.pfx` and its password in your password
  manager. Never put the password in the repo or in CI logs.

## Windows (MSI)

### 1. Create the certificate (once)

PowerShell, from the repo root:

```powershell
$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=PrintNinja Internal" -KeyUsage DigitalSignature `
  -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable -NotAfter (Get-Date).AddYears(5) `
  -CertStoreLocation Cert:\CurrentUser\My

$pw = ConvertTo-SecureString "choose-a-password" -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath scripts\certs\windows.pfx -Password $pw
Export-Certificate    -Cert $cert -FilePath scripts\certs\printninja-internal.cer
```

That produces:

- `windows.pfx` — private key plus certificate. Used only by you, to sign.
- `printninja-internal.cer` — the public certificate. Installed on the
  PCs that should trust your builds.

### 2. Build and sign the MSI

From the repo root:

```powershell
pnpm tauri:build --bundles msi

signtool sign /f scripts\certs\windows.pfx /p "choose-a-password" /fd sha256 `
  /tr http://timestamp.digicert.com /td sha256 `
  target\release\bundle\msi\*.msi
```

The artifacts land in `target/release/bundle/msi/` because the build
runs from the repo root against `app/tauri.conf.json`.

The `/tr` timestamp server is free. It proves the file was signed while
the certificate was valid, so the signature stays good after the
certificate expires.

`signtool` comes with the Windows SDK. If it is not on your `PATH`, it
is usually in `C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\`.

### 3. Verify the signature

```powershell
signtool verify /pa /v target\release\bundle\msi\PrintNinja_*.msi
```

On your own machine this passes only if the certificate is trusted
there (step 4). On an untrusted machine you will see "A certificate
chain processed, but terminated in a root certificate which is not
trusted" — expected until step 4.

### 4. Make each internal PC trust it

Run once per PC in an **administrator** PowerShell, using only the
`.cer`:

```powershell
Import-Certificate -FilePath printninja-internal.cer -CertStoreLocation Cert:\LocalMachine\Root
Import-Certificate -FilePath printninja-internal.cer -CertStoreLocation Cert:\LocalMachine\TrustedPublisher
```

For more than a few PCs, deploy the `.cer` with Group Policy or Intune
instead of by hand. Afterwards the installer shows
"PrintNinja Internal" as the publisher instead of "Unknown publisher".
SmartScreen may still ask about files freshly downloaded from the
internet; installing from a shared drive or via your
software-distribution tool avoids that.

### Renewal

The certificate above lasts 5 years. Before it expires, create a new
one (step 1), sign new builds with it, and roll out the new `.cer`.
Builds already signed *and timestamped* keep working.

## Android (landing with the Android phase)

The Android phase is being wired up in this branch right now — treat
everything in this section as work in progress until it lands:

- CI has an `android-check` job (debug APK on pull requests) and an
  `android-build` job (release APK + AAB on every `v*` tag, arm64 only).
- Signing is pinned by `scripts/patch-android-signing.mjs`, which runs
  after `tauri android init` and before `tauri android build`. It
  points **both** the debug and the release variants at one shared
  keystore, so every release APK upgrades cleanly over the last — and
  it **fails loudly** when the secrets are missing, rather than
  shipping a throwaway key.
- The shared keystore comes from CI secrets, not from a file in the
  repo: `ANDROID_KEYSTORE_BASE64` (the base64 of the `.keystore`) and
  `ANDROID_KEYSTORE_PASSWORD`, with the optional
  `ANDROID_KEYSTORE_ALIAS` (default `printninja`).

The keystore itself still has to be created once (the usual
`keytool -genkeypair` into a `.keystore`) and backed up: if it is lost,
no one can update an installed app. Until the Android phase is
finished, the established signing path is the Windows MSI above.

## Not the same thing: the Tauri updater key

Tauri's built-in auto-updater uses its own signing key
(`TAURI_SIGNING_PRIVATE_KEY`). PrintNinja does not use the updater — it
only shows an update badge that links to the release page (see
`docs/RELEASE.md`) — so no such key is needed. If the updater is added
later, generate a separate key; do not reuse the Windows `.pfx` or the
Android keystore for it.

## Checklist before each release

- [ ] `scripts/certs/` files exist and are not tracked by git
  (`git check-ignore scripts/certs/windows.pfx`)
- [ ] MSI signed, `signtool verify /pa /v` passes on a machine with the
  `.cer` installed
- [ ] The signed file replaced the unsigned one on the draft GitHub
  release
- [ ] The MSI was installed on one clean PC and the app opened
- [ ] (Android, once it lands) APK signed with the same keystore as the
  previous release, `apksigner verify` passes
