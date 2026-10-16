/* Captura facial para assinatura secundária.
   NÃO usa inteligência artificial: a câmera tira a foto, o sistema faz apenas checagens
   clássicas de qualidade de imagem (brilho, contraste e nitidez) e grava data/hora/matrícula
   na própria foto. A conferência de identidade é feita por pessoas (supervisor e SESMT),
   comparando com a foto de referência do colaborador. */
(function () {
  "use strict";
  const { esc } = DDS;

  function analisar(canvas) {
    // amostra 64x80 em tons de cinza da região central (onde fica o rosto)
    const W = 64, H = 80, t = document.createElement("canvas");
    t.width = W; t.height = H;
    const c = t.getContext("2d", { willReadFrequently: true });
    const cw = canvas.width, ch = canvas.height;
    c.drawImage(canvas, cw * 0.2, ch * 0.12, cw * 0.6, ch * 0.7, 0, 0, W, H);
    const d = c.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    let soma = 0;
    for (let i = 0; i < W * H; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; soma += g[i]; }
    const media = soma / (W * H);
    let v = 0; for (let i = 0; i < g.length; i++) v += (g[i] - media) ** 2;
    const contraste = Math.sqrt(v / g.length);
    // nitidez: variância do Laplaciano
    let ls = 0, ls2 = 0, n = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, L = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
      ls += L; ls2 += L * L; n++;
    }
    const nitidez = ls2 / n - (ls / n) ** 2;
    const problemas = [];
    if (media < 50) problemas.push("A foto está muito escura. Procure um local mais iluminado.");
    else if (media > 215) problemas.push("A foto está muito clara/estourada. Evite luz forte atrás ou na frente.");
    if (contraste < 16) problemas.push("Imagem sem detalhes. Enquadre o rosto dentro do contorno.");
    if (nitidez < 18) problemas.push("A foto parece tremida ou desfocada. Segure firme e tente de novo.");
    return { media, contraste, nitidez, problemas };
  }

  function carimbar(ctx, W, H, texto) {
    const h = Math.round(H * 0.075);
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(0, H - h, W, h);
    ctx.fillStyle = "#fff";
    ctx.font = `600 ${Math.round(h * 0.42)}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(texto, 10, H - h / 2, W - 20);
  }

  /**
   * FaceCapture(container, { legenda: () => "texto carimbado", onChange(dataUrl|null) })
   */
  function FaceCapture(container, opts) {
    opts = opts || {};
    let stream = null, foto = null;
    container.classList.add("face-cap");

    function telaInicial(msg) {
      parar();
      container.innerHTML = `
        <div class="face-stage face-empty">
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="11" r="3.2"/><path d="M7.5 17.5c1-1.8 2.6-2.7 4.5-2.7s3.5.9 4.5 2.7"/></svg>
          <div><b>Foto de verificação</b><br><span class="small muted">Rosto de frente, sem boné/óculos escuros, em local iluminado.</span></div>
          ${msg ? `<div class="alert alert-danger small" style="margin:0">${esc(msg)}</div>` : ""}
        </div>
        <div class="row face-actions"><button type="button" class="btn btn-block" data-a="abrir">📷 Abrir câmera</button></div>
        <input type="file" accept="image/*" capture="user" hidden>`;
      container.querySelector('[data-a="abrir"]').onclick = abrir;
      container.querySelector("input[type=file]").onchange = (e) => e.target.files[0] && deArquivo(e.target.files[0]);
    }

    async function abrir() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        container.querySelector("input[type=file]").click(); return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 1280 } }, audio: false,
        });
      } catch (e) {
        const m = e && e.name === "NotAllowedError"
          ? "Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador e tente novamente."
          : e && e.name === "NotFoundError" ? "Nenhuma câmera encontrada neste dispositivo." : "Não foi possível abrir a câmera.";
        telaInicial(m); return;
      }
      const mid = "fm" + Math.random().toString(36).slice(2, 8);
      container.innerHTML = `
        <div class="face-stage"><video playsinline autoplay muted></video>
          <svg class="face-guide" viewBox="0 0 100 125" preserveAspectRatio="none"><defs><mask id="${mid}"><rect width="100" height="125" fill="#fff"/><ellipse cx="50" cy="56" rx="30" ry="40" fill="#000"/></mask></defs>
            <rect width="100" height="125" fill="rgba(6,30,20,.55)" mask="url(#${mid})"/><ellipse cx="50" cy="56" rx="30" ry="40" fill="none" stroke="#f2b705" stroke-width="1.2" stroke-dasharray="3 2"/></svg>
          <div class="face-tip">Posicione o rosto dentro do contorno</div></div>
        <div class="row face-actions"><button type="button" class="btn btn-ghost" data-a="cancelar">Cancelar</button>
          <button type="button" class="btn btn-accent" data-a="capturar" style="flex:1">Capturar foto</button></div>`;
      const video = container.querySelector("video");
      video.srcObject = stream;
      try { await video.play(); } catch (e) {}
      container.querySelector('[data-a="cancelar"]').onclick = () => telaInicial();
      container.querySelector('[data-a="capturar"]').onclick = () => capturar(video);
    }

    function gerar(fonte, sw, sh, espelhar) {
      // recorte 4:5 central, 360x450, JPEG ~20-30 KB
      const W = 360, H = 450, alvo = W / H;
      let cw = sw, ch = sw / alvo;
      if (ch > sh) { ch = sh; cw = sh * alvo; }
      const sx = (sw - cw) / 2, sy = (sh - ch) / 2;
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const ctx = cv.getContext("2d");
      if (espelhar) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.drawImage(fonte, sx, sy, cw, ch, 0, 0, W, H);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const q = analisar(cv);
      carimbar(ctx, W, H, (opts.legenda ? opts.legenda() : "") || `DDS · ${DDS.fmtDataHora(new Date().toISOString())}`);
      return { url: cv.toDataURL("image/jpeg", 0.72), q };
    }

    function capturar(video) {
      if (!video.videoWidth) return;
      const r = gerar(video, video.videoWidth, video.videoHeight, true);
      parar();
      revisar(r);
    }

    function deArquivo(file) {
      const img = new Image();
      img.onload = () => { const r = gerar(img, img.naturalWidth, img.naturalHeight, false); URL.revokeObjectURL(img.src); revisar(r); };
      img.onerror = () => telaInicial("Arquivo de imagem inválido.");
      img.src = URL.createObjectURL(file);
    }

    function revisar(r) {
      const bloqueia = r.q.problemas.some((p) => /escura|clara/.test(p));
      container.innerHTML = `
        <div class="face-stage"><img src="${r.url}" alt="Foto capturada"></div>
        ${r.q.problemas.length ? `<div class="alert alert-warn small" style="margin:8px 0 0">${r.q.problemas.map(esc).join("<br>")}</div>` : `<div class="alert alert-ok small" style="margin:8px 0 0">✓ Foto com boa qualidade.</div>`}
        <div class="row face-actions"><button type="button" class="btn btn-ghost" data-a="refazer" style="flex:1">Tirar outra</button>
          ${r.q.problemas.length && !bloqueia ? `<button type="button" class="btn btn-ghost" data-a="usar">Usar mesmo assim</button>` : ""}</div>`;
      container.querySelector('[data-a="refazer"]').onclick = () => { definir(null); abrir(); };
      const usar = container.querySelector('[data-a="usar"]');
      if (usar) usar.onclick = () => { definir(r.url); usar.remove(); container.querySelector(".alert").className = "alert alert-info small"; };
      definir(r.q.problemas.length ? null : r.url);
    }

    function definir(url) { foto = url; opts.onChange && opts.onChange(url); }
    function parar() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }

    telaInicial();
    return {
      foto: () => foto,
      parar,
      limpar() { definir(null); telaInicial(); },
      abrir,
    };
  }

  DDS.FaceCapture = FaceCapture;
})();
