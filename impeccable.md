# WiXplorer — Plan de mejoras de UI (crítica de impeccable)

Plan surgido de la crítica `$impeccable critique` del 14/11/2026 sobre la web de WiXplorer (`src/components/layout/AppLayout.tsx` y todos los componentes). El informe completo está archivado en `.impeccable/critique/2026-11-14T01-08-06Z__src-components-layout-applayout-tsx.md`.

**Puntaje: 22/40 (Aceptable).** Hay 0 problemas P0, 3 P1 y 2 P2, más observaciones menores.

## Estado

**Implementado** en la rama `feat/ui-polish`: fases A, B y C completas. Solo queda pendiente el ítem opcional de A2 (implementar renombrar, mover y crear carpeta en el servidor del teléfono).

Además de lo planificado:
- Los íconos de tipo de archivo también pasaron de emoji a vectores.
- Los errores al conectar por USB tienen mensajes propios.

## Decisiones tomadas

- **Identidad:** se mantiene el lenguaje visual de Finder (modo oscuro de macOS). Esto no es un rediseño: se pule usabilidad y accesibilidad y se conserva el look actual, el comportamiento y el texto.
- **Prioridad:** los tres P1 (teclado, capacidades en WiFi y primer uso) se encaran juntos, primero.
- **Alcance:** todo, es decir los problemas prioritarios y las observaciones menores.

## Puntaje por heurística

| # | Heurística | Puntaje | Problema principal |
|---|---|---|---|
| 1 | Visibilidad del estado | 3 | En WiFi no se ve el dispositivo conectado; la ubicación es un nombre truncado y sin ruta |
| 2 | Coincidencia con el mundo real | 3 | "DCIM", "Agrupar por clase", zip llamado `pt_files.zip` |
| 3 | Control y libertad | 2 | No hay deshacer; Pegar exige una carpeta seleccionada |
| 4 | Consistencia | 2 | Mezcla de tú y vos; ninguna tecla estándar de explorador funciona |
| 5 | Prevención de errores | 2 | En WiFi se ofrecen renombrar, cortar y mover, que fallan |
| 6 | Reconocer en vez de recordar | 2 | Las acciones solo están en el clic derecho; los íconos se explican solo con `title` |
| 7 | Flexibilidad y eficiencia | 2 | Sin atajos; vista y orden no persisten; los encabezados no ordenan |
| 8 | Diseño estético y minimalista | 3 | Crédito del autor fijo en la barra lateral; emojis junto a íconos vectoriales |
| 9 | Recuperación de errores | 2 | Excepción cruda en los mensajes; búsqueda sin resultados dice "carpeta vacía" |
| 10 | Ayuda y documentación | 1 | Primer uso de una frase; sin explicación de WiFi ni detección de WebUSB |

---

## Fase A — Los tres P1, juntos

### A1. Operación por teclado y semántica · `$impeccable harden` · P1

- **Problema:** los archivos son `div` sin foco ni rol (`FileItem.tsx:134`, `FileListItem.tsx:110`). La barra lateral, el menú de orden y los recientes son `div onClick` (`Sidebar.tsx:104`, `SortDropdown.tsx:66`, `RecentsView.tsx:130`). No hay manejo global de teclas.
- **Qué hacer:**
  - [x] Grilla o lista con un solo elemento enfocable (roving tabindex): `role="grid"`/`listbox` en el contenedor, `role="gridcell"`/`option` en los ítems y `aria-selected` según la selección. Debe andar en las vistas de grilla, lista, columnas y galería.
  - [x] Atajos (con ⌘ en macOS y Ctrl en Windows/Linux). Que no se disparen mientras se escribe en la búsqueda, en un renombrado o en un diálogo.

    | Tecla | Acción |
    |---|---|
    | Flechas | Moverse; con Shift, extender la selección |
    | Enter | Abrir la carpeta o hacer preview/descargar el archivo |
    | ⌘↑ / Backspace | Subir de carpeta |
    | ⌘← / ⌘→ | Atrás / adelante |
    | Supr / ⌘⌫ | Eliminar (pasa por el diálogo de A1·P2) |
    | F2 / Enter en macOS | Renombrar |
    | ⌘A | Seleccionar todo |
    | ⌘F | Ir a la búsqueda |
    | Esc | Cerrar menú o diálogo, o limpiar la selección |
  - [x] Barra lateral: filas como `<button>`, con `aria-current="page"` en la sección activa.
  - [x] Menú de orden: `role="menu"` con opciones `role="menuitemradio"` y `aria-checked`, navegación con flechas, cierre con Esc y devolución del foco al botón.
  - [x] Recientes: filas como `<button>`.
  - [x] Menú contextual: `role="menu"`/`menuitem`, flechas, Esc, y abrirlo también con Shift+F10 o la tecla de menú.

### A2. Capacidades por modo de conexión · `$impeccable harden` · P1

- **Problema:** en WiFi, Renombrar, Cortar, Pegar y arrastrar para mover llaman a `mtpState` (`AppLayout.tsx:291,314,344`), y el hook de red solo implementa eliminar. Solo "Nueva carpeta" está condicionada a USB.
- **Qué hacer:**
  - [x] Definir un objeto `capabilities` por modo (`canRename`, `canMove`, `canCreateFolder`, `canDelete`, `canDownload`) que exponga cada hook (`useMTPDevice` y `useNetworkDevice`) y que `AppLayout` use para todo.
  - [x] Menú contextual: mostrar deshabilitado lo que no se puede hacer, con el motivo como texto secundario ("No disponible por WiFi"), en lugar de ocultarlo, para que se entienda la diferencia entre modos.
  - [x] Deshabilitar arrastrar para mover y la inline rename cuando no hay soporte.
  - [x] Atajos de teclado (A1) que respeten las mismas capacidades.
  - [ ] *Opcional, fuera de la UI:* implementar renombrar, mover y crear carpeta en el servidor Flutter, para igualar los modos.

### A3. Primer uso: enseñar los dos caminos · `$impeccable onboard` · P1

- **Problema:** el estado vacío es solo texto (`FileExplorer.tsx:404`) y el estilo `.emptyConnectBtn` (`FileExplorer.module.css:95`) no se usa. Desde el launcher no hay entrada a WiFi (`networkState.devices` solo se llena en modo auto-hospedado, `useNetworkDevice.ts:237`) y no se detecta si hay WebUSB.
- **Qué hacer:**
  - [x] Estado vacío con dos tarjetas en el estilo actual:
    - **USB:** botón principal "Conectar por USB" (con `.emptyConnectBtn`) y tres pasos (conectá el cable, elegí "Transferencia de archivos", desbloqueá la pantalla).
    - **WiFi:** "Abrí WiXplorer en el teléfono, tocá Iniciar y entrá a la dirección que muestra (o escaneá el QR)".
  - [x] Detectar si hay WebUSB (`'usb' in navigator`). Si no hay, deshabilitar la tarjeta USB con el motivo: "Tu navegador no soporta USB. Usá Chrome o Edge, o conectate por WiFi."
  - [x] Desde el launcher: un acceso "Conectar por WiFi…" que pida IP y puerto y luego abra el diálogo de PIN, o que explique abrir la URL del teléfono.
  - [x] Ayuda breve con un enlace "¿Cómo me conecto?" desde la barra lateral que vuelve a mostrar los dos caminos.

---

## Fase B — P2

### B1. Diálogo de borrado propio · `$impeccable clarify` · P2

- **Problema:** se usa `window.confirm` (`AppLayout.tsx:276`) y el aviso dice "3 elementos eliminado" (`:281`), sin plural.
- **Qué hacer:**
  - [x] Diálogo con el estilo de `RenameDialog.module.css`:
    - Título "¿Eliminar del teléfono?".
    - Lista con los nombres (los primeros 3 y "y N más") y el tamaño total.
    - Aviso "No se puede deshacer".
    - Botones Cancelar (con el foco inicial) y "Eliminar" en color destructivo.
  - [x] Aviso de éxito con plural correcto: "1 elemento eliminado" / "3 elementos eliminados".
  - [x] Errores sin la excepción cruda: "No se pudo eliminar «foto.jpg». Puede estar protegido o ya no existir.", con el detalle técnico en consola.

### B2. Contraste, foco, movimiento, tema e idioma · `$impeccable polish` · P2

- **Problema:** contrastes estimados por debajo de WCAG AA.

  | Elemento | Contraste |
  |---|---|
  | `--text-tertiary` (0.35 de alfa) | ≈3:1 en 12px |
  | Etiquetas de la barra lateral (0.40) | ≈3.8:1 en 11px |
  | Pie de la barra lateral | ≈1.9:1 y 2.5:1 |
  | Blanco sobre `#007aff` | ≈4:1 |
  | Enlace `#007aff` | ≈4.1:1 en 10px |
- **Qué hacer:**
  - [x] Tokens en `theme.css`:
    - `--text-tertiary` a ~0.55 de alfa.
    - Etiquetas de la barra lateral a ≥0.55.
    - Fondo `#0060d4` (o similar con ≥4.5:1) detrás del texto blanco.
    - Definir `--color-sidebar-icon`, que se usa pero no existe (`Sidebar.module.css:87`).
  - [x] Anillos de foco con `:focus-visible` en todos los controles (2px del color de acento, con separación).
  - [x] Bloque `@media (prefers-reduced-motion: reduce)` para el temblor del PIN, los spinners, la animación de carga y las transiciones.
  - [x] Tema claro "Finder Light" con `prefers-color-scheme` (incluido el `Toaster` de `App.tsx:7`), sin cambiar el modo oscuro actual.
  - [x] `<html lang="es">` en `index.html`.
  - [x] Accesibilidad de componentes:
    - Diálogos con `role="dialog"`, `aria-modal`, foco atrapado y devolución del foco al cerrar (`PinDialog`, `NewFolderDialog`, el nuevo de borrado).
    - `aria-label` en las casillas del PIN ("Dígito 1 de 6"), en los botones de ícono (cerrar el PIN, expulsar, cerrar el error) y en la búsqueda.
    - `aria-pressed` en los botones de vista.
    - `aria-live="polite"` en la barra de estado para anunciar descargas y errores.

---

## Fase C — Observaciones menores · `$impeccable polish` / `$impeccable clarify`

### Texto y consistencia
- [x] Unificar en voseo: "Conectá", "Seleccioná", "Ingresá" (`FileExplorer.tsx:411`, `NewFolderDialog.tsx:35`, `AppLayout.tsx:312`, `RecentsView.tsx:80`).
- [x] Renombrar el zip `pt_files.zip` a `WiXplorer_<carpeta>_<fecha>.zip` (`AppLayout.tsx:242`).
- [x] Búsqueda sin resultados: "Ningún archivo coincide con «x»" en lugar de "Esta carpeta está vacía" (`FileExplorer.tsx:587`).
- [x] "Clase": ordenar y agrupar por el mismo criterio (categoría), o renombrar el orden a "Extensión".
- [x] DCIM: mostrarlo como "Cámara (DCIM)" en Favoritos.

### Estado y feedback
- [x] El botón Descargar del panel debe usar el estado de descarga real, no el `isLoading` global (`AppLayout.tsx:586`).
- [x] Reemplazar el 🔄 estático y los "..." de la vista de columnas por un spinner real que respete el movimiento reducido.
- [x] La barra de estado tiene que contar los archivos filtrados durante la búsqueda (`AppLayout.tsx:599`).
- [x] Indicador del dispositivo conectado también en WiFi: nombre, tipo de conexión y botón de desconectar en la barra lateral o el encabezado.
- [x] Ruta completa o breadcrumb en la barra de herramientas, en lugar del nombre truncado (`Toolbar.tsx:159`). Sacar el `background-color` sobrante (`Toolbar.module.css:62`).
- [x] Marcar visualmente los archivos cortados (opacidad reducida) mientras estén en el portapapeles.

### Control y eficiencia
- [x] Pegar en la carpeta actual cuando no hay una carpeta seleccionada (`AppLayout.tsx:312`).
- [x] Guardar vista, orden y agrupación en `localStorage`, envuelto en try/catch (`AppLayout.tsx:76-78`).
- [x] Encabezados de la vista de lista que ordenen al hacer clic y alternen la dirección (`FileExplorer.tsx:113`); el orden por tamaño y fecha hoy es solo descendente.
- [x] Botón Descargar también con varios archivos seleccionados en el panel de preview (`PreviewPanel.tsx:310`).
- [x] Virtualizar la grilla, la vista agrupada y la galería para carpetas con miles de archivos como DCIM (`FileExplorer.tsx:466,563`).
- [x] Permitir seleccionar texto en nombres y mensajes: quitar `user-select: none` global y aplicarlo solo donde moleste al arrastrar (`index.css:15`).

### Visual y limpieza
- [x] Reemplazar los emojis de estado (📱 🔄 📁 🕐 ⚠️) por íconos vectoriales consistentes con la carpeta (lucide-react ya es dependencia).
- [x] Pasar el crédito del autor y el enlace de GitHub a un "Acerca de" (`Sidebar.tsx:186-197`), y tomar la versión de `package.json` en lugar de "v1.0.0" fijo.
- [x] Área táctil de al menos 24px para la "✕" del banner de error, con ícono y `aria-label` (`AppLayout.tsx:527`).
- [x] `title` en las filas de la lista para leer los nombres truncados (`FileListItem.tsx:131`).
- [x] Que la búsqueda no cambie de ancho al enfocarla (`Toolbar.module.css:172`) y que su borde de foco sea visible.
- [x] Mover los estilos inline a los módulos CSS (`FileExplorer.tsx:506` y otros).
- [x] Borrar el código muerto: `GroupDropdown.tsx` y su CSS (y `RenameDialog.tsx` si sigue sin uso, conservando el CSS que comparte `NewFolderDialog`). Quitar `GroupMode` 'date' o darle interfaz.

---

## Orden recomendado de comandos

1. **`$impeccable harden`**: A1 (teclado y semántica) y A2 (capacidades por modo). Comparten el mismo código de `AppLayout` y el menú contextual.
2. **`$impeccable onboard`**: A3 (estado vacío de dos caminos, detección de WebUSB, conexión WiFi desde el launcher).
3. **`$impeccable clarify`**: B1 (diálogo de borrado y errores) y los puntos de texto de la Fase C.
4. **`$impeccable polish`**: B2 (contraste, foco, movimiento reducido, tema claro, `lang`, accesibilidad de diálogos) y el resto de la Fase C.
5. **`$impeccable critique`**: volver a medir. Conviene hacerlo con navegador disponible, así el detector evalúa también contraste y tamaño de texto en la página renderizada.

> Se pueden correr de a uno, todos juntos o en el orden que prefieras.
