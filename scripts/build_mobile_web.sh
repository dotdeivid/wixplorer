#!/bin/bash
# Compila la web y la copia como assets embebidos en la app Flutter.
# Uso: ./scripts/build_mobile_web.sh
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"
ASSETS_WEB="$ROOT_DIR/mobile/assets/www"

echo "==> 1/2  Compilando la web (web/)..."
cd "$WEB_DIR"
npm run build

echo "==> 2/2  Copiando web/dist/ → mobile/assets/www/"
rm -rf "$ASSETS_WEB"
mkdir -p "$ASSETS_WEB"
cp -r "$WEB_DIR/dist/." "$ASSETS_WEB/"

echo ""
echo "✓ Listo. Archivos web embebidos en mobile/assets/www/"
echo ""
echo "Para probar en el dispositivo:"
echo "  cd mobile && flutter run"
echo ""
echo "Para generar APK de release:"
echo "  cd mobile && flutter build apk --release"
