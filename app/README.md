# Cubes Mobile App

## Auth setup

1. Copy `app/env.example.json` to `app/env.local.json`
2. Fill in the same Supabase project URL and publishable anon key used by `web/`
3. Add `cubes://login-callback` to the Supabase Auth redirect allow-list
4. Run:

```bash
flutter run --project-dir app --dart-define-from-file=app/env.local.json
```

The app uses `supabase_flutter` for:

- Email/password sign in
- Signup with `name` metadata for the existing `handle_new_user` provisioning trigger
- Persistent device sessions
- Password reset links that deep-link back into the mobile app
