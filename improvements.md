# WiXplorer — Revisión: bugs, mejoras y actualizaciones

Revisión del 13/11/2026 sobre la rama `fix/review` (`ee571ef`). Cubre el launcher Go, el servidor Flutter/Android, la web React (modos MTP y WiFi), CI/CD y dependencias.

Estado de los checks al momento de la revisión:

| Check | Resultado |
|---|---|
| `npm run lint` | ✅ 0 errores, 2 warnings |
| `npm test` (vitest) | ✅ 18/18 |
| `tsc -b` | ✅ |
| `go vet` / `go test` | ✅ |
| `flutter test` | ✅ 21/21 |
| `flutter analyze` (Flutter 3.50) | ❌ **exit 1**: 6 infos `deprecated_member_use` (ver §4.1) |
| `npm audit` (prod) | ✅ 0 vulnerabilidades |
| `npm audit` (dev) | ⚠️ advisories en `@babel/core`, `brace-expansion` (high), `@humanfs/node`, `baseline-browser-mapping`; se arreglan con `npm audit fix` |

Las prioridades van de 🔴 (rompe funcionalidad o seguridad) a 🟡 (bug menor o robustez) y 🟢 (mejora).

## Estado

- **Fase 1 — Bugs (§1): aplicada** en la rama `fix/phase1-bugs`, sin commitear todavía. Durante la fase aparecieron tres problemas más, que también quedaron resueltos:
  - **Flutter 3.50 exige Gradle ≥ 9.3.1 y AGP ≥ 9.1.1**, y AGP 8.x no funciona desde Gradle 9.6. El build de Android estaba roto con cualquier wrapper. Se subió AGP a 9.3.1 y Kotlin a 2.4.20 (la combinación de la plantilla oficial de Flutter 3.50), y se migró `kotlinOptions` a `kotlin { compilerOptions }`. Se mantiene el wrapper Gradle 9.7.1.
  - **`video_thumbnail` no compila con AGP 9.** Se reemplazó por `fc_native_video_thumbnail` 4.0.0.
  - **El `.syso` de Windows se generaba para 386 y nunca se enlazaba**, porque `go build main.go` ignora los `.syso`, así que el `.exe` salía sin ícono ni metadatos. Ahora se genera con `goversioninfo -64` y se compila el paquete (`.`).
- **Fase 2 — Mejoras (§2): pendiente.**
- **Fase 3 — Actualizaciones (§3): aplicada** en la rama `chore/phase3-deps`, que está apilada sobre la fase 1. Queda un solo pendiente: TypeScript 7, que espera soporte de `typescript-eslint`.

---

## 1. Bugs

### 1.1 Servidor Flutter (`mobile/lib/services/server_service.dart`)

- 🔴 **Range requests mal parseados** (`server_service.dart:326-336`)
  - Un rango con sufijo, `bytes=-500` (los últimos 500 bytes), se interpreta como `0-500`. Los navegadores lo usan para leer el `moov` de MP4 que lo tienen al final.
  - Un archivo de 0 bytes con `Range` revienta: `start.clamp(0, -1)` lanza `ArgumentError` y responde 500. Lo dispara la sonda `bytes=0-0` de `downloadFileChunked` sobre archivos vacíos.
  - Un `start >= fileLength` debería devolver `416 Range Not Satisfiable`. Hoy se recorta en silencio.
  - Los multi-range (`bytes=0-1,5-6`) caen en `int.tryParse` → null, y terminan devolviendo el archivo hasta el final.
- 🔴 **Fallback SPA cacheado como `immutable`** (`server_service.dart:545-565`). Cualquier ruta desconocida devuelve `index.html` con `cache-control: public, max-age=31536000, immutable`. Lo mismo pasa con `sw.js`, `favicon.svg` e `icons.svg`, que no llevan hash en el nombre. Después de actualizar la app el navegador sigue mostrando el shell viejo. Solo `assets/*` (con hash) debería ser `immutable`; el resto, `no-cache`. Además, un `.js` inexistente recibe `index.html` con `content-type` de JS.
- 🟡 **Bloqueo global del PIN = DoS en la LAN** (`auth_service.dart:13-18, 59-64`). El contador de intentos fallidos es global. Cualquier equipo de la red (o una web cualquiera abierta en un navegador de la LAN, porque CORS es `*`) puede mandar 5 PINs malos cada 30 s y dejar afuera al usuario legítimo. Hay que limitar por IP (`req.context['shelf.io.connection_info']`). El comentario dice "5 intentos en 60s", pero el bloqueo dura 30 s y el contador nunca se resetea por ventana de tiempo. El cliente web, ante un 429, dice "Reiniciá el servidor en el teléfono" (`useNetworkDevice.ts:319`), cuando en realidad alcanza con esperar 30 s.
- 🟡 **`DELETE /api/file` con paths no-string** (`server_service.dart:374`). `cast<String>()` es perezoso: un elemento numérico lanza `TypeError` → 500. Además, si una parte se borra y otra falla, responde 403 sin decir qué se borró.
- 🟡 **NDJSON: el stream no se cancela si el cliente se va** (`server_service.dart:278-291`). El `StreamController` no tiene `onCancel` y la suscripción a `streamFiles` sigue haciendo `stat()` de toda la carpeta. Si ocurre un error a mitad del stream, el cliente recibe una lista truncada sin enterarse (`NetworkClient._readNdjson` tampoco lo detecta).
- 🟡 **`_json` comprime con gzip sin mirar `Accept-Encoding`** (`server_service.dart:665-687`). En la práctica los navegadores aceptan gzip, pero `curl` u otros clientes reciben binario.
- 🟡 **`start()` concurrente / `stop()` durante `start()`**. `start()` solo chequea `isRunning`, no `isBusy`. La UI deshabilita el botón, pero `ServerService` no se protege solo: un segundo `start()` intenta bindear 7070 de nuevo.
- 🟡 **Puerto fijo 7070**. Si está ocupado, `start()` falla sin alternativa. Conviene probar 7070, 7071… y mostrar el puerto real (el estado ya lo soporta).
- 🟡 `_initThumbCache` usa `.list().listen(...)` sin `onError`, así que un error de I/O queda como excepción no capturada en la zona.

### 1.2 Android nativo

- 🔴 **Sin acceso a archivos no-multimedia en Android 11+**. El manifest solo pide `READ_MEDIA_IMAGES/VIDEO/AUDIO` y `READ_EXTERNAL_STORAGE (maxSdk 32)`. Con scoped storage, `Directory.list()` sobre `/storage/emulated/0` solo devuelve medios: PDFs, ZIPs, APKs y documentos de `Download/` o `Documents/` no aparecen. Para un explorador de archivos hace falta `MANAGE_EXTERNAL_STORAGE`, con el intent `ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` y `Permission.manageExternalStorage` en `permission_handler`, o asumir y documentar la limitación. Eso tiene implicancias para Play Store; para APK sideload no.
- 🔴 **Notificación "fantasma" con el servidor muerto** (`WiXplorerForegroundService.kt:52`, `AndroidManifest.xml` `stopWithTask="false"`).
  - `START_STICKY` hace que, si el sistema mata el proceso, Android recree el servicio con `intent == null`. Se muestra "Servidor activo", pero el `HttpServer` de Dart ya no existe (vive en el `FlutterEngine` de la Activity).
  - Lo mismo pasa al deslizar la app desde recientes: con `stopWithTask="false"`, el servicio sobrevive pero el engine se destruye.
  - Fix mínimo: `START_NOT_STICKY`, `stopWithTask="true"` (o `onTaskRemoved` → `stopSelf()`). Si se quiere servidor de fondo de verdad, el engine tiene que vivir en el servicio.
- 🟡 **`POST_NOTIFICATIONS` declarado pero nunca pedido en runtime**. En Android 13+ la notificación del FGS no se ve hasta que el usuario da el permiso. Hay que agregar `Permission.notification.request()` en `_requestStoragePermissions`.
- 🟡 **Límite de FGS `dataSync` en Android 15** (6 h cada 24 h, con `onTimeout`). No se maneja `Service.onTimeout(int, int)`. Conviene detener el servidor limpiamente o pasar a otro tipo de FGS.
- 🟡 **Release firmado siempre con la debug key**. `release.yml` escribe `android/key.properties` y `keystore.jks`, pero `mobile/android/app/build.gradle.kts` nunca los lee (`signingConfig = signingConfigs.getByName("debug")`). Hay que agregar un `signingConfigs.create("release")` que cargue `key.properties` cuando exista.
- 🟡 **iOS no funciona**. `getExternalStorageDirectories()` lanza `UnsupportedError` en iOS (`file_service.dart:70`, fuera del try), y `start()` explota. Si iOS no es objetivo, conviene sacarlo de `flutter_launcher_icons` o documentarlo. Si lo es, hay que usar `getApplicationDocumentsDirectory()`.

### 1.3 Web — MTP / USB

- 🔴 **`MtpClient` no serializa transacciones**. MTP es estrictamente "una transacción a la vez" sobre el mismo par de endpoints bulk, y hoy pueden pisarse:
  - `refreshFiles` lanza un `getObjectInfo` por handle en paralelo con `Promise.all` (`useMTPDevice.ts:133-160`), igual que `navigateToFavoriteFolder` (`:574`).
  - Las miniaturas tienen su propia cola de 1 (`useThumbnail.ts:81`), pero corren en paralelo con el listado, el preview y el streaming de video.
  - `createFolder` y `renameObject` leen `this.transactionId` después de un `await` (`MtpClient.ts:419, 470`). Si otra operación entra en el medio, el paquete de datos sale con el TID equivocado.
  - Hoy funciona en parte por timing (el dispositivo hace NAK al siguiente comando hasta terminar), pero no está garantizado y explica fallos intermitentes: respuestas cruzadas o `getObjectInfo` → `null`.
  - **Fix**: un mutex simple (cadena de promesas) dentro de `MtpClient` que envuelva cada transacción completa (command → data → response). El streaming de video y las descargas largas deberían tomar el lock por toda su duración, o al menos dejar claro que bloquean el resto.
- 🔴 **`connectToDevice` puede elegir la interfaz ADB** (`USBManager.ts:207-222`). Toma la primera interfaz con bulk-in y bulk-out. Con depuración USB activa, la interfaz ADB (clase `0xFF`/`0x42`) también los tiene y puede aparecer antes. `findMTPEndpoints` (que exige además un interrupt-in) ya resuelve esto y debería reutilizarse. Además se usa `mtpInterface.alternate` (la alternativa activa) en lugar de la alternativa que matcheó.
- 🟡 **Descarga MTP truncada reportada como éxito** (`MtpClient.ts:335-346`). Si `receiveBulk` devuelve 0 bytes se hace `break`, se lee la respuesta y se devuelve el Blob o se cierra el archivo sin error. Habría que verificar `received === payloadSize` y que el código de respuesta sea `OK`.
- 🟡 **`knownSize` tiene prioridad sobre el header** (`MtpClient.ts:311-315`). Si el archivo cambió desde el listado, `knownSize` queda desactualizado y se leen bytes de más (incluido el paquete de respuesta como datos) o el bucle se cuelga. Android manda `0xFFFFFFFF` para >4 GB; conviene usar `reportedLength` siempre que sea `< 0xFFFFFFFF` y `knownSize` solo como respaldo.
- 🟡 **`receiveBulk` y la sonda ignoran `byteOffset`** (`USBManager.ts:132, 282`). Se usa `result.data.buffer` en lugar de `result.data.buffer.slice(byteOffset, byteOffset + byteLength)`. En Chrome hoy el offset es 0, pero no está garantizado.
- 🟡 **`serializeMtpString` no valida longitud** (`MtpPacket.ts:113`). Un nombre de más de 254 caracteres desborda el byte de conteo. Hay que validarlo en `RenameDialog` y `NewFolderDialog`.
- 🟡 **Preview MTP sin cancelación** (`useMTPDevice.ts:400-414`). `previewFile` llama a `getObject` sin `signal`: al cambiar de archivo, la transferencia anterior sigue ocupando el pipe USB hasta terminar (un PDF o un `.log` grande puede tardar mucho).
- 🟡 **Video MSE sin control de buffer** (`MtpVideoStream.ts`). No hay `SourceBuffer.remove()` ni manejo de `QuotaExceededError`: en videos largos `appendBuffer` falla, el segmento se descarta y la reproducción se congela. Tampoco se llama a `mp4box.releaseUsedSamples`, así que mp4box retiene todo el archivo en memoria.

### 1.4 Web — WiFi

- 🔴 **Condición de carrera en la navegación** (`useNetworkDevice.ts:368-462`). Si se hace clic rápido en dos carpetas, la respuesta de la primera puede llegar después y pisar `files` (también vía `onProgress`/`setFiles` progresivo). Falta un contador de generación o un `AbortController` por navegación, igual al que ya usa `useThumbnail`.
- 🔴 **"Adelante" habilitado pero sin efecto en modo WiFi** (`AppLayout.tsx:54-56`). `canGoForward` se activa con `navigateOut`, pero `activeNavigateFwd` es un no-op en red. Hay que implementar `navigateForward` en `useNetworkDevice` (el `forwardStack` ya existe) o devolver `canGoForward: false`.
- 🔴 **Cancelar una descarga FSAA deja un archivo truncado en disco** (`NetworkClient.ts:328-333`). Ante un error o abort se llama a `fsWritable.close()`, que guarda lo parcial, y después se reintenta la descarga entera en RAM como Blob. Debería ser `fsWritable.abort()` y, si fue `AbortError`, relanzar sin fallback (el camino MTP ya lo hace bien, `useMTPDevice.ts:363`).
- 🟡 **Chunk con `200` en lugar de `206`** (`NetworkClient.ts:252`). `res.ok` acepta 200; si un servidor ignora `Range`, cada chunk escribe el archivo completo en su offset y lo corrompe. Hay que exigir `res.status === 206`.
- 🟡 **La sonda de tamaño no cancela el body** (`NetworkClient.ts:168-178`). Si responde 200 (sin soporte de rangos), el navegador descarga el archivo entero y lo descarta. Hay que agregar `probe.body?.cancel()`.
- 🟡 **Descarga sin tamaño conocido escribe el JSON de error en el archivo** (`NetworkClient.ts:183-192`): no se chequea `res.ok`.
- 🟡 **Los chunks en vuelo no se abortan cuando uno falla** (`runPool`). Siguen escribiendo sobre un writable ya cerrado.
- 🟡 **Preview de texto/PDF descarga el archivo entero sin límite ni abort** (`getFileBlob`, `PreviewPanel.tsx:235`). Un `.log` o `.json` de cientos de MB se carga completo en memoria para mostrar 20 000 caracteres. Conviene pedir `Range: bytes=0-1048575` para texto y pasar `signal`.
- 🟡 **Recientes contaminados con IDs de red** (`AppLayout.tsx:184`). `handleSelectFile` hace `RecentsStorage.touch(file)` también en modo WiFi, donde `id` es un contador efímero. Después `RecentsView` verifica esos IDs como handles MTP (`AppLayout.tsx:531`) y puede abrir otro archivo. Además escribe `localStorage` en cada clic de selección.
- 🟡 **Recientes y caché de miniaturas indexados solo por handle MTP**. Un handle puede reasignarse entre sesiones o dispositivos:
  - `verifyFile` debería comparar nombre y tamaño, no solo que el handle exista.
  - `ThumbCache` (IndexedDB) se vacía en cada desconexión (`useMTPDevice.ts:106, 241`), así que en la práctica no persiste entre sesiones. O se indexa por `serial + handle + tamaño + fecha` y se deja de borrar, o se elimina IndexedDB y queda solo el LRU.
- 🟡 **`thumbCache` en `useNetworkDevice` sin límite** (`:171`). Duplica el LRU de `useThumbnail` y crece sin tope durante la sesión. Conviene quitarlo y dejar solo el LRU.
- 🟡 **Una caída del health check desconecta sin explicación**. `resetConnection()` se llama sin `fromExpiry`, así que no se muestra el aviso de reconexión.
- 🟡 **El buffer final de NDJSON se descarta** (`NetworkClient.ts:103`). Si la última línea no termina en `\n`, se pierde. Hay que parsear `buffer` en `done`.
- 🟡 **Doc comment fuera de lugar** (`NetworkClient.ts:398-402`): la JSDoc de `getFileUrl` está encima de `deleteFiles`.

### 1.5 Launcher Go / scripts

- 🟡 **`build_desktop.sh` deja `resource.syso` presente durante el build de macOS** (`scripts/build_desktop.sh:17-22`). `release.yml` lo borra a propósito; el script local no. Lo mejor es renombrarlo a `resource_windows_amd64.syso`: Go lo enlaza solo para ese GOOS/GOARCH y no hay que borrarlo (actualizar también `release.yml` y `.gitignore`). De paso, los pasos del script están numerados mal (`1/4` antes de `0/4`, dos `4/4`).
- 🟡 **`release.yml` instala `goversioninfo@latest`**, que no es reproducible. Hay que fijar la versión.

### 1.6 Repo

- 🟡 `mobile/android/build/` está sin trackear y **no ignorado**: `mobile/.gitignore` solo cubre `/build/` en la raíz de `mobile/`. Hay que agregar `build/` a `mobile/android/.gitignore`.
- 🟡 Cambio sin commitear en `mobile/android/gradle/wrapper/gradle-wrapper.properties`: Gradle `8.14-all` → `9.7.1-bin`. **AGP `8.11.1` no está pensado para Gradle 9**: si se sube Gradle, hay que subir también AGP (ver §3.3) o revertir el wrapper.
- 🟡 La `main` local está desactualizada respecto de `origin/main`. Ya se avanzó con fast-forward durante esta revisión (ver nota al final).

---

## 2. Mejoras (dentro del alcance actual)

### Seguridad
- 🟢 **Cabeceras en `/api/file`**. En modo auto-hospedado la web y los archivos comparten origen (`http://IP:7070`). Un `.html` o `.svg` del teléfono servido `inline` (respuestas 206) podría ejecutar scripts en ese origen. Agregar `X-Content-Type-Options: nosniff` y `Content-Security-Policy: sandbox` a las respuestas de archivos, y usar `attachment` salvo para tipos multimedia.
- 🟢 **`sandbox=""` en el `<iframe srcDoc>` del preview de texto** (`PreviewPanel.tsx:478`), como defensa adicional. Hoy el contenido está escapado; además conviene cortar antes de escapar para no partir entidades.
- 🟢 **Comparación del token en tiempo constante** (`auth_service.dart:68`) y `Content-Disposition` con `filename*=UTF-8''…` en lugar de `filename="%E2…"`.
- 🟢 **CORS**: en modo auto-hospedado no hace falta `*`. Se puede limitar a `http://localhost:*` / `127.0.0.1` (launcher Go) más el propio origen.

### Rendimiento / robustez
- 🟢 **Validación de paths sin I/O síncrono**. `FileService._realPath` usa `typeSync` y `resolveSymbolicLinksSync` en cada request y para cada raíz, lo que bloquea el isolate del servidor. Conviene resolver las raíces una vez en `init()` y usar las versiones async para el path pedido.
- 🟢 **Thumbs de imagen**: el último fallback sirve el archivo original completo (`server_service.dart:486`). Para una foto RAW de 50 MB es peor que un 204. Además `readAsBytes()` se hace dos veces cuando falla el primer intento.
- 🟢 **Listado progresivo en WiFi**: el render parcial no está ordenado y al final "salta" al orden definitivo. Se puede ordenar en el cliente al acumular.
- 🟢 **Logs de depuración**: `MtpClient` y `useMTPDevice` tienen muchos `console.log` en producción. Conviene un `debug()` que solo loguee con `import.meta.env.DEV`.
- 🟢 **Service worker**: el cache `pt-v1` nunca purga assets con hash viejos. Se pueden borrar las entradas `/assets/*` que no figuren en el `index.html` actual, o usar un nombre de cache por build.
- 🟢 **Contexto no seguro en modo auto-hospedado**: sobre `http://IP:7070` no existen `showSaveFilePicker` ni el service worker, así que las descargas grandes caen siempre al Blob en RAM. Vale la pena documentarlo y avisar en la UI antes de descargar archivos de varios GB.

### UX
- 🟢 Mostrar en la app móvil el puerto real y un QR con `http://IP:puerto` (no suma dependencias pesadas: `qr_flutter`).
- 🟢 Aviso de inactividad: hoy solo avisa ("el servidor sigue activo"). Se puede ofrecer un apagado automático opcional tras N minutos, que además ayuda con el límite de FGS de Android 15.
- 🟢 Mensaje de 429 en el cliente alineado con el comportamiento real (esperar 30 s).

### Calidad / tests
- 🟢 Tests para el parser de `Range` (extraerlo a una función pura en Dart) y para `_readNdjson` / `downloadFileChunked` con `fetch` mockeado.
- 🟢 Warning de lint en `useThumbnail.ts:137`: copiar `generationRef` a una variable local dentro del efecto. `FileExplorer.tsx:100` es el aviso esperado de React Compiler con `@tanstack/react-virtual`; se puede silenciar con un comentario explicativo.
- ✅ `@types/jszip` eliminado (fase 3).
- 🟢 **`react-hooks/set-state-in-effect`** (nueva en `eslint-plugin-react-hooks` 7.1, bajada a `warn` en `eslint.config.js`): 10 efectos resetean estado al cambiar de archivo o carpeta (`PreviewPanel`, `GalleryPreview`, `AppLayout`, `RecentsView`, `useThumbnail`, `useMTPDevice`). Migrarlos a `key` en el componente o a estado derivado, y después volver la regla a `error`.

---

## 3. Actualizaciones de dependencias — ✅ aplicadas

### 3.1 npm (web)

- Todas las dependencias están en su última versión (`npm outdated` limpio), salvo las dos excepciones de abajo. Mayores aplicadas: **ESLint 10**, **Vitest 5**, **TypeScript 6.0.3**.
- `npm audit`: **0 vulnerabilidades**. `typescript-eslint` fija `minimatch@^10`, vulnerable a GHSA-g3hv-75wg-m249; se fuerza `minimatch@^11.0.8` con `overrides` en `package.json` (es la misma versión que ya usa ESLint). Se puede quitar cuando `typescript-eslint` la suba.
- `@types/jszip` eliminado (jszip trae sus tipos).
- ESLint 10 y `react-hooks` 7.1 activaron reglas nuevas. Se corrigieron:
  - `no-useless-assignment` (`StatusBar`, `MtpClient`)
  - `react-hooks/refs`: refs escritas durante el render en `AppLayout` y `useNetworkDevice`
  - `react-hooks/immutability`: el health check usaba `resetConnection` antes de declararlo
  - `set-state-in-effect` quedó en `warn` (ver §2, Calidad).
- **Pendientes a propósito:**
  - **TypeScript 7.0**: `typescript-eslint` 8.72 solo soporta `<6.1`.
  - **@types/node 26**: se mantiene en 24 para coincidir con Node 24 de CI.

### 3.2 Flutter / Dart

- Todo al día (`flutter pub outdated`: "all up-to-date"). Mayores: `permission_handler` 13, `device_info_plus` 13, `network_info_plus` 8, `wakelock_plus` 1.8.
- `cupertino_icons` eliminado (no se usaba).
- **`package:flutter/material.dart` → `package:material_ui/material_ui.dart`** (`material_ui` 1.11.0). `flutter analyze` ya no reporta nada.
- `environment.sdk: ^3.13.0` (mínimo que pide `material_ui`).
- `video_thumbnail` → `fc_native_video_thumbnail` 4.0.0 (fase 1).

### 3.3 Android / Gradle

- AGP 9.3.1 + Kotlin 2.4.20, Gradle 9.7.1 (fase 1).
- `compileSdk` subido a 37: lo exige `permission_handler_android` 14. `targetSdk` sigue siendo el de Flutter.
- `gradle.properties`: heap de 8G/4G a 4G/1G; el build de release se verificó desde cero.
- Solo `flutter_image_compress_common` (1.1.1, la última) sigue aplicando el Kotlin Gradle Plugin por su cuenta: Flutter avisa que una versión futura dejará de compilarlo. No hay versión nueva upstream; hay que seguirlo. Por eso se mantienen `android.builtInKotlin=false` y `android.newDsl=false`, que de todos modos trae la plantilla de Flutter 3.50.

### 3.4 Go

- `go.mod`: `go 1.27.4`.

### 3.5 CI / GitHub Actions

- Flutter fijo en `3.50.0`, Node `24` LTS.
- Todas las actions fijadas por SHA en su última versión: `checkout` v7.0.1, `setup-node` v7.1.0, `setup-go` v7.0.0, `setup-java` v6.2.0, `upload-artifact` v7.0.2, `download-artifact` v8.0.2, `flutter-action` v2.23.0, `action-gh-release` v3.0.4. Se revisaron las notas de cada versión mayor: los cambios incompatibles son el runtime Node 24 y la verificación de hash en las descargas, y ninguno afecta a estos workflows.
- `goversioninfo` fijado a v1.7.0 (fase 1).

---

## Nota sobre la conexión con GitHub

El remoto `origin` ya apuntaba a `https://github.com/dotdeivid/wixplorer.git`, y `fix/review` sigue a `origin/fix/review` sin commits pendientes. `origin/main` incluye el merge del PR #1 (`e56d586`), con el mismo contenido que `fix/review`. La `main` local estaba 9 commits atrás y se actualizó con fast-forward (`git fetch origin main:main`).
