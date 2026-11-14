import 'package:flutter_test/flutter_test.dart';
import 'package:wixplorer_mobile/services/http_security.dart';

void main() {
  group('isAllowedOrigin', () {
    test('permite loopback en cualquier puerto', () {
      expect(isAllowedOrigin('http://localhost:3000'), isTrue);
      expect(isAllowedOrigin('http://127.0.0.1:54321'), isTrue);
      expect(isAllowedOrigin('http://[::1]:5173'), isTrue);
    });

    test('permite el propio origen del teléfono', () {
      expect(isAllowedOrigin('http://192.168.0.10:7070', host: '192.168.0.10:7070'), isTrue);
    });

    test('rechaza otros orígenes', () {
      expect(isAllowedOrigin('http://192.168.0.66:8080', host: '192.168.0.10:7070'), isFalse);
      expect(isAllowedOrigin('https://evil.example', host: '192.168.0.10:7070'), isFalse);
      expect(isAllowedOrigin('http://localhost.evil.example'), isFalse);
      expect(isAllowedOrigin('null'), isFalse);
    });

    test('mismo host pero otro puerto no es el propio origen', () {
      expect(isAllowedOrigin('http://192.168.0.10:8080', host: '192.168.0.10:7070'), isFalse);
    });
  });

  group('contentDisposition', () {
    test('nombre ASCII', () {
      expect(contentDisposition('foto.jpg'),
          'attachment; filename="foto.jpg"; filename*=UTF-8\'\'foto.jpg');
    });

    test('nombre con acentos: fallback ASCII + UTF-8 codificado', () {
      expect(contentDisposition('canción.mp3', inline: true),
          'inline; filename="canci_n.mp3"; filename*=UTF-8\'\'canci%C3%B3n.mp3');
    });

    test('comillas y barras no rompen el header', () {
      expect(contentDisposition('a"b\\c.txt'), startsWith('attachment; filename="a_b_c.txt"'));
    });
  });

  group('isSafeInlineType', () {
    test('multimedia sí, SVG/HTML no', () {
      expect(isSafeInlineType('image/jpeg'), isTrue);
      expect(isSafeInlineType('video/mp4'), isTrue);
      expect(isSafeInlineType('audio/mpeg'), isTrue);
      expect(isSafeInlineType('image/svg+xml'), isFalse);
      expect(isSafeInlineType('text/html'), isFalse);
      expect(isSafeInlineType('application/pdf'), isFalse);
    });
  });

  group('constantTimeEquals', () {
    test('compara contenido y longitud', () {
      expect(constantTimeEquals('abc', 'abc'), isTrue);
      expect(constantTimeEquals('abc', 'abd'), isFalse);
      expect(constantTimeEquals('abc', 'abcd'), isFalse);
      expect(constantTimeEquals('', ''), isTrue);
    });
  });
}
