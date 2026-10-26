#!/usr/bin/env bash
# Build a signed release APK and copy it to artifacts/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="$ROOT/android"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"

if [ ! -d "$ANDROID_HOME" ]; then
  echo "ANDROID_HOME not found at $ANDROID_HOME" >&2
  exit 1
fi

if [ ! -f "$HOME/.config/agent-progress/keystore.properties" ] \
  && [ -z "${ANDROID_KEYSTORE_PATH:-}" ]; then
  echo "Missing keystore. See android/KEYSTORE.md" >&2
  exit 1
fi

echo "sdk.dir=$ANDROID_HOME" > "$ANDROID_DIR/local.properties"
cd "$ANDROID_DIR"
chmod +x ./gradlew
./gradlew assembleRelease --no-daemon

APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
mkdir -p "$ROOT/artifacts" "$ROOT/dist-web/android"
cp "$APK" "$ROOT/artifacts/agent-progress.apk"
cp "$APK" "$ROOT/dist-web/android/agent-progress.apk"
if [ -d /opt/cursor/artifacts ]; then
  cp "$APK" /opt/cursor/artifacts/agent-progress.apk
fi
echo "Signed APK: $APK"
echo "Copied to artifacts/agent-progress.apk"
ls -lah "$ROOT/artifacts/agent-progress.apk"
