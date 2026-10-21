#!/bin/zsh
# Builds Daybook.app for macOS from this repository.
#
#   ./app/macos/build.sh               build into build/, install into /Applications and open it   (npm run app)
#   ./app/macos/build.sh --no-install  build only
#
# The app runs Daybook's server from this folder (so your data stays in data/ and code changes show up without
# rebuilding). Rebuild after changing anything in app/macos, or after moving the folder.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
APP="$ROOT/build/Daybook.app"
RES="$APP/Contents/Resources"

command -v swiftc >/dev/null || { echo "Daybook.app needs Xcode's command line tools: xcode-select --install"; exit 1; }
command -v node >/dev/null || { echo "Daybook needs Node.js 20 or later: brew install node"; exit 1; }
[[ -d "$ROOT/node_modules/tsx" ]] || (cd "$ROOT" && npm install)

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES"
cp Info.plist "$APP/Contents/"
/usr/libexec/PlistBuddy -c "Add :KeelSourceFolder string $ROOT" "$APP/Contents/Info.plist"

# Icon, drawn from the Daybook mark (web/icon.svg)
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
swiftc -O -target arm64-apple-macos13.0  -o "$APP/Contents/MacOS/Daybook-arm64"  Sources/main.swift
swiftc -O -target x86_64-apple-macos13.0 -o "$APP/Contents/MacOS/Daybook-x86_64" Sources/main.swift
lipo -create -output "$APP/Contents/MacOS/Daybook" "$APP/Contents/MacOS/Daybook-arm64" "$APP/Contents/MacOS/Daybook-x86_64"
rm "$APP/Contents/MacOS/Daybook-arm64" "$APP/Contents/MacOS/Daybook-x86_64"
codesign --force --deep --sign - "$APP"
echo "Built $APP (runs Daybook from $ROOT)"

if [[ "${1:-}" != "--no-install" ]]; then
  # Quit a running copy the normal way so it stops the server it started
  # (Keel is the app's old name: replace that copy too, so there's one app, not two.)
  if pgrep -x Daybook >/dev/null || pgrep -x Keel >/dev/null; then
    osascript -e 'tell application id "local.keel.money" to quit' >/dev/null 2>&1 || true
    sleep 1
  fi
  pkill -x Daybook 2>/dev/null || true
  pkill -x Keel 2>/dev/null || true
  rm -rf /Applications/Daybook.app /Applications/Keel.app
  cp -R "$APP" /Applications/
  echo "Installed /Applications/Daybook.app"
  open /Applications/Daybook.app
fi
