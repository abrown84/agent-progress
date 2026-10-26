#!/usr/bin/env bash
# Build signed release APK + OTA manifest into dist-web/android/ for VPS deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="$ROOT/android"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"

bash "$ANDROID_DIR/scripts/build-release.sh"

APK="$ROOT/artifacts/agent-progress.apk"
VERSION_CODE=$(python3 - <<PY
import re
from pathlib import Path
text = Path("$ANDROID_DIR/app/build.gradle").read_text()
m = re.search(r"versionCode\s+(\d+)", text)
print(m.group(1) if m else "0")
PY
)
VERSION_NAME=$(python3 - <<PY
import re
from pathlib import Path
text = Path("$ANDROID_DIR/app/build.gradle").read_text()
m = re.search(r'versionName\s+"([^"]+)"', text)
print(m.group(1) if m else "0")
PY
)
SHA=$(sha256sum "$APK" | awk '{print $1}')
OUT_DIR="$ROOT/dist-web/android"
mkdir -p "$OUT_DIR" "$ROOT/artifacts"
cp "$APK" "$OUT_DIR/agent-progress.apk"
cat > "$OUT_DIR/latest.json" <<EOF
{
  "versionCode": ${VERSION_CODE},
  "versionName": "${VERSION_NAME}",
  "url": "https://progress.brwnindustries.com/android/agent-progress.apk",
  "sha256": "${SHA}"
}
EOF
cp "$OUT_DIR/latest.json" "$ROOT/artifacts/latest.json"
echo "Published OTA manifest:"
cat "$OUT_DIR/latest.json"
echo "Copy dist-web/android/ onto the VPS (or rebuild the Docker image that includes PUBLIC_WEB_DIR)."
