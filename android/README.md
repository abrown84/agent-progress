# Agent Progress — Android (TWA)

Trusted Web Activity wrapping `https://progress.brwnindustries.com`.  
Same web dashboard + **Web Push** (no Firebase required). Brown Industries icon + splash.

## Why TWA

- Real installable APK with app icon / splash
- Notifications use the existing VAPID Web Push path (already working on the server)
- Tap notification → opens the dashboard (deep link includes `task` / `agent` query)
- Web dashboard and desktop overlay stay unchanged

## Prerequisites

- JDK 17+ (21 works)
- Android SDK (`platforms;android-34`, `build-tools;34.0.0`)
- Release keystore **outside the repo** — see [KEYSTORE.md](./KEYSTORE.md)

## Build signed release APK

```bash
export ANDROID_HOME=$HOME/android-sdk   # or your SDK path
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

cd android
./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

Or from repo root:

```bash
npm run build:android
```

## Install on a phone

1. Copy `app-release.apk` to the phone (USB, Drive, or download from  
   `https://progress.brwnindustries.com/android/agent-progress.apk` after deploy packages it).
2. Open the APK → allow “Install unknown apps” if prompted.
3. Open **Agent Progress** → sign in → **Enable notifications** → allow.
4. Tap **Send test notification**.

Chrome must be installed (TWA uses it). After Digital Asset Links verify, the app is a fullscreen TWA without the URL bar.

## Digital Asset Links (deploy)

`web-public/.well-known/assetlinks.json` must list this package + the **release** cert SHA-256.  
Redeploy the web/server image so `https://progress.brwnindustries.com/.well-known/assetlinks.json` is live. Verify:

```bash
curl -sS https://progress.brwnindustries.com/.well-known/assetlinks.json
# optional: https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://progress.brwnindustries.com&relation=delegate_permission/common.handle_all_urls
```

No Firebase project is required for push. Optional BRWN Text relay remains a server env config.
