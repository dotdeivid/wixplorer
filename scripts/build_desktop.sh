#!/bin/bash
# Fase 2: Build script — genera binarios Mac y Windows
# Uso: ./build_desktop.sh
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT_DIR/dist_bin"

echo "==> 1/4  Compilando React..."
cd "$ROOT_DIR"
npm run build

echo "==> 0/4  Limpiando dist_bin/..."
rm -rf "$OUT"
mkdir -p "$OUT"

echo "==> 2/4  Generando recursos Windows (ícono + metadata)..."
~/go/bin/goversioninfo -icon="$ROOT_DIR/build/icon.ico" -o="$ROOT_DIR/resource.syso" "$ROOT_DIR/scripts/versioninfo.json"

echo "==> 3/4  Binario macOS (Universal: arm64 + amd64)..."
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o "$OUT/WiXplorer_mac_arm64" main.go
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o "$OUT/WiXplorer_mac_amd64" main.go
lipo -create -output "$OUT/WiXplorer_mac" \
  "$OUT/WiXplorer_mac_arm64" \
  "$OUT/WiXplorer_mac_amd64"
rm "$OUT/WiXplorer_mac_arm64" "$OUT/WiXplorer_mac_amd64"

echo "==> 4/4  Binario Windows (amd64)..."
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H windowsgui" \
  -o "$OUT/WiXplorer.exe" main.go

echo "==> 4/4  Armando WiXplorer.app..."
APP="$OUT/WiXplorer.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

cp "$OUT/WiXplorer_mac" "$APP/Contents/MacOS/WiXplorer"
chmod +x "$APP/Contents/MacOS/WiXplorer"
cp "$ROOT_DIR/build/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT_DIR/build/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

# Firma ad-hoc para reducir advertencias de Gatekeeper
codesign --deep --force --sign - "$APP" 2>/dev/null || true

# ZIP para distribución (preserva permisos de ejecución)
cd "$OUT" && zip -r --symlinks WiXplorer_mac.zip WiXplorer.app && cd "$ROOT_DIR"

echo "==> 5/5  Empaquetando para distribución (pendrive / descarga)..."
PKG="$OUT/WiXplorer_v1.0"
rm -rf "$PKG"
mkdir -p "$PKG/Mac" "$PKG/Windows"

# Mac: copiar el .app completo
cp -r "$APP" "$PKG/Mac/WiXplorer.app"

# Windows: copiar el .exe
cp "$OUT/WiXplorer.exe" "$PKG/Windows/WiXplorer.exe"

# Instrucciones de primer uso
cp "$ROOT_DIR/build/LEEME.txt" "$PKG/LEEME.txt"

# ZIP final listo para enviar / copiar al pendrive
cd "$OUT" && zip -r --symlinks WiXplorer_v1.0.zip WiXplorer_v1.0 && cd "$ROOT_DIR"
rm -rf "$PKG"

echo ""
echo "✓ Listo. Archivos generados en dist_bin/"
ls -lh "$OUT/"
