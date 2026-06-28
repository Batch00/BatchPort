import type { MetadataRoute } from "next";

const STANDARD_SIZES = [48, 72, 96, 128, 144, 192, 384, 512];

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BatchPort",
    short_name: "BatchPort",
    description: "Track your travels around the world",
    categories: ["travel", "lifestyle"],
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      ...STANDARD_SIZES.map((size) => ({
        src: `/icons/icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose: "any" as const,
      })),
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
