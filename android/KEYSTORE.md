# Android release keystore (NOT in git)

The signed release APK is produced with a keystore that **must never be committed**.

## Local (this agent / Alex's build machine)

| Item | Path |
|------|------|
| Keystore | `~/.config/agent-progress/android-release.keystore` |
| Gradle props | `~/.config/agent-progress/keystore.properties` |
| Cert SHA-256 | `~/.config/agent-progress/cert-sha256.txt` |

`keystore.properties` format:

```
storeFile=/home/YOU/.config/agent-progress/android-release.keystore
storePassword=…
keyAlias=agent-progress
keyPassword=…
```

Generate a new keystore (only if starting fresh — changing it requires updating Digital Asset Links):

```bash
mkdir -p ~/.config/agent-progress
keytool -genkeypair -v \
  -keystore ~/.config/agent-progress/android-release.keystore \
  -alias agent-progress \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass '…' -keypass '…' \
  -dname "CN=Agent Progress, OU=Brown Industries, O=Brown Industries, C=US"
```

Then refresh `web-public/.well-known/assetlinks.json` with the new SHA-256 fingerprint
(`keytool -list -v -keystore … | grep SHA256`).

## GitHub Actions

Store these repository secrets (Settings → Secrets):

- `ANDROID_KEYSTORE_BASE64` — `base64 -w0 android-release.keystore`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS` (usually `agent-progress`)
- `ANDROID_KEY_PASSWORD`

The workflow writes the keystore to a temp path and signs the release APK; the APK is uploaded as a workflow artifact named `agent-progress.apk`.
