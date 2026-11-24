import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Library of Babel",
    short_name: "Babel",
    description:
      "A descriptive shelf catalogue, commonplace book, and reading ledger for the Library of Babel.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6efd9",
    theme_color: "#284d43",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
