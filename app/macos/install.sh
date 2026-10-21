#!/bin/zsh
# Downloads (or updates) Daybook into ~/keel, builds the Mac app, installs it into /Applications and opens it.
#
#   curl -fsSL https://raw.githubusercontent.com/bollineni-create/keel/main/app/macos/install.sh | zsh
#
# Running it again updates and reinstalls. Your data (data/) and settings (.env) are never touched.
set -euo pipefail
DIR="${KEEL_DIR:-$HOME/keel}"

if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  echo "Install Apple's command-line tools in the window that just opened, then run this command again."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install node
  else
    echo "Daybook needs Node.js 20 or later. Install it from https://nodejs.org (or Homebrew), then run this command again."
    exit 1
  fi
fi

if [[ -d "$DIR/.git" ]]; then
  git -C "$DIR" fetch --quiet origin main
  git -C "$DIR" checkout --quiet main
  git -C "$DIR" merge --ff-only --quiet origin/main
else
  git clone --quiet --branch main https://github.com/bollineni-create/keel.git "$DIR"
fi

[[ -f "$DIR/.env" ]] || cp "$DIR/.env.example" "$DIR/.env"
(cd "$DIR" && npm install --no-audit --no-fund)

"$DIR/app/macos/build.sh"
