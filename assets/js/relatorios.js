/* Geração de relatórios em formatos para Teams, e-mail, texto e Excel.
   Modelo: { titulo, subtitulo, resumo: [[rótulo, valor]], tabelas: [{ titulo, colunas: [], linhas: [[]] }], nota } */
(function () {
  "use strict";
  const esc = (v) => DDS.esc(v);

  function html(m, estilo) {
    const email = estilo === "email";
    const th = email ? 'style="background:#0f6b45;color:#ffffff;text-align:left;padding:7px 10px;font-size:12px;border:1px solid #0f6b45"' : 'style="text-align:left;padding:4px 8px;border:1px solid #999"';
    const td = email ? 'style="padding:6px 10px;border:1px solid #dfe5e1;font-size:13px;color:#15231b"' : 'style="padding:4px 8px;border:1px solid #999"';
    const tbl = 'style="border-collapse:collapse;margin:6px 0 16px 0"';
    let out = email
      ? `<div style="font-family:Segoe UI,Arial,sans-serif;color:#15231b;max-width:900px">
         <div style="border-left:5px solid #f2b705;padding:6px 12px;margin-bottom:12px"><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#0f6b45;font-weight:bold">SESMT · ${esc(CONFIG.UNIDADE)}</div>
         <div style="font-size:20px;font-weight:bold">${esc(m.titulo)}</div>${m.subtitulo ? `<div style="color:#4a5a50;font-size:13px">${esc(m.subtitulo)}</div>` : ""}</div>`
      : `<div><p><b>📋 ${esc(m.titulo)}</b>${m.subtitulo ? `<br>${esc(m.subtitulo)}` : ""}</p>`;
    if (m.resumo && m.resumo.length) {
      out += email
        ? `<table ${tbl}><tr>${m.resumo.map(([k, v]) => `<td style="padding:8px 14px;border:1px solid #dfe5e1;background:#f8faf7"><div style="font-size:11px;color:#7b8a80;text-transform:uppercase">${esc(k)}</div><div style="font-size:18px;font-weight:bold">${esc(v)}</div></td>`).join("")}</tr></table>`
        : `<ul>${m.resumo.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join("")}</ul>`;
    }
    (m.tabelas || []).forEach((t) => {
      out += `<p style="margin:10px 0 4px 0"><b>${esc(t.titulo)}</b></p>`;
      if (!t.linhas.length) { out += `<p><i>Nenhum registro.</i></p>`; return; }
      out += `<table ${tbl}><thead><tr>${t.colunas.map((c) => `<th ${th}>${esc(c)}</th>`).join("")}</tr></thead><tbody>
        ${t.linhas.map((l, i) => `<tr${email && i % 2 ? ' style="background:#f8faf7"' : ""}>${l.map((c) => `<td ${td}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    });
    if (m.nota) out += `<p style="font-size:12px;color:#7b8a80">${esc(m.nota)}</p>`;
    out += email ? `<p style="font-size:11px;color:#7b8a80;border-top:1px solid #dfe5e1;padding-top:8px">Relatório gerado pelo sistema DDS SESMT em ${esc(DDS.fmtDataHora(new Date().toISOString()))}.</p></div>` : `</div>`;
    return out;
  }

  function texto(m) {
    const L = [];
    L.push(`📋 ${m.titulo.toUpperCase()}`);
    if (m.subtitulo) L.push(m.subtitulo);
    L.push("━━━━━━━━━━━━━━━━━━━━");
    (m.resumo || []).forEach(([k, v]) => L.push(`• ${k}: ${v}`));
    (m.tabelas || []).forEach((t) => {
      L.push(""); L.push(`▶ ${t.titulo}`);
      if (!t.linhas.length) { L.push("  (nenhum registro)"); return; }
      t.linhas.forEach((l) => L.push("  - " + l.map((c, i) => (i === 0 ? c : `${t.colunas[i]}: ${c}`)).filter((x) => x !== "").join(" | ")));
    });
    if (m.nota) { L.push(""); L.push(m.nota); }
    L.push(""); L.push(`SESMT · ${CONFIG.UNIDADE}`);
    return L.join("\n");
  }

  function excel(m, nomeArquivo) {
    const wb = XLSX.utils.book_new();
    const resumo = [[m.titulo], [m.subtitulo || ""], [], ...(m.resumo || [])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), "Resumo");
    (m.tabelas || []).forEach((t, i) => {
      const ws = XLSX.utils.aoa_to_sheet([t.colunas, ...t.linhas]);
      ws["!cols"] = t.colunas.map((c, ci) => ({ wch: Math.min(60, Math.max(c.length, ...t.linhas.map((l) => String(l[ci] == null ? "" : l[ci]).length)) + 2) }));
      XLSX.utils.book_append_sheet(wb, ws, (t.aba || t.titulo).replace(/[\\/?*[\]:]/g, "").slice(0, 31) || `Tabela${i + 1}`);
    });
    XLSX.writeFile(wb, nomeArquivo);
  }

  window.Relatorio = { html, texto, excel };
})();
