"use client";

import { useAuthContext } from "./auth-provider";
import type {
  AuthContextValue,
  AuthResult,
  Profile,
  SignUpInput,
} from "./auth-provider";

export type { AuthContextValue, AuthResult, Profile, SignUpInput };

/**
 * Auth hook implementing the shared contract:
 *   { user, session, profile, loading,
 *     signIn(email, password), signUp({ name, email, password }),
 *     signOut(),
 *     resetPassword(email), updatePassword(newPassword) }
 *
 * Backed by <AuthProvider> (wired in src/app/providers.tsx) which tracks the
 * Supabase session via getSession() + onAuthStateChange and loads the
 * public.users profile row for the current user.
 */
export function useAuth(): AuthContextValue {
  return useAuthContext();
}
