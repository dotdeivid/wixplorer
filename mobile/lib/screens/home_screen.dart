import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/server_status.dart';
import '../services/server_service.dart';
import '../theme/app_theme.dart';
import '../widgets/main_button.dart';
import '../widgets/status_card.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  ServerState _serverState = const ServerState.stopped();
  StreamSubscription<ServerState>? _sub;

  @override
  void initState() {
    super.initState();
    _sub = ServerService.instance.stateStream.listen((state) {
      if (mounted) setState(() => _serverState = state);
    });
    // Sincroniza estado inicial por si el servicio ya estaba activo
    _serverState = ServerService.instance.current;
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _toggleServer() async {
    if (_serverState.isRunning) {
      await ServerService.instance.stop();
    } else {
      await ServerService.instance.start();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SizedBox.expand(
         child: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            const SizedBox(height: 24),
            const _Header(),
            const Spacer(),
            MainButton(
              serverState: _serverState,
              onTap: _toggleServer,
            ),
            const SizedBox(height: 32),
            StatusCard(serverState: _serverState),
            if (!_serverState.isRunning) const _HintText(),
            const Spacer(),
            if (_serverState.inactivityWarning)
              const _InactivityBanner(),
            if (_serverState.status == ServerStatus.error)
              _ErrorBanner(message: _serverState.errorMessage ?? 'Error desconocido'),
            const _Footer(),
            const SizedBox(height: 16),
          ],
         ),
        ),
      ),
    );
  }
}

// ── Subwidgets ──────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: 52,
          height: 52,
          decoration: BoxDecoration(
            color: AppColors.accent,
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Icon(Icons.swap_horiz_rounded, color: Colors.white, size: 30),
        ),
        const SizedBox(height: 12),
        const Text(
          'WiXplorer',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 22,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.3,
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          'Accede a tus archivos desde el navegador',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
        ),
      ],
    );
  }
}

class _HintText extends StatelessWidget {
  const _HintText();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.only(top: 20),
      child: Text(
        'Tocá el botón para iniciar el servidor',
        style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
      ),
    );
  }
}

class _InactivityBanner extends StatelessWidget {
  const _InactivityBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF3A2F00),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFFFCC00).withAlpha(120)),
      ),
      child: const Row(
        children: [
          Icon(Icons.timer_off_outlined, color: Color(0xFFFFCC00), size: 16),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              '15 min sin actividad — el servidor sigue activo',
              style: TextStyle(color: Color(0xFFFFCC00), fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  final String message;
  const _ErrorBanner({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.destructive.withAlpha(30),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.destructive.withAlpha(80)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppColors.destructive, size: 16),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: AppColors.destructive, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

class _Footer extends StatelessWidget {
  const _Footer();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const Text(
          'v1.0.0',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 11),
        ),
        const SizedBox(height: 4),
        const Text(
          'Sandoval, Carlos David',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 11),
        ),
        const SizedBox(height: 2),
        RichText(
          text: TextSpan(
            text: 'github.com/dotdeivid',
            style: const TextStyle(
              color: AppColors.accent,
              fontSize: 11,
              decoration: TextDecoration.underline,
              decorationColor: AppColors.accent,
            ),
            recognizer: TapGestureRecognizer()
              ..onTap = () => launchUrl(
                    Uri.parse('https://github.com/dotdeivid'),
                    mode: LaunchMode.externalApplication,
                  ),
          ),
        ),
      ],
    );
  }
}
