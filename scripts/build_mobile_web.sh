#!/bin/bash
# Fase 1: Pipeline React → Flutter assets
# Compila la web y la copia como assets embebidos en la app Flutter.
# Uso: ./build_mobile_web.sh
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
ASSETS_WEB="$ROOT_DIR/mobile/assets/www"

echo "==> 1/2  Compilando React..."
cd "$ROOT_DIR"
npm run build

echo "==> 2/2  Copiando dist/ → mobile/assets/www/"
rm -rf "$ASSETS_WEB"
mkdir -p "$ASSETS_WEB"
cp -r "$DIST_DIR/." "$ASSETS_WEB/"

echo ""
echo "✓ Listo. Archivos web embebidos en mobile/assets/www/"
echo ""
echo "Para probar en el dispositivo:"
echo "  cd mobile && flutter run"
echo ""
echo "Para generar APK de release:"
echo "  cd mobile && flutter build apk --release"
