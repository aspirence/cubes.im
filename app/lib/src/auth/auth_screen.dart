import 'package:flutter/material.dart';

import 'auth_controller.dart';

enum AuthScreenMode {
  signIn,
  signUp,
  forgotPassword,
  resetPassword,
}

class AuthScreen extends StatefulWidget {
  const AuthScreen({
    super.key,
    required this.controller,
    this.initialMode = AuthScreenMode.signIn,
  });

  final AuthController controller;
  final AuthScreenMode initialMode;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _signInFormKey = GlobalKey<FormState>();
  final _signUpFormKey = GlobalKey<FormState>();
  final _forgotFormKey = GlobalKey<FormState>();
  final _resetFormKey = GlobalKey<FormState>();

  late AuthScreenMode _mode;
  bool _submitting = false;
  String? _pendingEmailConfirmation;
  String? _resetEmail;

  final _signInEmail = TextEditingController();
  final _signInPassword = TextEditingController();
  final _signUpName = TextEditingController();
  final _signUpEmail = TextEditingController();
  final _signUpPassword = TextEditingController();
  final _forgotEmail = TextEditingController();
  final _resetPassword = TextEditingController();
  final _resetPasswordConfirm = TextEditingController();

  @override
  void initState() {
    super.initState();
    _mode = widget.initialMode;
  }

  @override
  void dispose() {
    _signInEmail.dispose();
    _signInPassword.dispose();
    _signUpName.dispose();
    _signUpEmail.dispose();
    _signUpPassword.dispose();
    _forgotEmail.dispose();
    _resetPassword.dispose();
    _resetPasswordConfirm.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Hero(mode: _mode),
                  const SizedBox(height: 18),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(22),
                      child: _buildCardContent(context),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCardContent(BuildContext context) {
    if (_pendingEmailConfirmation != null) {
      return _EmailConfirmationState(
        email: _pendingEmailConfirmation!,
        onBackToSignIn: () {
          setState(() {
            _pendingEmailConfirmation = null;
            _mode = AuthScreenMode.signIn;
          });
        },
      );
    }

    return switch (_mode) {
      AuthScreenMode.signIn => _buildSignIn(context),
      AuthScreenMode.signUp => _buildSignUp(context),
      AuthScreenMode.forgotPassword => _buildForgotPassword(context),
      AuthScreenMode.resetPassword => _buildResetPassword(context),
    };
  }

  Widget _buildSignIn(BuildContext context) {
    return Form(
      key: _signInFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Sign in',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Use your Cubes email and password. Your mobile session will stay signed in on this device.',
            style: TextStyle(
              color: Color(0xFF475569),
              height: 1.45,
            ),
          ),
          const SizedBox(height: 20),
          TextFormField(
            controller: _signInEmail,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: const InputDecoration(labelText: 'Email'),
            validator: _validateEmail,
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _signInPassword,
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            decoration: const InputDecoration(labelText: 'Password'),
            validator: _validatePassword,
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: _submitting
                  ? null
                  : () => setState(() => _mode = AuthScreenMode.forgotPassword),
              child: const Text('Forgot password?'),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _submitting ? null : _submitSignIn,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 18),
              ),
              child: _submitting
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Sign in'),
            ),
          ),
          const SizedBox(height: 14),
          _BottomSwitch(
            prompt: 'Need a new account?',
            action: 'Create one',
            onTap: _submitting
                ? null
                : () => setState(() => _mode = AuthScreenMode.signUp),
          ),
        ],
      ),
    );
  }

  Widget _buildSignUp(BuildContext context) {
    return Form(
      key: _signUpFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Create account',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          const Text(
            'This uses the same Supabase signup flow as the web app, including workspace provisioning from your name metadata.',
            style: TextStyle(
              color: Color(0xFF475569),
              height: 1.45,
            ),
          ),
          const SizedBox(height: 20),
          TextFormField(
            controller: _signUpName,
            autofillHints: const [AutofillHints.name],
            decoration: const InputDecoration(labelText: 'Full name'),
            validator: (value) {
              final text = value?.trim() ?? '';
              if (text.isEmpty) return 'Enter your name.';
              if (text.length > 55) return 'Name must be 55 characters or less.';
              return null;
            },
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _signUpEmail,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: const InputDecoration(labelText: 'Email'),
            validator: _validateEmail,
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _signUpPassword,
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            decoration: const InputDecoration(labelText: 'Password'),
            validator: _validatePassword,
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _submitting ? null : _submitSignUp,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 18),
              ),
              child: _submitting
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Create account'),
            ),
          ),
          const SizedBox(height: 14),
          _BottomSwitch(
            prompt: 'Already have an account?',
            action: 'Sign in',
            onTap: _submitting
                ? null
                : () => setState(() => _mode = AuthScreenMode.signIn),
          ),
        ],
      ),
    );
  }

  Widget _buildForgotPassword(BuildContext context) {
    final success = _resetEmail != null;

    if (success) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Check your email',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 10),
          Text(
            'If an account exists for $_resetEmail, we sent a reset link that opens this mobile app directly.',
            style: const TextStyle(
              color: Color(0xFF475569),
              height: 1.5,
            ),
          ),
          const SizedBox(height: 18),
          FilledButton(
            onPressed: () {
              setState(() {
                _resetEmail = null;
                _mode = AuthScreenMode.signIn;
              });
            },
            child: const Text('Back to sign in'),
          ),
        ],
      );
    }

    return Form(
      key: _forgotFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Reset password',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          const Text(
            'We will email a recovery link and send you back into the app to choose a new password.',
            style: TextStyle(
              color: Color(0xFF475569),
              height: 1.45,
            ),
          ),
          const SizedBox(height: 20),
          TextFormField(
            controller: _forgotEmail,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Email'),
            validator: _validateEmail,
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _submitting ? null : _submitForgotPassword,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 18),
              ),
              child: _submitting
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Send reset link'),
            ),
          ),
          const SizedBox(height: 14),
          _BottomSwitch(
            prompt: 'Remembered your password?',
            action: 'Back to sign in',
            onTap: _submitting
                ? null
                : () => setState(() => _mode = AuthScreenMode.signIn),
          ),
        ],
      ),
    );
  }

  Widget _buildResetPassword(BuildContext context) {
    return Form(
      key: _resetFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Choose a new password',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Your recovery link is active on this device. Set a new password to finish the reset flow.',
            style: TextStyle(
              color: Color(0xFF475569),
              height: 1.45,
            ),
          ),
          const SizedBox(height: 20),
          TextFormField(
            controller: _resetPassword,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'New password'),
            validator: _validatePassword,
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _resetPasswordConfirm,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Confirm password'),
            validator: (value) {
              final error = _validatePassword(value);
              if (error != null) return error;
              if (value != _resetPassword.text) {
                return 'Passwords do not match.';
              }
              return null;
            },
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _submitting ? null : _submitResetPassword,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 18),
              ),
              child: _submitting
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Update password'),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _submitSignIn() async {
    if (!_signInFormKey.currentState!.validate()) return;
    await _runSubmission(() async {
      final result = await widget.controller.signIn(
        email: _signInEmail.text,
        password: _signInPassword.text,
      );
      _showResult(result);
    });
  }

  Future<void> _submitSignUp() async {
    if (!_signUpFormKey.currentState!.validate()) return;
    await _runSubmission(() async {
      final result = await widget.controller.signUp(
        name: _signUpName.text,
        email: _signUpEmail.text,
        password: _signUpPassword.text,
      );
      if (result.error == null && result.needsEmailConfirmation) {
        setState(() {
          _pendingEmailConfirmation = _signUpEmail.text.trim();
        });
      }
      _showResult(result);
    });
  }

  Future<void> _submitForgotPassword() async {
    if (!_forgotFormKey.currentState!.validate()) return;
    await _runSubmission(() async {
      final result = await widget.controller.resetPassword(_forgotEmail.text);
      if (result.error == null) {
        setState(() {
          _resetEmail = _forgotEmail.text.trim();
        });
      }
      _showResult(result);
    });
  }

  Future<void> _submitResetPassword() async {
    if (!_resetFormKey.currentState!.validate()) return;
    await _runSubmission(() async {
      final result = await widget.controller.updatePassword(_resetPassword.text);
      if (result.error == null) {
        setState(() {
          _mode = AuthScreenMode.signIn;
          _resetPassword.clear();
          _resetPasswordConfirm.clear();
        });
      }
      _showResult(result);
    });
  }

  Future<void> _runSubmission(Future<void> Function() action) async {
    setState(() => _submitting = true);
    await action();
    if (mounted) {
      setState(() => _submitting = false);
    }
  }

  void _showResult(AuthActionResult result) {
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    if (result.error != null) {
      messenger.showSnackBar(
        SnackBar(content: Text(result.error!)),
      );
      return;
    }

    if (result.message != null) {
      messenger.showSnackBar(
        SnackBar(content: Text(result.message!)),
      );
    }
  }

  String? _validateEmail(String? value) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) return 'Enter your email.';
    final emailPattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
    if (!emailPattern.hasMatch(text)) return 'Enter a valid email.';
    return null;
  }

  String? _validatePassword(String? value) {
    if ((value ?? '').isEmpty) return 'Enter your password.';
    if ((value ?? '').length < 6) return 'Password must be at least 6 characters.';
    return null;
  }
}

class _Hero extends StatelessWidget {
  const _Hero({required this.mode});

  final AuthScreenMode mode;

  @override
  Widget build(BuildContext context) {
    final title = switch (mode) {
      AuthScreenMode.signIn => 'Cubes login',
      AuthScreenMode.signUp => 'Create your workspace account',
      AuthScreenMode.forgotPassword => 'Recover access',
      AuthScreenMode.resetPassword => 'Finish password reset',
    };

    final subtitle = switch (mode) {
      AuthScreenMode.signIn =>
        'One login. Zero glue work. Projects, clients, reviews, and operations in one mobile flow.',
      AuthScreenMode.signUp =>
        'The same auth model as the web product, now with a mobile-first onboarding surface.',
      AuthScreenMode.forgotPassword =>
        'Password recovery is routed back into the mobile app with a deep link.',
      AuthScreenMode.resetPassword =>
        'Your recovery session is active. Set a new password and get back in.',
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(32),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF0F172A),
            Color(0xFF134E4A),
            Color(0xFF0F766E),
          ],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(999),
            ),
            child: const Text(
              'Authentication',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 12,
              ),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 30,
              fontWeight: FontWeight.w800,
              height: 1.1,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            subtitle,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.82),
              fontSize: 15,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

class _BottomSwitch extends StatelessWidget {
  const _BottomSwitch({
    required this.prompt,
    required this.action,
    required this.onTap,
  });

  final String prompt;
  final String action;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(
          prompt,
          style: const TextStyle(
            color: Color(0xFF64748B),
            fontWeight: FontWeight.w600,
          ),
        ),
        TextButton(
          onPressed: onTap,
          child: Text(action),
        ),
      ],
    );
  }
}

class _EmailConfirmationState extends StatelessWidget {
  const _EmailConfirmationState({
    required this.email,
    required this.onBackToSignIn,
  });

  final String email;
  final VoidCallback onBackToSignIn;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Check your email',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
        ),
        const SizedBox(height: 10),
        Text(
          'We sent a confirmation link to $email. Open it on this device to come straight back into the Cubes app.',
          style: const TextStyle(
            color: Color(0xFF475569),
            height: 1.5,
          ),
        ),
        const SizedBox(height: 18),
        FilledButton(
          onPressed: onBackToSignIn,
          child: const Text('Back to sign in'),
        ),
      ],
    );
  }
}
