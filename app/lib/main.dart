import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'src/auth/auth_controller.dart';
import 'src/auth/auth_screen.dart';
import 'src/config/supabase_config.dart';
import 'src/ui/workspace_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final bootstrap = await SupabaseBootstrap.initialize();
  runApp(CubesApp(bootstrap: bootstrap));
}

class CubesApp extends StatefulWidget {
  const CubesApp({
    super.key,
    required this.bootstrap,
  });

  final SupabaseBootstrap bootstrap;

  @override
  State<CubesApp> createState() => _CubesAppState();
}

class _CubesAppState extends State<CubesApp> {
  AuthController? _authController;

  @override
  void initState() {
    super.initState();
    if (widget.bootstrap.isReady) {
      _authController = AuthController(Supabase.instance.client);
    }
  }

  @override
  void dispose() {
    _authController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF0F766E),
        brightness: Brightness.light,
      ),
      scaffoldBackgroundColor: const Color(0xFFF3F5F7),
      textTheme: ThemeData.light().textTheme.apply(
        bodyColor: const Color(0xFF0F172A),
        displayColor: const Color(0xFF0F172A),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        foregroundColor: Color(0xFF0F172A),
        surfaceTintColor: Colors.transparent,
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(28),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: const BorderSide(color: Color(0xFF0F766E), width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 18,
          vertical: 18,
        ),
      ),
    );

    return MaterialApp(
      title: 'Cubes',
      debugShowCheckedModeBanner: false,
      theme: theme,
      home: _buildHome(),
    );
  }

  Widget _buildHome() {
    if (widget.bootstrap.error != null) {
      return _SupabaseSetupScreen(
        title: 'Supabase init failed',
        subtitle: widget.bootstrap.error.toString(),
      );
    }

    if (!widget.bootstrap.isConfigured) {
      return const _SupabaseSetupScreen(
        title: 'Connect Supabase to continue',
        subtitle:
            'This mobile app uses the same Supabase project as the web app. Add the publishable credentials before trying the login flow.',
      );
    }

    final authController = _authController!;

    return AnimatedBuilder(
      animation: authController,
      builder: (context, _) {
        if (authController.loading) {
          return const _SplashScreen();
        }

        if (authController.requiresPasswordReset) {
          return AuthScreen(
            controller: authController,
            initialMode: AuthScreenMode.resetPassword,
          );
        }

        if (!authController.isAuthenticated) {
          return AuthScreen(controller: authController);
        }

        return CubesWorkspaceShell(controller: authController);
      },
    );
  }
}

class SupabaseBootstrap {
  const SupabaseBootstrap._({
    required this.isConfigured,
    this.error,
  });

  final bool isConfigured;
  final Object? error;

  bool get isReady => isConfigured && error == null;

  static Future<SupabaseBootstrap> initialize() async {
    if (!SupabaseConfig.isConfigured) {
      return const SupabaseBootstrap._(isConfigured: false);
    }

    try {
      await Supabase.initialize(
        url: SupabaseConfig.url,
        publishableKey: SupabaseConfig.anonKey,
        authOptions: const FlutterAuthClientOptions(
          authFlowType: AuthFlowType.implicit,
        ),
      );
      return const SupabaseBootstrap._(isConfigured: true);
    } catch (error) {
      return SupabaseBootstrap._(
        isConfigured: true,
        error: error,
      );
    }
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: const [
            CircularProgressIndicator(),
            SizedBox(height: 18),
            Text(
              'Restoring your workspace...',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SupabaseSetupScreen extends StatelessWidget {
  const _SupabaseSetupScreen({
    required this.title,
    required this.subtitle,
  });

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        height: 56,
                        width: 56,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [
                              Color(0xFF0F766E),
                              Color(0xFF14B8A6),
                            ],
                          ),
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: const Icon(
                          Icons.lock_open_rounded,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 18),
                      Text(
                        title,
                        style: theme.textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        subtitle,
                        style: theme.textTheme.bodyLarge?.copyWith(
                          color: const Color(0xFF475569),
                          height: 1.5,
                        ),
                      ),
                      const SizedBox(height: 20),
                      const SelectableText(
                        'flutter run --project-dir app --dart-define-from-file=app/env.local.json',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 14),
                      const SelectableText(
                        'Required keys in app/env.local.json:\n'
                        'SUPABASE_URL\n'
                        'SUPABASE_ANON_KEY\n'
                        'SUPABASE_REDIRECT_SCHEME\n'
                        'SUPABASE_REDIRECT_HOST',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 13,
                          height: 1.45,
                        ),
                      ),
                      const SizedBox(height: 14),
                      SelectableText(
                        'Redirect URL to allow in Supabase: ${SupabaseConfig.redirectUri}',
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 13,
                          height: 1.45,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
