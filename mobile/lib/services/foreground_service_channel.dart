import 'dart:io';
import 'package:flutter/services.dart';

/// Wrapper de plataforma para iniciar y detener el Foreground Service de Android.
/// Garantiza que el proceso no sea eliminado por el sistema mientras el servidor
/// HTTP está activo. En iOS no es necesario (las apps usan Background Modes).
class ForegroundServiceChannel {
  static const _channel = MethodChannel('com.wixplorer/foreground');

  /// Inicia el foreground service. Muestra una notificación persistente con
  /// la dirección IP del servidor para que el usuario pueda abrir el navegador.
  static Future<void> start({required String ip, required int port}) async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod<void>('start', {
        'text': 'Activo en $ip:$port — Abrí el navegador en tu PC',
      });
    } catch (_) {
      // Si el channel falla (emulador, versión inesperada), no interrumpir el servidor
    }
  }

  /// Detiene el foreground service y elimina la notificación persistente.
  static Future<void> stop() async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod<void>('stop');
    } catch (_) {}
  }
}
