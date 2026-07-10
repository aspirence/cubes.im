/**
 * Extracts a human-readable message from an unknown thrown value. Supabase's
 * PostgrestError is a plain object (NOT an Error instance), so the common
 * `err instanceof Error ? err.message : fallback` pattern silently masks the
 * real cause (e.g. "relation does not exist" when a migration hasn't been
 * pushed). This helper reads `.message` off anything shaped like an error.
 */
export function errMsg(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string" &&
    (err as { message: string }).message
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
}
