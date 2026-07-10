/** Duration formatting helpers shared across the reporting suite. */

/** Formats a whole number of seconds as a compact `Hh Mm` label. */
export function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/** Formats a whole number of minutes as a compact `Hh Mm` label. */
export function formatMinutes(totalMinutes: number): string {
  return formatSeconds(Math.max(0, Math.round(totalMinutes)) * 60);
}

/** Converts a minute count to hours, rounded to one decimal place. */
export function minutesToHours(totalMinutes: number): number {
  return Math.round((Math.max(0, totalMinutes) / 60) * 10) / 10;
}
