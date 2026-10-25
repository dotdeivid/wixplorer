# WiXplorer

Explorá los archivos de tu Android desde el navegador del PC, sin cables ni software adicional.

---

## Modos de uso

| Modo | Quién sirve los archivos | Cómo conectar |
|------|--------------------------|---------------|
| **WiFi** | App WiXplorer en el teléfono | Abrís el navegador del PC y entrás a la IP que muestra la app; ingresás el PIN que aparece en pantalla |
| **USB / MTP** | Protocolo MTP del teléfono | Abrís `WiXplorer.app` / `WiXplorer.exe` en la PC, conectás el cable y seleccionás "Transferencia de archivos" en el teléfono |

> **WiFi no requiere ningún software en la PC.** La app mobile levanta un servidor HTTP con la interfaz web embebida; solo necesitás un navegador.

---

## Productos

| Artefacto | Plataforma | Para qué sirve |
|-----------|-----------|----------------|
| APK de release | Android | Servidor WiFi — instalar en el teléfono |
| `WiXplorer.app` | macOS (Universal) | Modo MTP por USB |
| `WiXplorer.exe` | Windows | Modo MTP por USB |

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
| `WiXplorer.exe` | Launcher Windows (amd64) |

### Pipeline del CI (`.github/workflows/release.yml`)

```
build-web ──┬── build-apk ──────┐
            └── build-desktop ──┴── release (GitHub Release)
```

1. **build-web** — compila React (`npm run build`)
2. **build-apk** — copia `dist/` a `mobile/assets/www/` y corre `flutter build apk --release`
3. **build-desktop** — compila binario macOS Universal con `lipo`, arma el `.app`, firma ad-hoc, cross-compila el `.exe` Windows desde el runner macOS
4. **release** — crea el GitHub Release con los tres artefactos adjuntos

> Los tags con guión (ej: `v1.1.0-beta`) se marcan automáticamente como pre-release.

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

```
wixplorer/
├── src/                  # UI web (React + TypeScript + Vite)
│   ├── components/       # Explorer, sidebar, toolbar, preview, contextmenu…
│   ├── hooks/            # useMTPDevice, useNetworkDevice, useThumbnail…
│   └── services/         # NetworkClient, ThumbCache, MtpClient…
├── mobile/               # App Flutter (servidor HTTP + UI de control)
│   ├── lib/
│   │   ├── screens/      # HomeScreen
│   │   ├── widgets/      # MainButton, StatusCard, PulseRing
│   │   └── services/     # ServerService, FileService, AuthService…
│   └── assets/www/       # Build de React embebido (generado por build_mobile_web.sh)
├── build/                # Recursos para el launcher de escritorio
│   ├── Info.plist        # Bundle macOS
│   ├── AppIcon.icns      # Ícono macOS
│   └── icon.ico          # Ícono Windows
├── scripts/
│   ├── build_desktop.sh  # Compila launcher Go → .app + .exe
│   └── build_mobile_web.sh # Compila React → copia a assets/www/ del APK
├── public/
│   └── sw.js             # Service Worker (caché de assets estáticos)
├── main.go               # Launcher Go para modo MTP: sirve la UI React en localhost
└── dist/                 # Build de React (generado por Vite)
```

---

## Desarrollo

### Requisitos

- Node.js 20+ y npm
- Go 1.21+ (solo para el launcher MTP de escritorio)
- Flutter 3.19+ (solo para el módulo mobile WiFi)
- macOS con Xcode CLI Tools (para compilar el `.app` Universal)

### UI web (React)

```bash
npm install
npm run dev          # servidor de desarrollo en http://localhost:5173
npm run build        # genera dist/
```

### Launcher de escritorio — modo MTP (Go)

```bash
# Requiere dist/ generado previamente
npm run build
go run main.go

# Generar binarios de distribución
bash scripts/build_desktop.sh
```

Los binarios quedan en `dist_bin/`.

### App mobile — modo WiFi (Flutter)

```bash
cd mobile
flutter pub get
flutter run            # ejecutar en dispositivo/emulador conectado
flutter build apk --release
```

Para empaquetar la UI React dentro del APK:

```bash
bash scripts/build_mobile_web.sh
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
| Path traversal | Validación contra lista de raíces permitidas en `FileService` |
| Proceso eliminado en segundo plano (Android) | Foreground Service con notificación persistente |

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
