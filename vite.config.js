import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "autoUpdate": quando uma nova versão é publicada, o app atualiza
      // sozinho na próxima abertura, sem precisar reinstalar nada.
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "VisãoRepro",
        short_name: "VisãoRepro",
        description: "Controle de inseminação artificial de bovinos (IATF)",
        start_url: "/",
        display: "standalone",
        background_color: "#F5EFDD",
        theme_color: "#3B5D45",
        orientation: "portrait-primary",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // guarda em cache o "esqueleto" do app (HTML/CSS/JS) para ele abrir
        // mesmo sem internet nenhuma — os DADOS continuam vindo do
        // IndexedDB local (src/lib/db.js), não deste cache.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
});
