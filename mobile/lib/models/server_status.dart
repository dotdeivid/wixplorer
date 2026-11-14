enum ServerStatus { stopped, starting, running, error }

class ServerState {
  final ServerStatus status;
  final String? ip;
  final int port;
  final String? pin;
  final String? errorMessage;
  /// Se activa cuando pasan 15 minutos sin ninguna petición al servidor.
  final bool inactivityWarning;
  /// true cuando no se concedió acceso a todos los archivos (Android 11+):
  /// el servidor solo ve fotos, videos y audio.
  final bool limitedAccess;
  /// Cuándo se detendrá solo el servidor si sigue sin actividad
  /// (se informa junto con [inactivityWarning]).
  final DateTime? autoStopAt;

  const ServerState({
    required this.status,
    this.ip,
    this.port = 7070,
    this.pin,
    this.errorMessage,
    this.inactivityWarning = false,
    this.limitedAccess = false,
    this.autoStopAt,
  });

  const ServerState.stopped()
      : status = ServerStatus.stopped,
        ip = null,
        port = 7070,
        pin = null,
        errorMessage = null,
        inactivityWarning = false,
        limitedAccess = false,
        autoStopAt = null;

  bool get isRunning => status == ServerStatus.running;
  bool get isBusy => status == ServerStatus.starting;

  /// Retorna una copia con el aviso de inactividad modificado.
  /// [autoStopAt] se reemplaza siempre (pasar null lo borra).
  ServerState copyWith({bool? inactivityWarning, DateTime? autoStopAt}) {
    return ServerState(
      status: status,
      ip: ip,
      port: port,
      pin: pin,
      errorMessage: errorMessage,
      inactivityWarning: inactivityWarning ?? this.inactivityWarning,
      limitedAccess: limitedAccess,
      autoStopAt: autoStopAt,
    );
  }
}
