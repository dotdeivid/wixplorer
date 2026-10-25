enum ServerStatus { stopped, starting, running, error }

class ServerState {
  final ServerStatus status;
  final String? ip;
  final int port;
  final String? pin;
  final String? errorMessage;
  /// Se activa cuando pasan 15 minutos sin ninguna petición al servidor.
  final bool inactivityWarning;

  const ServerState({
    required this.status,
    this.ip,
    this.port = 7070,
    this.pin,
    this.errorMessage,
    this.inactivityWarning = false,
  });

  const ServerState.stopped()
      : status = ServerStatus.stopped,
        ip = null,
        port = 7070,
        pin = null,
        errorMessage = null,
        inactivityWarning = false;

  bool get isRunning => status == ServerStatus.running;
  bool get isBusy => status == ServerStatus.starting;

  /// Retorna una copia con [inactivityWarning] modificado.
  ServerState copyWith({bool? inactivityWarning}) {
    return ServerState(
      status: status,
      ip: ip,
      port: port,
      pin: pin,
      errorMessage: errorMessage,
      inactivityWarning: inactivityWarning ?? this.inactivityWarning,
    );
  }
}
