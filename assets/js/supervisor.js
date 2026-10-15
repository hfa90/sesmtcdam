(async function () {
  "use strict";
  const { $, esc, call, erro, toast, modal, confirmar, fmtData, fmtDataHora, fmtHora, horaAgora, comLoading, SignaturePad, pct } = DDS;

  let me;
  try { me = await DDS.exigirSessao(["supervisor", "admin"]); } catch (e) { return; }
  DDS.topbar(me, DDS.linksPorPerfil(me.perfil, "supervisor.html"));

  let painel = null, ativoId = null, timer = null;

  async function carregar() {
    try {
      painel = await call("sup_painel");
      $("#equipeInfo").textContent = painel.setores.length
        ? `Equipe: ${painel.setores.join(" · ")} (${painel.equipe_total} colaboradores)`
        : "Nenhum setor vinculado à sua equipe — o SESMT pode configurar em Equipes.";
      const vigente = painel.temas.find((t) => t.vigente);
      const mes = DDS.hojeISO().slice(0, 7);
      const doMes = painel.reunioes.filter((r) => String(r.data).slice(0, 7) === mes);
      $("#kpis").innerHTML = `
        <div class="card kpi"><div class="label">Tema vigente</div><div class="value" style="font-size:1.1rem;margin-top:6px">${vigente ? esc(vigente.titulo) : "—"}</div>
          <div class="sub">${vigente ? `${fmtData(vigente.semana_inicio)} a ${fmtData(vigente.semana_fim)}` : "Aguardando publicação do SESMT"}</div></div>
        <div class="card kpi"><div class="label">DDS no mês</div><div class="value">${doMes.length}</div><div class="sub">${doMes.reduce((n, r) => n + r.assinaturas, 0)} assinaturas</div></div>
        <div class="card kpi"><div class="label">Abertos agora</div><div class="value">${painel.reunioes.filter((r) => r.status === "aberta" && r.data === DDS.hojeISO()).length}</div><div class="sub">DDS aguardando assinaturas</div></div>`;
      renderLista();
      if (!ativoId) {
        const aberta = painel.reunioes.find((r) => r.status === "aberta" && r.data === DDS.hojeISO());
        if (aberta) abrirReuniao(aberta.id);
      }
    } catch (e) { erro(e); }
  }

  function renderLista() {
    const rs = painel.reunioes;
    if (!rs.length) { $("#lista").innerHTML = `<div class="empty">Nenhum DDS registrado ainda. Clique em <b>Iniciar DDS</b>.</div>`; return; }
    $("#lista").innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr>
      <th>Data</th><th>Tema</th><th>Local</th><th>Código</th><th class="right">Assinaturas</th><th>Status</th></tr></thead><tbody>
      ${rs.map((r) => `<tr class="clickable" data-id="${r.id}">
        <td class="nowrap">${fmtData(r.data)} ${fmtHora(r.horario)}</td><td>${esc(r.tema)}</td><td>${esc(r.local || "")}</td>
        <td class="mono">${esc(r.codigo)}</td><td class="right"><b>${r.assinaturas}</b></td>
        <td>${r.status === "aberta" ? '<span class="chip chip-warn">Aberto</span>' : '<span class="chip chip-ok">Encerrado</span>'}</td></tr>`).join("")}
      </tbody></table></div>`;
    $("#lista").querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => abrirReuniao(tr.dataset.id)));
  }

  // ---------- Novo DDS ----------
  $("#btnNovo").onclick = () => {
    if (!painel || !painel.temas.length) { toast("Nenhum tema publicado pelo SESMT ainda.", "err"); return; }
    const opts = painel.temas.map((t) => `<option value="${t.id}" ${t.vigente ? "selected" : ""}>${esc(t.titulo)} (${fmtData(t.semana_inicio)} a ${fmtData(t.semana_fim)})${t.vigente ? " · vigente" : ""}</option>`).join("");
    const m = modal({
      titulo: "Iniciar DDS",
      corpo: `<div class="field"><label>Tema</label><select id="nTema">${opts}</select></div>
        <div class="grid grid-2"><div class="field"><label>Horário</label><input type="time" id="nHora" value="${horaAgora()}"></div>
        <div class="field"><label>Local</label><input type="text" id="nLocal" placeholder="Ex.: Doca 3, Refeitório"></div></div>
        <div class="field"><label>Observações (opcional)</label><input type="text" id="nObs" placeholder="Turno, pontos discutidos..."></div>
        <div class="alert alert-info">Após iniciar, um código de 6 dígitos e um QR Code serão exibidos para os colaboradores assinarem.</div>`,
      rodape: `<button class="btn btn-ghost" data-x>Cancelar</button><button class="btn" id="nOk">Iniciar</button>`,
    });
    $("[data-x]", m.el).onclick = m.fechar;
    $("#nOk", m.el).onclick = (ev) => comLoading(ev.currentTarget, async () => {
      try {
        const r = await call("sup_criar_reuniao", { p_tema_id: $("#nTema", m.el).value, p_horario: $("#nHora", m.el).value, p_local: $("#nLocal", m.el).value, p_observacoes: $("#nObs", m.el).value });
        m.fechar(); toast("DDS iniciado!", "ok"); ativoId = null; await carregar(); abrirReuniao(r.id);
      } catch (e) { erro(e); }
    });
  };

  // ---------- Reunião ativa ----------
  async function abrirReuniao(id) {
    ativoId = id;
    ultimaQtd = -1;
    clearInterval(timer);
    await renderReuniao(true);
    timer = setInterval(() => { if (!document.hidden) renderReuniao(false); }, 8000);
  }

  let ultimaQtd = -1;
  async function renderReuniao(rolar) {
    if (!ativoId) return;
    let d;
    try { d = await call("reuniao_detalhe", { p_reuniao_id: ativoId }); } catch (e) { erro(e); return; }
    const r = d.reuniao, t = d.tema, ass = d.assinaturas, pend = d.pendentes;
    const aberta = r.status === "aberta" && r.data === DDS.hojeISO();
    if (!rolar && ultimaQtd === ass.length && aberta) return; // nada mudou
    if (ultimaQtd >= 0 && ass.length > ultimaQtd && !rolar) toast(`${ass[ass.length - 1].nome} assinou`, "ok");
    ultimaQtd = ass.length;
    const equipe = ass.length + pend.length;
    const card = $("#cardAtivo");
    card.classList.remove("hidden");
    const link = new URL(`index.html?codigo=${r.codigo}`, location.href).href;
    card.innerHTML = `
      <div class="card-head"><div><div class="eyebrow">${aberta ? "DDS em andamento" : "DDS encerrado"} · ${fmtData(r.data)} ${fmtHora(r.horario)}</div>
        <h2>${esc(t.titulo)}</h2><div class="muted small">${esc(r.local || "")}</div></div>
        <button class="btn btn-ghost btn-sm" id="fecharAtivo">Fechar</button></div>
      <div class="grid grid-3">
        <div>${aberta ? `<div class="code-big">${esc(r.codigo)}</div><p class="small muted center" style="margin-top:6px">Código para assinatura</p>
          <div class="qr" id="qr"></div><p class="small muted center">Escaneie para assinar</p>` :
          `<div class="alert alert-ok">Encerrado em ${fmtDataHora(r.encerrada_em)}</div>
           ${r.assinatura_instrutor ? `<div class="small muted">Visto do instrutor</div><img src="${r.assinatura_instrutor}" style="max-width:100%;height:70px;object-fit:contain">` : ""}`}
        </div>
        <div style="grid-column: span 2">
          <div class="row between"><h3 style="margin:0">Presenças: ${ass.length}${equipe ? ` de ${equipe} (${pct(ass.length, equipe)}%)` : ""}</h3>
            <div class="row">
              ${aberta ? `<button class="btn btn-sm" id="quiosque">Modo quiosque</button><button class="btn btn-sm btn-accent" id="encerrar">Encerrar DDS</button>` : ""}
              <a class="btn btn-sm btn-ghost" href="evidencia.html?id=${r.id}" target="_blank">Evidência / Imprimir</a>
              ${!ass.length ? `<button class="btn btn-sm btn-ghost" id="excluir">Excluir</button>` : ""}
            </div></div>
          ${equipe ? `<div class="bar"><span style="width:${pct(ass.length, equipe)}%"></span></div>` : ""}
          <div class="tabs" style="margin-top:14px"><button class="active" data-t="ass">Assinaram (${ass.length})</button><button data-t="pend">Pendentes da equipe (${pend.length})</button></div>
          <div data-p="ass" class="scroll-y">${ass.length ? `<table class="tbl"><tbody>${ass.map((a) => `<tr>
              <td><b>${esc(a.nome)}</b><div class="small muted">${esc(a.matricula)} · ${esc(a.cargo || "")}</div></td>
              <td><img class="sig" src="${a.assinatura}" alt="assinatura"></td>
              <td class="small muted nowrap">${fmtDataHora(a.assinado_em).slice(11)}${a.metodo === "quiosque" ? "<br>quiosque" : ""}</td></tr>`).join("")}</tbody></table>`
              : `<div class="empty">Aguardando assinaturas...</div>`}</div>
          <div data-p="pend" class="scroll-y hidden">${pend.length ? `<table class="tbl"><tbody>${pend.map((p) => `<tr><td><b>${esc(p.nome)}</b><div class="small muted">${esc(p.matricula)} · ${esc(p.setor || "")}</div></td><td class="small">${esc(p.cargo || "")}</td></tr>`).join("")}</tbody></table>`
              : `<div class="empty">Ninguém pendente na equipe 🎉</div>`}</div>
        </div>
      </div>`;
    if (aberta && window.QRCode) new QRCode($("#qr"), { text: link, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
    card.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
      card.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
      card.querySelectorAll("[data-p]").forEach((p) => p.classList.toggle("hidden", p.dataset.p !== b.dataset.t));
    }));
    $("#fecharAtivo").onclick = () => { ativoId = null; clearInterval(timer); ultimaQtd = -1; card.classList.add("hidden"); };
    if ($("#quiosque")) $("#quiosque").onclick = () => quiosque(r, t);
    if ($("#encerrar")) $("#encerrar").onclick = () => encerrar(r, ass.length);
    if ($("#excluir")) $("#excluir").onclick = async () => {
      if (!(await confirmar("Excluir este DDS sem assinaturas?", { perigo: true, ok: "Excluir" }))) return;
      try { await call("sup_excluir_reuniao", { p_reuniao_id: r.id }); toast("DDS excluído.", "ok"); $("#fecharAtivo").click(); carregar(); } catch (e) { erro(e); }
    };
    if (rolar) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Modo quiosque (colaborador assina no dispositivo do supervisor) ----------
  function quiosque(r, t) {
    const m = modal({
      titulo: "Modo quiosque · assinatura no dispositivo do supervisor",
      grande: true,
      corpo: `<div class="alert alert-info">Entregue o dispositivo ao colaborador. Ele informa a própria matrícula e CPF e assina. Tema: <b>${esc(t.titulo)}</b></div>
        <form id="qForm" autocomplete="off"><div class="grid grid-2">
          <div class="field"><label>Matrícula</label><input type="text" id="qMat" inputmode="numeric" autocomplete="off"></div>
          <div class="field"><label>CPF</label><input type="password" id="qCpf" inputmode="numeric" placeholder="000.000.000-00" autocomplete="new-password"></div></div>
          <label>Assinatura do colaborador</label><div id="qPad"></div>
          <div class="row" style="margin-top:6px"><button type="button" class="btn btn-ghost btn-sm" id="qLimpar">Limpar</button></div>
          <label class="check" style="margin-top:14px"><input type="checkbox" id="qDecl"><span>Declaro que participei deste DDS e compreendi as orientações de segurança apresentadas.</span></label>
        </form><div id="qMsg" style="margin-top:12px"></div>`,
      rodape: `<button class="btn btn-ghost" data-x>Fechar quiosque</button><button class="btn btn-lg" id="qOk">Registrar assinatura</button>`,
      onClose: () => renderReuniao(false),
    });
    DDS.mascaraCPF($("#qCpf", m.el));
    const pad = SignaturePad($("#qPad", m.el));
    $("#qLimpar", m.el).onclick = () => pad.limpar();
    $("[data-x]", m.el).onclick = m.fechar;
    $("#qOk", m.el).onclick = (ev) => {
      const mat = $("#qMat", m.el).value.trim(), cpf = $("#qCpf", m.el).value;
      if (!mat || cpf.replace(/\D/g, "").length !== 11) { toast("Informe matrícula e CPF completos.", "err"); return; }
      if (!$("#qDecl", m.el).checked) { toast("Marque a declaração de participação.", "err"); return; }
      if (pad.vazio()) { toast("Assinatura obrigatória.", "err"); return; }
      comLoading(ev.currentTarget, async () => {
        try {
          const res = await call("sup_assinar_quiosque", { p_reuniao_id: r.id, p_matricula: mat, p_cpf: cpf, p_assinatura: pad.paraPNG(), p_user_agent: navigator.userAgent + " [quiosque]" });
          $("#qMsg", m.el).innerHTML = `<div class="alert alert-ok">✓ Presença de <b>${esc(res.nome)}</b> registrada às ${fmtDataHora(res.assinado_em).slice(11)}. Próximo colaborador.</div>`;
          $("#qMat", m.el).value = ""; $("#qCpf", m.el).value = ""; $("#qDecl", m.el).checked = false; pad.limpar(); $("#qMat", m.el).focus();
        } catch (e) { $("#qMsg", m.el).innerHTML = `<div class="alert alert-danger">${esc(DDS.msgErro(e))}</div>`; }
      });
    };
    setTimeout(() => $("#qMat", m.el).focus(), 50);
  }

  // ---------- Encerrar com visto do instrutor ----------
  function encerrar(r, qtd) {
    const m = modal({
      titulo: "Encerrar DDS",
      corpo: `<p>${qtd} presença(s) registrada(s). Após encerrar, não será possível receber novas assinaturas neste DDS.</p>
        <label>Visto do instrutor (${esc(me.nome)})</label><div id="ePad"></div>
        <div class="row" style="margin-top:6px"><button type="button" class="btn btn-ghost btn-sm" id="eLimpar">Limpar</button></div>`,
      rodape: `<button class="btn btn-ghost" data-x>Cancelar</button><button class="btn btn-accent" id="eOk">Encerrar e assinar</button>`,
    });
    const pad = SignaturePad($("#ePad", m.el));
    $("#eLimpar", m.el).onclick = () => pad.limpar();
    $("[data-x]", m.el).onclick = m.fechar;
    $("#eOk", m.el).onclick = (ev) => {
      if (pad.vazio()) { toast("Assine como instrutor.", "err"); return; }
      comLoading(ev.currentTarget, async () => {
        try { await call("sup_encerrar_reuniao", { p_reuniao_id: r.id, p_assinatura: pad.paraPNG() }); m.fechar(); toast("DDS encerrado.", "ok"); ultimaQtd = -1; await carregar(); renderReuniao(false); }
        catch (e) { erro(e); }
      });
    };
  }

  carregar();
})();
