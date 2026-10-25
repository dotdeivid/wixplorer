import 'dart:math';
import 'package:uuid/uuid.dart';

/// Gestiona PIN efímero y session token.
/// Ambos viven solo en memoria — se invalidan al detener el servidor.
class AuthService {
  AuthService._();
  static final AuthService instance = AuthService._();

  String? _pin;
  String? _token;

  // Rate limiting: bloqueo tras 5 intentos fallidos en 60s
  int _failedAttempts = 0;
  DateTime? _blockedUntil;

  static const int _maxAttempts = 5;
  static const Duration _blockDuration = Duration(seconds: 30);

  /// Genera nuevo PIN y token. Llamar al iniciar el servidor.
  void generate() {
    _pin = _generatePin();
    _token = const Uuid().v4();
    _failedAttempts = 0;
    _blockedUntil = null;
  }

  /// Invalida credenciales. Llamar al detener el servidor.
  void invalidate() {
    _pin = null;
    _token = null;
    _failedAttempts = 0;
    _blockedUntil = null;
  }

  String? get currentPin => _pin;
  bool get hasCredentials => _pin != null && _token != null;

  bool get isBlocked {
    if (_blockedUntil == null) return false;
    if (DateTime.now().isAfter(_blockedUntil!)) {
      _blockedUntil = null;
      _failedAttempts = 0;
      return false;
    }
    return true;
  }

  /// Valida el PIN recibido del cliente web.
  /// Retorna el session token si es correcto, null si no.
  String? validatePin(String pin) {
    if (isBlocked) return null;
    if (_pin == null || _token == null) return null;

    if (pin == _pin) {
      _failedAttempts = 0;
      return _token;
    }

    _failedAttempts++;
    if (_failedAttempts >= _maxAttempts) {
      _blockedUntil = DateTime.now().add(_blockDuration);
    }
    return null;
  }

  /// Valida el Bearer token en cada request protegido.
  bool validateToken(String token) {
    if (_token == null) return false;
    return token == _token;
  }

  static String _generatePin() {
    final rng = Random.secure();
    // 6 dígitos: 100000–999999
    return (rng.nextInt(900000) + 100000).toString();
  }
}
