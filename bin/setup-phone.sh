#!/data/data/com.termux/files/usr/bin/bash
# Set up live-call-assistant's phone transcription in Termux (docs/phone.md).
#
#   bash bin/setup-phone.sh [model]
#
# Installs ffmpeg and the build tools, builds whisper.cpp in ~/whisper.cpp, downloads a Whisper model
# (default: small; see docs/phone.md for others) and sets "source": "phone" in
# ~/.live-call-assistant/config.json. Safe to run again: finished steps are skipped.
set -euo pipefail

MODEL="${1:-small}"
LCA="$(cd "$(dirname "$0")/.." && pwd)"
WHISPER="$HOME/whisper.cpp"

if [ -z "${PREFIX:-}" ] || [ ! -d /data/data/com.termux ]; then
  echo "Run this in Termux (not inside proot or on a computer)." >&2
  exit 1
fi

echo "== Packages"
pkg install -y ffmpeg cmake clang git nodejs

if [ ! -d "$HOME/storage/shared" ]; then
  echo "== Storage access: allow it in the dialog that opens"
  termux-setup-storage
  sleep 5
fi

echo "== whisper.cpp"
if [ ! -d "$WHISPER" ]; then
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$WHISPER"
fi
if [ ! -x "$WHISPER/build/bin/whisper-cli" ]; then
  cmake -S "$WHISPER" -B "$WHISPER/build" -DCMAKE_BUILD_TYPE=Release -DWHISPER_SDL2=OFF -DWHISPER_BUILD_TESTS=OFF
  cmake --build "$WHISPER/build" -j "$(nproc)" --config Release --target whisper-cli
fi

echo "== Whisper model: $MODEL"
if [ ! -f "$WHISPER/models/ggml-$MODEL.bin" ]; then
  bash "$WHISPER/models/download-ggml-model.sh" "$MODEL"
fi

echo "== Config"
node -e '
const fs = require("fs"), path = require("path");
const dir = process.env.LCA_DATA_DIR || path.join(require("os").homedir(), ".live-call-assistant");
const f = path.join(dir, "config.json");
let c = {};
try { c = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
c.source = "phone";
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
console.log("source = phone in " + f);
'

echo
node "$LCA/bin/phone.mjs" check
