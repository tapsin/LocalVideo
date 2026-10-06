#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENMONTAGE_DIR="${OPENMONTAGE_DIR:-$HOME/Projeler/OpenMontage}"
COMFY_ROOT="${COMFY_ROOT:-$HOME/ComfyUI-Installs/ComfyUI/ComfyUI}"
if [[ ! -f "$COMFY_ROOT/main.py" ]]; then COMFY_ROOT="$APP_DIR/vendor/ComfyUI"; fi
mkdir -p "$APP_DIR/vendor/bin" "$APP_DIR/work/setup"
export PATH="$APP_DIR/vendor/bin:$APP_DIR/vendor/ollama/bin:$PATH"
setup_note() { echo; echo "[Video Kolay kurulum] $*"; }
setup_comfy() {
  if [[ ! -f "$COMFY_ROOT/main.py" ]]; then
    setup_note "ComfyUI eksik; resmi kaynaktan indiriliyor."
    mkdir -p "$(dirname "$COMFY_ROOT")"
    git clone --depth 1 https://github.com/Comfy-Org/ComfyUI.git "$COMFY_ROOT"
  fi
  if [[ ! -x "$COMFY_ROOT/.venv/bin/python" ]]; then
    setup_note "ComfyUI için ayrı Python ortamı hazırlanıyor."
    python3 -m venv "$COMFY_ROOT/.venv"
  fi
  if [[ ! -f "$COMFY_ROOT/.venv/.video-kolay-deps-ready" ]]; then
    if "$COMFY_ROOT/.venv/bin/python" -c 'import torch, sqlalchemy, comfy' >/dev/null 2>&1; then
      touch "$COMFY_ROOT/.venv/.video-kolay-deps-ready"
    else
      setup_note "ComfyUI yerel bağımlılıkları kuruluyor (ilk açılışta birkaç GB olabilir)."
      "$COMFY_ROOT/.venv/bin/python" -m pip install --upgrade pip
      "$COMFY_ROOT/.venv/bin/python" -m pip install -r "$COMFY_ROOT/requirements.txt"
      touch "$COMFY_ROOT/.venv/.video-kolay-deps-ready"
    fi
  fi
}
setup_ollama() {
  if ! command -v ollama >/dev/null 2>&1 && ! curl -fsS "${OLLAMA_URL:-http://127.0.0.1:11434}/api/tags" >/dev/null 2>&1; then
    setup_note "Ollama eksik; resmi Linux paketi uygulama klasörüne indiriliyor (yaklaşık 1,3 GB)."
    local ollama_dir="$APP_DIR/vendor/ollama"
    local ollama_arch; case "$(uname -m)" in x86_64) ollama_arch=amd64;; aarch64|arm64) ollama_arch=arm64;; *) echo "Ollama bu işlemci mimarisinde otomatik kurulamıyor."; return 0;; esac
    mkdir -p "$ollama_dir"
    curl -fL --retry 3 "https://ollama.com/download/ollama-linux-${ollama_arch}.tar.zst" | tar --zstd -xf - -C "$ollama_dir"
    [[ -x "$ollama_dir/bin/ollama" ]] || { echo "Ollama paketi açılamadı."; return 1; }
    export PATH="$ollama_dir/bin:$PATH"
  fi
  if ! curl -fsS "${OLLAMA_URL:-http://127.0.0.1:11434}/api/tags" >/dev/null 2>&1; then
    setup_note "Ollama yerel servisi başlatılıyor."
    OLLAMA_HOST=127.0.0.1:11434 ollama serve >"$APP_DIR/work/setup/ollama.log" 2>&1 & OLLAMA_PID=$!
    for _ in $(seq 1 60); do curl -fsS "${OLLAMA_URL:-http://127.0.0.1:11434}/api/tags" >/dev/null 2>&1 && break; sleep 1; done
  fi
  if curl -fsS "${OLLAMA_URL:-http://127.0.0.1:11434}/api/tags" | rg -q 'qwen3\.5:2b'; then return; fi
  setup_note "Varsayılan yerel sahne planı modeli qwen3.5:2b kontrol ediliyor/indiriliyor."
  OLLAMA_HOST=127.0.0.1:11434 ollama pull qwen3.5:2b
}
setup_ffmpeg() {
  if command -v ffmpeg >/dev/null 2>&1; then return; fi
  local asset
  case "$(uname -m)" in x86_64) asset='ffmpeg-master-latest-linux64-gpl.tar.xz';; aarch64|arm64) asset='ffmpeg-master-latest-linuxarm64-gpl.tar.xz';; *) echo "FFmpeg otomatik indirme bu işlemci mimarisinde desteklenmiyor."; return 0;; esac
  setup_note "FFmpeg eksik; statik yerel kopyası indiriliyor."
  local archive="$APP_DIR/work/setup/ffmpeg.tar.xz" url
  url="$(curl -fsSL https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest | python3 -c 'import json,sys; name=sys.argv[1]; print(next((x["browser_download_url"] for x in json.load(sys.stdin).get("assets",[]) if x.get("name")==name),""))' "$asset")"
  [[ -n "$url" ]] || { echo "FFmpeg indirme adresi bulunamadı; ffmpeg'i sistem paket yöneticinizle kurun."; return 0; }
  curl -fL --retry 3 "$url" -o "$archive"
  local unpack="$APP_DIR/work/setup/ffmpeg-unpack"; rm -rf "$unpack"; mkdir -p "$unpack"; tar -xJf "$archive" -C "$unpack"
  local binary; binary="$(find "$unpack" -type f -name ffmpeg -print -quit)"; [[ -n "$binary" ]] || { echo "İndirilen FFmpeg arşivinde çalıştırılabilir dosya bulunamadı."; return 1; }
  cp "$binary" "$APP_DIR/vendor/bin/ffmpeg"; chmod +x "$APP_DIR/vendor/bin/ffmpeg"
  local probe; probe="$(find "$unpack" -type f -name ffprobe -print -quit || true)"; [[ -z "$probe" ]] || { cp "$probe" "$APP_DIR/vendor/bin/ffprobe"; chmod +x "$APP_DIR/vendor/bin/ffprobe"; }
}
setup_comfy
setup_ollama
setup_ffmpeg
ensure_model() {
  local folder="$1" name="$2" url="$3"
  mkdir -p "$COMFY_ROOT/models/$folder"
  if [[ -s "$COMFY_ROOT/models/$folder/$name" ]]; then return; fi
  echo "Yerel Wan modeli indiriliyor: $name"
  if command -v aria2c >/dev/null 2>&1; then
    aria2c -c -x 8 -s 8 --file-allocation=none -d "$COMFY_ROOT/models/$folder" -o "$name" "$url"
  else
    curl -fL --retry 5 "$url" -o "$COMFY_ROOT/models/$folder/$name"
  fi
}
ensure_model diffusion_models wan2.1_t2v_1.3B_fp16.safetensors 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors'
ensure_model text_encoders umt5_xxl_fp8_e4m3fn_scaled.safetensors 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors'
ensure_model vae wan_2.1_vae.safetensors 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors'
if [[ ! -f "$APP_DIR/node_modules/.video-kolay-deps-ready" || ! -d "$APP_DIR/node_modules/@remotion/renderer" ]]; then
  setup_note "Video düzenleme/render bağımlılıkları kuruluyor."
  rm -rf "$APP_DIR/node_modules"
  (cd "$APP_DIR" && npm install --omit=dev)
  touch "$APP_DIR/node_modules/.video-kolay-deps-ready"
fi
if [[ ! -x "$APP_DIR/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell" ]]; then
  setup_note "Remotion video çalışma bileşeni denetleniyor/indiriliyor."
  (cd "$APP_DIR" && node "$APP_DIR/node_modules/@remotion/cli/remotion-cli.js" browser ensure)
  touch "$APP_DIR/work/setup/remotion-browser-ready"
fi
export OPENMONTAGE_DIR COMFY_ROOT
cd "$APP_DIR"
COMFY_PID="" OLLAMA_PID=""
if ! curl -fsS "${COMFY_URL:-http://127.0.0.1:8188}/system_stats" >/dev/null 2>&1; then
  if [[ -x "$COMFY_ROOT/.venv/bin/python" && -f "$COMFY_ROOT/main.py" ]]; then
    (cd "$COMFY_ROOT" && ./.venv/bin/python main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch) >"$APP_DIR/work/setup/comfy.log" 2>&1 & COMFY_PID=$!
    for _ in $(seq 1 90); do curl -fsS "${COMFY_URL:-http://127.0.0.1:8188}/system_stats" >/dev/null 2>&1 && break; sleep 1; done
  fi
fi
node server.mjs & SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; if [[ -n "$COMFY_PID" ]]; then kill "$COMFY_PID" 2>/dev/null || true; fi' EXIT
sleep 1
if [[ "${VIDEO_KOLAY_NO_OPEN:-0}" != 1 ]]; then xdg-open "http://127.0.0.1:${PORT:-4177}" >/dev/null 2>&1 || true; fi
wait "$SERVER_PID"
