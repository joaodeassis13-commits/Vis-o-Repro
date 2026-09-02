import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Registra o app como instalável/offline (PWA). Com registerType "prompt"
// (configurado em vite.config.js), uma atualização nova NUNCA troca a versão
// sozinha enquanto alguém está usando o app — em vez disso, isso aqui só
// pergunta, e só recarrega a página se a pessoa confirmar. Isso evita perder
// leituras/formulários em andamento por causa de um deploy novo.
// Registra o app como instalável/offline (PWA). Com registerType "prompt"
// (configurado em vite.config.js), uma atualização nova NUNCA troca a versão
// sozinha enquanto alguém está usando o app — em vez disso, isso aqui só
// pergunta, e só recarrega a página se a pessoa confirmar. Isso evita perder
// leituras/formulários em andamento por causa de um deploy novo.
const atualizarApp = registerSW({
  onNeedRefresh() {
    const confirmar = window.confirm(
      "Uma nova versão do VisãoRepro está disponível. Atualizar agora?\n\n" +
      "Se você estiver no meio de uma leitura ou formulário não salvo, " +
      "clique em Cancelar, termine e salve o que estiver fazendo antes de atualizar."
    );
    if (confirmar) atualizarApp(true);
  },
  onOfflineReady() {
    console.info("[VisãoRepro] Pronto para funcionar offline.");
  },
});
