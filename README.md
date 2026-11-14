# WiXplorer

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Explorá los archivos de tu Android desde el navegador del PC, sin cables ni software adicional.

---

## Modos de uso

| Modo | Quién sirve los archivos | Cómo conectar |
|------|--------------------------|---------------|
| **WiFi** | App WiXplorer en el teléfono | Abrís el navegador del PC y entrás a la IP que muestra la app; ingresás el PIN que aparece en pantalla |
| **USB / MTP** (macOS) | Protocolo MTP del teléfono | Abrís `WiXplorer.app` en la Mac, conectás el cable y seleccionás "Transferencia de archivos" en el teléfono |

> **WiFi no requiere ningún software en la PC.** La app mobile levanta un servidor HTTP con la interfaz web embebida; solo necesitás un navegador. Funciona en cualquier sistema.
>
> **El modo USB es para macOS**, que no lee Android por cable de forma nativa. En Windows el Explorador ya muestra el teléfono, y Chrome no puede usar WebUSB con un dispositivo tomado por el driver MTP del sistema, así que no se distribuye un launcher para Windows.

---

## Productos

| Artefacto | Plataforma | Para qué sirve |
|-----------|-----------|----------------|
| APK de release | Android | Servidor WiFi — instalar en el teléfono |
| `WiXplorer.app` | macOS (Universal) | Modo MTP por USB |

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
| `WiXplorer_mac.zip` | `WiXplorer.app` Universal (arm64 + amd64) |

### Pipeline del CI (`.github/workflows/release.yml`)

```
build-web ──┬── build-apk ──────┐
            └── build-desktop ──┴── release (GitHub Release)
```

1. **build-web** — lint + tests (`npm run lint`, `npm test`) y compila React (`npm run build`)
2. **build-apk** — copia `web/dist/` a `mobile/assets/www/`, corre `flutter analyze` + `flutter test` y `flutter build apk --release`
3. **build-desktop** — `go vet` + `go test` y `launcher/scripts/build.sh`: binario macOS Universal con `lipo`, `.app` firmado ad-hoc y ZIP
4. **release** — crea el GitHub Release con el APK y el `.app`

> Los tags con guión (ej: `v1.1.0-beta`) se marcan automáticamente como pre-release.

Además, `.github/workflows/ci.yml` corre los mismos checks (lint, vitest, `go test`, `flutter analyze`/`flutter test`) en cada push a `main` y en cada PR.

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

Monorepo con tres proyectos: la web, el launcher de escritorio y la app móvil. La web compilada se embebe en los otros dos.

```
wixplorer/
├── web/                  # UI web (React + TypeScript + Vite)
│   ├── src/
│   │   ├── components/   # Explorer, sidebar, toolbar, preview, diálogos…
│   │   ├── hooks/        # useMTPDevice, useNetworkDevice, useThumbnail…
│   │   └── services/     # NetworkClient, ThumbCache, MtpClient…
│   ├── public/           # sw.js (service worker), íconos
│   └── dist/             # Build (generado por Vite)
├── launcher/             # Launcher de escritorio (Go) para el modo USB
│   ├── main.go           # Sirve la web en localhost y abre el navegador
│   ├── packaging/        # Info.plist, ícono, LEEME.txt
│   ├── scripts/build.sh  # web → .app + ZIP (lo usan `make desktop` y release.yml)
│   ├── dist/             # Copia de web/dist para go:embed (generada)
│   └── dist_bin/         # Binarios de distribución (generados)
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

> **Por qué `launcher/dist` es una copia:** `go:embed` no puede leer fuera del paquete Go, así que la web compilada se copia a `launcher/dist` antes de compilar. El script de escritorio, `make launcher` y el CI lo hacen solos.

---

## Desarrollo

### Requisitos

- Node.js 24+ y npm
- Go 1.27+ (solo para el launcher de escritorio)
- Flutter 3.50 (solo para la app móvil)
- macOS con Xcode CLI Tools (para compilar el `.app` Universal)

Todas las tareas tienen un atajo en el `Makefile` de la raíz:

```bash
make help            # lista las tareas
make check           # lint + tests de web, launcher y Flutter (lo mismo que CI)
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

### Launcher de escritorio — modo USB (Go) — `launcher/`

```bash
make launcher        # compila la web, la copia a launcher/dist y corre `go run .`
make test-launcher   # go vet + go test (endpoint /quit)

# WiXplorer.app (macOS) para distribuir
make desktop         # = bash launcher/scripts/build.sh
```

Los binarios quedan en `launcher/dist_bin/`.

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
| Launcher de escritorio expuesto a la red | Go escucha solo en `127.0.0.1`; `/quit` solo acepta `POST` desde el propio origen |
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
