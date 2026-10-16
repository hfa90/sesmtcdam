/* PWA: instalação no celular/tablet, tela de carregamento e aviso de conexão */
(function () {
  "use strict";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(navigator.userAgent);
  window.DDS_STANDALONE = standalone;
  if (standalone) document.documentElement.classList.add("is-app");

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  // ---------- Tela de carregamento ----------
  const inicio = Date.now();
  let primeira = true;
  try { primeira = !sessionStorage.getItem("dds_splash"); sessionStorage.setItem("dds_splash", "1"); } catch (e) {}
  const minimo = primeira ? 1100 : 0;
  function pronto() {
    const s = document.getElementById("splash");
    if (!s || s.classList.contains("out")) return;
    const espera = Math.max(0, minimo - (Date.now() - inicio));
    setTimeout(() => { s.classList.add("out"); setTimeout(() => s.remove(), 450); }, espera);
  }
  setTimeout(pronto, 10000); // segurança

  // ---------- Instalação ----------
  let promptInstalacao = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); promptInstalacao = e; mostrarBotoes(); });
  window.addEventListener("appinstalled", () => { promptInstalacao = null; document.querySelectorAll("[data-instalar]").forEach((b) => (b.hidden = true)); DDS.toast && DDS.toast("App instalado! Procure o ícone DDS SESMT na tela inicial.", "ok"); });
  function mostrarBotoes() { if (!standalone) document.querySelectorAll("[data-instalar]").forEach((b) => (b.hidden = false)); }

  async function instalar() {
    if (promptInstalacao) {
      promptInstalacao.prompt();
      try { await promptInstalacao.userChoice; } catch (e) {}
      promptInstalacao = null;
      return;
    }
    const passos = iOS
      ? `<ol class="install-steps">
          <li>Abra este endereço no <b>Safari</b> (no iPhone/iPad a instalação só funciona pelo Safari).</li>
          <li>Toque no botão <b>Compartilhar</b> <span class="kbd">⬆︎</span> na barra inferior.</li>
          <li>Role e toque em <b>Adicionar à Tela de Início</b>.</li>
          <li>Confirme em <b>Adicionar</b>. O ícone <b>DDS SESMT</b> aparecerá na tela inicial.</li></ol>`
      : `<ol class="install-steps">
          <li>Abra este endereço no <b>Google Chrome</b>${android ? "" : " ou Microsoft Edge"}.</li>
          <li>Toque no menu <span class="kbd">⋮</span> no canto superior direito.</li>
          <li>Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li>
          <li>Confirme. O ícone <b>DDS SESMT</b> aparecerá junto dos seus aplicativos.</li></ol>`;
    DDS.modal({
      titulo: "Instalar o app DDS SESMT",
      corpo: `<div class="row" style="flex-wrap:nowrap;gap:14px;margin-bottom:12px"><img src="assets/icons/icon-192.png" alt="" style="width:64px;height:64px;border-radius:15px">
        <div><b>DDS SESMT</b><div class="small muted">Abre em tela cheia, como um aplicativo, sem precisar da loja.</div></div></div>${passos}`,
      rodape: false,
    });
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-instalar]"); if (b) { e.preventDefault(); instalar(); } });
  document.addEventListener("DOMContentLoaded", () => { if (iOS || android || promptInstalacao) mostrarBotoes(); });

  // ---------- Conexão ----------
  function aviso() {
    let b = document.getElementById("offline-bar");
    if (navigator.onLine) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("div"); b.id = "offline-bar"; b.textContent = "Sem conexão com a internet — as assinaturas só são registradas online."; document.body.appendChild(b); }
  }
  window.addEventListener("online", aviso);
  window.addEventListener("offline", aviso);
  document.addEventListener("DOMContentLoaded", aviso);

  Object.assign(window.DDS || (window.DDS = {}), { pronto, instalar, standalone, iOS });
})();
