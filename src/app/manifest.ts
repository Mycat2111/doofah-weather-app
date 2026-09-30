import type { MetadataRoute } from "next";
import { MESSAGES } from "@/i18n/messages";

/** Lets DooFah be installed to the home screen and open like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "DooFah ดูฟ้า",
    short_name: "DooFah",
    description: MESSAGES.en.meta.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Matches the night sky shown while the first forecast loads.
    background_color: "#0b1026",
    theme_color: "#0b1026",
    categories: ["weather"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      {
        src: "/screenshots/phone.webp",
        sizes: "780x1688",
        type: "image/webp",
        form_factor: "narrow",
        label: "Current weather, favorites and the radar map on a phone",
      },
      {
        src: "/screenshots/desktop.webp",
        sizes: "1440x900",
        type: "image/webp",
        form_factor: "wide",
        label: "The DooFah dashboard with the radar map",
      },
    ],
  };
}
