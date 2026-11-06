import 'package:flutter_test/flutter_test.dart';
import 'package:wixplorer_mobile/services/auth_service.dart';

void main() {
  final auth = AuthService.instance;

  /// Un PIN de 6 dígitos distinto del actual.
  String wrongPin() => auth.currentPin == '000000' ? '111111' : '000000';

  setUp(auth.generate);
  tearDown(auth.invalidate);

  group('generate', () {
    test('crea un PIN de 6 dígitos', () {
      expect(auth.currentPin, matches(RegExp(r'^[1-9]\d{5}$')));
      expect(auth.hasCredentials, isTrue);
    });

    test('cada llamada genera un token nuevo', () {
      final first = auth.validatePin(auth.currentPin!);
      auth.generate();
      final second = auth.validatePin(auth.currentPin!);
      expect(first, isNotNull);
      expect(second, isNot(first));
      expect(auth.validateToken(first!), isFalse);
    });
  });

  group('validatePin', () {
    test('con el PIN correcto devuelve un token válido', () {
      final token = auth.validatePin(auth.currentPin!);
      expect(token, isNotNull);
      expect(auth.validateToken(token!), isTrue);
    });

    test('con un PIN incorrecto devuelve null', () {
      expect(auth.validatePin(wrongPin()), isNull);
      expect(auth.isBlocked, isFalse);
    });

    test('bloquea tras 5 intentos fallidos, incluso con el PIN correcto', () {
      for (var i = 0; i < 4; i++) {
        auth.validatePin(wrongPin());
      }
      expect(auth.isBlocked, isFalse);

      auth.validatePin(wrongPin());
      expect(auth.isBlocked, isTrue);
      expect(auth.validatePin(auth.currentPin!), isNull);
    });

    test('un acierto reinicia el contador de fallos', () {
      for (var i = 0; i < 4; i++) {
        auth.validatePin(wrongPin());
      }
      expect(auth.validatePin(auth.currentPin!), isNotNull);

      auth.validatePin(wrongPin());
      expect(auth.isBlocked, isFalse);
    });

    test('generate() levanta el bloqueo', () {
      for (var i = 0; i < 5; i++) {
        auth.validatePin(wrongPin());
      }
      auth.generate();
      expect(auth.isBlocked, isFalse);
    });
  });

  group('invalidate', () {
    test('invalida el token y el PIN', () {
      final token = auth.validatePin(auth.currentPin!)!;
      auth.invalidate();
      expect(auth.hasCredentials, isFalse);
      expect(auth.validateToken(token), isFalse);
      expect(auth.validatePin(token), isNull);
    });
  });

  test('validateToken rechaza tokens arbitrarios', () {
    expect(auth.validateToken(''), isFalse);
    expect(auth.validateToken('no-es-el-token'), isFalse);
  });
}
