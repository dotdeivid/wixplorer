#!/bin/bash
# Compila el launcher de escritorio (Go) → WiXplorer.app (macOS Universal) y
# WiXplorer.exe (Windows), con la web embebida. Requiere macOS (lipo, codesign)
# y goversioninfo en ~/go/bin.
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

echo "==> 1/6  Limpiando launcher/dist_bin/..."
rm -rf "$OUT"
mkdir -p "$OUT"

if [ "${SKIP_WEB_BUILD:-}" = "1" ]; then
  echo "==> 2/6  Usando la web ya compilada en launcher/dist..."
  if [ ! -f "$LAUNCHER_DIR/dist/index.html" ]; then
    echo "Error: launcher/dist/index.html no existe (SKIP_WEB_BUILD=1)." >&2
    exit 1
  fi
else
  echo "==> 2/6  Compilando la web y copiándola al launcher..."
  cd "$WEB_DIR"
  npm run build
  # go:embed no puede leer fuera del paquete: la web va a launcher/dist
  rm -rf "$LAUNCHER_DIR/dist"
  cp -r "$WEB_DIR/dist" "$LAUNCHER_DIR/dist"
fi

echo "==> 3/6  Generando recursos Windows (ícono + metadata)..."
# El sufijo _windows_amd64 hace que Go enlace el .syso solo en ese target,
# así el build de macOS no lo toma. Se compila el paquete (.) y no main.go:
# con una lista de archivos Go ignora los .syso del directorio.
cd "$LAUNCHER_DIR"
~/go/bin/goversioninfo -64 -icon="$PACKAGING/icon.ico" -o="$LAUNCHER_DIR/resource_windows_amd64.syso" "$PACKAGING/versioninfo.json"

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
cp "$PACKAGING/Info.plist" "$APP/Contents/Info.plist"
cp "$PACKAGING/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

# Firma ad-hoc para reducir advertencias de Gatekeeper
codesign --deep --force --sign - "$APP" 2>/dev/null || true

# ZIP para distribución (preserva permisos de ejecución)
cd "$OUT" && zip -r --symlinks WiXplorer_mac.zip WiXplorer.app && cd "$LAUNCHER_DIR"

# Paquete para distribución (pendrive / descarga)
PKG="$OUT/WiXplorer_v1.0"
rm -rf "$PKG"
mkdir -p "$PKG/Mac" "$PKG/Windows"

# Mac: copiar el .app completo
cp -r "$APP" "$PKG/Mac/WiXplorer.app"

# Windows: copiar el .exe
cp "$OUT/WiXplorer.exe" "$PKG/Windows/WiXplorer.exe"

# Instrucciones de primer uso
cp "$PACKAGING/LEEME.txt" "$PKG/LEEME.txt"

# ZIP final listo para enviar / copiar al pendrive
cd "$OUT" && zip -r --symlinks WiXplorer_v1.0.zip WiXplorer_v1.0 && cd "$LAUNCHER_DIR"
rm -rf "$PKG"

echo ""
echo "✓ Listo. Archivos generados en launcher/dist_bin/"
ls -lh "$OUT/"
