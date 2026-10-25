import 'package:flutter/material.dart';

// Paleta que replica las variables CSS de la web
class AppColors {
  AppColors._();

  static const bgMain = Color(0xFF1C1C1E);
  static const bgCard = Color(0xFF2C2C2E);
  static const bgToolbar = Color(0xFF242426);

  static const accent = Color(0xFF2F7FF5);
  static const accentDim = Color(0xFF1A5EC4);

  static const textPrimary = Color(0xFFF2F2F7);
  static const textSecondary = Color(0xFF8E8E93);

  static const borderColor = Color(0xFF3A3A3C);
  static const connDotOn = Color(0xFF34C759);
  static const destructive = Color(0xFFFF3B30);
}

ThemeData buildAppTheme() {
  return ThemeData(
    colorScheme: ColorScheme.dark(
      surface: AppColors.bgMain,
      primary: AppColors.accent,
      onSurface: AppColors.textPrimary,
      onPrimary: Colors.white,
      outline: AppColors.borderColor,
    ),
    scaffoldBackgroundColor: AppColors.bgMain,
    fontFamily: 'SF Pro Display',
    useMaterial3: true,
    textTheme: const TextTheme(
      bodyMedium: TextStyle(color: AppColors.textPrimary),
      bodySmall: TextStyle(color: AppColors.textSecondary),
    ),
  );
}
