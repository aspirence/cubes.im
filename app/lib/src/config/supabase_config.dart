class SupabaseConfig {
  static const url = String.fromEnvironment('SUPABASE_URL');
  static const anonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
  static const redirectScheme = String.fromEnvironment(
    'SUPABASE_REDIRECT_SCHEME',
    defaultValue: 'cubes',
  );
  static const redirectHost = String.fromEnvironment(
    'SUPABASE_REDIRECT_HOST',
    defaultValue: 'login-callback',
  );

  static bool get isConfigured => url.isNotEmpty && anonKey.isNotEmpty;

  static String get redirectUri =>
      Uri(scheme: redirectScheme, host: redirectHost).toString();

  static String get passwordResetRedirectUri => Uri(
        scheme: redirectScheme,
        host: redirectHost,
        path: '/reset-password',
      ).toString();
}
