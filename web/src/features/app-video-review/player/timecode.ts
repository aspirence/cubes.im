/**
 * Timecode helpers for the review player.
 *
 * Review notes are argued about frame by frame, so the player shows a broadcast
 * style HH:MM:SS:FF timecode rather than a rough m:ss clock. We have no way to
 * read a file's real frame rate from a `<video>` element, so the whole app
 * agrees on one nominal rate: the frame number is a readable, reproducible
 * label for a moment in time, not a claim about the source's true cadence.
 */

/** The nominal frame rate the UI counts frames in (arrow-key stepping too). */
export const DEFAULT_FPS = 25;

/** `HH:MM:SS:FF` — the timecode shown in the transport bar. */
export function formatTimecode(seconds: number, fps: number = DEFAULT_FPS): string {
  const t = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const whole = Math.floor(t);
  // Round the sub-second remainder to the nearest frame, then carry: at 25fps a
  // remainder of 0.999s is frame 25, which is really the next second's frame 0.
  let frame = Math.round((t - whole) * fps);
  let total = whole;
  if (frame >= fps) {
    frame = 0;
    total += 1;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s, frame].map((n) => String(n).padStart(2, "0")).join(":");
}

/** `m:ss` (or `h:mm:ss` past an hour) — the compact clock used in comment chips. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Parses what someone can reasonably type into the "jump to" box: `90`,
 * `1:30`, `1:30:00` or a full `00:01:30:12` timecode. Returns seconds, or null
 * when the text isn't a time at all (so the caller can leave the playhead put).
 */
export function parseTimecode(input: string, fps: number = DEFAULT_FPS): number | null {
  const text = input.trim();
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length > 4) return null;
  if (parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);

  // 4 parts are HH:MM:SS:FF; fewer are a plain clock read from the right.
  if (nums.length === 4) {
    const [h, m, s, f] = nums;
    return h * 3600 + m * 60 + s + f / fps;
  }
  let seconds = 0;
  for (const n of nums) seconds = seconds * 60 + n;
  return seconds;
}
