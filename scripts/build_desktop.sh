#!/bin/bash
# Fase 2: Build script — genera binarios Mac y Windows
# Uso: ./build_desktop.sh
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT_DIR/dist_bin"

echo "==> 1/6  Limpiando dist_bin/..."
rm -rf "$OUT"
mkdir -p "$OUT"

echo "==> 2/6  Compilando React..."
cd "$ROOT_DIR"
npm run build

echo "==> 3/6  Generando recursos Windows (ícono + metadata)..."
# El sufijo _windows_amd64 hace que Go enlace el .syso solo en ese target,
# así el build de macOS no lo toma. Se compila el paquete (.) y no main.go:
# con una lista de archivos Go ignora los .syso del directorio.
# resource.syso (sin sufijo) es el nombre viejo: se enlazaría en todos los
# targets y en Windows duplicaría los recursos.
rm -f "$ROOT_DIR/resource.syso"
~/go/bin/goversioninfo -64 -icon="$ROOT_DIR/build/icon.ico" -o="$ROOT_DIR/resource_windows_amd64.syso" "$ROOT_DIR/scripts/versioninfo.json"

echo "==> 4/6  Binario macOS (Universal: arm64 + amd64)..."
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o "$OUT/WiXplorer_mac_arm64" .
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o "$OUT/WiXplorer_mac_amd64" .
lipo -create -output "$OUT/WiXplorer_mac" \
  "$OUT/WiXplorer_mac_arm64" \
  "$OUT/WiXplorer_mac_amd64"
rm "$OUT/WiXplorer_mac_arm64" "$OUT/WiXplorer_mac_amd64"

echo "==> 5/6  Binario Windows (amd64)..."
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H windowsgui" \
  -o "$OUT/WiXplorer.exe" .

echo "==> 6/6  Armando WiXplorer.app y paquete de distribución..."
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

# Paquete para distribución (pendrive / descarga)
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
