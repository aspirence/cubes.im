import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_DESCRIPTION } from "@/lib/seo";

/**
 * Web app manifest — makes Cubes an installable PWA on Android, iOS/iPadOS
 * (via Add to Home Screen) and desktop. `start_url` opens straight into the
 * app; the proxy sends signed-out users to login from there.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — One workspace for everything you run`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    id: "/",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b0d12",
    theme_color: "#4a4ad0",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
