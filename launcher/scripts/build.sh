#!/bin/bash
# Compila el launcher de escritorio (Go) → WiXplorer.app (macOS Universal),
# con la web embebida. Requiere macOS (lipo, codesign).
#
# Solo macOS: es el sistema que no lee Android por USB de forma nativa. En
# Windows el Explorador ya muestra el teléfono, y Chrome no puede usar WebUSB
# con un dispositivo tomado por el driver MTP del sistema; ahí se usa el modo
# WiFi.
#
# Uso: launcher/scripts/build.sh   (o `make desktop` desde la raíz)
#
# SKIP_WEB_BUILD=1 usa la web que ya está en launcher/dist en lugar de
# compilarla (lo usa release.yml, que la recibe compilada de otro job).
set -e

LAUNCHER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$LAUNCHER_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"
PACKAGING="$LAUNCHER_DIR/packaging"
OUT="$LAUNCHER_DIR/dist_bin"

echo "==> 1/4  Limpiando launcher/dist_bin/..."
rm -rf "$OUT"
mkdir -p "$OUT"

if [ "${SKIP_WEB_BUILD:-}" = "1" ]; then
  echo "==> 2/4  Usando la web ya compilada en launcher/dist..."
  if [ ! -f "$LAUNCHER_DIR/dist/index.html" ]; then
    echo "Error: launcher/dist/index.html no existe (SKIP_WEB_BUILD=1)." >&2
    exit 1
  fi
else
  echo "==> 2/4  Compilando la web y copiándola al launcher..."
  cd "$WEB_DIR"
  npm run build
  # go:embed no puede leer fuera del paquete: la web va a launcher/dist
  rm -rf "$LAUNCHER_DIR/dist"
  cp -r "$WEB_DIR/dist" "$LAUNCHER_DIR/dist"
fi

cd "$LAUNCHER_DIR"

echo "==> 3/4  Binario macOS (Universal: arm64 + amd64)..."
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o "$OUT/WiXplorer_mac_arm64" .
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o "$OUT/WiXplorer_mac_amd64" .
lipo -create -output "$OUT/WiXplorer_mac" \
  "$OUT/WiXplorer_mac_arm64" \
  "$OUT/WiXplorer_mac_amd64"
rm "$OUT/WiXplorer_mac_arm64" "$OUT/WiXplorer_mac_amd64"

echo "==> 4/4  Armando WiXplorer.app y paquete de distribución..."
APP="$OUT/WiXplorer.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

cp "$OUT/WiXplorer_mac" "$APP/Contents/MacOS/WiXplorer"
chmod +x "$APP/Contents/MacOS/WiXplorer"
cp "$PACKAGING/Info.plist" "$APP/Contents/Info.plist"
cp "$PACKAGING/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

# Firma ad-hoc para reducir advertencias de Gatekeeper
codesign --deep --force --sign - "$APP" 2>/dev/null || true

# ZIP para distribución (preserva permisos de ejecución)
cd "$OUT" && zip -r --symlinks WiXplorer_mac.zip WiXplorer.app && cd "$LAUNCHER_DIR"

# Paquete para distribución (pendrive / descarga)
PKG="$OUT/WiXplorer_v1.0"
rm -rf "$PKG"
mkdir -p "$PKG"

# El .app completo
cp -r "$APP" "$PKG/WiXplorer.app"

# Instrucciones de primer uso
cp "$PACKAGING/LEEME.txt" "$PKG/LEEME.txt"

# ZIP final listo para enviar / copiar al pendrive
cd "$OUT" && zip -r --symlinks WiXplorer_v1.0.zip WiXplorer_v1.0 && cd "$LAUNCHER_DIR"
rm -rf "$PKG"

echo ""
echo "✓ Listo. Archivos generados en launcher/dist_bin/"
ls -lh "$OUT/"
