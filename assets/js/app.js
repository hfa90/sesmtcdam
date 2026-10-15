/* Núcleo comum: API, sessão, utilidades de UI, assinatura digital */
(function () {
  "use strict";

  const STORE_KEY = "dds_sesmt_sessao";

  // ---------------- Armazenamento seguro ----------------
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { return store._mem || null; } },
    set(v) { store._mem = v; try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) {} },
    clear() { store._mem = null; try { localStorage.removeItem(STORE_KEY); } catch (e) {} },
  };

  // ---------------- Mensagens de erro ----------------
  const ERROS = {
    CREDENCIAIS_INVALIDAS: "Matrícula ou CPF inválidos.",
    BLOQUEADO: "Muitas tentativas incorretas. Aguarde 15 minutos e tente novamente.",
    DESLIGADO: "Acesso inativo. Procure o SESMT.",
    SESSAO_INVALIDA: "Sua sessão expirou. Entre novamente.",
    ACESSO_NEGADO: "Você não tem permissão para esta ação.",
    CODIGO_INVALIDO: "Código não encontrado. Confira com o seu supervisor (o DDS precisa estar aberto hoje).",
    JA_ASSINOU: "Presença já registrada para este tema.",
    REUNIAO_ENCERRADA: "Este DDS já foi encerrado.",
    REUNIAO_FORA_DO_DIA: "Este DDS não é de hoje. Peça ao supervisor para abrir um novo.",
    REUNIAO_NAO_ENCONTRADA: "DDS não encontrado.",
    REUNIAO_COM_ASSINATURAS: "Este DDS possui assinaturas e não pode ser excluído (evidência).",
    ASSINATURA_INVALIDA: "Assinatura inválida. Desenhe novamente.",
    TEMA_INVALIDO: "Tema inválido ou não publicado.",
    TEMA_COM_REUNIOES: "Este tema já possui DDS realizados e não pode ser excluído. Arquive-o.",
    DADOS_OBRIGATORIOS: "Preencha os campos obrigatórios.",
    PLANILHA_VAZIA: "A planilha não possui linhas válidas.",
    PLANILHA_INCOMPLETA: "A planilha tem menos da metade da base ativa. Para evitar desligamentos indevidos, desmarque a opção de desligar ausentes ou confira o arquivo.",
    NAO_PODE_ALTERAR_PROPRIO_ACESSO: "Você não pode remover o seu próprio acesso de administradora.",
    SO_REUNIOES_DE_HOJE: "Só é possível reabrir DDS realizados hoje.",
    EVIDENCIA_PROTEGIDA: "Registro protegido: evidências não podem ser alteradas.",
    FALHA_REDE: "Sem conexão com o servidor. Verifique a internet e tente novamente.",
  };
  function msgErro(e) {
    const code = (e && (e.code || e.message)) || "";
    for (const k of Object.keys(ERROS)) if (code.indexOf(k) === 0) return ERROS[k];
    return code || "Erro inesperado.";
  }

  // ---------------- API (RPC Supabase/PostgREST) ----------------
  async function rpc(fn, args) {
    let res;
    try {
      res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(args || {}),
      });
    } catch (e) {
      const err = new Error("FALHA_REDE"); err.code = "FALHA_REDE"; throw err;
    }
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
    if (!res.ok) {
      const code = (data && data.message) || `HTTP_${res.status}`;
      const err = new Error(code); err.code = code; err.details = data;
      if (code.indexOf("SESSAO_INVALIDA") === 0) {
        store.clear();
        if (!/index\.html$|\/$/.test(location.pathname)) {
          setTimeout(() => (location.href = "index.html?expirou=1"), 600);
        }
      }
      throw err;
    }
    return data;
  }
  function call(fn, args) {
    const s = store.get();
    return rpc(fn, Object.assign({ p_token: s && s.token }, args || {}));
  }

  // ---------------- Sessão ----------------
  function destinoPorPerfil(perfil) {
    return perfil === "admin" ? "admin.html" : perfil === "supervisor" ? "supervisor.html" : "colaborador.html";
  }
  async function exigirSessao(perfis) {
    const s = store.get();
    if (!s || !s.token) { location.href = "index.html"; throw new Error("sem sessão"); }
    try {
      const me = await rpc("me", { p_token: s.token });
      s.usuario = me; store.set(s);
      if (perfis && perfis.indexOf(me.perfil) < 0) { location.href = destinoPorPerfil(me.perfil); throw new Error("perfil"); }
      return me;
    } catch (e) {
      if (e.code && e.code.indexOf("SESSAO_INVALIDA") === 0) throw e;
      if (e.message === "perfil") throw e;
      // falha de rede: usa a sessão local para exibir a página
      if (s.usuario) return s.usuario;
      throw e;
    }
  }
  async function sair() {
    const s = store.get();
    try { if (s && s.token) await rpc("logout", { p_token: s.token }); } catch (e) {}
    store.clear();
    location.href = "index.html";
  }

  // ---------------- Utilidades ----------------
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const TZ = "America/Manaus";
  function fmtData(d) { // 'YYYY-MM-DD' -> 'DD/MM/YYYY' sem fuso
    if (!d) return "";
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
  }
  function fmtDataHora(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function fmtHora(t) { return t ? String(t).slice(0, 5) : ""; }
  function hojeISO() {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return p; // YYYY-MM-DD
  }
  function horaAgora() {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  }
  function pct(a, b) { return b ? Math.round((a / b) * 1000) / 10 : 0; }
  function tipoLabel(t) { return { tecnico: "Técnico", comportamental: "Comportamental", tecnico_comportamental: "Técnico e Comportamental" }[t] || t || ""; }
  function perfilLabel(p) { return { admin: "SESMT (Admin)", supervisor: "Supervisor", colaborador: "Colaborador" }[p] || p; }
  function mascaraCPF(el) {
    el.addEventListener("input", () => {
      let v = el.value.replace(/\D/g, "").slice(0, 11);
      if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, "$1.$2.$3-$4");
      else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, "$1.$2.$3");
      else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, "$1.$2");
      el.value = v;
    });
  }
  function normalizar(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }

  // ---------------- Toast / modal / loading ----------------
  function toast(msg, tipo) {
    let box = $("#toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = "toast " + (tipo || "");
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), tipo === "err" ? 6000 : 3500);
  }
  function erro(e) { console.error(e); toast(msgErro(e), "err"); }

  function modal({ titulo, corpo, rodape, grande, onClose }) {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal ${grande ? "lg" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(titulo)}</h3><button class="x-btn" aria-label="Fechar">&times;</button></div>
      <div class="modal-body"></div>${rodape !== false ? '<div class="modal-foot"></div>' : ""}</div>`;
    const body = $(".modal-body", back);
    if (typeof corpo === "string") body.innerHTML = corpo; else if (corpo) body.appendChild(corpo);
    const foot = $(".modal-foot", back);
    if (foot && rodape) { if (typeof rodape === "string") foot.innerHTML = rodape; else foot.appendChild(rodape); }
    const fechar = () => { back.remove(); document.removeEventListener("keydown", onKey); onClose && onClose(); };
    const onKey = (ev) => { if (ev.key === "Escape") fechar(); };
    $(".x-btn", back).onclick = fechar;
    back.addEventListener("mousedown", (ev) => { if (ev.target === back) fechar(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    return { el: back, body, foot, fechar };
  }
  function confirmar(texto, { titulo = "Confirmar", ok = "Confirmar", perigo = false } = {}) {
    return new Promise((resolve) => {
      let decidido = false;
      const m = modal({
        titulo, corpo: `<p>${texto}</p>`,
        rodape: `<button class="btn btn-ghost" data-a="n">Cancelar</button><button class="btn ${perigo ? "btn-danger" : ""}" data-a="s">${esc(ok)}</button>`,
        onClose: () => { if (!decidido) resolve(false); },
      });
      m.foot.addEventListener("click", (ev) => {
        const a = ev.target.closest("[data-a]"); if (!a) return;
        decidido = true; resolve(a.dataset.a === "s"); m.fechar();
      });
    });
  }
  async function comLoading(btn, fn) {
    const html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Aguarde...`;
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
  }

  // ---------------- Topbar ----------------
  function topbar(usuario, links) {
    const el = document.createElement("header");
    el.className = "topbar";
    const nav = (links || []).map((l) => `<a href="${l.href}">${esc(l.label)}</a>`).join("");
    el.innerHTML = `
      <div class="brand"><div class="brand-mark">DDS</div><div>Diálogo de Segurança<small>${esc(CONFIG.SETOR)} · ${esc(CONFIG.UNIDADE)}</small></div></div>
      <nav class="topnav">${nav}</nav>
      <div class="spacer"></div>
      <div class="user-chip"><b>${esc(usuario.nome)}</b>Mat. ${esc(usuario.matricula)} · ${esc(perfilLabel(usuario.perfil))}</div>
      <button class="btn btn-ghost btn-sm" id="btnSair">Sair</button>`;
    document.body.prepend(el);
    $("#btnSair", el).onclick = sair;
  }
  function linksPorPerfil(perfil, atual) {
    const l = [];
    if (perfil === "admin") l.push({ href: "admin.html", label: "Painel SESMT" });
    if (perfil === "admin" || perfil === "supervisor") l.push({ href: "supervisor.html", label: "Conduzir DDS" });
    l.push({ href: "colaborador.html", label: "Minha presença" });
    return l.filter((x) => x.href !== atual);
  }

  // ---------------- Assinatura (canvas) ----------------
  function SignaturePad(container) {
    container.classList.add("sig-wrap");
    container.innerHTML = `<canvas></canvas><div class="sig-line"></div><div class="sig-label">Assine aqui com o dedo ou o mouse</div>`;
    const canvas = $("canvas", container);
    const ctx = canvas.getContext("2d");
    let strokes = [], atual = null;

    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }
    function pos(ev) { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, h: r.height }; }
    function drawStroke(c, s, sx, sy) {
      if (!s.length) return;
      c.beginPath();
      c.moveTo(s[0].x * sx, s[0].y * sy);
      if (s.length === 1) c.lineTo(s[0].x * sx + 0.1, s[0].y * sy + 0.1);
      for (let i = 1; i < s.length - 1; i++) {
        const mx = ((s[i].x + s[i + 1].x) / 2) * sx, my = ((s[i].y + s[i + 1].y) / 2) * sy;
        c.quadraticCurveTo(s[i].x * sx, s[i].y * sy, mx, my);
      }
      if (s.length > 1) c.lineTo(s[s.length - 1].x * sx, s[s.length - 1].y * sy);
      c.stroke();
    }
    function style(c, w) { c.lineWidth = w; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = "#0b1f3a"; }
    function redraw() {
      const r = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, r.width, r.height);
      style(ctx, 2.4);
      strokes.forEach((s) => drawStroke(ctx, s, 1, 1));
    }
    canvas.addEventListener("pointerdown", (ev) => {
      ev.preventDefault(); canvas.setPointerCapture(ev.pointerId);
      const p = pos(ev); atual = [{ x: p.x, y: p.y }]; strokes.push(atual); redraw();
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!atual) return; ev.preventDefault();
      const p = pos(ev); atual.push({ x: p.x, y: p.y }); redraw();
    });
    const fim = () => { atual = null; };
    canvas.addEventListener("pointerup", fim);
    canvas.addEventListener("pointercancel", fim);
    // ajusta a resolução sempre que o tamanho mudar (inclusive quando sai de um elemento oculto)
    if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(canvas);
    else window.addEventListener("resize", resize);
    setTimeout(resize, 0);

    return {
      limpar() { strokes = []; redraw(); },
      vazio() { return strokes.reduce((n, s) => n + s.length, 0) < 8; },
      paraPNG() {
        // exporta em resolução fixa (leve) para armazenar como evidência
        const r = canvas.getBoundingClientRect();
        const W = 500, H = Math.round((500 * r.height) / r.width);
        const off = document.createElement("canvas"); off.width = W; off.height = H;
        const c = off.getContext("2d");
        style(c, 2.6);
        strokes.forEach((s) => drawStroke(c, s, W / r.width, H / r.height));
        return off.toDataURL("image/png");
      },
      resize,
    };
  }

  // ---------------- Clipboard (texto rico p/ Teams e e-mail) ----------------
  async function copiarRico(html, texto) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([texto], { type: "text/plain" }),
        })]);
        return true;
      }
    } catch (e) { /* tenta o método alternativo */ }
    const div = document.createElement("div");
    div.contentEditable = "true"; div.style.position = "fixed"; div.style.left = "-9999px";
    div.innerHTML = html; document.body.appendChild(div);
    const range = document.createRange(); range.selectNodeContents(div);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    let ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
    sel.removeAllRanges(); div.remove();
    return ok;
  }
  async function copiarTexto(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch (e) {
      const ta = document.createElement("textarea"); ta.value = texto; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (e2) {} ta.remove(); return ok;
    }
  }

  window.DDS = {
    store, rpc, call, exigirSessao, sair, destinoPorPerfil, msgErro, erro, toast, modal, confirmar, comLoading,
    esc, $, $$, fmtData, fmtDataHora, fmtHora, hojeISO, horaAgora, pct, tipoLabel, perfilLabel, mascaraCPF, normalizar,
    topbar, linksPorPerfil, SignaturePad, copiarRico, copiarTexto,
  };
})();
