# Agent Progress — native Android app

Kotlin + WebView shell (no Chrome / TWA dependency) for package
`com.brwnindustries.agentprogress`.

- UI loads live from `https://progress.brwnindustries.com` (OTA for web features)
- Native push via **Firebase Cloud Messaging**
- Native OTA for APK bumps: checks `/android/latest.json`, verifies SHA-256, prompts install
- Same release keystore as v1.0.0 (`versionCode` 2+)

## Build

```bash
# Keystore outside git — see KEYSTORE.md / Agent Store secrets/
export ANDROID_HOME=$HOME/android-sdk
npm run build:android          # signed APK → artifacts/agent-progress.apk
npm run publish:android        # APK + latest.json → dist-web/android/
cd android && ./gradlew test   # unit tests
```

## Firebase

See [FIREBASE.md](./FIREBASE.md). Placeholder `google-services.json` builds the APK;
replace with Alex’s real Firebase Android config before production FCM.

## Install / update

1. Install APK (sideload or OTA prompt).
2. Sign in → **Enable notifications** → allow → **Send test notification**.
3. Later native builds: app prompts when `latest.json` has a higher `versionCode`.
