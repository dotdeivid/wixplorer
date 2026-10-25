import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/app_theme.dart';
import '../models/server_status.dart';

/// Tarjeta de estado que aparece cuando el servidor está activo.
/// Muestra IP:puerto y el PIN en formato OTP.
class StatusCard extends StatelessWidget {
  final ServerState serverState;

  const StatusCard({super.key, required this.serverState});

  @override
  Widget build(BuildContext context) {
    if (!serverState.isRunning) return const SizedBox.shrink();

    final ip = serverState.ip ?? '—';
    final port = serverState.port;
    final pin = serverState.pin ?? '------';

    return AnimatedOpacity(
      opacity: 1.0,
      duration: const Duration(milliseconds: 300),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 32),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
        decoration: BoxDecoration(
          color: AppColors.bgCard,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.borderColor),
        ),
        child: Column(
          children: [
            // URL prominente — toca para copiar
            GestureDetector(
              onTap: () {
                Clipboard.setData(ClipboardData(text: 'http://$ip:$port'));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('URL copiada al portapapeles'),
                    duration: Duration(seconds: 2),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: AppColors.bgToolbar,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.accent.withAlpha(80)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.circle, size: 8, color: AppColors.connDotOn),
                    const SizedBox(width: 10),
                    Text(
                      'http://$ip:$port',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0.2,
                        fontFamily: 'monospace',
                      ),
                    ),
                    const SizedBox(width: 10),
                    const Icon(Icons.copy_rounded, size: 14, color: AppColors.textSecondary),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 16),
            const Divider(color: AppColors.borderColor, height: 1),
            const SizedBox(height: 16),

            // Etiqueta PIN
            const Text(
              'PIN de acceso',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
                fontWeight: FontWeight.w500,
                letterSpacing: 0.8,
              ),
            ),

            const SizedBox(height: 10),

            // Dígitos OTP
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(pin.length, (i) {
                return _PinDigit(digit: pin[i]);
              }),
            ),

            const SizedBox(height: 14),

            // Botón copiar
            GestureDetector(
              onTap: () {
                Clipboard.setData(ClipboardData(text: pin));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('PIN copiado al portapapeles'),
                    duration: Duration(seconds: 2),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              },
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
                decoration: BoxDecoration(
                  color: AppColors.bgToolbar,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.borderColor),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.copy_rounded,
                        size: 13, color: AppColors.textSecondary),
                    SizedBox(width: 6),
                    Text(
                      'Copiar PIN',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PinDigit extends StatelessWidget {
  final String digit;

  const _PinDigit({required this.digit});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 38,
      height: 48,
      margin: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(
        color: AppColors.bgToolbar,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.accent.withAlpha(100)),
      ),
      alignment: Alignment.center,
      child: Text(
        digit,
        style: const TextStyle(
          color: AppColors.textPrimary,
          fontSize: 22,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
      ),
    );
  }
}
