# Android release signing key

The shared keystore the `android-build` tag job signs every release APK/AAB
with (see `scripts/patch-android-signing.mjs`). Kept in the repo on purpose:
it is the single source of truth, and the GitHub secrets are only its copy.

| File | Meaning |
| --- | --- |
| `printninja.keystore` | PKCS12 keystore, RSA-2048, alias `printninja` (~27 year validity) |
| `keystore-password.txt` | Store password; the key password is the same |
| `printninja.keystore.b64` | `base64 -w 0 printninja.keystore` — the value of the `ANDROID_KEYSTORE_BASE64` secret |

## GitHub secrets (repo: PrintNinja-Next)

- `ANDROID_KEYSTORE_BASE64` = the `.b64` file's content
- `ANDROID_KEYSTORE_PASSWORD` = the password file's content (no trailing newline)

## Rotating the key (only before any signed release ships)

Once a release signed with this key is installed on phones, the key can no
longer be replaced — Android refuses updates from a different signer.

1. Generate a new keystore (same shape):
   `keytool -genkeypair -storetype PKCS12 -keystore printninja.keystore -alias printninja -keyalg RSA -keysize 2048 -validity 10000 -storepass <pw> -keypass <pw> -dname "CN=PrintNinja, OU=PrintNinja, O=PrintNinja, L=Dhaka, ST=Dhaka, C=BK"`
2. `base64 -w 0 printninja.keystore > printninja.keystore.b64`
3. Replace the three files here, commit.
4. Re-set both GitHub secrets from the new files.
