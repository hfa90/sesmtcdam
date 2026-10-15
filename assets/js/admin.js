(async function () {
  "use strict";
  const { $, $$, esc, call, erro, toast, modal, confirmar, comLoading, fmtData, fmtDataHora, fmtHora, pct, tipoLabel, perfilLabel, normalizar, hojeISO } = DDS;

  let me;
  try { me = await DDS.exigirSessao(["admin"]); } catch (e) { return; }
  DDS.topbar(me, DDS.linksPorPerfil(me.perfil, "admin.html"));

  const view = $("#view");
  const cache = { temas: null };
  const charts = [];
  const COR = { ok: "#18804f", warn: "#e0a106", bad: "#c0392b", none: "#b8c2bb", brand: "#0f6b45", accent: "#f2b705", info: "#2563a8" };
  if (window.Chart) {
    Chart.defaults.font.family = '"Plus Jakarta Sans", system-ui, sans-serif';
    Chart.defaults.color = "#4a5a50";
    Chart.defaults.borderColor = "#e1e7e2";
  }
  function limparCharts() { while (charts.length) charts.pop().destroy(); }
  const corAdesao = (p, temDDS) => (!temDDS ? COR.none : p >= 80 ? COR.ok : p >= 50 ? COR.warn : COR.bad);
  const statusChip = (p, temDDS) => (!temDDS ? '<span class="chip chip-danger">Não realizado</span>' : p >= 80 ? '<span class="chip chip-ok">Entregue</span>' : '<span class="chip chip-warn">Parcial</span>');

  async function temas(force) {
    if (!cache.temas || force) cache.temas = await call("adm_temas");
    return cache.temas;
  }
  function temaPadrao(lista) {
    const hoje = hojeISO();
    return lista.find((t) => t.status === "publicado" && t.semana_inicio <= hoje && t.semana_fim >= hoje) || lista.find((t) => t.status !== "rascunho") || lista[0];
  }
  function opcoesTemas(lista, sel) {
    return lista.filter((t) => t.status !== "rascunho").map((t) => `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${esc(t.titulo)} · ${fmtData(t.semana_inicio)}</option>`).join("");
  }

  // =====================================================================
  // ROTEAMENTO
  // =====================================================================
  const views = { painel, temasView, dds, colaboradores, relatorios };
  const mapa = { painel: "painel", temas: "temasView", dds: "dds", colaboradores: "colaboradores", relatorios: "relatorios" };
  function ir(nome) {
    $$("#menu button").forEach((b) => b.classList.toggle("active", b.dataset.view === nome));
    limparCharts();
    view.innerHTML = `<div class="empty" style="padding:80px"><span class="spinner"></span></div>`;
    try { history.replaceState(null, "", "#" + nome); } catch (e) {}
    views[mapa[nome]]().catch(erro);
  }
  $$("#menu button").forEach((b) => (b.onclick = () => ir(b.dataset.view)));

  // =====================================================================
  // PAINEL DE ENTREGAS
  // =====================================================================
  async function painel(temaId) {
    const lista = await temas(true);
    if (!lista.length) {
      view.innerHTML = `<div class="page-head"><h1>Painel de entregas</h1></div><div class="card empty">Cadastre o primeiro tema em <b>Temas semanais</b>.</div>`;
      return;
    }
    const tId = temaId || (temaPadrao(lista) || {}).id;
    const [d, evo] = await Promise.all([call("adm_dashboard", { p_tema_id: tId }), call("adm_evolucao", { p_limite: 16 })]);
    const sup = d.supervisores.filter((s) => s.cargo || s.reunioes);
    const entregues = sup.filter((s) => s.reunioes > 0).length;
    const ades = pct(Math.min(d.assinaturas, d.base), d.base);

    view.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Painel de entregas</div><h1>${esc(d.tema.titulo)}</h1>
        <div class="muted small">Semana ${fmtData(d.tema.semana_inicio)} a ${fmtData(d.tema.semana_fim)}</div></div>
        <div class="row"><select id="selTema" style="min-width:280px">${opcoesTemas(lista, tId)}</select>
        <button class="btn btn-ghost" id="atualizar">Atualizar</button></div></div>
      <div class="grid grid-4">
        <div class="card kpi"><div class="label">Adesão geral</div><div class="value">${ades}%</div><div class="sub">${d.assinaturas} de ${d.base} colaboradores</div><div class="bar"><span style="width:${ades}%"></span></div></div>
        <div class="card kpi"><div class="label">Supervisores que entregaram</div><div class="value">${entregues}/${sup.length}</div><div class="sub">${sup.length - entregues} pendente(s)</div><div class="bar"><span style="width:${pct(entregues, sup.length)}%;background:${COR.accent}"></span></div></div>
        <div class="card kpi"><div class="label">DDS realizados</div><div class="value">${d.reunioes}</div><div class="sub">reuniões no tema</div></div>
        <div class="card kpi"><div class="label">Pendentes de assinatura</div><div class="value">${Math.max(0, d.base - d.assinaturas)}</div><div class="sub"><a href="#" id="verPend">ver lista</a></div></div>
      </div>
      <div class="grid grid-3" style="margin-top:16px">
        <div class="card" style="grid-column: span 2"><div class="card-head"><h3>Adesão da equipe por supervisor</h3><span class="muted small">% da equipe que assinou</span></div><div class="chart-box"><canvas id="cSup"></canvas></div></div>
        <div class="card"><div class="card-head"><h3>Status das entregas</h3></div><div class="chart-box"><canvas id="cStatus"></canvas></div></div>
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><div class="card-head"><h3>Evolução semanal</h3><span class="muted small">últimos temas</span></div><div class="chart-box"><canvas id="cEvo"></canvas></div></div>
        <div class="card"><div class="card-head"><h3>Adesão por setor</h3></div><div class="chart-box"><canvas id="cSetor"></canvas></div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h3>Entregas dos supervisores</h3></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Supervisor</th><th>Equipe (setores)</th><th class="right">Equipe</th><th class="right">DDS</th><th class="right">Assinaturas</th><th class="right">Adesão</th><th>Último DDS</th><th>Status</th></tr></thead>
        <tbody>${sup.map((s) => { const p = pct(s.equipe_assinou, s.equipe); return `<tr>
          <td><b>${esc(s.nome)}</b><div class="small muted">${esc(s.matricula)} · ${esc(s.cargo || "")}</div></td>
          <td class="small">${(s.setores || []).map(esc).join("<br>") || '<span class="muted">sem vínculo</span>'}</td>
          <td class="right">${s.equipe}</td><td class="right">${s.reunioes}</td><td class="right">${s.assinaturas}</td>
          <td class="right"><b>${s.equipe ? p + "%" : "—"}</b></td><td>${s.ultima_data ? fmtData(s.ultima_data) : "—"}</td><td>${statusChip(p, s.reunioes > 0)}</td></tr>`; }).join("")}</tbody></table></div></div>`;

    $("#selTema").onchange = (e) => { limparCharts(); painel(e.target.value).catch(erro); };
    $("#atualizar").onclick = () => { limparCharts(); painel(tId).catch(erro); };
    $("#verPend").onclick = (e) => { e.preventDefault(); ir("relatorios"); setTimeout(() => { const s = $("#rTipo"); if (s) { s.value = "pendentes"; s.onchange(); } }, 400); };

    if (!window.Chart) return;
    const ordenados = [...sup].sort((a, b) => pct(b.equipe_assinou, b.equipe) - pct(a.equipe_assinou, a.equipe));
    charts.push(new Chart($("#cSup"), {
      type: "bar",
      data: { labels: ordenados.map((s) => s.nome.split(" ").slice(0, 2).join(" ")),
        datasets: [{ label: "Adesão (%)", data: ordenados.map((s) => pct(s.equipe_assinou, s.equipe)), backgroundColor: ordenados.map((s) => corAdesao(pct(s.equipe_assinou, s.equipe), s.reunioes > 0)), borderRadius: 6, maxBarThickness: 26 }] },
      options: { indexAxis: "y", maintainAspectRatio: false, scales: { x: { min: 0, max: 100, ticks: { callback: (v) => v + "%" } }, y: { grid: { display: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const s = ordenados[c.dataIndex]; return ` ${c.raw}% · ${s.equipe_assinou}/${s.equipe} · ${s.reunioes} DDS`; } } } } },
    }));
    const parcial = sup.filter((s) => s.reunioes > 0 && pct(s.equipe_assinou, s.equipe) < 80).length;
    charts.push(new Chart($("#cStatus"), {
      type: "doughnut",
      data: { labels: ["Entregue (≥80%)", "Parcial", "Não realizado"], datasets: [{ data: [entregues - parcial, parcial, sup.length - entregues], backgroundColor: [COR.ok, COR.warn, COR.bad], borderWidth: 2, borderColor: "#fff" }] },
      options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom" } } },
    }));
    charts.push(new Chart($("#cEvo"), {
      type: "line",
      data: { labels: evo.map((e) => fmtData(e.semana_inicio).slice(0, 5)),
        datasets: [
          { label: "Adesão geral (%)", data: evo.map((e) => pct(Math.min(e.assinaturas, e.base), e.base)), borderColor: COR.brand, backgroundColor: COR.brand, tension: .3, pointRadius: 4 },
          { label: "Supervisores que entregaram (%)", data: evo.map((e) => pct(e.supervisores_entregaram, e.supervisores_total)), borderColor: COR.accent, backgroundColor: COR.accent, tension: .3, pointRadius: 4, borderDash: [5, 4] },
        ] },
      options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + "%" } } },
        plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { title: (c) => evo[c[0].dataIndex].titulo } } } },
    }));
    const setores = d.por_setor.filter((s) => s.total > 0).sort((a, b) => pct(b.assinaram, b.total) - pct(a.assinaram, a.total));
    charts.push(new Chart($("#cSetor"), {
      type: "bar",
      data: { labels: setores.map((s) => s.setor.replace(/^EQ-\s*/, "").replace(/ - CD AM$/, "")),
        datasets: [{ label: "Adesão (%)", data: setores.map((s) => pct(s.assinaram, s.total)), backgroundColor: setores.map((s) => corAdesao(pct(s.assinaram, s.total), s.assinaram > 0)), borderRadius: 6, maxBarThickness: 30 }] },
      options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + "%" } }, x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 50, minRotation: 30, font: { size: 10 } } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.raw}% · ${setores[c.dataIndex].assinaram}/${setores[c.dataIndex].total}` } } } },
    }));
  }

  // =====================================================================
  // TEMAS
  // =====================================================================
  async function temasView() {
    const lista = await temas(true);
    const hoje = hojeISO();
    view.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Conteúdo</div><h1>Temas semanais</h1><div class="muted small">Os temas publicados ficam disponíveis para os supervisores conduzirem o DDS na semana.</div></div>
        <button class="btn btn-accent" id="novoTema">+ Novo tema</button></div>
      <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Semana</th><th>Tema</th><th>Tipo</th><th>Status</th><th class="right">DDS</th><th class="right">Assinaturas</th><th></th></tr></thead><tbody>
      ${lista.length ? lista.map((t) => `<tr>
        <td class="nowrap">${fmtData(t.semana_inicio)} – ${fmtData(t.semana_fim)}${t.semana_inicio <= hoje && t.semana_fim >= hoje ? '<br><span class="chip chip-brand">vigente</span>' : ""}</td>
        <td><b>${esc(t.titulo)}</b><div class="small muted">${esc((t.objetivo || "").slice(0, 90))}</div></td>
        <td class="small">${esc(tipoLabel(t.tipo))}</td>
        <td>${t.status === "publicado" ? '<span class="chip chip-ok">Publicado</span>' : t.status === "rascunho" ? '<span class="chip chip-muted">Rascunho</span>' : '<span class="chip chip-info">Arquivado</span>'}</td>
        <td class="right">${t.reunioes}</td><td class="right">${t.assinaturas}</td>
        <td class="right nowrap"><button class="btn btn-ghost btn-sm" data-ed="${t.id}">Editar</button> <button class="btn btn-ghost btn-sm" data-dup="${t.id}">Duplicar</button>
        ${t.reunioes == 0 ? `<button class="btn btn-ghost btn-sm" data-del="${t.id}">Excluir</button>` : ""}</td></tr>`).join("")
        : `<tr><td colspan="7" class="empty">Nenhum tema cadastrado.</td></tr>`}</tbody></table></div></div>`;
    $("#novoTema").onclick = () => formTema(null, lista);
    $$("[data-ed]").forEach((b) => (b.onclick = () => formTema(lista.find((t) => t.id === b.dataset.ed), lista)));
    $$("[data-dup]").forEach((b) => (b.onclick = () => { const t = Object.assign({}, lista.find((x) => x.id === b.dataset.dup)); delete t.id; t.assinaturas = 0; t.titulo += " (cópia)"; formTema(t, lista, true); }));
    $$("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!(await confirmar("Excluir este tema? Esta ação não pode ser desfeita.", { perigo: true, ok: "Excluir" }))) return;
      try { await call("adm_tema_excluir", { p_id: b.dataset.del }); toast("Tema excluído.", "ok"); temasView(); } catch (e) { erro(e); }
    }));
  }

  function proximaSemana(lista) {
    const base = lista.length ? new Date(lista.map((t) => t.semana_fim).sort().pop() + "T12:00:00") : new Date(hojeISO() + "T12:00:00");
    const d = new Date(base); d.setDate(d.getDate() + 1);
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
    if (!lista.length) { d.setTime(new Date(hojeISO() + "T12:00:00").getTime()); while (d.getDay() !== 1) d.setDate(d.getDate() - 1); }
    const fim = new Date(d); fim.setDate(fim.getDate() + 6);
    const iso = (x) => x.toISOString().slice(0, 10);
    return [iso(d), iso(fim)];
  }

  function formTema(t, lista, duplicando) {
    const novo = !t || !t.id;
    const travado = !novo && t.assinaturas > 0;
    const [ini, fim] = novo && !duplicando ? proximaSemana(lista) : duplicando ? proximaSemana(lista) : [t.semana_inicio, t.semana_fim];
    t = t || {};
    const m = modal({
      titulo: novo ? "Novo tema" : "Editar tema", grande: true,
      corpo: `${travado ? `<div class="alert alert-warn">Este tema já possui assinaturas. Para preservar a evidência, o conteúdo está bloqueado — apenas status, data final e material de apoio podem ser alterados.</div>` : ""}
        <div class="field"><label>Título do tema *</label><input type="text" id="tTit" value="${esc(t.titulo || "")}" ${travado ? "disabled" : ""} placeholder="Ex.: Prevenção de quedas no armazém"></div>
        <div class="grid grid-4">
          <div class="field"><label>Início da semana *</label><input type="date" id="tIni" value="${ini}" ${travado ? "disabled" : ""}></div>
          <div class="field"><label>Fim da semana *</label><input type="date" id="tFim" value="${fim}"></div>
          <div class="field"><label>Tipo</label><select id="tTipo" ${travado ? "disabled" : ""}>
            ${["comportamental", "tecnico", "tecnico_comportamental"].map((x) => `<option value="${x}" ${t.tipo === x ? "selected" : ""}>${tipoLabel(x)}</option>`).join("")}</select></div>
          <div class="field"><label>Carga horária (min)</label><input type="number" id="tCh" min="5" max="240" value="${t.carga_horaria_min || 15}" ${travado ? "disabled" : ""}></div>
        </div>
        <div class="field"><label>Objetivo geral</label><input type="text" id="tObj" value="${esc(t.objetivo || "")}" ${travado ? "disabled" : ""}></div>
        <div class="field"><label>Público alvo</label><input type="text" id="tPub" value="${esc(t.publico_alvo || "Todos os colaboradores do CD AM")}" ${travado ? "disabled" : ""}></div>
        <div class="field"><label>Conteúdo a ser explanado pelo supervisor *</label><textarea id="tCont" rows="10" ${travado ? "disabled" : ""} placeholder="Pontos principais, orientações, exemplos, perguntas para a equipe...">${esc(t.conteudo || "")}</textarea></div>
        <div class="grid grid-2">
          <div class="field"><label>Link de material de apoio (opcional)</label><input type="url" id="tUrl" value="${esc(t.material_url || "")}" placeholder="https://..."><div class="hint">Vídeo, PDF ou apresentação (SharePoint, Drive, YouTube).</div></div>
          <div class="field"><label>Status</label><select id="tSt">${["publicado", "rascunho", "arquivado"].map((x) => `<option value="${x}" ${(t.status || "publicado") === x ? "selected" : ""}>${x[0].toUpperCase() + x.slice(1)}</option>`).join("")}</select></div>
        </div>`,
      rodape: `<button class="btn btn-ghost" data-x>Cancelar</button><button class="btn" id="tOk">Salvar tema</button>`,
    });
    $("[data-x]", m.el).onclick = m.fechar;
    $("#tOk", m.el).onclick = (ev) => {
      const p = { id: novo ? null : t.id, titulo: $("#tTit", m.el).value, conteudo: $("#tCont", m.el).value, objetivo: $("#tObj", m.el).value, publico_alvo: $("#tPub", m.el).value,
        tipo: $("#tTipo", m.el).value, carga_horaria_min: $("#tCh", m.el).value, material_url: $("#tUrl", m.el).value, semana_inicio: $("#tIni", m.el).value, semana_fim: $("#tFim", m.el).value, status: $("#tSt", m.el).value };
      if (!p.titulo.trim() || !p.conteudo.trim() || !p.semana_inicio || !p.semana_fim) { toast("Preencha título, conteúdo e período.", "err"); return; }
      if (p.semana_fim < p.semana_inicio) { toast("A data final deve ser posterior à inicial.", "err"); return; }
      comLoading(ev.currentTarget, async () => {
        try { await call("adm_tema_salvar", { p }); m.fechar(); toast("Tema salvo.", "ok"); temasView(); } catch (e) { erro(e); }
      });
    };
  }

  // =====================================================================
  // DDS E EVIDÊNCIAS
  // =====================================================================
  async function dds() {
    const lista = await temas();
    view.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Evidências</div><h1>DDS realizados</h1><div class="muted small">Todas as reuniões, assinaturas e listas de presença (FO-COR-SEG-001).</div></div>
        <div class="row"><a class="btn btn-ghost" href="supervisor.html">Conduzir um DDS</a></div></div>
      <div class="card"><div class="row" style="align-items:flex-end">
        <div style="flex:2;min-width:220px"><label>Tema</label><select id="fTema"><option value="">Todos os temas</option>${opcoesTemas(lista)}</select></div>
        <div style="flex:1;min-width:140px"><label>De</label><input type="date" id="fIni"></div>
        <div style="flex:1;min-width:140px"><label>Até</label><input type="date" id="fFim"></div>
        <button class="btn" id="fBuscar">Filtrar</button><button class="btn btn-ghost" id="fXls">Exportar assinaturas (Excel)</button></div></div>
      <div class="card" id="ddsLista"><div class="empty"><span class="spinner"></span></div></div>`;
    const filtros = () => ({ p_tema_id: $("#fTema").value || null, p_inicio: $("#fIni").value || null, p_fim: $("#fFim").value || null });
    async function buscar() {
      const rs = await call("adm_reunioes", filtros());
      $("#ddsLista").innerHTML = rs.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Supervisor</th><th>Tema</th><th>Local</th><th>Código</th><th class="right">Assinaturas</th><th>Status</th><th></th></tr></thead><tbody>
        ${rs.map((r) => `<tr><td class="nowrap">${fmtData(r.data)} ${fmtHora(r.horario)}</td><td><b>${esc(r.supervisor)}</b><div class="small muted">${esc(r.supervisor_matricula)}</div></td>
          <td>${esc(r.tema)}</td><td class="small">${esc(r.local || "")}</td><td class="mono">${esc(r.codigo)}</td><td class="right"><b>${r.assinaturas}</b></td>
          <td>${r.status === "aberta" ? '<span class="chip chip-warn">Aberto</span>' : '<span class="chip chip-ok">Encerrado</span>'}</td>
          <td class="right nowrap"><button class="btn btn-ghost btn-sm" data-ver="${r.id}">Ver</button> <a class="btn btn-sm" href="evidencia.html?id=${r.id}" target="_blank">Evidência</a>
          ${r.status === "encerrada" && r.data === hojeISO() ? ` <button class="btn btn-ghost btn-sm" data-reabrir="${r.id}">Reabrir</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
          <p class="small muted" style="margin-top:10px">${rs.length} DDS · ${rs.reduce((n, r) => n + r.assinaturas, 0)} assinaturas</p>`
        : `<div class="empty">Nenhum DDS encontrado para os filtros.</div>`;
      $$("[data-ver]").forEach((b) => (b.onclick = () => verReuniao(b.dataset.ver)));
      $$("[data-reabrir]").forEach((b) => (b.onclick = async () => {
        if (!(await confirmar("Reabrir este DDS para receber novas assinaturas hoje?"))) return;
        try { await call("adm_reabrir_reuniao", { p_reuniao_id: b.dataset.reabrir }); toast("DDS reaberto.", "ok"); buscar(); } catch (e) { erro(e); }
      }));
    }
    $("#fBuscar").onclick = () => buscar().catch(erro);
    $("#fXls").onclick = (ev) => comLoading(ev.currentTarget, async () => {
      try {
        const a = await call("adm_assinaturas", filtros());
        if (!a.length) { toast("Nenhuma assinatura no filtro.", "err"); return; }
        Relatorio.excel({ titulo: "Assinaturas DDS", subtitulo: `Exportado em ${fmtDataHora(new Date().toISOString())}`, resumo: [["Total de assinaturas", a.length]],
          tabelas: [{ titulo: "Assinaturas", colunas: ["Data", "Horário", "Tema", "Supervisor", "Mat. supervisor", "Matrícula", "Nome", "Cargo", "Setor", "Assinado em", "Método", "Código DDS", "Hash"],
            linhas: a.map((x) => [fmtData(x.data), fmtHora(x.horario), x.tema, x.supervisor, x.supervisor_matricula, x.matricula, x.nome, x.cargo, x.setor, fmtDataHora(x.assinado_em), x.metodo === "quiosque" ? "Quiosque" : "Próprio dispositivo", x.codigo, x.hash]) }] },
          `assinaturas_dds_${hojeISO()}.xlsx`);
      } catch (e) { erro(e); }
    });
    buscar().catch(erro);
  }

  async function verReuniao(id) {
    const d = await call("reuniao_detalhe", { p_reuniao_id: id });
    const r = d.reuniao;
    modal({
      titulo: `DDS ${fmtData(r.data)} · ${r.supervisor_nome}`, grande: true,
      corpo: `<p><b>${esc(d.tema.titulo)}</b><br><span class="muted small">${fmtHora(r.horario)} · ${esc(r.local || "")} · código ${esc(r.codigo)} · ${r.status}</span></p>
        <div class="tabs"><button class="active" data-t="a">Assinaturas (${d.assinaturas.length})</button><button data-t="p">Pendentes da equipe (${d.pendentes.length})</button></div>
        <div data-p="a">${d.assinaturas.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Colaborador</th><th>Setor</th><th>Assinatura</th><th>Data/hora</th></tr></thead><tbody>
          ${d.assinaturas.map((a) => `<tr><td><b>${esc(a.nome)}</b><div class="small muted">${esc(a.matricula)} · ${esc(a.cargo || "")}</div></td><td class="small">${esc(a.setor || "")}</td><td><img class="sig" src="${a.assinatura}"></td>
            <td class="small nowrap">${fmtDataHora(a.assinado_em)}<div class="muted">${a.metodo === "quiosque" ? "quiosque" : "próprio dispositivo"}</div></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Sem assinaturas.</div>'}</div>
        <div data-p="p" class="hidden">${d.pendentes.length ? `<ul class="list-plain">${d.pendentes.map((p) => `<li><b>${esc(p.nome)}</b> <span class="small muted">${esc(p.matricula)} · ${esc(p.setor || "")}</span></li>`).join("")}</ul>` : '<div class="empty">Ninguém pendente.</div>'}</div>`,
      rodape: `<a class="btn" href="evidencia.html?id=${r.id}" target="_blank">Abrir evidência (FO-COR-SEG-001)</a>`,
    }).el.querySelectorAll(".tabs button").forEach((b, _, all) => (b.onclick = () => {
      all.forEach((x) => x.classList.toggle("active", x === b));
      b.closest(".modal-body").querySelectorAll("[data-p]").forEach((p) => p.classList.toggle("hidden", p.dataset.p !== b.dataset.t));
    }));
  }

  // =====================================================================
  // COLABORADORES (base, importação, equipes, histórico)
  // =====================================================================
  async function colaboradores(aba) {
    aba = aba || "base";
    view.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Base de dados</div><h1>Colaboradores</h1><div class="muted small">Contratações, desligamentos e mudanças de setor. Nenhuma assinatura é perdida ao atualizar a base.</div></div>
        <button class="btn btn-ghost" id="novoColab">+ Cadastrar colaborador</button></div>
      <div class="tabs" id="cTabs">
        <button data-a="base">Base de colaboradores</button><button data-a="importar">Importar Excel</button>
        <button data-a="equipes">Equipes dos supervisores</button><button data-a="historico">Histórico de alterações</button></div>
      <div id="cBody"><div class="empty"><span class="spinner"></span></div></div>`;
    $$("#cTabs button").forEach((b) => { b.classList.toggle("active", b.dataset.a === aba); b.onclick = () => colaboradores(b.dataset.a).catch(erro); });
    $("#novoColab").onclick = () => formColaborador();
    const body = $("#cBody");
    if (aba === "base") return abaBase(body);
    if (aba === "importar") return abaImportar(body);
    if (aba === "equipes") return abaEquipes(body);
    if (aba === "historico") return abaHistorico(body);
  }

  async function abaBase(body) {
    const lista = await call("adm_colaboradores");
    const setores = [...new Set(lista.map((c) => c.setor).filter(Boolean))].sort();
    body.innerHTML = `<div class="card">
      <div class="row" style="margin-bottom:12px">
        <input type="search" id="bBusca" placeholder="Buscar por nome ou matrícula" style="flex:2;min-width:200px">
        <select id="bStatus" style="flex:1;min-width:130px"><option value="ativo">Ativos</option><option value="inativo">Desligados</option><option value="">Todos</option></select>
        <select id="bPerfil" style="flex:1;min-width:130px"><option value="">Todos os perfis</option><option value="colaborador">Colaborador</option><option value="supervisor">Supervisor</option><option value="admin">SESMT (Admin)</option></select>
        <select id="bSetor" style="flex:2;min-width:180px"><option value="">Todos os setores</option>${setores.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
        <button class="btn btn-ghost" id="bXls">Exportar</button>
      </div><div id="bTabela"></div></div>`;
    const render = () => {
      const q = normalizar($("#bBusca").value), st = $("#bStatus").value, pf = $("#bPerfil").value, se = $("#bSetor").value;
      const f = lista.filter((c) => (!q || normalizar(c.nome).includes(q) || c.matricula.includes(q)) && (!st || (st === "ativo") === c.ativo) && (!pf || c.perfil === pf) && (!se || c.setor === se));
      $("#bTabela").innerHTML = `<div class="table-wrap scroll-y" style="max-height:620px"><table class="tbl"><thead><tr><th>Matrícula</th><th>Nome</th><th>Cargo</th><th>Setor</th><th>Perfil</th><th>Status</th><th class="right">Assin.</th><th></th></tr></thead><tbody>
        ${f.map((c) => `<tr><td class="mono">${esc(c.matricula)}</td><td><b>${esc(c.nome)}</b></td><td class="small">${esc(c.cargo || "")}</td><td class="small">${esc(c.setor || "")}</td>
          <td><span class="chip ${c.perfil === "admin" ? "chip-brand" : c.perfil === "supervisor" ? "chip-info" : "chip-muted"}">${perfilLabel(c.perfil)}</span></td>
          <td>${c.ativo ? '<span class="chip chip-ok">Ativo</span>' : `<span class="chip chip-danger">Desligado</span><div class="small muted">${fmtData((c.desligado_em || "").slice(0, 10))}</div>`}</td>
          <td class="right">${c.assinaturas}</td><td class="right"><button class="btn btn-ghost btn-sm" data-id="${c.id}">Gerenciar</button></td></tr>`).join("")}</tbody></table></div>
        <p class="small muted" style="margin-top:8px">${f.length} de ${lista.length} registros · ${lista.filter((c) => c.ativo).length} ativos</p>`;
      $$("#bTabela [data-id]").forEach((b) => (b.onclick = () => gerenciarColaborador(lista.find((c) => c.id === b.dataset.id))));
    };
    ["bBusca", "bStatus", "bPerfil", "bSetor"].forEach((id) => $("#" + id).addEventListener("input", render));
    $("#bXls").onclick = () => Relatorio.excel({ titulo: "Base de colaboradores", subtitulo: fmtDataHora(new Date().toISOString()), resumo: [["Total", lista.length], ["Ativos", lista.filter((c) => c.ativo).length]],
      tabelas: [{ titulo: "Colaboradores", colunas: ["Matrícula", "Nome", "Cargo", "Setor", "Perfil", "Status", "Desligado em", "Assinaturas"],
        linhas: lista.map((c) => [c.matricula, c.nome, c.cargo, c.setor, perfilLabel(c.perfil), c.ativo ? "Ativo" : "Desligado", fmtData((c.desligado_em || "").slice(0, 10)), c.assinaturas]) }] }, `colaboradores_${hojeISO()}.xlsx`);
    render();
  }

  async function gerenciarColaborador(c) {
    const hist = await call("adm_historico", { p_colaborador_id: c.id });
    const m = modal({
      titulo: c.nome, grande: true,
      corpo: `<div class="grid grid-3"><div><div class="small muted">Matrícula</div><b class="mono">${esc(c.matricula)}</b></div><div><div class="small muted">Cargo</div><b>${esc(c.cargo || "")}</b></div><div><div class="small muted">Setor</div><b>${esc(c.setor || "")}</b></div></div>
        <div class="grid grid-2" style="margin-top:16px">
          <div class="field"><label>Perfil de acesso</label><select id="gPerfil">${["colaborador", "supervisor", "admin"].map((p) => `<option value="${p}" ${c.perfil === p ? "selected" : ""}>${perfilLabel(p)}</option>`).join("")}</select>
            <div class="hint">${c.perfil_manual ? "Perfil definido manualmente (a importação não altera)." : "Perfil definido automaticamente pelo cargo."}</div></div>
          <div class="field"><label>Situação</label><select id="gAtivo"><option value="1" ${c.ativo ? "selected" : ""}>Ativo</option><option value="0" ${!c.ativo ? "selected" : ""}>Desligado</option></select>
            <div class="hint">Desligar bloqueia o acesso, mas mantém todas as assinaturas e evidências.</div></div></div>
        <h3 style="margin-top:10px">Histórico</h3>
        ${hist.length ? `<ul class="list-plain">${hist.map((h) => `<li><div class="row between"><b>${eventoLabel(h.evento)}</b><span class="small muted">${fmtDataHora(h.em)}</span></div>
          <div class="small">${h.anterior ? esc(h.anterior) + " → " : ""}${esc(h.novo || "")} <span class="muted">· ${esc(h.origem)}${h.por ? " por " + esc(h.por) : ""}</span></div></li>`).join("")}</ul>` : '<div class="empty">Sem histórico.</div>'}`,
      rodape: `<button class="btn btn-ghost" data-x>Fechar</button><button class="btn" id="gOk">Salvar alterações</button>`,
    });
    $("[data-x]", m.el).onclick = m.fechar;
    $("#gOk", m.el).onclick = (ev) => comLoading(ev.currentTarget, async () => {
      const ativo = $("#gAtivo", m.el).value === "1", perfil = $("#gPerfil", m.el).value;
      if (!ativo && c.ativo && !(await confirmar(`Confirmar o desligamento de <b>${esc(c.nome)}</b>? As assinaturas já coletadas serão mantidas.`, { perigo: true, ok: "Desligar" }))) return;
      try { await call("adm_colaborador_status", { p_id: c.id, p_ativo: ativo, p_perfil: perfil }); m.fechar(); toast("Colaborador atualizado.", "ok"); colaboradores("base"); } catch (e) { erro(e); }
    });
  }
  function eventoLabel(e) {
    return { admissao: "Inclusão na base", desligamento: "Desligamento", readmissao: "Readmissão / reativação", mudanca_setor: "Mudança de setor", mudanca_cargo: "Mudança de cargo", mudanca_nome: "Correção de nome", mudanca_cpf: "CPF atualizado", mudanca_perfil: "Mudança de perfil" }[e] || e;
  }

  function formColaborador() {
    const m = modal({
      titulo: "Cadastrar / atualizar colaborador",
      corpo: `<div class="alert alert-info">Se a matrícula já existir, os dados serão atualizados (e o colaborador reativado, se estiver desligado).</div>
        <div class="grid grid-2"><div class="field"><label>Matrícula *</label><input type="text" id="cMat" inputmode="numeric"></div>
        <div class="field"><label>CPF *</label><input type="text" id="cCpf" inputmode="numeric" placeholder="000.000.000-00"></div></div>
        <div class="field"><label>Nome completo *</label><input type="text" id="cNome"></div>
        <div class="grid grid-2"><div class="field"><label>Cargo</label><input type="text" id="cCargo"></div><div class="field"><label>Setor</label><input type="text" id="cSetor" placeholder="Ex.: EQ- PRD - CD AM"></div></div>`,
      rodape: `<button class="btn btn-ghost" data-x>Cancelar</button><button class="btn" id="cOk">Salvar</button>`,
    });
    DDS.mascaraCPF($("#cCpf", m.el));
    $("[data-x]", m.el).onclick = m.fechar;
    $("#cOk", m.el).onclick = (ev) => {
      const p = { matricula: $("#cMat", m.el).value, cpf: $("#cCpf", m.el).value, nome: $("#cNome", m.el).value, cargo: $("#cCargo", m.el).value, setor: $("#cSetor", m.el).value };
      if (!p.matricula.trim() || !p.nome.trim() || p.cpf.replace(/\D/g, "").length !== 11) { toast("Preencha matrícula, nome e CPF (11 dígitos).", "err"); return; }
      comLoading(ev.currentTarget, async () => {
        try { const r = await call("adm_colaborador_salvar", { p }); m.fechar(); toast({ novo: "Colaborador cadastrado.", atualizado: "Dados atualizados.", readmitido: "Colaborador reativado.", sem_alteracao: "Nenhuma alteração." }[r] || r, "ok"); colaboradores("base"); }
        catch (e) { erro(e); }
      });
    };
  }

  // ---------- Importação via Excel ----------
  function lerPlanilha(arquivo) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const wb = XLSX.read(new Uint8Array(fr.result), { type: "array" });
          for (const nome of wb.SheetNames) {
            const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: false, defval: "" });
            const hi = linhas.findIndex((l) => l.some((c) => normalizar(c) === "matricula") && l.some((c) => normalizar(c) === "cpf"));
            if (hi < 0) continue;
            const h = linhas[hi].map(normalizar);
            const col = (...nomes) => h.findIndex((x) => nomes.includes(x));
            const iN = col("funcionario", "nome", "colaborador", "nome do funcionario"), iM = col("matricula"), iC = col("cpf"), iCa = col("cargo", "funcao"), iS = col("setor", "setor / empresa", "departamento");
            if (iN < 0 || iM < 0 || iC < 0) continue;
            const rows = linhas.slice(hi + 1).map((l) => ({
              nome: String(l[iN] || "").trim(), matricula: String(l[iM] || "").trim().replace(/\.0+$/, ""), cpf: String(l[iC] || "").trim(),
              cargo: iCa >= 0 ? String(l[iCa] || "").trim() : "", setor: iS >= 0 ? String(l[iS] || "").trim() : "",
            })).filter((r) => r.matricula || r.nome);
            return resolve(rows);
          }
          reject(new Error("Não encontrei as colunas Funcionário, Matrícula e CPF. Use o mesmo modelo da listagem WorkArea."));
        } catch (e) { reject(e); }
      };
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(arquivo);
    });
  }

  async function abaImportar(body) {
    body.innerHTML = `<div class="card">
      <h3>Atualizar a base a partir da listagem de funcionários</h3>
      <p class="muted small">Use o mesmo modelo da planilha <b>Listagem_Funcionarios_WorkArea</b> (colunas Funcionário, Matrícula, CPF, Cargo, Setor). O sistema compara com a base atual e mostra uma prévia antes de aplicar.</p>
      <label class="dropzone" id="drop"><input type="file" id="arq" accept=".xlsx,.xls,.csv" hidden>
        <div style="font-size:30px">📄</div><b>Clique para escolher</b> ou arraste o arquivo Excel aqui<div class="small muted">.xlsx, .xls ou .csv</div></label>
      <div id="prev"></div></div>
      <div class="card"><h3>Importações anteriores</h3><div id="impHist"><div class="empty"><span class="spinner"></span></div></div></div>`;
    const drop = $("#drop");
    ["dragenter", "dragover"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove("drag"); }));
    drop.addEventListener("drop", (ev) => { if (ev.dataTransfer.files[0]) processar(ev.dataTransfer.files[0]); });
    $("#arq").onchange = (ev) => { if (ev.target.files[0]) processar(ev.target.files[0]); ev.target.value = ""; };
    call("adm_importacoes").then((h) => {
      $("#impHist").innerHTML = h.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Arquivo</th><th>Por</th><th class="right">Novos</th><th class="right">Atualizados</th><th class="right">Readmitidos</th><th class="right">Desligados</th><th class="right">Sem alteração</th></tr></thead><tbody>
        ${h.map((i) => `<tr><td class="nowrap">${fmtDataHora(i.em)}</td><td class="small">${esc(i.arquivo || "carga inicial")}</td><td class="small">${esc(i.por || "")}</td><td class="right">${i.resumo.novos ?? ""}</td><td class="right">${i.resumo.atualizados ?? ""}</td><td class="right">${i.resumo.readmitidos ?? ""}</td><td class="right">${i.resumo.desligados ?? ""}</td><td class="right">${i.resumo.sem_alteracao ?? ""}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">Nenhuma importação registrada.</div>';
    }).catch(erro);

    async function processar(arquivo) {
      const prev = $("#prev");
      prev.innerHTML = `<div class="empty"><span class="spinner"></span> Lendo planilha...</div>`;
      let rows, atual;
      try { [rows, atual] = await Promise.all([lerPlanilha(arquivo), call("adm_colaboradores")]); }
      catch (e) { prev.innerHTML = `<div class="alert alert-danger" style="margin-top:14px">${esc(e.message || DDS.msgErro(e))}</div>`; return; }
      const porMat = new Map(atual.map((c) => [c.matricula, c]));
      const vistos = new Set(), dup = [], invalidos = [], novos = [], alterados = [], readm = [], iguais = [];
      rows.forEach((r, i) => {
        const cpf = r.cpf.replace(/\D/g, "");
        if (!r.matricula || !r.nome || !cpf || cpf.length > 11) { invalidos.push({ ...r, linha: i + 2 }); return; }
        if (vistos.has(r.matricula)) { dup.push(r); return; }
        vistos.add(r.matricula);
        const c = porMat.get(r.matricula);
        if (!c) return novos.push(r);
        const mud = [];
        if ((c.setor || "") !== r.setor) mud.push(`Setor: ${c.setor || "—"} → ${r.setor || "—"}`);
        if ((c.cargo || "") !== r.cargo) mud.push(`Cargo: ${c.cargo || "—"} → ${r.cargo || "—"}`);
        if (c.nome !== r.nome) mud.push(`Nome: ${c.nome} → ${r.nome}`);
        if (!c.ativo) return readm.push({ ...r, mud });
        if (mud.length) alterados.push({ ...r, mud }); else iguais.push(r);
      });
      const ausentes = atual.filter((c) => c.ativo && !vistos.has(c.matricula) && c.id !== me.id);
      const validas = rows.filter((r) => !invalidos.includes(r));
      const bloco = (titulo, itens, fmt, cls) => `<details ${itens.length && itens.length <= 15 ? "open" : ""} style="margin-top:8px"><summary><b>${titulo}</b> <span class="chip ${cls}">${itens.length}</span></summary>
        ${itens.length ? `<ul class="list-plain" style="margin:6px 0 0 14px">${itens.map(fmt).join("")}</ul>` : '<div class="small muted" style="margin:6px 14px">Nenhum.</div>'}</details>`;
      prev.innerHTML = `<div style="margin-top:18px"><div class="row between"><h3 style="margin:0">Prévia: ${esc(arquivo.name)}</h3><span class="muted small">${rows.length} linhas lidas</span></div>
        <div class="diff-grid">
          <div class="kpi"><div class="label">Novos</div><div class="value" style="color:${COR.ok}">${novos.length}</div></div>
          <div class="kpi"><div class="label">Alterados</div><div class="value" style="color:${COR.info}">${alterados.length}</div></div>
          <div class="kpi"><div class="label">Readmitidos</div><div class="value">${readm.length}</div></div>
          <div class="kpi"><div class="label">Ausentes</div><div class="value" style="color:${COR.bad}">${ausentes.length}</div></div>
          <div class="kpi"><div class="label">Sem alteração</div><div class="value" style="color:#7b8a80">${iguais.length}</div></div></div>
        ${invalidos.length ? `<div class="alert alert-warn">${invalidos.length} linha(s) ignorada(s) por falta de matrícula, nome ou CPF: ${invalidos.slice(0, 10).map((x) => "linha " + x.linha).join(", ")}${invalidos.length > 10 ? "..." : ""}</div>` : ""}
        ${dup.length ? `<div class="alert alert-warn">${dup.length} matrícula(s) duplicada(s) na planilha — será considerada a primeira ocorrência.</div>` : ""}
        ${bloco("Novas contratações", novos, (r) => `<li><b>${esc(r.nome)}</b> <span class="small muted">${esc(r.matricula)} · ${esc(r.cargo)} · ${esc(r.setor)}</span></li>`, "chip-ok")}
        ${bloco("Mudanças de setor / cargo / nome", alterados, (r) => `<li><b>${esc(r.nome)}</b> <span class="small muted">${esc(r.matricula)}</span><div class="small">${r.mud.map(esc).join("<br>")}</div></li>`, "chip-info")}
        ${bloco("Readmissões (estavam desligados)", readm, (r) => `<li><b>${esc(r.nome)}</b> <span class="small muted">${esc(r.matricula)} · ${esc(r.setor)}</span></li>`, "chip-muted")}
        ${bloco("Ativos que NÃO estão na planilha (possíveis desligamentos)", ausentes, (c) => `<li><b>${esc(c.nome)}</b> <span class="small muted">${esc(c.matricula)} · ${esc(c.setor || "")} · ${c.assinaturas} assinatura(s) preservada(s)</span></li>`, "chip-danger")}
        <div class="card" style="margin-top:16px;background:var(--surface-2);box-shadow:none">
          <label class="check"><input type="checkbox" id="desligar" ${ausentes.length ? "checked" : ""}><span><b>Desligar os ${ausentes.length} colaborador(es) ativos que não constam na planilha.</b><br><span class="small muted">Use quando a planilha for a listagem COMPLETA da unidade. O acesso deles é bloqueado, mas todas as assinaturas e evidências permanecem guardadas.</span></span></label>
          <div class="alert alert-ok" style="margin:14px 0 0">🔒 Garantia: a importação nunca exclui colaboradores, assinaturas, DDS ou temas. Assinaturas antigas mantêm o nome, cargo e setor da data em que foram feitas.</div>
          <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn btn-ghost" id="impCancel">Cancelar</button><button class="btn btn-lg" id="impOk">Aplicar importação</button></div>
        </div></div>`;
      $("#impCancel").onclick = () => (prev.innerHTML = "");
      $("#impOk").onclick = (ev) => comLoading(ev.currentTarget, async () => {
        const desligar = $("#desligar").checked;
        if (desligar && ausentes.length && !(await confirmar(`Serão desligados ${ausentes.length} colaborador(es). Confirmar?`, { perigo: true, ok: "Aplicar" }))) return;
        try {
          const unicos = []; const s = new Set();
          validas.forEach((r) => { if (!s.has(r.matricula)) { s.add(r.matricula); unicos.push(r); } });
          const res = await call("adm_importar", { p_linhas: unicos, p_desligar_ausentes: desligar, p_arquivo: arquivo.name });
          toast(`Importação concluída: ${res.novos} novos, ${res.atualizados} atualizados, ${res.readmitidos} readmitidos, ${res.desligados} desligados.`, "ok");
          colaboradores("importar");
        } catch (e) { erro(e); }
      });
    }
  }

  // ---------- Equipes ----------
  async function abaEquipes(body) {
    const d = await call("adm_equipes");
    body.innerHTML = `<div class="card"><p class="muted small">Vincule cada supervisor aos setores da sua equipe. Esse vínculo define a base de cálculo da adesão no painel e a lista de pendentes de cada supervisor. Para tornar alguém supervisor, altere o perfil em <b>Base de colaboradores</b>.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Supervisor</th><th>Setores vinculados</th><th class="right">Equipe</th><th></th></tr></thead><tbody>
      ${d.supervisores.map((s) => `<tr><td><b>${esc(s.nome)}</b><div class="small muted">${esc(s.matricula)} · ${esc(s.cargo || "")} · ${perfilLabel(s.perfil)}</div></td>
        <td class="small">${s.setores.map(esc).join("<br>") || '<span class="chip chip-warn">sem setor</span>'}</td>
        <td class="right">${d.setores.filter((x) => s.setores.includes(x.setor)).reduce((n, x) => n + x.total, 0)}</td>
        <td class="right"><button class="btn btn-ghost btn-sm" data-id="${s.id}">Editar</button></td></tr>`).join("")}</tbody></table></div></div>`;
    $$("[data-id]", body).forEach((b) => (b.onclick = () => {
      const s = d.supervisores.find((x) => x.id === b.dataset.id);
      const m = modal({
        titulo: `Equipe de ${s.nome}`, grande: true,
        corpo: `<div class="setor-checks">${d.setores.map((x) => `<label class="check"><input type="checkbox" value="${esc(x.setor)}" ${s.setores.includes(x.setor) ? "checked" : ""}><span>${esc(x.setor)} <span class="muted small">(${x.total})</span></span></label>`).join("")}</div>`,
        rodape: `<button class="btn btn-ghost" data-x>Cancelar</button><button class="btn" id="eqOk">Salvar</button>`,
      });
      $("[data-x]", m.el).onclick = m.fechar;
      $("#eqOk", m.el).onclick = (ev) => comLoading(ev.currentTarget, async () => {
        try { await call("adm_equipe_salvar", { p_supervisor_id: s.id, p_setores: $$("input:checked", m.el).map((i) => i.value) }); m.fechar(); toast("Equipe atualizada.", "ok"); colaboradores("equipes"); } catch (e) { erro(e); }
      });
    }));
  }

  async function abaHistorico(body) {
    const h = await call("adm_historico", { p_colaborador_id: null });
    body.innerHTML = `<div class="card"><div class="table-wrap scroll-y" style="max-height:640px"><table class="tbl"><thead><tr><th>Data</th><th>Colaborador</th><th>Evento</th><th>Detalhe</th><th>Origem</th></tr></thead><tbody>
      ${h.map((x) => `<tr><td class="nowrap small">${fmtDataHora(x.em)}</td><td><b>${esc(x.nome)}</b><div class="small muted">${esc(x.matricula)}</div></td><td>${eventoLabel(x.evento)}</td>
        <td class="small">${x.anterior ? esc(x.anterior) + " → " : ""}${esc(x.novo || "")}</td><td class="small">${esc(x.origem)}${x.por ? "<br>" + esc(x.por) : ""}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">Sem registros.</td></tr>'}
      </tbody></table></div><p class="small muted" style="margin-top:8px">Últimos 500 eventos.</p></div>`;
  }

  // =====================================================================
  // RELATÓRIOS
  // =====================================================================
  async function relatorios() {
    const lista = await temas();
    const pad = temaPadrao(lista);
    const ini = new Date(hojeISO() + "T12:00:00"); ini.setDate(1);
    view.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Relatórios</div><h1>Relatórios para Teams e e-mail</h1>
        <div class="muted small">Gere o relatório, confira a prévia e copie já formatado para colar no Microsoft Teams ou no e-mail corporativo.</div></div></div>
      <div class="card"><div class="row" style="align-items:flex-end">
        <div style="flex:2;min-width:220px"><label>Tipo de relatório</label><select id="rTipo">
          <option value="tema">Entregas do tema por supervisor</option>
          <option value="pendentes">Colaboradores pendentes no tema</option>
          <option value="periodo">DDS realizados no período</option>
          <option value="consolidado">Consolidado semanal (evolução)</option></select></div>
        <div style="flex:2;min-width:220px" id="wTema"><label>Tema</label><select id="rTema">${opcoesTemas(lista, pad && pad.id)}</select></div>
        <div style="flex:1;min-width:140px" class="hidden" id="wIni"><label>De</label><input type="date" id="rIni" value="${ini.toISOString().slice(0, 10)}"></div>
        <div style="flex:1;min-width:140px" class="hidden" id="wFim"><label>Até</label><input type="date" id="rFim" value="${hojeISO()}"></div>
        <button class="btn" id="rGerar">Gerar relatório</button></div></div>
      <div class="card hidden" id="rSaida">
        <div class="card-head"><h3>Prévia</h3><div class="row">
          <button class="btn btn-sm" id="cpTeams">Copiar para Teams</button>
          <button class="btn btn-sm" id="cpEmail">Copiar para e-mail</button>
          <button class="btn btn-sm btn-ghost" id="cpTxt">Copiar texto simples</button>
          <button class="btn btn-sm btn-ghost" id="abrirEmail">Abrir no e-mail</button>
          <button class="btn btn-sm btn-ghost" id="xls">Baixar Excel</button></div></div>
        <div class="report-preview" id="rPrev"></div>
        <p class="hint">Dica: “Copiar para Teams/e-mail” mantém negrito e tabelas ao colar (Ctrl+V). Use “texto simples” em chats que não aceitam formatação.</p></div>`;
    const tipo = $("#rTipo");
    tipo.onchange = () => {
      const t = tipo.value;
      $("#wTema").classList.toggle("hidden", !(t === "tema" || t === "pendentes"));
      $("#wIni").classList.toggle("hidden", t !== "periodo");
      $("#wFim").classList.toggle("hidden", t !== "periodo");
      gerar();
    };
    let modelo = null;
    async function gerar() {
      const btn = $("#rGerar");
      await comLoading(btn, async () => {
        try { modelo = await montar(tipo.value); } catch (e) { erro(e); return; }
        $("#rSaida").classList.remove("hidden");
        $("#rPrev").innerHTML = Relatorio.html(modelo, "email");
      });
    }
    $("#rGerar").onclick = gerar;
    $("#cpTeams").onclick = async () => toast((await DDS.copiarRico(Relatorio.html(modelo, "teams"), Relatorio.texto(modelo))) ? "Copiado! Cole no Teams com Ctrl+V." : "Não foi possível copiar.", "ok");
    $("#cpEmail").onclick = async () => toast((await DDS.copiarRico(Relatorio.html(modelo, "email"), Relatorio.texto(modelo))) ? "Copiado! Cole no corpo do e-mail com Ctrl+V." : "Não foi possível copiar.", "ok");
    $("#cpTxt").onclick = async () => toast((await DDS.copiarTexto(Relatorio.texto(modelo))) ? "Texto copiado." : "Não foi possível copiar.", "ok");
    $("#abrirEmail").onclick = async () => {
      await DDS.copiarRico(Relatorio.html(modelo, "email"), Relatorio.texto(modelo));
      let corpo = Relatorio.texto(modelo);
      if (corpo.length > 1500) corpo = corpo.slice(0, 1500) + "\n\n[...] Relatório completo copiado: cole com Ctrl+V.";
      location.href = `mailto:?subject=${encodeURIComponent(modelo.titulo)}&body=${encodeURIComponent(corpo)}`;
      toast("Relatório formatado copiado — você pode colar no e-mail com Ctrl+V.", "ok");
    };
    $("#xls").onclick = () => Relatorio.excel(modelo, `${modelo.titulo.replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_").slice(0, 60)}.xlsx`);
    gerar();
  }

  async function montar(tipo) {
    if (tipo === "tema" || tipo === "pendentes") {
      const id = $("#rTema").value;
      if (!id) throw new Error("Cadastre um tema primeiro.");
      const d = await call("adm_dashboard", { p_tema_id: id });
      const t = d.tema;
      const sub = `Semana ${fmtData(t.semana_inicio)} a ${fmtData(t.semana_fim)} · ${CONFIG.UNIDADE}`;
      const sup = d.supervisores;
      const entregues = sup.filter((s) => s.reunioes > 0).length;
      if (tipo === "tema") {
        return {
          titulo: `Relatório DDS – ${t.titulo}`, subtitulo: sub,
          resumo: [["Adesão geral", `${pct(Math.min(d.assinaturas, d.base), d.base)}%`], ["Assinaturas", `${d.assinaturas} de ${d.base}`], ["DDS realizados", d.reunioes], ["Supervisores que entregaram", `${entregues} de ${sup.length}`]],
          tabelas: [
            { titulo: "Entregas por supervisor", aba: "Supervisores", colunas: ["Supervisor", "Equipe", "DDS", "Assinaram", "Adesão", "Último DDS", "Status"],
              linhas: sup.map((s) => { const p = pct(s.equipe_assinou, s.equipe); return [s.nome, s.equipe, s.reunioes, s.equipe_assinou, s.equipe ? p + "%" : "—", s.ultima_data ? fmtData(s.ultima_data) : "—", s.reunioes ? (p >= 80 ? "✅ Entregue" : "⚠️ Parcial") : "❌ Não realizado"]; }) },
            { titulo: "Adesão por setor", aba: "Setores", colunas: ["Setor", "Colaboradores", "Assinaram", "Adesão"],
              linhas: d.por_setor.map((s) => [s.setor, s.total, s.assinaram, pct(s.assinaram, s.total) + "%"]) },
          ],
          nota: sup.length - entregues ? `Pendentes de realização: ${sup.filter((s) => !s.reunioes).map((s) => s.nome).join(", ")}.` : "Todos os supervisores realizaram o DDS do tema. 👏",
        };
      }
      const p = await call("adm_pendentes", { p_tema_id: id });
      return {
        titulo: `Pendentes DDS – ${t.titulo}`, subtitulo: sub,
        resumo: [["Colaboradores pendentes", p.length], ["Adesão atual", `${pct(Math.min(d.assinaturas, d.base), d.base)}%`]],
        tabelas: [{ titulo: "Colaboradores que ainda não assinaram", aba: "Pendentes", colunas: ["Nome", "Matrícula", "Cargo", "Setor", "Supervisor"], linhas: p.map((x) => [x.nome, x.matricula, x.cargo, x.setor, x.supervisor || "—"]) }],
        nota: "Supervisores: favor realizar o DDS com os colaboradores listados até o fim da semana.",
      };
    }
    if (tipo === "periodo") {
      const ini = $("#rIni").value, fim = $("#rFim").value;
      const rs = await call("adm_reunioes", { p_tema_id: null, p_inicio: ini || null, p_fim: fim || null });
      const porSup = {};
      rs.forEach((r) => { porSup[r.supervisor] = porSup[r.supervisor] || { dds: 0, ass: 0 }; porSup[r.supervisor].dds++; porSup[r.supervisor].ass += r.assinaturas; });
      return {
        titulo: `DDS realizados – ${fmtData(ini)} a ${fmtData(fim)}`, subtitulo: CONFIG.UNIDADE,
        resumo: [["DDS realizados", rs.length], ["Assinaturas", rs.reduce((n, r) => n + r.assinaturas, 0)], ["Supervisores", Object.keys(porSup).length]],
        tabelas: [
          { titulo: "Resumo por supervisor", aba: "Supervisores", colunas: ["Supervisor", "DDS", "Assinaturas"], linhas: Object.entries(porSup).sort((a, b) => b[1].dds - a[1].dds).map(([n, v]) => [n, v.dds, v.ass]) },
          { titulo: "Detalhamento", aba: "DDS", colunas: ["Data", "Horário", "Supervisor", "Tema", "Local", "Assinaturas"], linhas: rs.map((r) => [fmtData(r.data), fmtHora(r.horario), r.supervisor, r.tema, r.local || "", r.assinaturas]) },
        ],
      };
    }
    const evo = await call("adm_evolucao", { p_limite: 12 });
    return {
      titulo: "Consolidado semanal do DDS", subtitulo: `Últimos ${evo.length} temas · ${CONFIG.UNIDADE}`,
      resumo: [["Temas", evo.length], ["Total de assinaturas", evo.reduce((n, e) => n + e.assinaturas, 0)], ["Média de adesão", `${evo.length ? Math.round(evo.reduce((n, e) => n + pct(Math.min(e.assinaturas, e.base), e.base), 0) / evo.length) : 0}%`]],
      tabelas: [{ titulo: "Evolução por tema", aba: "Evolucao", colunas: ["Semana", "Tema", "DDS", "Assinaturas", "Adesão", "Supervisores que entregaram"],
        linhas: [...evo].reverse().map((e) => [`${fmtData(e.semana_inicio)} a ${fmtData(e.semana_fim)}`, e.titulo, e.reunioes, `${e.assinaturas}/${e.base}`, pct(Math.min(e.assinaturas, e.base), e.base) + "%", `${e.supervisores_entregaram}/${e.supervisores_total}`]) }],
    };
  }

  // início
  const inicial = (location.hash || "#painel").slice(1);
  ir(mapa[inicial] ? inicial : "painel");
})();
