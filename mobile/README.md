# WiXplorer — App Móvil (Flutter)

App Android que convierte el teléfono en un servidor de archivos WiFi. Sirve la UI React embebida y expone una API HTTP para que cualquier navegador en la misma red pueda explorar y descargar archivos sin cables ni software adicional en la PC.

---

## Compilar y ejecutar

### Requisitos

- Flutter 3.19+
- Android SDK (API 23 mínimo, API 33+ recomendado)
- Dispositivo Android o emulador conectado

### Desarrollo

```bash
cd mobile
flutter pub get
flutter run
```

### Release

```bash
# 1. Embebe la UI React actualizada en el APK
bash ../scripts/build_mobile_web.sh

# 2. Genera el APK de release
flutter build apk --release
```

El APK queda en `build/app/outputs/flutter-apk/app-release.apk`.

---

## Arquitectura

```
lib/
├── main.dart                    # Punto de entrada; configura orientación y barra de estado
├── screens/
│   └── home_screen.dart         # Pantalla principal: botón de inicio/parada + estado
├── widgets/
│   ├── main_button.dart         # Botón circular animado (192 dp)
│   ├── status_card.dart         # URL copiable + PIN en formato OTP
│   └── pulse_ring.dart          # Anillo pulsante animado cuando el servidor está activo
├── services/
│   ├── server_service.dart      # Ciclo de vida del servidor HTTP (shelf)
│   ├── file_service.dart        # Acceso al sistema de archivos con stat() paralelos
│   ├── auth_service.dart        # Generación y validación de PIN + token
│   └── foreground_service_channel.dart  # Canal para el servicio en segundo plano de Android
├── models/
│   └── server_status.dart       # Enum ServerStatus + clase inmutable ServerState
└── theme/
    └── app_theme.dart           # Paleta de colores y tema Material 3 oscuro
```

### Flujo de inicio del servidor

```
start()
  ├─ Solicitar permisos de almacenamiento
  ├─ Future.wait([FileService.init(), _preloadWebAssets(), _initThumbCache()])
  ├─ AuthService.generate()      → PIN de 6 dígitos + token UUID
  ├─ shelf_io.serve(handler, 0.0.0.0, 7070)
  ├─ ForegroundServiceChannel.start()   → notificación persistente
  └─ WakelockPlus.enable()
```

---

## API HTTP

Puerto fijo `7070`. Todas las rutas `/api/*` excepto `/api/ping` y `/api/auth` requieren `Authorization: Bearer <token>` o el query param `?token=<token>`.

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/ping` | Health check sin auth → `{ app, version, deviceName }` |
| `POST` | `/api/auth` | Validar PIN → `{ token }` |
| `GET` | `/api/storages` | Almacenamientos disponibles (interno, SD) |
| `GET` | `/api/files?path=` | Listado de carpeta — NDJSON streaming o JSON array |
| `GET` | `/api/file?path=` | Descarga / streaming binario con soporte de Range requests |
| `GET` | `/api/thumb?path=` | Thumbnail WebP 320px (caché HTTP 24h) |
| `GET` | `/*` | React SPA embebida desde `assets/www/` |

### NDJSON streaming (`/api/files`)

Si el cliente envía `Accept: application/x-ndjson`, el servidor devuelve los ítems de la carpeta en tiempo real usando chunked transfer. Los `stat()` se ejecutan en batches paralelos de 8; cada batch se emite como líneas JSON separadas por `\n` en cuanto está listo. La UI React renderiza progresivamente sin esperar el listado completo.

### Range requests (`/api/file`)

El endpoint soporta la cabecera `Range: bytes=start-end`. Permite al navegador reproducir videos con seek y reanudar descargas interrumpidas.

### Autenticación via query param

El token puede enviarse como `?token=<token>` además del header `Authorization: Bearer`. Esto permite usar URLs directas en `<img src>` y `<video src>` sin necesidad de headers personalizados, habilitando carga progresiva nativa del navegador.

---

## Seguridad

| Amenaza | Mitigación |
|---------|-----------|
| Acceso no autorizado desde la red local | PIN de 6 dígitos visible solo en pantalla del dispositivo |
| Fuerza bruta del PIN | Bloqueo tras 5 intentos fallidos en 60 s |
| Token robado o reutilizado | Token efímero en memoria — se invalida al detener el servidor |
| Path traversal (`../../etc/passwd`) | `FileService._sanitizePath()` valida contra lista de raíces permitidas |
| Proceso eliminado en segundo plano | Foreground Service de Android con notificación persistente |

---

## Rendimiento

### Listado de carpetas
- `stat()` paralelos en batches de 8 → carpeta de 500 archivos: ~5 s → ~0.6 s
- NDJSON streaming → primer ítem visible en el cliente en milisegundos

### Thumbnails
- **Formato**: WebP 72q vía `flutter_image_compress` (codec nativo Android) → ~70% más pequeño que JPEG original
- **Fallback JPEG**: `compute(_encodeJpegThumbnail)` → Dart Isolate separado, no bloquea la UI
- **Semáforo**: máximo 3 compresiones concurrentes para evitar saturar la CPU
- **Caché en disco**: `temp/wixplorer_thumbs/{hash}_{mtime}.webp` — los thumbs ya generados se sirven directamente sin recomprimir; limpieza automática de archivos > 7 días

### Preview de archivos
- Imágenes y videos se sirven via URL directa (token en query param) — el navegador hace carga progresiva y Range requests nativos sin descargar el blob completo

### Assets web
- Pre-cargados en `Map<String, Uint8List>` al iniciar el servidor → latencia cero en cada request de la SPA
- Carga en paralelo con `Future.wait` → ~5× más rápido que carga secuencial

### Respuestas JSON
- Payloads > 512 bytes se comprimen con `GZipCodec` antes de enviar
- Listados de carpetas grandes: ~70% menos datos en la red

---

## Permisos Android

| Permiso | Motivo |
|---------|--------|
| `INTERNET` | Servidor HTTP |
| `ACCESS_WIFI_STATE` / `ACCESS_NETWORK_STATE` | Obtener IP local |
| `READ_EXTERNAL_STORAGE` (≤ API 32) | Leer archivos en Android < 13 |
| `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` / `READ_MEDIA_AUDIO` (≥ API 33) | Permisos granulares Android 13+ |
| `WAKE_LOCK` | Mantener pantalla encendida mientras el servidor está activo |
| `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_DATA_SYNC` | Servicio en segundo plano |
| `POST_NOTIFICATIONS` | Notificación persistente del foreground service |

---

## Dependencias principales

| Paquete | Uso |
|---------|-----|
| `shelf` + `shelf_router` | Servidor HTTP |
| `flutter_image_compress` | Codificación WebP nativa en hilo separado |
| `image` | Fallback Dart puro para decodificación/resize (JPEG) |
| `video_thumbnail` | Frame JPEG de video para thumbnail |
| `path_provider` | Rutas de almacenamiento y directorio temporal |
| `permission_handler` | Permisos en runtime |
| `mime` | MIME types para cabeceras HTTP |
| `uuid` | Generación del token de sesión |
| `network_info_plus` | IP local WiFi |
| `wakelock_plus` | Mantener pantalla encendida |
| `device_info_plus` | Nombre del modelo del dispositivo |
