import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../models/server_status.dart';
import 'pulse_ring.dart';

/// Botón circular central — el corazón de la pantalla principal.
class MainButton extends StatelessWidget {
  static const double _size = 192.0;

  final ServerState serverState;
  final VoidCallback onTap;

  const MainButton({
    super.key,
    required this.serverState,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isRunning = serverState.isRunning;
    final isBusy = serverState.isBusy;

    final bgColor = isRunning ? AppColors.accent : AppColors.bgCard;
    final borderColor =
        isRunning ? AppColors.accent : AppColors.borderColor;

    return SizedBox(
      width: _size + 40,
      height: _size + 40,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Anillo de pulso (solo visible cuando está activo)
          PulseRing(active: isRunning, size: _size + 16),

          // Botón principal
          GestureDetector(
            onTap: isBusy ? null : onTap,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 280),
              curve: Curves.easeInOut,
              width: _size,
              height: _size,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: bgColor,
                border: Border.all(color: borderColor, width: 1.5),
                boxShadow: isRunning
                    ? [
                        BoxShadow(
                          color: AppColors.accent.withAlpha(80),
                          blurRadius: 32,
                          spreadRadius: 4,
                        )
                      ]
                    : [
                        BoxShadow(
                          color: Colors.black.withAlpha(100),
                          blurRadius: 20,
                          offset: const Offset(0, 6),
                        )
                      ],
              ),
              child: _ButtonContent(serverState: serverState),
            ),
          ),
        ],
      ),
    );
  }
}

class _ButtonContent extends StatelessWidget {
  final ServerState serverState;

  const _ButtonContent({required this.serverState});

  @override
  Widget build(BuildContext context) {
    if (serverState.isBusy) {
      return const Center(
        child: SizedBox(
          width: 36,
          height: 36,
          child: CircularProgressIndicator(
            strokeWidth: 2.5,
            valueColor: AlwaysStoppedAnimation(AppColors.textPrimary),
          ),
        ),
      );
    }

    final isRunning = serverState.isRunning;

    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          isRunning ? Icons.wifi : Icons.wifi_off_rounded,
          size: 44,
          color: isRunning ? Colors.white : AppColors.textSecondary,
        ),
        const SizedBox(height: 14),
        Text(
          isRunning ? 'Detener' : 'Iniciar\nWiXplorer',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: isRunning ? Colors.white : AppColors.textPrimary,
            fontSize: isRunning ? 16 : 14,
            fontWeight: FontWeight.w600,
            height: 1.3,
          ),
        ),
      ],
    );
  }
}
