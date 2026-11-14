# WiXplorer

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Explorá los archivos de tu Android desde el navegador del PC, sin cables ni software adicional.

---

## Modos de uso

| Modo | Quién sirve los archivos | Cómo conectar |
|------|--------------------------|---------------|
| **WiFi** | App WiXplorer en el teléfono | Abrís el navegador del PC y entrás a la IP que muestra la app; ingresás el PIN que aparece en pantalla |
| **USB / MTP** (macOS) | Protocolo MTP del teléfono | Entrás a **https://dotdeivid.github.io/wixplorer/** con Chrome o Edge, conectás el cable y seleccionás "Transferencia de archivos" en el teléfono |

> **WiFi no requiere ningún software en la PC.** La app mobile levanta un servidor HTTP con la interfaz web embebida; solo necesitás un navegador. Funciona en cualquier sistema.
>
> **El modo USB es web y pensado para macOS**, que no lee Android por cable de forma nativa. No hay que descargar nada: la versión publicada en GitHub Pages sirve por `https://`, que es lo que pide WebUSB, y en el teléfono no hace falta instalar la app. En Windows el Explorador ya muestra el teléfono, y Chrome no puede usar WebUSB con un dispositivo tomado por el driver MTP del sistema; ahí se usa el modo WiFi.

---

## Productos

| Artefacto | Plataforma | Para qué sirve |
|-----------|-----------|----------------|
| APK de release | Android | Servidor WiFi — instalar en el teléfono |
| Versión web | Navegador (Chrome/Edge) | Modo USB — https://dotdeivid.github.io/wixplorer/ |

---

## Versión web (GitHub Pages)

`.github/workflows/pages.yml` publica la web en **https://dotdeivid.github.io/wixplorer/** en cada push a `main` que toque `web/`. También se puede lanzar a mano desde la pestaña Actions.

- **Modo USB:** funciona directo desde la página, porque es `https://`.
- **Modo WiFi:** el navegador no deja que una página `https://` le hable a `http://192.168.…`. Por eso, desde la versión publicada, "Conectar por WiFi…" lleva a la página del teléfono, donde se ingresa el PIN.
- **Ruta base:** sin dominio propio la app vive en `/wixplorer/`, y el workflow compila con `VITE_BASE=/wixplorer/`. Con un dominio propio en la raíz, se cambia a `/` en el workflow y se configura en **Settings → Pages → Custom domain**.

---

## Releases

Los binarios de distribución se generan automáticamente con GitHub Actions al crear un tag de versión.

### Publicar una nueva release

```bash
git tag v1.0.1
git push --tags
```

El CI corre en paralelo y publica los artefactos en la pestaña **Releases** del repositorio:

| Artefacto | Qué contiene |
|-----------|-------------|
| `WiXplorer.apk` | App Android con la UI web embebida |

La versión web no forma parte del release: se publica sola en GitHub Pages con cada merge a `main`.

### Pipeline del CI (`.github/workflows/release.yml`)

```
build-web ── build-apk ── release (GitHub Release)
```

1. **build-web** — lint + tests (`npm run lint`, `npm test`) y compila React (`npm run build`)
2. **build-apk** — copia `web/dist/` a `mobile/assets/www/`, corre `flutter analyze` + `flutter test` y `flutter build apk --release`
3. **release** — crea el GitHub Release con el APK

> Los tags con guión (ej: `v1.1.0-beta`) se marcan automáticamente como pre-release.

Además, `.github/workflows/ci.yml` corre los mismos checks (lint, vitest, `flutter analyze`/`flutter test`) en cada push a `main` y en cada PR.

### Firma del APK con clave de producción (opcional)

Sin configuración extra el APK se firma con la debug key, válido para instalación directa (sideload). Para firma de producción, agregar estos secrets al repositorio:

| Secret | Valor |
|--------|-------|
| `KEYSTORE_BASE64` | Keystore en base64: `base64 -i keystore.jks` |
| `KEYSTORE_PASSWORD` | Contraseña del keystore |
| `KEY_ALIAS` | Alias de la clave |
| `KEY_PASSWORD` | Contraseña de la clave |

---

## Estructura del repositorio

Monorepo con dos proyectos: la web y la app móvil. La web se publica en GitHub Pages (modo USB) y además se embebe en la app (modo WiFi).

```
wixplorer/
├── web/                  # UI web (React + TypeScript + Vite)
│   ├── src/
│   │   ├── components/   # Explorer, sidebar, toolbar, preview, diálogos…
│   │   ├── hooks/        # useMTPDevice, useNetworkDevice, useThumbnail…
│   │   └── services/     # NetworkClient, ThumbCache, MtpClient…
│   ├── public/           # sw.js (service worker), íconos
│   └── dist/             # Build (generado por Vite)
├── mobile/               # App Flutter (servidor HTTP + UI de control)
│   ├── lib/
│   │   ├── screens/      # HomeScreen
│   │   ├── widgets/      # MainButton, StatusCard, PulseRing
│   │   └── services/     # ServerService, FileService, AuthService…
│   ├── scripts/build_web_assets.sh  # web → mobile/assets/www/
│   └── assets/www/       # Copia de web/dist (generada)
├── docs/                 # Guía de desarrollo y planes de trabajo
└── Makefile              # Atajos para todas las tareas (`make help`)
```

---

## Desarrollo

### Requisitos

- Node.js 24+ y npm
- Flutter 3.50 (solo para la app móvil)

Todas las tareas tienen un atajo en el `Makefile` de la raíz:

```bash
make help            # lista las tareas
make check           # lint + tests de la web y Flutter (lo mismo que CI)
```

### UI web (React) — `web/`

```bash
cd web
npm install
npm run dev          # servidor de desarrollo en http://localhost:5173
npm run lint         # ESLint
npm test             # tests unitarios (vitest)
npm run build        # genera web/dist/
```

### App móvil — modo WiFi (Flutter) — `mobile/`

```bash
make mobile-assets     # compila la web y la copia a mobile/assets/www/
cd mobile
flutter pub get
flutter run            # ejecutar en dispositivo/emulador conectado
flutter test           # tests unitarios — paths, AuthService, Range, seguridad HTTP
flutter build apk --release   # o `make apk` desde la raíz
```

---

## API del servidor (modo WiFi)

El servidor corre en `0.0.0.0:7070`. Todas las rutas `/api/*` (excepto `/api/ping` y `/api/auth`) requieren `Authorization: Bearer <token>` o el query param `?token=<token>`.

```
GET  /api/ping                  → { app, version, deviceName }   (sin auth)
POST /api/auth  { pin }         → { token }                       (sin auth)
GET  /api/storages              → [ { id, name, path } ]
GET  /api/files?path=           → NDJSON stream o JSON array
GET  /api/file?path=            → stream binario (soporta Range requests)
GET  /api/thumb?path=           → WebP/JPEG 320px (caché 24h)
GET  /*                         → React SPA embebida
```

**NDJSON streaming:** el cliente envía `Accept: application/x-ndjson` y recibe los ítems de la carpeta progresivamente (batches de 8 `stat()` paralelos) en lugar de esperar el JSON completo. La UI React muestra los archivos a medida que llegan.

---

## Seguridad

| Amenaza | Mitigación |
|---------|-----------|
| Acceso no autorizado desde la red | PIN de 6 dígitos visible solo en pantalla del teléfono |
| Fuerza bruta del PIN | Bloqueo tras 5 intentos fallidos |
| Token robado | Se invalida al detener el servidor |
| Path traversal | `FileService` resuelve `..` y symlinks y exige que la ruta real quede dentro de una raíz permitida (comparación por componentes, no por prefijo) |
| Proceso eliminado en segundo plano (Android) | Foreground Service con notificación persistente |

### Limitaciones conocidas

El modo WiFi está pensado para **redes domésticas de confianza**. No es apto para WiFi públicas o compartidas:

- **HTTP sin TLS.** El PIN, el token de sesión y los archivos viajan en claro. Cualquiera en la misma red con un sniffer puede verlos y reutilizar el token mientras el servidor siga activo.
- **Token en query param.** Imágenes y videos se cargan con `?token=` en la URL (los elementos `<img>`/`<video>` no pueden mandar headers). Esas URLs pueden quedar en el historial del navegador o en logs de proxies.
- **CORS `*`.** El servidor acepta requests de cualquier origen. Una página web maliciosa no puede obtener el token por sí sola, pero si lo consigue (p.ej. por las vías anteriores) puede usar la API desde el navegador de la víctima.
- **PIN de 6 dígitos.** El bloqueo tras 5 intentos fallidos dura 30 segundos, lo que frena pero no impide un ataque de fuerza bruta sostenido mientras el servidor esté encendido.

Recomendación: encender el servidor solo mientras se usa y apagarlo al terminar — eso invalida PIN y token.

---

## Rendimiento

**Thumbnails:**
- Server-side: resize a 320px WebP via codec nativo de Android (`flutter_image_compress`) → ~70% menos datos
- Client-side: LRU en memoria (200 entradas), caché HTTP 24h
- Generación limitada a 3 operaciones concurrentes en el servidor (semáforo)
- Caché en disco en `temp/wixplorer_thumbs/` — evita recomprimir entre sesiones

**Preview de archivos (modo WiFi):**
- Imágenes y videos usan URL directa con token en query param — carga progresiva nativa del navegador sin descargar el blob completo
- Videos con Range requests — seek y reproducción instantáneos

**Listado de carpetas:**
- `stat()` en batches de 8 en paralelo — una carpeta de 500 fotos pasa de ~5s a ~0.6s
- NDJSON streaming — primer ítem visible en milisegundos

**UI:**
- Virtual scroll (`@tanstack/react-virtual`) en vista lista
- `React.memo` en todos los ítems del explorador
- Service Worker — assets JS/CSS cacheados localmente tras la primera carga

## Licencia

Apache 2.0. Ver [LICENSE](LICENSE).
