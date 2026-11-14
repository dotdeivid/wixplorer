# WiXplorer — Guía de desarrollo

Referencia rápida: qué hacer después de cada tipo de cambio para obtener los productos finales e instalarlos en cada dispositivo.

---

## Arquitectura del proyecto

```
wixplorer/
  web/                  ← App React (UI web) — se publica en GitHub Pages
  mobile/               ← App Flutter (servidor Android)
    scripts/build_web_assets.sh ← Build React → assets Flutter
  Makefile              ← Atajos para todo (`make help`)
```

### Dos modos de uso independientes

| Modo | Quién sirve la web | Requiere |
|------|-------------------|----------|
| **USB** (macOS) | GitHub Pages (`https://dotdeivid.github.io/wixplorer/`) | Chrome o Edge en la Mac; en el teléfono no hace falta la app |
| **WiFi** | Flutter en el teléfono | App Android instalada + browser en la PC |

### Decisiones de arquitectura

**No hay backend en Node.js.** Node solo existe como herramienta de desarrollo (Vite). El backend real del modo WiFi es el servidor Flutter que corre en el teléfono:

```
Navegador (React) ←→ GitHub Pages   (https, solo archivos estáticos)
Navegador (React) ←→ Flutter server (192.168.x.x:7070, API real)
Navegador (React) ←→ WebUSB         (MTP por USB, directo desde el browser)
```

| Responsabilidad | Quién la maneja |
|-----------------|-----------------|
| Autenticación (PIN + token) | `AuthService` en Flutter |
| Listado y acceso a archivos Android | `FileService` en Flutter |
| Streaming de video (Range requests) | `server_service.dart` en Flutter |
| Acceso MTP (Android por USB) | WebUSB, directamente en el browser |
| Servir la interfaz web para el modo USB | GitHub Pages (`.github/workflows/pages.yml`) |

**Por qué GitHub Pages para el modo USB.** WebUSB solo funciona en páginas seguras (`https://` o `localhost`). La página que sirve el teléfono (`http://192.168…`) no cuenta como segura, así que el modo USB necesita otra fuente. Pages la da por `https://`, sin que el usuario descargue nada, y se actualiza sola con cada merge a `main`. El modo USB está pensado para macOS, que no lee Android por cable de forma nativa; en Windows el Explorador ya muestra el teléfono y Chrome no puede usar WebUSB con el driver MTP del sistema, así que ahí se usa el modo WiFi.

**Alternativas descartadas:**
- **Launcher de escritorio (Go)** — existió hasta noviembre de 2026: servía la web en `localhost` desde un `.app`. Se reemplazó por Pages, que no requiere descargar ni firmar nada.
- **Tauri** — en macOS usa WKWebView, que no soporta WebUSB; el modo MTP dejaría de funcionar.
- **Electron** — ~150 MB por el Chromium embebido para servir archivos estáticos.

**Rendimiento.** Servir la web no influye en las transferencias. El cuello de botella es siempre la WiFi, el servidor Flutter leyendo del almacenamiento Android y el browser procesando los blobs. Las optimizaciones de red van en Flutter (Range requests, compresión desactivada para no romperlos).

---

## Desarrollo día a día

### Servidor de desarrollo React

```bash
cd web && npm run dev     # o: make dev
```

Abre `http://localhost:5173`. Hot reload automático. Ideal para trabajar en la UI sin compilar.

> En modo dev el servidor corre en `localhost` → modo USB activo, modo WiFi no disponible (es esperado).

### Probar la app Flutter en el teléfono (modo WiFi)

```bash
cd mobile && flutter run
```

Hot reload con `r`, reinicio con `R`. La URL aparece en pantalla.

---

## Escenario 1 — Cambié código React

### → Versión web (modo USB)

No hay que hacer nada: al mergear a `main`, `pages.yml` la compila y la publica en GitHub Pages. Para probar antes, `make dev`.

### → App Android (modo WiFi con web embebida)

```bash
make mobile-assets
cd mobile && flutter build apk --release
```

`make mobile-assets` compila React y copia el resultado a `mobile/assets/www/`. Luego Flutter embebe esos assets en el APK.

---

## Escenario 2 — Cambié código Flutter

### → App Android

```bash
cd mobile && flutter build apk --release
```

No hace falta recompilar React si no tocaste la UI web.

### Instalar directamente en el teléfono conectado por USB

```bash
cd mobile && flutter install
```

---

## Escenario 3 — Cambié ambos (React + Flutter)

```bash
make mobile-assets          # 1. Compila React y lo copia a Flutter
cd mobile && flutter build apk --release   # 2. Genera el APK con la web nueva
```

---

## Productos finales

| Producto | Ruta | Cómo se genera |
|---------|------|----------------|
| Versión web (modo USB) | https://dotdeivid.github.io/wixplorer/ | `pages.yml`, automático al mergear a `main` |
| APK Android | `mobile/build/app/outputs/flutter-apk/app-release.apk` | `cd mobile && flutter build apk --release` |

---

## Instalación en cada dispositivo

### Mac / Windows / Linux

No se instala nada en la computadora:
- **WiFi:** entrar desde el navegador a la dirección que muestra la app del teléfono.
- **USB (Mac, Chrome o Edge):** entrar a https://dotdeivid.github.io/wixplorer/.

### Android

```bash
# Instalar directamente si el teléfono está conectado por USB
cd mobile && flutter install

# O instalar el APK manualmente
adb install mobile/build/app/outputs/flutter-apk/app-release.apk
```

También se puede copiar el `.apk` al teléfono y abrirlo desde el explorador de archivos (requiere activar "Orígenes desconocidos" en Ajustes → Seguridad).

---

## Referencia de scripts

Desde la raíz, `make help` lista todos los atajos.

| Comando | Qué hace |
|--------|----------|
| `make dev` (`cd web && npm run dev`) | Servidor de desarrollo React (hot reload) |
| `make build` (`cd web && npm run build`) | Compila React → `web/dist/` |
| `make lint` / `make test` | ESLint y tests unitarios de la web (vitest) |
| `make mobile-assets` (`mobile/scripts/build_web_assets.sh`) | Compila React y copia a `mobile/assets/www/` |
| `make mobile-test` | `flutter analyze` + `flutter test` |
| `make apk` | Web actual + APK de release |
| `make check` | Todos los checks (lo mismo que CI) |
| `cd mobile && flutter run` | App Android en modo debug (hot reload) |
| `cd mobile && flutter install` | Instala el APK en el teléfono conectado por USB |

---

## Checklist antes de distribuir

- [ ] `make check` sin errores (lint, tests de la web y Flutter)
- [ ] `make build` sin errores TypeScript
- [ ] Después del merge a `main`, el workflow Pages pasó y https://dotdeivid.github.io/wixplorer/ carga la versión nueva
- [ ] `make apk`
- [ ] Instalar el APK en el teléfono y probar el flujo WiFi completo (iniciar servidor → URL → PIN → archivos)
- [ ] Actualizar número de versión en `web/package.json` y `mobile/pubspec.yaml` si corresponde
