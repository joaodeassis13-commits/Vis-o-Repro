import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// carimbo da versão (data/hora do build) — aparece no menu lateral, pra dar pra conferir se o
// aparelho está mesmo rodando a versão mais recente (o app só atualiza quando a pessoa confirma).
const CARIMBO_VERSAO = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  define: { __VERSAO_APP__: JSON.stringify(CARIMBO_VERSAO) },
  plugins: [
    react(),
    VitePWA({
      // "prompt": quando uma nova versão é publicada, o app NÃO troca sozinho
      // no meio do uso (isso já causou perda de dados não salvos). Em vez
      // disso, o app avisa o usuário e só atualiza quando ele confirmar
      // (ver o aviso de atualização em src/main.jsx).
      registerType: "prompt",
      includeAssets: ["icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon.png"],
      manifest: {
        name: "VArepro",
        short_name: "VArepro",
        description: "Controle de inseminação artificial de bovinos (IATF)",
        start_url: "/",
        display: "standalone",
        background_color: "#F7F7F7",
        theme_color: "#166336",
        orientation: "portrait-primary",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
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
