# Generación de iconos

El archivo `icon.svg` contiene el diseño fuente del icono (fondo azul #2F7FF5, ícono swap blanco).

## Pasos para generar los PNGs

1. Convertir `icon.svg` a `icon.png` (1024×1024 px):
   ```bash
   # Con Inkscape (CLI):
   inkscape icon.svg --export-png=icon.png --export-width=1024 --export-height=1024

   # Con rsvg-convert:
   rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png

   # O abrir en Figma / Sketch / cualquier editor vectorial y exportar a 1024×1024 PNG
   ```

2. Crear `icon_foreground.png` (solo el ícono swap blanco sobre fondo transparente, 1024×1024 px):
   Igual que `icon.svg` pero sin el `<rect>` de fondo.

3. Generar todos los tamaños:
   ```bash
   cd mobile
   flutter pub get
   flutter pub run flutter_launcher_icons
   ```

## Notas

- En Android 8+ (API 26) el ícono adaptativo se usa directamente desde los XMLs en `mipmap-anydpi-v26/` — no necesita PNGs.
- Los PNGs en `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/` son para Android < 8 y la pantalla de carga del launcher.
- En iOS todos los tamaños se generan desde el PNG fuente de 1024×1024.
