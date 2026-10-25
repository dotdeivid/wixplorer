# Dudas sobre el empaquetado portable con Go

---

## 1. Cuando migremos a Go, ¿el backend funcionará igual que cuando tenía Node.js?

**Sí, y es importante entender por qué:** en este proyecto nunca hubo un backend en Node.js. Node.js solo existe como herramienta de desarrollo — es Vite, el dev server que usas con `npm run dev`. No tiene lógica de negocio, autenticación, ni API propia.

El "backend real" de WiXplorer siempre fue el servidor **Flutter** que corre en el teléfono. Él maneja:
- Autenticación con PIN y token Bearer
- Listado de archivos del sistema Android
- Descarga/streaming de archivos con Range requests
- Thumbnails de imágenes y videos

Go **no reemplaza** ninguno de esos componentes. Go solo hace lo que hoy hace Vite en producción: servir los archivos HTML/JS/CSS del build de React en `localhost`. La arquitectura completa sigue siendo:

```
Navegador (React) ←→ Go launcher (localhost:3000, archivos estáticos)
Navegador (React) ←→ Flutter server (192.168.x.x:7070, API real)
Navegador (React) ←→ WebUSB (MTP via USB directo en el browser)
```

Go es el "portero silencioso" que levanta el servidor local y abre el browser. Nada más.

---

## 2. ¿No le faltará nada al backend de Go? ¿Será completo en autenticación, seguridad, funciones, etc.?

No le falta nada porque **Go no hace ninguna de esas cosas** — y no tiene que hacerlas.

| Responsabilidad | Quién la maneja |
|----------------|-----------------|
| Autenticación (PIN + token) | Servidor Flutter en el teléfono |
| Seguridad de red (solo LAN) | Diseño de red (sin exposición a Internet) |
| Listado y acceso a archivos Android | `FileService` en Flutter |
| Streaming de video (Range requests) | `server_service.dart` en Flutter |
| Acceso MTP (Android via USB) | WebUSB API directamente en el browser |
| Servir la interfaz web | **Go** (su única responsabilidad) |

El único riesgo teórico de seguridad del Go launcher es que expone `localhost:3000` en la máquina del usuario. Eso es el comportamiento esperado y normal para cualquier app web local.

---

## 3. ¿Cuáles son los comandos finales para empaquetar y distribuir?

El flujo completo de principio a fin:

```bash
# 1. Build de React (genera dist/)
npm run build

# 2. Empaquetar todo en los ejecutables
./build.sh
```

El script `build.sh` genera:
```
dist_bin/
  WiXplorer_mac.zip   → descomprimir → doble clic en WiXplorer.app
  WiXplorer.exe       → doble clic directo
```

El usuario no instala Node.js, no abre ninguna terminal, no configura nada. Solo abre el archivo y el browser se lanza automáticamente apuntando a `localhost:3000` con la app lista.

---

## 4. ¿Seguimos desarrollando en Node.js y lo empaquetamos en Go, o ahora desarrollaremos solo en Go?

**Seguís desarrollando 100% en Node.js / React exactamente igual que hasta ahora.**

Go solo aparece en el momento de distribuir la app a un usuario final. No cambia nada del flujo de trabajo diario:

```
Desarrollo   →  npm run dev          (Vite dev server con HMR)
Build        →  npm run build        (genera dist/)
Distribución →  ./build.sh           (Go empaqueta dist/ → ejecutable)
```

Go no toca ni un archivo `.tsx`, `.ts` ni `.css`. Es literalmente un paso extra al final, como comprimir en zip. Incluso podrías añadirlo como script en `package.json`:

```json
"scripts": {
  "dist": "npm run build && ./build.sh"
}
```

El 99% del tiempo trabajás con Vite como siempre. Go solo entra cuando querés hacer un release.

---

## 5. ¿Qué ventajas obtenemos con el empaquetado en Go?

**Para el usuario final (la ventaja más importante):**
- No instala Node.js, npm, ni ninguna dependencia.
- No abre una terminal. Doble clic → app lista.
- Funciona offline completamente (la UI está embebida en el ejecutable).
- Un solo archivo para distribuir.

**Para vos como desarrollador:**
- El flujo de desarrollo no cambia en absoluto.
- Compilación cruzada nativa: desde tu Mac generás el .exe de Windows en segundos, sin necesitar una VM.
- Binario Universal Mac (arm64 + amd64) con un solo comando (`lipo`).
- Sin instaladores complejos para la distribución básica.
- El binario final pesa ~10–12 MB (Go runtime + dist de React comprimida).

**Comparado con alternativas:**
- vs Electron: Go pesa 10 MB vs Electron que pesa 150+ MB y requiere Chromium embebido.
- vs Tauri: Go no rompe WebUSB en Mac (ver pregunta 3).
- vs un instalador Node.js: el usuario no necesita tener Node instalado.

---

## 6. ¿Esto aceleraría las requests, descargas, subidas y demás en la red?

**No directamente**, y es importante entender por qué no es necesario.

El cuello de botella en WiXplorer **nunca es el servidor de archivos estáticos** (Go). Es siempre:

1. **La velocidad de la red WiFi** entre tu computadora y el teléfono.
2. **El servidor Flutter** en el teléfono, que lee archivos del almacenamiento interno.
3. **El browser procesando** los blobs descargados.

Go sirve `localhost:3000` — archivos que ya están en memoria/disco local del mismo equipo. Eso es básicamente instantáneo (nanosegundos). Cambiar ese servidor de Vite a Go no va a hacer que tus descargas de 100 MB desde el teléfono vayan más rápido.

La mejora de velocidad real vendría de optimizar el **servidor Flutter**, que es quien hace el trabajo pesado: leer el archivo del storage Android, empaquetarlo en HTTP y enviarlo por WiFi. Eso ya tiene Range requests implementados (para video) y compresión desactivada (para no interferir con los Range requests).

En resumen: Go mejora la **experiencia de instalación y distribución**, no el rendimiento de red. El rendimiento de red depende de Flutter + WiFi.
