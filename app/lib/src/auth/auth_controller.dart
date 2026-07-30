import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/supabase_config.dart';

class AuthActionResult {
  const AuthActionResult({
    this.error,
    this.needsEmailConfirmation = false,
    this.message,
  });

  final String? error;
  final bool needsEmailConfirmation;
  final String? message;
}

class AuthController extends ChangeNotifier {
  AuthController(this._client) {
    _session = _client.auth.currentSession;
    _user = _client.auth.currentUser;
    _subscription = _client.auth.onAuthStateChange.listen(
      (authState) => _handleAuthState(
        authState.event,
        authState.session,
      ),
      onError: (_) {
        _loading = false;
        notifyListeners();
      },
    );
    unawaited(_restoreProfile());
  }

  final SupabaseClient _client;

  StreamSubscription<AuthState>? _subscription;
  Session? _session;
  User? _user;
  Map<String, dynamic>? _profile;
  bool _loading = true;
  bool _requiresPasswordReset = false;
  int _profileRequestId = 0;

  Session? get session => _session;
  User? get user => _user;
  Map<String, dynamic>? get profile => _profile;
  bool get loading => _loading;
  bool get isAuthenticated => _session != null && _user != null;
  bool get requiresPasswordReset => _requiresPasswordReset;

  String get displayName {
    final profileName = _profile?['name'] as String?;
    final metadataName = _user?.userMetadata?['name'] as String?;
    if (profileName != null && profileName.trim().isNotEmpty) return profileName;
    if (metadataName != null && metadataName.trim().isNotEmpty) return metadataName;
    final email = _user?.email;
    if (email != null && email.contains('@')) return email.split('@').first;
    return 'there';
  }

  String get email => _profile?['email'] as String? ?? _user?.email ?? '';

  Future<AuthActionResult> signIn({
    required String email,
    required String password,
  }) async {
    try {
      await _client.auth.signInWithPassword(
        email: email.trim(),
        password: password,
      );
      return const AuthActionResult(message: 'Signed in.');
    } catch (error) {
      return AuthActionResult(error: _friendlyError(error));
    }
  }

  Future<AuthActionResult> signUp({
    required String name,
    required String email,
    required String password,
  }) async {
    try {
      final response = await _client.auth.signUp(
        email: email.trim(),
        password: password,
        emailRedirectTo: SupabaseConfig.redirectUri,
        data: {
          'name': name.trim(),
        },
      );

      return AuthActionResult(
        needsEmailConfirmation: response.session == null,
        message: response.session == null
            ? 'Check your email to confirm your account.'
            : 'Account created.',
      );
    } catch (error) {
      return AuthActionResult(error: _friendlyError(error));
    }
  }

  Future<AuthActionResult> resetPassword(String email) async {
    try {
      await _client.auth.resetPasswordForEmail(
        email.trim(),
        redirectTo: SupabaseConfig.passwordResetRedirectUri,
      );
      return const AuthActionResult(
        message: 'Password reset link sent.',
      );
    } catch (error) {
      return AuthActionResult(error: _friendlyError(error));
    }
  }

  Future<AuthActionResult> updatePassword(String password) async {
    try {
      await _client.auth.updateUser(
        UserAttributes(password: password),
      );
      _requiresPasswordReset = false;
      await _client.auth.signOut();
      return const AuthActionResult(
        message: 'Password updated. Sign in with your new password.',
      );
    } catch (error) {
      return AuthActionResult(error: _friendlyError(error));
    }
  }

  Future<AuthActionResult> signOut() async {
    try {
      _requiresPasswordReset = false;
      await _client.auth.signOut();
      return const AuthActionResult(message: 'Signed out.');
    } catch (error) {
      return AuthActionResult(error: _friendlyError(error));
    }
  }

  Future<void> _handleAuthState(
    AuthChangeEvent event,
    Session? session,
  ) async {
    _session = session;
    _user = session?.user;

    if (event == AuthChangeEvent.passwordRecovery) {
      _requiresPasswordReset = true;
    } else if (event == AuthChangeEvent.signedOut) {
      _requiresPasswordReset = false;
    } else if (event == AuthChangeEvent.signedIn) {
      _requiresPasswordReset = false;
    }

    await _restoreProfile();
  }

  Future<void> _restoreProfile() async {
    final requestId = ++_profileRequestId;
    final userId = _user?.id;

    if (userId == null) {
      _profile = null;
      _loading = false;
      notifyListeners();
      return;
    }

    try {
      final data = await _client
          .from('users')
          .select('id,name,email,avatar_url,setup_completed')
          .eq('id', userId)
          .maybeSingle();

      if (requestId != _profileRequestId) return;
      _profile = data;
    } catch (_) {
      if (requestId != _profileRequestId) return;
      _profile = null;
    }

    _loading = false;
    notifyListeners();
  }

  String _friendlyError(Object error) {
    final message = error is AuthException
        ? error.message
        : error.toString().replaceFirst('Exception: ', '');
    final normalized = message.toLowerCase();

    if (normalized.contains('invalid login credentials')) {
      return 'Incorrect email or password.';
    }
    if (normalized.contains('email not confirmed')) {
      return 'Please confirm your email before signing in.';
    }
    if (normalized.contains('user already registered')) {
      return 'An account with this email already exists.';
    }
    if (normalized.contains('password should be at least')) {
      return 'Password must be at least 6 characters.';
    }
    if (normalized.contains('auth session missing')) {
      return 'This reset session expired. Request a fresh password reset link.';
    }

    return message;
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}
