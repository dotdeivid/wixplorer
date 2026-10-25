# WiXplorer — Guía de desarrollo

Referencia rápida: qué hacer después de cada tipo de cambio para obtener los productos finales e instalarlos en cada dispositivo.

---

## Arquitectura del proyecto

```
wixplorer/
  src/                  ← App React (UI web)
  mobile/               ← App Flutter (servidor Android)
  main.go               ← Launcher Go (ejecutable de escritorio)
  scripts/
    build_desktop.sh    ← Build completo para Mac + Windows
    build_mobile_web.sh ← Build React → assets Flutter
```

### Dos modos de uso independientes

| Modo | Quién sirve la web | Requiere |
|------|-------------------|----------|
| **USB** | Go launcher en la PC | `WiXplorer.exe` / `.app` en la computadora |
| **WiFi** | Flutter en el teléfono | App Android instalada + browser en la PC |

### Decisiones de arquitectura

**No hay backend en Node.js.** Node solo existe como herramienta de desarrollo (Vite). El backend real del modo WiFi es el servidor Flutter que corre en el teléfono:

```
Navegador (React) ←→ Go launcher   (localhost:3000, solo archivos estáticos)
Navegador (React) ←→ Flutter server (192.168.x.x:7070, API real)
Navegador (React) ←→ WebUSB         (MTP por USB, directo desde el browser)
```

| Responsabilidad | Quién la maneja |
|-----------------|-----------------|
| Autenticación (PIN + token) | `AuthService` en Flutter |
| Listado y acceso a archivos Android | `FileService` en Flutter |
| Streaming de video (Range requests) | `server_service.dart` en Flutter |
| Acceso MTP (Android por USB) | WebUSB, directamente en el browser |
| Servir la interfaz web en escritorio | Launcher Go (su única responsabilidad) |

**Por qué un launcher en Go.** Embebe `dist/` con `go:embed`, levanta un servidor en `127.0.0.1` y abre el browser. Para el usuario final: un solo archivo, doble clic, sin instalar Node ni abrir una terminal, y funciona offline. Para desarrollo: cross-compilación a Windows desde Mac sin VM y binario Universal con `lipo`. El flujo diario no cambia — se sigue trabajando con Vite y Go solo entra al empaquetar.

**Alternativas descartadas:**
- **Electron** — ~150 MB por el Chromium embebido, contra ~10–12 MB del binario Go.
- **Tauri** — en macOS usa WKWebView, que no soporta WebUSB; el modo MTP dejaría de funcionar.
- **Distribuir con Node** — obliga al usuario a tener Node instalado.

**Rendimiento.** Go no acelera las transferencias: sirve archivos locales y ese paso es instantáneo. El cuello de botella es siempre la WiFi, el servidor Flutter leyendo del almacenamiento Android y el browser procesando los blobs. Las optimizaciones de red van en Flutter (Range requests, compresión desactivada para no romperlos).

---

## Desarrollo día a día

### Servidor de desarrollo React

```bash
npm run dev
```

Abre `http://localhost:5173`. Hot reload automático. Ideal para trabajar en la UI sin compilar.

> En modo dev el servidor corre en `localhost` → modo USB activo, modo WiFi no disponible (es esperado).

### Probar el launcher Go localmente

```bash
npm run build
go run main.go
```

Abre `http://localhost:3000` con la build de producción de React. Útil para verificar que el launcher funciona antes de generar el ejecutable final.

### Probar la app Flutter en el teléfono (modo WiFi)

```bash
cd mobile && flutter run
```

Hot reload con `r`, reinicio con `R`. La URL aparece en pantalla.

---

## Escenario 1 — Cambié código React

### → Producto de escritorio (Mac / Windows)

```bash
./scripts/build_desktop.sh
```

Compila React, genera los binarios y arma `dist_bin/WiXplorer_v1.0.zip`.

### → App Android (modo WiFi con web embebida)

```bash
./scripts/build_mobile_web.sh
cd mobile && flutter build apk --release
```

`build_mobile_web.sh` compila React y copia el resultado a `mobile/assets/www/`. Luego Flutter embebe esos assets en el APK.

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
./scripts/build_mobile_web.sh          # 1. Compila React y lo copia a Flutter
cd mobile && flutter build apk --release   # 2. Genera el APK con la web nueva
```

---

## Escenario 4 — Cambié el launcher Go (`main.go`)

```bash
./scripts/build_desktop.sh
```

El script siempre recompila React y luego el Go. Si React no cambió el build es rápido (Vite hace cache).

---

## Productos finales

| Producto | Ruta | Cómo se genera |
|---------|------|----------------|
| ZIP para pendrive (Mac + Win) | `dist_bin/WiXplorer_v1.0.zip` | `./scripts/build_desktop.sh` |
| `.app` macOS | `dist_bin/WiXplorer.app` | `./scripts/build_desktop.sh` |
| `.exe` Windows | `dist_bin/WiXplorer.exe` | `./scripts/build_desktop.sh` |
| APK Android | `mobile/build/app/outputs/flutter-apk/app-release.apk` | `cd mobile && flutter build apk --release` |

---

## Instalación en cada dispositivo

### Mac

```bash
# Opción A — desde el ZIP de distribución
unzip dist_bin/WiXplorer_v1.0.zip
# Abrir Mac/WiXplorer.app con clic derecho → Abrir (solo la primera vez)

# Opción B — probar el .app directamente
open dist_bin/WiXplorer.app
```

Si macOS bloquea la app (Gatekeeper): **clic derecho → Abrir → Abrir**.

### Windows

Copiar `dist_bin/WiXplorer.exe` a la PC destino y hacer doble clic.

Si aparece SmartScreen: **"Más información" → "Ejecutar de todas formas"** (solo la primera vez).

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

| Script | Qué hace |
|--------|----------|
| `npm run dev` | Servidor de desarrollo React (hot reload) |
| `npm run build` | Compila React → `dist/` |
| `npm run lint` | ESLint sobre todo el proyecto web |
| `npm test` | Tests unitarios web (vitest) |
| `go run main.go` | Prueba el launcher Go sin compilar |
| `go test .` | Tests del launcher Go (requiere `dist/`) |
| `cd mobile && flutter test` | Tests unitarios Flutter |
| `./scripts/build_mobile_web.sh` | Compila React y copia a `mobile/assets/www/` |
| `./scripts/build_desktop.sh` | Build completo: React + Go Mac/Win + `.app` + ZIP |
| `cd mobile && flutter run` | App Android en modo debug (hot reload) |
| `cd mobile && flutter build apk --release` | APK de producción |
| `cd mobile && flutter install` | Instala el APK en el teléfono conectado por USB |

---

## Checklist antes de distribuir

- [ ] `npm run lint` y `npm test` sin errores
- [ ] `go test .` y `cd mobile && flutter analyze && flutter test` sin errores
- [ ] `npm run build` sin errores TypeScript
- [ ] `./scripts/build_desktop.sh` genera `dist_bin/WiXplorer_v1.0.zip`
- [ ] Probar el `.app` localmente: doble clic → se abre el browser
- [ ] `./scripts/build_mobile_web.sh && cd mobile && flutter build apk --release`
- [ ] Instalar el APK en el teléfono y probar el flujo WiFi completo (iniciar servidor → URL → PIN → archivos)
- [ ] Actualizar número de versión en `versioninfo.json` y `mobile/pubspec.yaml` si corresponde
