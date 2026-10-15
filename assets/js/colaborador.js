(async function () {
  "use strict";
  const { $, esc, call, erro, toast, fmtData, fmtDataHora, fmtHora, tipoLabel, comLoading, SignaturePad, msgErro } = DDS;

  let me;
  try { me = await DDS.exigirSessao(); } catch (e) { return; }
  DDS.topbar(me, DDS.linksPorPerfil(me.perfil, "colaborador.html"));

  const primeiroNome = (me.nome || "").split(" ")[0];
  $("#saudacao").innerHTML = `<div><div class="eyebrow">Olá, ${esc(primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1).toLowerCase())}</div>
    <h1>Minha presença no DDS</h1><div class="muted small">${esc(me.cargo || "")} · ${esc(me.setor || "")}</div></div>`;

  // ---------- Tema da semana ----------
  async function carregarTema() {
    try {
      const temas = await call("tema_semana");
      if (!temas.length) { $("#temaSemana").innerHTML = `<div class="empty">Nenhum tema publicado para esta semana.</div>`; return; }
      $("#temaSemana").innerHTML = temas.map((t) => `
        <div class="stack" style="margin-bottom:12px">
          <div class="row between">
            <div class="tema-title">${esc(t.titulo)}</div>
            ${t.assinado_em ? `<span class="chip chip-ok">✓ Presença registrada</span>` : `<span class="chip chip-warn">Pendente</span>`}
          </div>
          <div class="muted small">Semana ${fmtData(t.semana_inicio)} a ${fmtData(t.semana_fim)} · ${esc(tipoLabel(t.tipo))} · ${t.carga_horaria_min} min</div>
          ${t.objetivo ? `<div><b>Objetivo:</b> ${esc(t.objetivo)}</div>` : ""}
          <div class="tema-box">${esc(t.conteudo)}</div>
          ${t.material_url ? `<a class="btn btn-ghost btn-sm" href="${esc(t.material_url)}" target="_blank" rel="noopener">📎 Material de apoio</a>` : ""}
          ${t.assinado_em ? `<div class="small muted">Assinado em ${fmtDataHora(t.assinado_em)}</div>` : ""}
        </div>`).join("");
    } catch (e) { erro(e); }
  }

  async function carregarHistorico() {
    try {
      const h = await call("minhas_assinaturas");
      if (!h.length) { $("#historico").innerHTML = `<div class="empty">Você ainda não possui participações registradas.</div>`; return; }
      $("#historico").innerHTML = `<ul class="list-plain">${h.map((x) => `
        <li><div class="row between"><b>${esc(x.tema)}</b><span class="chip chip-ok">${fmtData(x.data)}</span></div>
        <div class="small muted">Supervisor: ${esc(x.supervisor)} · ${fmtDataHora(x.assinado_em)}</div></li>`).join("")}</ul>`;
    } catch (e) { erro(e); }
  }

  // ---------- Fluxo: código -> leitura -> assinatura ----------
  const fluxo = $("#cardFluxo");
  let pad = null;

  async function abrirCodigo(codigo) {
    const r = await call("buscar_reuniao", { p_codigo: codigo });
    $("#cardAssinar").classList.add("hidden");
    fluxo.classList.remove("hidden");
    if (r.ja_assinou) {
      fluxo.innerHTML = `<div class="success-burst"><div class="ic">✓</div><h2>Você já assinou este tema</h2>
        <p class="muted">${esc(r.tema.titulo)}</p><button class="btn btn-ghost" id="voltar">Voltar</button></div>`;
      $("#voltar").onclick = resetar; return;
    }
    fluxo.innerHTML = `
      <div class="eyebrow">DDS em andamento · código ${esc(r.reuniao.codigo)}</div>
      <div class="tema-title">${esc(r.tema.titulo)}</div>
      <div class="muted small" style="margin:4px 0 12px">Supervisor: <b>${esc(r.reuniao.supervisor_nome)}</b>
        · ${fmtData(r.reuniao.data)} ${r.reuniao.horario ? "às " + fmtHora(r.reuniao.horario) : ""} ${r.reuniao.local ? "· " + esc(r.reuniao.local) : ""}</div>
      ${r.tema.objetivo ? `<p><b>Objetivo:</b> ${esc(r.tema.objetivo)}</p>` : ""}
      <div class="tema-box" style="max-height:280px;overflow:auto">${esc(r.tema.conteudo)}</div>
      ${r.tema.material_url ? `<p style="margin-top:10px"><a href="${esc(r.tema.material_url)}" target="_blank" rel="noopener">📎 Material de apoio</a></p>` : ""}
      <div style="margin:18px 0 8px"><label>Sua assinatura</label><div id="pad"></div>
        <div class="row" style="margin-top:6px"><button type="button" class="btn btn-ghost btn-sm" id="limpar">Limpar</button></div></div>
      <label class="check" style="margin:14px 0"><input type="checkbox" id="declaro" />
        <span>Eu, <b>${esc(me.nome)}</b> (matrícula ${esc(me.matricula)}), declaro que participei deste DDS e compreendi as orientações de segurança apresentadas.</span></label>
      <div class="row"><button class="btn btn-ghost" id="cancelar">Cancelar</button>
        <button class="btn btn-lg" id="confirmar" style="flex:1">Assinar presença</button></div>`;
    pad = SignaturePad($("#pad"));
    $("#limpar").onclick = () => pad.limpar();
    $("#cancelar").onclick = resetar;
    $("#confirmar").onclick = (ev) => {
      if (!$("#declaro").checked) { toast("Marque a declaração de participação.", "err"); return; }
      if (pad.vazio()) { toast("Desenhe sua assinatura no quadro.", "err"); return; }
      comLoading(ev.currentTarget, async () => {
        try {
          const res = await call("assinar", { p_reuniao_id: r.reuniao.id, p_codigo: r.reuniao.codigo, p_assinatura: pad.paraPNG(), p_user_agent: navigator.userAgent });
          fluxo.innerHTML = `<div class="success-burst"><div class="ic">✓</div><h2>Presença registrada!</h2>
            <p>${esc(r.tema.titulo)}</p><p class="muted small">${fmtDataHora(res.assinado_em)}</p>
            <p class="small muted">Código de integridade:<br><span class="mono">${esc(res.hash)}</span></p>
            <button class="btn" id="voltar">Concluir</button></div>`;
          $("#voltar").onclick = resetar;
          carregarTema(); carregarHistorico();
          history.replaceState(null, "", "colaborador.html");
        } catch (e) { erro(e); }
      });
    };
    fluxo.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetar() {
    fluxo.classList.add("hidden"); fluxo.innerHTML = "";
    $("#cardAssinar").classList.remove("hidden"); $("#codigo").value = "";
  }

  $("#codigo").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
  $("#formCodigo").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const c = $("#codigo").value;
    if (c.length !== 6) { toast("O código tem 6 dígitos.", "err"); return; }
    comLoading($("#btnBuscar"), () => abrirCodigo(c).catch(erro));
  });

  carregarTema();
  carregarHistorico();

  const cod = (new URLSearchParams(location.search).get("codigo") || "").replace(/\D/g, "");
  if (cod.length === 6) { $("#codigo").value = cod; abrirCodigo(cod).catch(erro); }
})();
