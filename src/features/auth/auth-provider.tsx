"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

/** The public.users profile row (id === auth.uid()). */
export type Profile = Database["public"]["Tables"]["users"]["Row"];

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

/** Result shape returned by every auth action. Errors are surfaced as a
 * friendly string instead of thrown so callers can render them with antd. */
export interface AuthResult {
  error: string | null;
  /** Present after signUp: true when the user is signed in immediately (email
   * confirmation disabled), false when a confirmation email was sent. */
  needsEmailConfirmation?: boolean;
}

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (input: SignUpInput) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  resetPassword: (email: string) => Promise<AuthResult>;
  updatePassword: (newPassword: string) => Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Turns a Supabase/Auth error into a user-friendly message. */
function friendlyError(error: unknown): string {
  if (!error) return "Something went wrong. Please try again.";
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : (error as { message?: string }).message ??
          "Something went wrong. Please try again.";

  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Please confirm your email address before signing in.";
  }
  if (normalized.includes("user already registered")) {
    return "An account with this email already exists.";
  }
  if (normalized.includes("password should be at least")) {
    return "Password must be at least 6 characters.";
  }
  return message;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // The browser client is stable for the life of the provider.
  const [supabase] = useState(() => createClient());

  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Guard against setting state after unmount / out-of-order async resolves.
  const mountedRef = useRef(true);

  const loadProfile = useCallback(
    async (uid: string | undefined) => {
      if (!uid) {
        if (mountedRef.current) setProfile(null);
        return;
      }
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", uid)
        .maybeSingle();

      if (!mountedRef.current) return;
      setProfile(error ? null : data);
    },
    [supabase],
  );

  useEffect(() => {
    mountedRef.current = true;

    // Initial session hydrate.
    supabase.auth.getSession().then(({ data }) => {
      if (!mountedRef.current) return;
      const initialSession = data.session;
      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      void loadProfile(initialSession?.user?.id).finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!mountedRef.current) return;
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        void loadProfile(nextSession?.user?.id);
      },
    );

    return () => {
      mountedRef.current = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase, loadProfile]);

  const signIn = useCallback<AuthContextValue["signIn"]>(
    async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { error: error ? friendlyError(error) : null };
    },
    [supabase],
  );

  const signUp = useCallback<AuthContextValue["signUp"]>(
    async ({ name, email, password }) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        // The DB trigger handle_new_user reads `name` from user metadata to
        // build the profile + default org/team. It MUST be passed here.
        options: { data: { name } },
      });
      if (error) {
        return { error: friendlyError(error) };
      }
      // When email confirmation is disabled (dev), a session is returned and
      // the user is signed in. Otherwise a confirmation email is sent.
      return { error: null, needsEmailConfirmation: !data.session };
    },
    [supabase],
  );

  const signOut = useCallback<AuthContextValue["signOut"]>(async () => {
    const { error } = await supabase.auth.signOut();
    if (!error && mountedRef.current) {
      setSession(null);
      setUser(null);
      setProfile(null);
    }
    return { error: error ? friendlyError(error) : null };
  }, [supabase]);

  const resetPassword = useCallback<AuthContextValue["resetPassword"]>(
    async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      return { error: error ? friendlyError(error) : null };
    },
    [supabase],
  );

  const updatePassword = useCallback<AuthContextValue["updatePassword"]>(
    async (newPassword) => {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      return { error: error ? friendlyError(error) : null };
    },
    [supabase],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile,
      loading,
      signIn,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
    }),
    [
      user,
      session,
      profile,
      loading,
      signIn,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>.");
  }
  return ctx;
}
