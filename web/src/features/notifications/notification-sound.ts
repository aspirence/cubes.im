/**
 * A short, pleasant "ding-dong" chime for new notifications, synthesised with
 * the Web Audio API so there's no asset to load and it works offline. Two soft
 * sine notes with a quick attack and gentle decay — a calm rising interval, not
 * a harsh beep. Muteable via localStorage (honoured by the bell's toggle).
 */

const MUTE_KEY = "cubes.notif.sound";

let audioCtx: AudioContext | null = null;

export function isNotificationSoundMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "off";
  } catch {
    return false;
  }
}

export function setNotificationSoundMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "off" : "on");
  } catch {
    // Private mode / no storage — the preference just won't persist.
  }
}

/** Plays the chime unless the user has muted it. Safe to call anywhere. */
export function playNotificationChime(): void {
  if (typeof window === "undefined") return;
  if (isNotificationSoundMuted()) return;

  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    audioCtx = audioCtx ?? new Ctor();
    // The context can be suspended until a user gesture; nudging it is harmless.
    if (audioCtx.state === "suspended") void audioCtx.resume();

    const now = audioCtx.currentTime;
    // A5 then E6 — a soft rising perfect-fourth "ding-dong".
    const notes = [
      { freq: 880.0, at: 0 },
      { freq: 1174.66, at: 0.13 },
    ];
    for (const n of notes) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = n.freq;
      const start = now + n.at;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.13, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.55);
    }
  } catch {
    // Audio unavailable (autoplay policy, no device) — silently skip.
  }
}
