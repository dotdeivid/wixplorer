Contexto del Proyecto: Estoy desarrollando una Web App para transferencia de archivos Android-macOS vía MTP. Dado que macOS no soporta MTP nativamente, usaremos WebUSB API y File System Access API. El enfoque es "Privacy-first" y "No-Third-Party-Software".
Stack Tecnológico:
* Vite + React + TypeScript (Strict Mode).
* Estilos: CSS Modules únicamente (Prohibido Tailwind, Styled Components o Inline Styles).
* APIs: WebUSB y File System Access.
Especificaciones Técnicas del Protocolo MTP:
1. Estructura de Paquetes: Implementa MTPContainer (Header 12 bytes: Length, Type, Code, TransactionID).
2. Endianness: Todo el parsing con DataView debe ser Little Endian.
3. State Management: Trackear SessionID y TransactionID incremental.
4. Bulk Transfers: Manejar transferOut para comandos y transferIn para respuestas (incluyendo paquetes fragmentados).
Diseño y UI (Estilo macOS Finder):
1. Layout Estructural:
    * Sidebar Izquierdo: Fondo gris traslúcido (rgba(243, 243, 243, 0.7) con backdrop-filter: blur), que liste el dispositivo conectado y carpetas favoritas.
    * Toolbar Superior: Botones de navegación (Atrás/Adelante), nombre de la carpeta actual y botón de "Conectar".
    * Main Content Area: Grilla o lista de archivos con fondo blanco y scroll suave.
2. Estética Visual:
    * Tipografía: Usar stack de fuentes de sistema de Apple (-apple-system, BlinkMacSystemFont, "Segoe UI").
    * Componentes: Bordes redondeados de 8px, iconos minimalistas y estados de hover sutiles.
    * Interactividad: Los elementos deben reaccionar al doble clic para entrar en carpetas.
Features Necesarias (MVP):
1. Connection Manager: Manejo de requestDevice y errores de "Interface busy".
2. Handshake: Secuencia OpenSession -> GetDeviceInfo -> GetStorageIDs.
3. File Explorer: Listar y navegar objetos usando GetObjectHandles y GetObjectInfo.
4. Download Flow: Descarga de bytes vía GetObject y escritura local con window.showSaveFilePicker.
Instrucciones de Arquitectura:
* Separa la lógica en /src/services/mtp/, /src/services/usb/ y los componentes en /src/components/.
* Cada componente debe tener su archivo .module.css dedicado.
* Usa un Custom Hook useMTPDevice para centralizar el estado del hardware.

Para que los estilos se vean realmente pro usando CSS Modules, crea un archivo variables.module.css o theme.css global con los colores oficiales de macOS:
* Sidebar Background: #ececec o con transparencia.
* Active Item Blue: #007aff.
* Border Color: #dcdcdc.

Tener en cuenta, que la funcionalidad y navegación (doble click, click derecho para eliminar algo y demas) debe ser igual que mac