"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_FPS } from "./timecode";

export interface BufferedRange {
  start: number;
  end: number;
}

export interface PlayerState {
  /** False until a `<video>` is mounted — the transport renders disabled. */
  hasMedia: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  buffered: BufferedRange[];
  volume: number;
  muted: boolean;
  rate: number;
  loop: boolean;
  fullscreen: boolean;
  /** True once metadata has arrived, i.e. duration and intrinsic size are known. */
  ready: boolean;
}

export interface PlayerActions {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (seconds: number) => void;
  seekBy: (delta: number) => void;
  stepFrames: (frames: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setRate: (r: number) => void;
  toggleLoop: () => void;
  toggleFullscreen: () => void;
}

/**
 * Owns everything the transport bar and scrubber need from one `<video>`.
 *
 * The element lives in a ref (it is a mutable DOM object, not React state) with
 * a version counter beside it, because the player swaps sources by remounting a
 * keyed `<video>` per version: bumping the counter re-runs the listener effect
 * on that swap, where a bare ref would leave the transport wired to a detached
 * element and a state-held element would be illegal to mutate.
 *
 * `attachStage` is attached to the element that actually goes fullscreen — we
 * send the stage *and* its transport, so the controls stay usable there, which
 * the `<video>` element's own fullscreen cannot do.
 */
export function useVideoPlayer(options?: { fps?: number }) {
  const fps = options?.fps ?? DEFAULT_FPS;
  const elRef = useRef<HTMLVideoElement | null>(null);
  const fsRef = useRef<HTMLElement | null>(null);
  const [elVersion, setElVersion] = useState(0);

  const [hasMedia, setHasMedia] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<BufferedRange[]>([]);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRateState] = useState(1);
  const [loop, setLoop] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [ready, setReady] = useState(false);

  // The viewer's choices survive a source swap, so they are mirrored here and
  // re-applied to each new element (a fresh one starts at browser defaults).
  const prefs = useRef({ volume: 1, muted: false, rate: 1, loop: false });

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    elRef.current = node;
    setHasMedia(Boolean(node));
    setReady(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setBuffered([]);
    setElVersion((v) => v + 1);
  }, []);

  const attachStage = useCallback((node: HTMLElement | null) => {
    fsRef.current = node;
  }, []);

  // --- element listeners ---------------------------------------------------
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const readBuffered = () => {
      const ranges: BufferedRange[] = [];
      for (let i = 0; i < el.buffered.length; i++) {
        ranges.push({ start: el.buffered.start(i), end: el.buffered.end(i) });
      }
      setBuffered(ranges);
    };
    const onMeta = () => {
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
      setReady(true);
      readBuffered();
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrentTime(el.currentTime);
    const onVolume = () => {
      prefs.current.volume = el.volume;
      prefs.current.muted = el.muted;
      setVolumeState(el.volume);
      setMuted(el.muted);
    };
    const onRate = () => {
      prefs.current.rate = el.playbackRate;
      setRateState(el.playbackRate);
    };

    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("playing", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("seeked", onTime);
    el.addEventListener("progress", readBuffered);
    el.addEventListener("volumechange", onVolume);
    el.addEventListener("ratechange", onRate);

    el.volume = prefs.current.volume;
    el.muted = prefs.current.muted;
    el.playbackRate = prefs.current.rate;
    el.loop = prefs.current.loop;

    // A remounted element can already have metadata, in which case no
    // `loadedmetadata` will fire; read it on the next frame rather than inline,
    // so the effect never renders twice in a row.
    const raf = requestAnimationFrame(() => {
      if (el.readyState >= 1) onMeta();
    });

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("playing", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("seeked", onTime);
      el.removeEventListener("progress", readBuffered);
      el.removeEventListener("volumechange", onVolume);
      el.removeEventListener("ratechange", onRate);
    };
  }, [elVersion]);

  // `timeupdate` fires only ~4x a second, which makes the frame counter and the
  // playhead visibly stutter. While playing, sample on every animation frame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const el = elRef.current;
      if (el) setCurrentTime(el.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, elVersion]);

  useEffect(() => {
    const onFs = () =>
      setFullscreen(
        Boolean(document.fullscreenElement) && document.fullscreenElement === fsRef.current,
      );
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // --- actions -------------------------------------------------------------
  const play = useCallback(() => {
    void elRef.current?.play().catch(() => {});
  }, []);
  const pause = useCallback(() => elRef.current?.pause(), []);
  const togglePlay = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = elRef.current;
    if (!el) return;
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : seconds;
    const next = Math.min(Math.max(0, seconds), max);
    el.currentTime = next;
    // Paint the new position now: a paused element reports the old time until
    // `seeked` lands, which makes the scrubber feel like it lags the drag.
    setCurrentTime(next);
  }, []);
  const seekBy = useCallback(
    (delta: number) => {
      const el = elRef.current;
      if (el) seek(el.currentTime + delta);
    },
    [seek],
  );
  const stepFrames = useCallback(
    (frames: number) => {
      const el = elRef.current;
      if (!el) return;
      el.pause();
      seek(el.currentTime + frames / fps);
    },
    [fps, seek],
  );

  const setVolume = useCallback((v: number) => {
    const next = Math.min(1, Math.max(0, v));
    const el = elRef.current;
    prefs.current.volume = next;
    if (el) {
      el.volume = next;
      // Dragging the slider up is an unmute — otherwise it looks broken.
      if (next > 0 && el.muted) el.muted = false;
    }
    setVolumeState(next);
    if (next > 0) {
      prefs.current.muted = false;
      setMuted(false);
    }
  }, []);
  const toggleMute = useCallback(() => {
    const next = !prefs.current.muted;
    prefs.current.muted = next;
    const el = elRef.current;
    if (el) el.muted = next;
    setMuted(next);
  }, []);
  const setRate = useCallback((r: number) => {
    prefs.current.rate = r;
    const el = elRef.current;
    if (el) el.playbackRate = r;
    setRateState(r);
  }, []);
  const toggleLoop = useCallback(() => {
    const next = !prefs.current.loop;
    prefs.current.loop = next;
    const el = elRef.current;
    if (el) el.loop = next;
    setLoop(next);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const target = fsRef.current;
    if (!target) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void target.requestFullscreen?.().catch(() => {});
  }, []);

  const state: PlayerState = {
    hasMedia,
    playing,
    currentTime,
    duration,
    buffered,
    volume,
    muted,
    rate,
    loop,
    fullscreen,
    ready,
  };
  const actions: PlayerActions = {
    play,
    pause,
    togglePlay,
    seek,
    seekBy,
    stepFrames,
    setVolume,
    toggleMute,
    setRate,
    toggleLoop,
    toggleFullscreen,
  };

  return { attachVideo, attachStage, state, actions, fps };
}
