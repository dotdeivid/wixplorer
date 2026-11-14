import 'dart:math';
import 'package:uuid/uuid.dart';

import 'http_security.dart';

/// Intentos fallidos de un cliente (IP) dentro de la ventana actual.
class _Attempts {
  int failures = 0;
  DateTime windowStart;
  DateTime? blockedUntil;

  _Attempts(this.windowStart);
}

/// Gestiona PIN efímero y session token.
/// Ambos viven solo en memoria — se invalidan al detener el servidor.
class AuthService {
  AuthService._();
  static final AuthService instance = AuthService._();

  String? _pin;
  String? _token;

  // Rate limiting por cliente: 5 intentos fallidos dentro de 60 s bloquean a
  // ese cliente durante 30 s. Es por IP para que un equipo de la red no pueda
  // dejar afuera al usuario legítimo mandando PINs malos.
  final Map<String, _Attempts> _attempts = {};

  static const int _maxAttempts = 5;
  static const Duration _attemptWindow = Duration(seconds: 60);
  static const Duration _blockDuration = Duration(seconds: 30);
  // Tope de clientes rastreados — evita que el mapa crezca sin límite.
  static const int _maxTrackedClients = 256;

  /// Genera nuevo PIN y token. Llamar al iniciar el servidor.
  void generate() {
    _pin = _generatePin();
    _token = const Uuid().v4();
    _attempts.clear();
  }

  /// Invalida credenciales. Llamar al detener el servidor.
  void invalidate() {
    _pin = null;
    _token = null;
    _attempts.clear();
  }

  String? get currentPin => _pin;
  bool get hasCredentials => _pin != null && _token != null;

  /// Duración del bloqueo tras demasiados intentos fallidos.
  Duration get blockDuration => _blockDuration;

  /// true si [client] está bloqueado por demasiados intentos fallidos.
  bool isBlockedFor(String client) {
    final a = _attempts[client];
    final until = a?.blockedUntil;
    if (until == null) return false;
    if (DateTime.now().isAfter(until)) {
      _attempts.remove(client);
      return false;
    }
    return true;
  }

  /// Bloqueo del cliente por defecto (sin IP conocida).
  bool get isBlocked => isBlockedFor('');

  /// Valida el PIN recibido del cliente web.
  /// Retorna el session token si es correcto, null si no.
  String? validatePin(String pin, {String client = ''}) {
    if (isBlockedFor(client)) return null;
    if (_pin == null || _token == null) return null;

    if (constantTimeEquals(pin, _pin!)) {
      _attempts.remove(client);
      return _token;
    }

    _registerFailure(client);
    return null;
  }

  /// Valida el Bearer token en cada request protegido.
  bool validateToken(String token) {
    final current = _token;
    if (current == null) return false;
    return constantTimeEquals(token, current);
  }

  void _registerFailure(String client) {
    final now = DateTime.now();
    var a = _attempts[client];
    if (a == null || now.difference(a.windowStart) > _attemptWindow) {
      if (a == null && _attempts.length >= _maxTrackedClients) _pruneExpired(now);
      a = _Attempts(now);
      _attempts[client] = a;
    }
    a.failures++;
    if (a.failures >= _maxAttempts) {
      a.blockedUntil = now.add(_blockDuration);
    }
  }

  void _pruneExpired(DateTime now) {
    _attempts.removeWhere((_, a) {
      final until = a.blockedUntil;
      if (until != null) return now.isAfter(until);
      return now.difference(a.windowStart) > _attemptWindow;
    });
    // Si siguen todos activos, descartar el más viejo.
    if (_attempts.length >= _maxTrackedClients) {
      _attempts.remove(_attempts.keys.first);
    }
  }

  static String _generatePin() {
    final rng = Random.secure();
    // 6 dígitos: 100000–999999
    return (rng.nextInt(900000) + 100000).toString();
  }
}
