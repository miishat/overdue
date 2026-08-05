import type { MetadataRoute } from "next";
import { PALETTE } from "@/lib/tokens";

// Theme colour is the "ink" token's dark value. Confirmed against
// src/lib/tokens.ts rather than hardcoding it here, since a previous
// milestone's plan shipped two wrong CSS variable names.
const THEME_COLOR = PALETTE.dark.ink;

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Overdue",
    short_name: "Overdue",
    description: "A quiet way to track the books you owe yourself.",
    start_url: "/",
    display: "standalone",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
