#!/bin/zsh
# Builds Keel.app for macOS from this repository.
#
#   ./app/macos/build.sh               build into build/ and install into /Applications   (npm run app)
#   ./app/macos/build.sh --no-install  build only
#
# The app runs Keel's server from this folder (so your data stays in data/ and code changes show up without
# rebuilding). Rebuild after changing anything in app/macos, or after moving the folder.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
APP="$ROOT/build/Keel.app"
RES="$APP/Contents/Resources"

command -v swiftc >/dev/null || { echo "Keel.app needs Xcode's command line tools: xcode-select --install"; exit 1; }
command -v node >/dev/null || { echo "Keel needs Node.js 20 or later: brew install node"; exit 1; }
[[ -d "$ROOT/node_modules/tsx" ]] || (cd "$ROOT" && npm install)

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES"
cp Info.plist "$APP/Contents/"
/usr/libexec/PlistBuddy -c "Add :KeelSourceFolder string $ROOT" "$APP/Contents/Info.plist"

# Icon, drawn from the Keel mark
TMP="$(mktemp -d)"
ICONSET="$TMP/AppIcon.iconset"
mkdir -p "$ICONSET"
swift make_icon.swift "$TMP/icon.png"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$TMP/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RES/AppIcon.icns"
rm -rf "$TMP"

# A universal binary for Apple Silicon and Intel Macs
swiftc -O -target arm64-apple-macos13.0  -o "$APP/Contents/MacOS/Keel-arm64"  Sources/main.swift
swiftc -O -target x86_64-apple-macos13.0 -o "$APP/Contents/MacOS/Keel-x86_64" Sources/main.swift
lipo -create -output "$APP/Contents/MacOS/Keel" "$APP/Contents/MacOS/Keel-arm64" "$APP/Contents/MacOS/Keel-x86_64"
rm "$APP/Contents/MacOS/Keel-arm64" "$APP/Contents/MacOS/Keel-x86_64"
codesign --force --deep --sign - "$APP"
echo "Built $APP (runs Keel from $ROOT)"

if [[ "${1:-}" != "--no-install" ]]; then
  pkill -x Keel 2>/dev/null || true
  rm -rf /Applications/Keel.app
  cp -R "$APP" /Applications/
  echo "Installed /Applications/Keel.app"
fi
