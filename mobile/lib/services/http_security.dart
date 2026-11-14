/// Helpers de seguridad HTTP del servidor: CORS, Content-Disposition y
/// comparación de secretos.
library;

import 'dart:convert';

/// true si un request con header `Origin: [origin]` puede usar la API.
///
/// Se permiten:
/// - La web servida por el propio teléfono (modo auto-hospedado): el origen
///   coincide con el `Host` del request.
/// - La web en desarrollo (Vite), que corre en loopback (`localhost`,
///   `127.0.0.1`, `[::1]`) en cualquier puerto.
///
/// Cualquier otra página (p.ej. un sitio abierto en un navegador de la red)
/// queda afuera, aunque no conozca el token.
bool isAllowedOrigin(String origin, {String? host}) {
  final uri = Uri.tryParse(origin);
  if (uri == null || uri.scheme != 'http' || uri.host.isEmpty) return false;
  if (const {'localhost', '127.0.0.1', '::1'}.contains(uri.host)) return true;
  if (host == null || host.isEmpty) return false;
  return uri.authority.toLowerCase() == host.toLowerCase();
}

/// Valor de `Content-Disposition` con el nombre en ASCII (`filename`) y en
/// UTF-8 (`filename*`, RFC 6266), así los nombres con acentos o emojis
/// llegan intactos y los navegadores viejos tienen un nombre legible.
String contentDisposition(String filename, {bool inline = false}) {
  final ascii = filename.replaceAll(RegExp(r'[^\x20-\x7E]|["\\]'), '_');
  final encoded = Uri.encodeComponent(filename)
      // encodeComponent deja estos sin codificar; en attr-char no van
      .replaceAll("'", '%27')
      .replaceAll('(', '%28')
      .replaceAll(')', '%29')
      .replaceAll('*', '%2A');
  final type = inline ? 'inline' : 'attachment';
  return '$type; filename="$ascii"; filename*=UTF-8\'\'$encoded';
}

/// Tipos que se pueden mostrar `inline` sin riesgo: multimedia que el
/// navegador no ejecuta. SVG es imagen pero puede llevar scripts.
bool isSafeInlineType(String mimeType) {
  if (mimeType == 'image/svg+xml') return false;
  return mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('audio/');
}

/// Compara dos strings en tiempo constante respecto del contenido, para no
/// filtrar por timing cuántos caracteres de un token coinciden.
bool constantTimeEquals(String a, String b) {
  final x = utf8.encode(a);
  final y = utf8.encode(b);
  var diff = x.length ^ y.length;
  for (var i = 0; i < x.length; i++) {
    diff |= x[i] ^ (i < y.length ? y[i] : 0);
  }
  return diff == 0;
}
