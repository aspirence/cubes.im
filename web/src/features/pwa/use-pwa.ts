"use client";

import { useEffect, useState } from "react";

/** The (non-standard) install prompt event Chromium fires before install. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Chromium fires `beforeinstallprompt` early (often before any install UI has
// mounted), so we stash it at module load and let the button read it later.
let deferredPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event("cubes:installable"));
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    window.dispatchEvent(new Event("cubes:installed"));
  });
}

/** True when running as an installed app (standalone / iOS home-screen). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; disambiguate by touch support.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Registers the service worker (idempotent). Returns the registration. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

/**
 * Install-prompt state for the "Install app" button. `canInstall` flips true
 * once Chromium offers the prompt (Android / desktop). iOS never fires it —
 * callers show Add-to-Home-Screen instructions via `isIOS()` instead.
 */
export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const sync = () => {
      setCanInstall(Boolean(deferredPrompt));
      setInstalled(isStandalone());
    };
    sync();
    window.addEventListener("cubes:installable", sync);
    window.addEventListener("cubes:installed", sync);
    return () => {
      window.removeEventListener("cubes:installable", sync);
      window.removeEventListener("cubes:installed", sync);
    };
  }, []);

  const promptInstall = async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!deferredPrompt) return "unavailable";
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    setCanInstall(false);
    return outcome;
  };

  return { canInstall, installed, isIOS: isIOS(), promptInstall };
}
