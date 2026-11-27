/* ============================================================
   Produção — página da equipe (lista de receitas + pesagem do lote)
   Independente do app do gerente: lê só dados.bin (cifrado) e a lista
   pública de liberações. Sem framework, mobile-first.
   ============================================================ */
(function () {
'use strict';

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const app = () => $('#app');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const nf = (n, d) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
// pequenas doses (menos de 10 g) mostram 2 casas; o resto, 1 casa
const fmtG = (v) => nf(v, v < 10 ? 2 : 1);
const parseNum = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const LOTE_PADRAO = 6;

/* ---------- armazenamento local (tudo dentro de try: aba anônima / cheio) ---------- */
const K = { chave: 'prod_chave', cfg: 'prod_cfg', cfgDev: 'prod_cfg_dev', estado: 'prod_estado', tema: 'prod_tema', agenda: 'prod_agenda', agendaDev: 'prod_agenda_dev', feitos: 'prod_feitos', pend: 'prod_pend', disp: 'prod_disp' };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* segue sem gravar */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ok */ } };

/* ---------- ícones ---------- */
const SVG = (p, o) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"${o || ''}>${p}</svg>`;
const ICON = {
  theme: SVG('<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>'),
  back: SVG('<path d="M15 5l-7 7 7 7"/>', ' stroke-width="2.2"'),
  scoop: SVG('<path d="M12 21 5.5 11h13z"/><circle cx="9" cy="8" r="3.4"/><circle cx="14.5" cy="7.5" r="3.4"/><circle cx="12" cy="5" r="3.2"/>'),
  sair: SVG('<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M16 8l4 4-4 4M20 12H9"/>'),
};
const catColors = {
  Creme: { bg: 'var(--brand-soft)', fg: 'var(--brand)' },
  Sorbet: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  Insumo: { bg: '#f2ebdd', fg: '#8c7b5e' },
};
function scoopBadge(grupo) {
  const c = catColors[grupo] || catColors.Creme;
  return `<span class="scoop" style="background:${c.bg};color:${c.fg}">${ICON.scoop}</span>`;
}

/* ---------- tema (mesmo comportamento do app: '' = segue o aparelho) ---------- */
document.documentElement.dataset.theme = lsGet(K.tema) || '';
function bindTema() {
  const b = $('#themeBtn');
  if (!b) return;
  b.onclick = () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    lsSet(K.tema, next);
  };
}

/* ---------- cifra: PBKDF2-SHA256 -> AES-256-GCM ---------- */
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (u8) => { let s = ''; u8.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
async function derivarBits(senha, env) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64d(env.salt), iterations: env.iter }, base, 256);
  return new Uint8Array(bits);
}
// cada senha abre um "slot" que guarda a chave do conteúdo (a mesma para todas)
async function abrirSlot(kek, env) {
  const key = await crypto.subtle.importKey('raw', kek, 'AES-GCM', false, ['decrypt']);
  for (const sl of (env.slots || [])) {
    try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(sl.iv) }, key, b64d(sl.ct))); }
    catch (e) { /* tenta o próximo */ }
  }
  throw new Error('senha');
}
async function decifrar(raw, env) {
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.iv) }, key, b64d(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---------- estado em memória ---------- */
let envelope = null;     // conteúdo de dados.bin (cifrado)
let dados = null;        // receitas decifradas (só em memória)
let cfg = null;          // { id: { visivel, nome } }
let cfgFonte = '';       // 'rede' | 'salvo' | 'dev' | ''
const filtro = { q: '', cat: 'Todos' };

/* ---------- carga de dados.bin ---------- */
async function carregarEnvelope() {
  const r = await fetch('dados.bin', { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const env = JSON.parse(await r.text());
  if (!env || !env.ct || !env.iv || !env.salt || !env.iter || !Array.isArray(env.slots)) throw new Error('formato');
  return env;
}

/* ---------- config do gerente (quais receitas aparecem e com que nome) ---------- */
const CFG_URL = 'https://firestore.googleapis.com/v1/projects/gelateria-la-maddalena/databases/(default)/documents/producaoPublico/config?key=AIzaSyDUgLdOsrovpbybf2dIn0-nvhw9K8Xx55k';
function lerCfgRest(doc) {
  const campos = (((doc || {}).fields || {}).receitas || {}).mapValue;
  const out = {};
  const mapa = (campos && campos.fields) || {};
  Object.keys(mapa).forEach((id) => {
    const f = ((mapa[id] || {}).mapValue || {}).fields || {};
    out[id] = {
      visivel: !!(f.visivel && f.visivel.booleanValue === true),
      nome: (f.nome && typeof f.nome.stringValue === 'string') ? f.nome.stringValue : '',
      creme: (f.creme && ['20', '15', 'ambas', 'duas'].includes(f.creme.stringValue)) ? f.creme.stringValue : 'ambas',
      ocultos: ((f.ocultos && f.ocultos.arrayValue && f.ocultos.arrayValue.values) || [])
        .map((x) => x && x.stringValue).filter((x) => typeof x === 'string'),
    };
  });
  return out;
}
function cfgSalva() {
  try { const o = JSON.parse(lsGet(K.cfg) || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
}
async function carregarCfgBase() {
  if (location.hostname === 'localhost') {          // só para testes locais
    try {
      const dev = JSON.parse(lsGet(K.cfgDev) || 'null');
      if (dev && typeof dev === 'object') { cfg = dev; cfgFonte = 'dev'; return; }
    } catch (e) { /* ignora */ }
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(CFG_URL, { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    cfg = lerCfgRest(await r.json());
    cfgFonte = 'rede';
    lsSet(K.cfg, JSON.stringify(cfg));
  } catch (e) {
    cfg = cfgSalva() || {};
    cfgFonte = cfgSalva() ? 'salvo' : '';
  } finally { clearTimeout(t); }
}

/* ---------- programação semanal (montada pelo gerente; só ids de receita por dia) ---------- */
const AGENDA_URL = 'https://firestore.googleapis.com/v1/projects/gelateria-la-maddalena/databases/(default)/documents/producaoPublico/agenda?key=AIzaSyDUgLdOsrovpbybf2dIn0-nvhw9K8Xx55k';
const DIAS = [['seg', 'Segunda-feira'], ['ter', 'Terça-feira'], ['qua', 'Quarta-feira'], ['qui', 'Quinta-feira'], ['sex', 'Sexta-feira'], ['sab', 'Sábado'], ['dom', 'Domingo']];
let agenda = {};         // { seg: [id,...], ... }
const agAbertos = new Set();   // dias expandidos (em memória: ao abrir o app, todos recolhidos)
// ordem de exibição; 'texto' = nome livre (não é receita); 'aviso' = só o nome da receita, sem link
const TIPOS = [['insumos', '🧀', 'Produção de insumos', 'texto'], ['descongelar', '🧊', 'Descongelar calda', 'aviso'], ['calda', '🥣', 'Calda', 'link'], ['congelar', '❄️', 'Congelar calda', 'aviso'], ['bater', '🍨', 'Bater o gelato', 'link']];
function lerAgendaRest(doc) {
  const campos = ((((doc || {}).fields || {}).dias || {}).mapValue || {}).fields || {};
  const out = {};
  DIAS.forEach(([k]) => {
    const f = (((campos[k] || {}).mapValue) || {}).fields || {};
    out[k] = {};
    TIPOS.forEach(([t]) => {
      const vals = ((((f[t] || {}).arrayValue) || {}).values) || [];
      out[k][t] = vals.map((x) => x && x.stringValue).filter((x) => typeof x === 'string').map((x) => x.slice(0, 80)).slice(0, 40);
    });
  });
  // trocas do dia do auxiliar feitas pelo gerente na escala: { 'AAAA-MM-DD': código }
  const aj = ((((doc || {}).fields || {}).ajustes || {}).mapValue || {}).fields || {};
  out.ajustes = {};
  Object.keys(aj).forEach((d) => {
    const v = aj[d] && aj[d].stringValue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && ESC_COD[v]) out.ajustes[d] = v;
  });
  return out;
}

/* ---------- onde o auxiliar estará no dia (escala vem cifrada no dados.bin; trocas do gerente por cima) ---------- */
const ESC_COD = {
  P: ['prod', 'Produção', '10:00–18:20'],
  C: ['gelateria', 'Gelateria · folga da Clara', null],
  T: ['gelateria', 'Treinamento na gelateria', null],
  M: ['manut', 'Manutenção da pousada', '13:40–22:00'],
  M1: ['manut', 'Manutenção da pousada', '13:00–21:20'],
  M6: ['manut', 'Manutenção da pousada', '06:00–14:20'],
  L: ['livre', 'A definir', ''],
  F: ['folga', 'Folga', ''],
};
// no dia em que cobre a Clara, faz o horário dela: 13:00–21:30 (seg–qui) ou 13:00–22:00 (sex–dom)
const horaGelateria = (iso) => { const w = new Date(iso + 'T12:00:00').getDay(); return (w === 5 || w === 6 || w === 0) ? '13:00–22:00' : '13:00–21:30'; };
function ondeEstou(iso) {
  const cod = ((agenda && agenda.ajustes) || {})[iso] || ((dados && dados.escala) || {})[iso];
  const x = ESC_COD[cod];
  if (!x) return null;
  return { g: x[0], txt: x[1], horas: x[2] === null ? horaGelateria(iso) : x[2] };
}
const chipOnde = (o) => o ? `<span class="esc-chip g-${o.g}">${esc(o.txt)}${o.horas ? ` <small>${o.horas}</small>` : ''}</span>` : '';

/* ---------- resumo da semana: caldas e gelatos batidos (feitos + programados de hoje em diante) ---------- */
function resumoSemana() {
  const vis = {}; receitasVisiveis().forEach((r) => { vis[r.id] = r; });
  const hoje = isoLocal(new Date());
  const bloco = (t, titulo) => {
    const por = {}; let f = 0, p = 0;
    DIAS.forEach(([k], i) => {
      const { iso } = dataDoDia(i);
      const ids = new Set(((agenda[k] || {})[t]) || []);
      Object.keys(feitosAg).forEach((ch) => { if (ch.startsWith(iso + '|' + t + '|')) ids.add(ch.slice(iso.length + t.length + 2)); });
      ids.forEach((id) => {
        if (!vis[id]) return;
        const ok = !!feitosAg[iso + '|' + t + '|' + id];
        if (!ok && iso < hoje) return;
        const o = (por[id] = por[id] || { f: 0, p: 0 });
        if (ok) { o.f++; f++; } else { o.p++; p++; }
      });
    });
    const tot = f + p;
    const linhas = Object.keys(por).sort((a, b) => (por[b].f + por[b].p) - (por[a].f + por[a].p) || vis[a].nomeExib.localeCompare(vis[b].nomeExib))
      .map((id) => `<div class="res-l"><span>${esc(vis[id].nomeExib)}</span><span>${por[id].f + por[id].p}${por[id].f ? ` <small class="muted" style="font-weight:600">(${por[id].f} ✓)</small>` : ''}</span></div>`).join('');
    return `<h4>${titulo}: ${tot} lote${tot === 1 ? '' : 's'}${tot ? ` · ${tot * LOTE_PADRAO} kg` : ''}</h4>
      <div class="muted small" style="margin-bottom:4px">${f} feito${f === 1 ? '' : 's'} · ${p} por fazer</div>
      ${linhas || '<div class="muted small">Nada nesta semana.</div>'}`;
  };
  return `<div class="card res-sem"><div style="font-weight:800">📊 Resumo da semana</div>${bloco('calda', '🥣 Caldas')}${bloco('bater', '🍨 Gelatos batidos')}</div>`;
}
function agendaSalva() {
  try { const o = JSON.parse(lsGet(K.agenda) || 'null'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}
async function carregarAgenda() {
  if (location.hostname === 'localhost') {          // só para testes locais
    try {
      const dev = JSON.parse(lsGet(K.agendaDev) || 'null');
      if (dev && typeof dev === 'object') { agenda = dev; return; }
    } catch (e) { /* ignora */ }
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(AGENDA_URL, { cache: 'no-store', signal: ctl.signal });
    if (r.status === 404) { agenda = {}; lsSet(K.agenda, '{}'); return; }   // gerente ainda não montou
    if (!r.ok) throw new Error('HTTP ' + r.status);
    agenda = lerAgendaRest(await r.json());
    lsSet(K.agenda, JSON.stringify(agenda));
  } catch (e) { agenda = agendaSalva(); }
  finally { clearTimeout(t); }
}
const visual = () => JSON.stringify([cfg, agenda]);
async function carregarCfg() { await Promise.all([carregarCfgBase(), carregarAgenda()]); }

/* receitas já feitas, por dia da semana: chave "AAAA-MM-DD|id" (some depois de 30 dias) */
const feitosAg = (() => {
  let o = {};
  try { o = JSON.parse(lsGet(K.feitos) || '{}') || {}; } catch (e) { o = {}; }
  const corte = Date.now() - 60 * 86400000;
  Object.keys(o).forEach((k) => { const t = Date.parse(k.split('|')[0]); if (!(t > corte)) delete o[k]; });
  return o;
})();
const salvarFeitosAg = () => lsSet(K.feitos, JSON.stringify(feitosAg));

/* ---------- envia o que foi marcado para o gerente ver (um doc por dia e por aparelho) ---------- */
const FEITOS_URL = 'https://firestore.googleapis.com/v1/projects/gelateria-la-maddalena/databases/(default)/documents/producaoFeitos/';
const FEITOS_KEY = 'AIzaSyDUgLdOsrovpbybf2dIn0-nvhw9K8Xx55k';
function idAparelho() {
  let d = lsGet(K.disp);
  if (!/^[a-z0-9]{8,16}$/.test(d || '')) {
    const b = new Uint8Array(6); crypto.getRandomValues(b);
    d = Array.from(b, (x) => (x % 36).toString(36)).join('') + Date.now().toString(36).slice(-4);
    lsSet(K.disp, d);
  }
  return d;
}
const pendentes = () => { try { const a = JSON.parse(lsGet(K.pend) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const salvarPend = (a) => lsSet(K.pend, JSON.stringify(a));
async function enviarDia(iso) {
  if (location.hostname === 'localhost' && !lsGet('prod_sync_teste')) return;   // testes locais não gravam na nuvem
  const itens = {};
  Object.keys(feitosAg).forEach((k) => { if (k.startsWith(iso + '|')) itens[k.slice(iso.length + 1)] = { booleanValue: true }; });
  const body = { fields: { itens: { mapValue: { fields: itens } }, atualizadoEm: { stringValue: new Date().toISOString() } } };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(FEITOS_URL + iso + '_' + idAparelho() + '?key=' + FEITOS_KEY,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    salvarPend(pendentes().filter((d) => d !== iso));
  } catch (e) {
    const p = pendentes(); if (!p.includes(iso)) { p.push(iso); salvarPend(p); }
  } finally { clearTimeout(t); }
}
// reenvia o que ficou pendente (sem internet na hora) e, ao abrir, os últimos 7 dias marcados
async function reenviarPendentes(recentes) {
  const lim = isoLocal(new Date(Date.now() - 7 * 86400000));
  const set = new Set(pendentes());
  if (recentes) Object.keys(feitosAg).forEach((k) => { const d = k.split('|')[0]; if (d >= lim) set.add(d); });
  for (const d of set) await enviarDia(d);
}
window.addEventListener('online', () => { if (dados) reenviarPendentes(false); });
const isoLocal = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

/* ---------- recebe o que os OUTROS aparelhos marcaram (o gerente também abre este app) ----------
   A fonte da verdade é a união dos documentos da nuvem (um por dia e por aparelho). Desmarcar tira a marca
   de todos eles. Datas com envio pendente, ou mexidas há menos de 20 s, não são sobrescritas. */
const FEITOS_JAN = 60;                  // dias para trás
let remotos = [];                       // [{ id, iso, itens:[chaves 'tipo|id'] }] da última leitura
const editadoEm = {};                   // iso -> quando ESTE aparelho mexeu
let sincronizando = false;
async function lerRemotos() {
  const out = []; let tok = '';
  for (let n = 0; n < 6; n++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
    let j;
    try {
      const r = await fetch(FEITOS_URL.replace(/\/$/, '') + '?pageSize=300&key=' + FEITOS_KEY + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      j = await r.json();
    } finally { clearTimeout(t); }
    (j.documents || []).forEach((d) => {
      const f = ((((d.fields || {}).itens || {}).mapValue || {}).fields) || {};
      out.push({ id: String(d.name || '').split('/').pop(), itens: Object.keys(f).filter((x) => f[x] && f[x].booleanValue === true) });
    });
    tok = j.nextPageToken || '';
    if (!tok) break;
  }
  return out;
}
async function sincronizarFeitos() {
  if (!dados || sincronizando) return false;
  if (location.hostname === 'localhost' && !lsGet('prod_sync_teste')) return false;
  sincronizando = true;
  try {
    const lista = await lerRemotos();
    const lim = isoLocal(new Date(Date.now() - FEITOS_JAN * 86400000));
    const pend = new Set(pendentes());
    const uniao = {}; remotos = [];
    for (const d of lista) {
      const iso = d.id.split('_')[0];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso < lim) continue;
      remotos.push({ id: d.id, iso, itens: d.itens });
      const u = (uniao[iso] = uniao[iso] || new Set()); d.itens.forEach((x) => u.add(iso + '|' + x));
    }
    const datas = new Set(Object.keys(uniao));
    Object.keys(feitosAg).forEach((k) => { const d = k.split('|')[0]; if (d >= lim) datas.add(d); });
    let mudou = false;
    for (const iso of datas) {
      if (pend.has(iso) || Date.now() - (editadoEm[iso] || 0) < 20000) continue;
      const alvo = uniao[iso] || new Set();
      Object.keys(feitosAg).forEach((k) => { if (k.startsWith(iso + '|') && !alvo.has(k)) { delete feitosAg[k]; mudou = true; } });
      alvo.forEach((k) => { if (!feitosAg[k]) { feitosAg[k] = 1; mudou = true; } });
    }
    if (mudou) salvarFeitosAg();
    return mudou;
  } catch (e) { return null; }           // null = não consegui ler (sem internet)
  finally { sincronizando = false; }
}
// ao desmarcar, tira a marca também dos documentos dos outros aparelhos
async function tirarMarcaRemota(iso, sub) {
  const meu = iso + '_' + idAparelho();
  for (const d of remotos) {
    if (d.iso !== iso || d.id === meu || !d.itens.includes(sub)) continue;
    d.itens = d.itens.filter((x) => x !== sub);
    const itens = {}; d.itens.forEach((x) => { itens[x] = { booleanValue: true }; });
    try {
      await fetch(FEITOS_URL + d.id + '?key=' + FEITOS_KEY, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { itens: { mapValue: { fields: itens } }, atualizadoEm: { stringValue: new Date().toISOString() } } }) });
    } catch (e) { /* sem internet: a marca volta na próxima leitura */ }
  }
}

/* ---------- caldas na geladeira e no freezer ----------
   Eventos marcados pelo auxiliar, em ordem de data: calda (nasce na geladeira), congelar, descongelar (volta à geladeira
   e a contagem de maturação recomeça do zero) e bater (consome a calda mais antiga do sabor). */
function calcCaldas(evs, hoje) {
  const ORD = { descongelar: 0, calda: 1, congelar: 2, bater: 3 };
  const dif = (a, b) => Math.max(0, Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000));
  const por = {};
  evs.filter((e) => e.d <= hoje && e.t in ORD).sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : ORD[x.t] - ORD[y.t])).forEach((e) => {
    const L = (por[e.id] = por[e.id] || []);
    if (e.t === 'calda') L.push({ est: 'gel', desde: e.d, gelAntes: 0, cong: 0 });
    else if (e.t === 'congelar') { const b = L.find((x) => x.est === 'gel'); if (b) { b.gelAntes += dif(b.desde, e.d); b.est = 'cong'; b.desde = e.d; } }
    else if (e.t === 'descongelar') { const b = L.find((x) => x.est === 'cong'); if (b) { b.cong += dif(b.desde, e.d); b.est = 'gel'; b.desde = e.d; } }
    else { let i = L.findIndex((x) => x.est === 'gel'); if (i < 0) i = L.findIndex((x) => x.est === 'cong'); if (i >= 0) L.splice(i, 1); }
  });
  const out = [];
  Object.keys(por).forEach((id) => por[id].forEach((b) => out.push({ id, est: b.est, dias: dif(b.desde, hoje), cong: b.cong, gelAntes: b.gelAntes })));
  return out.sort((a, b) => (a.est === b.est ? b.dias - a.dias : a.est === 'gel' ? -1 : 1));
}
function caldaLinha(x, nome) {
  const p = (n) => (n === 1 ? '1 dia' : n + ' dias');
  const topo = x.est === 'gel' ? 'na geladeira há ' + p(x.dias) : '❄️ congelada há ' + p(x.dias);
  const sub = x.est === 'gel'
    ? (x.cong > 0 ? (x.gelAntes > 0 ? 'maturou ' + p(x.gelAntes) + ' antes de congelar · ' : '') + 'ficou ' + p(x.cong) + ' congelada' : '')
    : (x.gelAntes > 0 ? 'maturou ' + p(x.gelAntes) + ' na geladeira antes de congelar' : 'congelada no mesmo dia em que foi feita');
  return `<div class="matur-l"><span>${esc(nome)}${sub ? `<small class="muted" style="display:block">${sub}</small>` : ''}</span><b style="white-space:nowrap;text-align:right">${topo}</b></div>`;
}
function renderMatur() {
  const el = $('#matur'); if (!el) return;
  const vis = {}; receitasVisiveis().forEach((r) => { vis[r.id] = r; });
  const evs = Object.keys(feitosAg).map((k) => { const p = k.split('|'); return { d: p[0], t: p[1], id: p.slice(2).join('|') }; });
  const lista = calcCaldas(evs, isoLocal(new Date())).filter((x) => vis[x.id]);
  el.innerHTML = `<div class="card matur"><div class="matur-t">🥣 Caldas: geladeira e freezer</div>${lista.length
    ? lista.map((x) => caldaLinha(x, vis[x.id].nomeExib)).join('')
    : '<p class="muted small" style="margin:6px 0 0">Nenhuma calda esperando para ser batida.</p>'}
    <p class="muted small" style="margin:8px 0 0">Conta desde que a calda foi marcada como feita até o sabor ser marcado em “Bater o gelato”. Se foi congelada, mostra os dias no freezer; ao descongelar, a contagem na geladeira recomeça.</p></div>`;
}
setInterval(() => {                     // mantém as marcações em dia entre os aparelhos
  if (document.hidden || !dados || !$('#agenda')) return;
  sincronizarFeitos().then((m) => { if (m) renderAgenda(); });
}, 20000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && dados && $('#agenda')) sincronizarFeitos().then((m) => { if (m) renderAgenda(); });
});
// data (desta semana, começando na segunda) do dia i
function dataDoDia(i) {
  const h = new Date(); const hoje = (h.getDay() + 6) % 7;
  const d = new Date(h.getFullYear(), h.getMonth(), h.getDate() + (i - hoje));
  return { iso: isoLocal(d), ehHoje: i === hoje, dm: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) };
}

function receitasVisiveis() {
  if (!dados || !cfg) return [];
  return dados.receitas
    .filter((r) => cfg[r.id] && cfg[r.id].visivel === true)
    .map((r) => {
      // o gerente escolhe qual versão do creme aparece: só 20%, só 15% ou as duas
      let modo = cfg[r.id].creme || 'ambas';
      // mascarpone 35%/30%: padrão só o 35%; as duas só se o gerente marcar 'duas'
      if (r.alt === 'masc30') modo = modo === 'duas' ? 'ambas' : (modo === '15' ? '15' : '20');
      const v = Object.assign({}, r.variantes || {});
      if (v['20'] && v['15']) { if (modo === '20') delete v['15']; else if (modo === '15') delete v['20']; }
      // o gerente também pode esconder insumos específicos desta receita
      const ocultos = Array.isArray(cfg[r.id].ocultos) ? cfg[r.id].ocultos : [];
      if (ocultos.length) for (const k of Object.keys(v)) v[k] = v[k].filter((i) => !ocultos.includes(i.n));
      return Object.assign({}, r, { variantes: v, nomeExib: (cfg[r.id].nome || '').trim() || r.nome });
    });
}

/* ---------- estado por receita (lote e marcações), gravado no aparelho ---------- */
const estado = (() => { try { return JSON.parse(lsGet(K.estado) || '{}') || {}; } catch (e) { return {}; } })();
const salvarEstado = () => lsSet(K.estado, JSON.stringify(estado));
function estadoDe(id) {
  const s = estado[id] = estado[id] || {};
  if (!s.feitos) s.feitos = {};
  return s;
}

/* ---------- moldura: barra superior ---------- */
function chrome(title, inner, opts) {
  opts = opts || {};
  return `
  <div class="topbar">
    ${opts.back ? `<button class="tb-btn" id="backBtn" aria-label="voltar">${ICON.back}</button>` : ''}
    <h1>${esc(title)}</h1>
    ${opts.actions || ''}
    <button class="tb-btn" id="themeBtn" title="tema" aria-label="tema">${ICON.theme}</button>
  </div>
  <div class="wrap">${inner}</div>`;
}
function bindChrome() {
  bindTema();
  const b = $('#backBtn');
  if (b) b.onclick = () => { location.hash = '#/'; };
  const s = $('#sairBtn');
  if (s) s.onclick = sair;
}

/* ============================================================ LOGIN */
function viewLogin(msg) {
  const inner = `
  <div class="login-hero">
    <div class="logo"><span class="scoop" style="width:82px;height:82px;border-radius:24px;background:var(--brand-soft);color:var(--brand)">${ICON.scoop.replace('viewBox', 'width="46" height="46" viewBox')}</span></div>
    <h2>La Maddalena · Produção</h2>
    <p class="muted">Receitas e pesagem para a equipe</p>
  </div>
  <form class="card" id="loginForm" autocomplete="on">
    <label class="lab" for="senha">Senha</label>
    <input class="inp" id="senha" name="password" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Digite a senha">
    <p class="muted small">Neste aparelho a senha vale por 24 horas; depois ela é pedida de novo.</p>
    <div class="erro" id="erro" role="alert">${esc(msg || '')}</div>
    <button class="btn full" id="entrarBtn" type="submit">Entrar</button>
  </form>`;
  app().innerHTML = `<div class="topbar"><h1>La Maddalena · Produção</h1><button class="tb-btn" id="themeBtn" title="tema" aria-label="tema">${ICON.theme}</button></div><div class="wrap">${inner}</div>`;
  bindTema();
  $('#loginForm').onsubmit = (e) => { e.preventDefault(); entrar(); };
  const s = $('#senha'); if (s) s.focus();
}

async function entrar() {
  const senha = $('#senha').value;
  const erro = $('#erro');
  const btn = $('#entrarBtn');
  if (!senha) { erro.textContent = 'Digite a senha.'; return; }
  if (!window.crypto || !crypto.subtle) { erro.textContent = 'Este navegador não suporta o acesso seguro. Abra pelo endereço https.'; return; }
  btn.disabled = true; btn.textContent = 'Abrindo…'; erro.textContent = '';
  try {
    if (!envelope) envelope = await carregarEnvelope();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Entrar';
    erro.textContent = 'Não consegui carregar os dados. Verifique a internet e tente de novo.';
    return;
  }
  let raw;
  try {
    raw = await abrirSlot(await derivarBits(senha, envelope), envelope);
    dados = await decifrar(raw, envelope);
  } catch (e) {
    dados = null;
    btn.disabled = false; btn.textContent = 'Entrar';
    erro.textContent = 'Senha incorreta';
    const s = $('#senha'); if (s) { s.select(); s.focus(); }
    return;
  }
  lsSet(K.chave, JSON.stringify({ k: b64e(raw), t: Date.now() }));   // vale 24 h (VALIDADE)
  await abrir();
}

function sair() {
  lsDel(K.chave);
  dados = null; envelope = null;
  location.hash = '#/';
  viewLogin();
}

/* ---------- depois de destravar: carrega a config e mostra a tela ---------- */
async function abrir() {
  // mostra já com a última config salva; a atual chega logo em seguida.
  // Sem nenhuma config salva, espera a busca terminar (senão um link direto
  // para uma receita seria desviado para a lista antes de a lista chegar).
  const ini = cfgSalva();
  if (!ini || (location.hostname === 'localhost' && lsGet(K.cfgDev))) {
    app().innerHTML = '<div class="loading">Carregando…</div>';
    await carregarCfg();
    if (dados) { render(); sincronizarFeitos().then((m) => { if (m) renderAgenda(); reenviarPendentes(m === null); }); }
    return;
  }
  if (ini) { cfg = ini; cfgFonte = 'salvo'; }
  else { cfg = {}; cfgFonte = ''; }
  agenda = agendaSalva();
  render();
  const antes = visual();
  await carregarCfg();
  if (dados && visual() !== antes) render();
  else if (dados) atualizarRodape();
  if (dados) sincronizarFeitos().then((m) => { if (m) renderAgenda(); reenviarPendentes(m === null); });
}

/* ============================================================ LISTA */
function viewHome() {
  const inner = `
    <h2 class="sect" style="margin-top:4px">📅 Programação da semana</h2>
    <div id="hojeOnde"></div>
    <div id="agenda"></div>
    <div id="resumo"></div>
    <div id="matur"></div>
    <h2 class="sect">Todas as receitas</h2>
    <input class="inp" id="q" type="search" placeholder="🔎 Buscar sabor…" value="${esc(filtro.q)}" autocomplete="off">
    <div class="seg" id="segCat">${['Todos', 'Creme', 'Fitness', 'Sorbet'].concat(receitasVisiveis().some((r) => r.grupo === 'Insumo') ? ['Insumo'] : []).map((c) =>
      `<button data-v="${c}" class="${filtro.cat === c ? 'on' : ''}">${c}</button>`).join('')}</div>
    <div class="rlist" id="items"></div>
    <p class="muted small" id="cnt" style="text-align:center"></p>
    <p class="muted small" id="rodape" style="text-align:center"></p>`;
  app().innerHTML = chrome('La Maddalena · Produção', inner, {
    actions: `<button class="tb-btn" id="sairBtn" title="sair" aria-label="sair">${ICON.sair}</button>` });
  bindChrome();
  // atualiza só a lista: a caixa de busca não é recriada, então o teclado não some
  $('#q').oninput = (e) => { filtro.q = e.target.value; renderItens(); };
  $('#segCat').onclick = (e) => {
    const v = e.target.dataset && e.target.dataset.v;
    if (!v) return;
    filtro.cat = v;
    $$('#segCat button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    renderItens();
  };
  renderItens();
  renderAgenda();
  const ag = $('#agenda');
  ag.addEventListener('toggle', (e) => {
    const d = e.target.dataset && e.target.dataset.dia;
    if (d) { if (e.target.open) agAbertos.add(d); else agAbertos.delete(d); }
  }, true);
  ag.onchange = (e) => {
    const k = e.target.dataset && e.target.dataset.feito;
    if (!k) return;
    const iso = k.split('|')[0];
    editadoEm[iso] = Date.now();
    if (e.target.checked) feitosAg[k] = 1; else { delete feitosAg[k]; tirarMarcaRemota(iso, k.slice(iso.length + 1)); }
    salvarFeitosAg();
    renderAgenda();
    enviarDia(iso);
  };
}

// cada dia é um cartão recolhido; ao abrir mostra só os blocos preenchidos (insumos, descongelar, calda, congelar, bater)
function renderAgenda() {
  const el = $('#agenda'); if (!el) return;
  const vis = {}; receitasVisiveis().forEach((r) => { vis[r.id] = r; });
  el.innerHTML = DIAS.map(([k, nome], i) => {
    const { iso, ehHoje, dm } = dataDoDia(i);
    const dia = (agenda[k] && typeof agenda[k] === 'object') ? agenda[k] : {};
    const blocos = TIPOS.map(([t, ic, tit, modo]) => ({ t, ic, tit, modo, itens: (Array.isArray(dia[t]) ? dia[t] : [])
      .map((id) => modo === 'texto' ? ((vis[id] && vis[id].grupo === 'Insumo') ? Object.assign({ link: true }, vis[id]) : { id, nomeExib: id }) : vis[id]).filter(Boolean) }));
    const total = blocos.reduce((n, b) => n + b.itens.length, 0);
    const feitas = blocos.reduce((n, b) => n + b.itens.filter((r) => feitosAg[iso + '|' + b.t + '|' + r.id]).length, 0);
    const cont = !total ? '<span class="ag-cont vazio">—</span>'
      : feitas === total ? `<span class="ag-cont ok">✓ ${total}/${total}</span>`
      : `<span class="ag-cont">${feitas}/${total}</span>`;
    const corpo = total ? blocos.filter((b) => b.itens.length).map((b) => `
      <div class="ag-bloco ${b.t}">
        <div class="ag-btit"><span>${b.ic}</span> ${b.tit}</div>
        ${b.itens.map((r) => {
          const ch = iso + '|' + b.t + '|' + r.id, f = !!feitosAg[ch];
          return `<div class="ag-item${f ? ' feito' : ''}">
            <input type="checkbox" class="ag-chk" data-feito="${esc(ch)}" aria-label="marcar ${esc(r.nomeExib)} (${b.tit}) como feita" ${f ? 'checked' : ''}>
            ${(b.modo !== 'link' && !r.link)
              ? `<span class="ag-nome-solto">${esc(r.nomeExib)}</span>`   // só um aviso: sem link nem insumos
              : `<a href="#/${b.t === 'bater' ? 'bater' : 'r'}/${encodeURIComponent(r.id)}">${esc(r.nomeExib)}<span class="ag-seta">›</span></a>`}</div>`;
        }).join('')}
      </div>`).join('') : '<p class="muted small" style="margin:0">Nada programado para este dia.</p>';
    const onde = ondeEstou(iso);
    return `<details class="ap ag-dia${ehHoje ? ' hoje' : ''}" data-dia="${k}" ${agAbertos.has(k) ? 'open' : ''}>
      <summary style="flex-wrap:wrap;row-gap:4px"><span class="ag-nome">${nome}</span>${ehHoje ? '<span class="ag-tag">Hoje</span>' : `<span class="ag-data">${dm}</span>`}${cont}
        ${onde ? `<span class="ag-onde">📍 ${chipOnde(onde)}</span>` : ''}</summary>
      <div class="apc">${corpo}</div></details>`;
  }).join('');
  const h = ondeEstou(isoLocal(new Date())), hEl = $('#hojeOnde');
  if (hEl) hEl.innerHTML = h ? `<div class="card" style="padding:12px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><b>📍 Hoje você está em:</b> ${chipOnde(h)}</div>` : '';
  const rEl = $('#resumo'); if (rEl) rEl.innerHTML = resumoSemana();
  renderMatur();
}

function renderItens() {
  const todas = receitasVisiveis();
  const q = sem(filtro.q);
  const lista = todas.filter((r) => {
    if (q && !sem(r.nomeExib).includes(q)) return false;
    if (filtro.cat !== 'Todos' && r.grupo !== filtro.cat) return false;
    return true;
  });
  const el = $('#items'); if (!el) return;
  let html = lista.map((r) => `<a class="ritem" href="#/r/${encodeURIComponent(r.id)}">
      ${scoopBadge(r.grupo)}
      <span><span class="rname">${esc(r.nomeExib)}</span>
        <span class="rsub">${esc(r.grupo || '')}</span></span>
    </a>`).join('');
  if (!lista.length) {
    html = todas.length
      ? '<p class="muted">Nenhuma receita encontrada.</p>'
      : '<div class="card"><p style="margin:0">Nenhuma receita liberada ainda pelo gerente.</p></div>';
  }
  el.innerHTML = html;
  $('#cnt').textContent = lista.length + ' receita(s)';
  atualizarRodape();
}

function atualizarRodape() {
  const el = $('#rodape'); if (!el) return;
  const partes = ['La Maddalena · Porto de Galinhas'];
  if (dados && dados.geradoEm) {
    const d = new Date(dados.geradoEm);
    if (!isNaN(d)) partes.push('receitas de ' + d.toLocaleDateString('pt-BR'));
  }
  if (cfgFonte === 'salvo') partes.push('lista salva (sem conexão)');
  el.textContent = partes.join(' · ');
}

/* ============================================================ CRONÔMETRO (13 min) */
// Tempo de produção na produtora: 13 minutos, contagem regressiva que apita no fim.
// O estado fica no aparelho (sobrevive a recarregar a página) e o relógio roda no app todo:
// se o auxiliar sair da receita, o alarme ainda toca e aparece uma faixa para parar.
const TIMER_MS = 13 * 60 * 1000;
const K_TIMER = 'prod_timer';
let TM = null;                       // { id, nome, end (ms, ou null), rest (ms), done }
try { TM = JSON.parse(lsGet(K_TIMER) || 'null'); } catch (e) { TM = null; }
let audioCtx = null, alarmIv = null;
const timerSalva = () => lsSet(K_TIMER, JSON.stringify(TM));
function destravaAudio() {          // precisa de um toque do usuário (iniciar) para o navegador liberar o som
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* sem som: fica o aviso visual e a vibração */ }
}
function beep() {
  try {
    destravaAudio();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.3;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.3);
  } catch (e) { /* segue */ }
  try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (e) { /* segue */ }
}
function alarmeParar() {
  if (alarmIv) { clearInterval(alarmIv); alarmIv = null; }
  const f = document.getElementById('tmFaixa'); if (f) f.remove();
}
function alarmeTocar() {
  alarmeParar();
  const f = document.createElement('div');
  f.id = 'tmFaixa'; f.className = 'tm-faixa'; f.setAttribute('role', 'alert');
  f.innerHTML = '<span>⏰ Tempo esgotado' + (TM && TM.nome ? ' — ' + esc(TM.nome) : '') + '</span><button class="btn" id="tmFaixaOk">Parar alarme</button>';
  document.body.appendChild(f);
  document.getElementById('tmFaixaOk').onclick = () => { alarmeParar(); if (TM) { TM.done = false; TM.rest = TIMER_MS; timerSalva(); } timerPinta(); };
  let n = 0; beep();
  alarmIv = setInterval(() => { n++; if (n >= 45) { alarmeParar(); return; } beep(); }, 1000);
}
const tmFmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
function timerPinta() {              // atualiza o cartão do cronômetro, se estiver na tela
  const clock = document.getElementById('tmClock'); if (!clock) return;
  const go = document.getElementById('tmGo'), card = document.getElementById('timerCard');
  const meu = TM && TM.id === card.dataset.id;
  const rem = !meu ? TIMER_MS : (TM.end ? TM.end - Date.now() : TM.rest);
  clock.textContent = tmFmt(rem);
  card.classList.toggle('tm-run', !!(meu && TM.end));
  card.classList.toggle('tm-done', !!(meu && TM.done));
  go.textContent = !meu ? '▶ Iniciar' : (TM.end ? '⏸ Pausar' : (TM.done ? '▶ Reiniciar' : (TM.rest < TIMER_MS ? '▶ Continuar' : '▶ Iniciar')));
}
setInterval(() => {                  // relógio do app inteiro (a cada 250 ms)
  if (TM && TM.end && Date.now() >= TM.end) {
    TM.end = null; TM.rest = 0; TM.done = true; timerSalva(); alarmeTocar();
  }
  timerPinta();
}, 250);
function timerSetup(id, nome) {
  const go = document.getElementById('tmGo'), rs = document.getElementById('tmReset'); if (!go) return;
  go.onclick = () => {
    destravaAudio();
    if (!TM || TM.id !== id) TM = { id, nome, end: null, rest: TIMER_MS, done: false };
    if (TM.end) { TM.rest = Math.max(0, TM.end - Date.now()); TM.end = null; }              // pausar
    else { TM.nome = nome; TM.done = false; if (TM.rest <= 0) TM.rest = TIMER_MS; TM.end = Date.now() + TM.rest; }   // iniciar/continuar
    alarmeParar(); timerSalva(); timerPinta();
  };
  rs.onclick = () => { alarmeParar(); TM = { id, nome, end: null, rest: TIMER_MS, done: false }; timerSalva(); timerPinta(); };
  timerPinta();
}

/* ============================================================ RECEITA */
function viewRecipe(id, soTimer) {   // soTimer: tela do "Bater o gelato" — só cronômetro e avisos, sem insumos
  const r = receitasVisiveis().find((x) => x.id === id);
  if (!r) { location.hash = '#/'; return; }
  const vars = r.variantes || {};
  const tem15 = !!(vars['15'] && vars['15'].length) && !!(vars['20'] && vars['20'].length);
  const st = estadoDe(id);
  let creme = tem15 && st.creme === '15' ? '15' : (vars['20'] && vars['20'].length ? '20' : Object.keys(vars)[0]);
  const ings = vars[creme] || [];
  const todosLemb = (r.lembretes || []).filter((t) => String(t || '').trim());
  const avisos = todosLemb.filter((t) => t.indexOf('ATENÇÃO') >= 0);        // destacados em vermelho
  // no "Bater o gelato" só ficam o aviso vermelho e a montagem da cuba (biscoito); o resto é da calda
  const lembretes = todosLemb.filter((t) => t.indexOf('ATENÇÃO') < 0 && (!soTimer || t.indexOf('Biscoito') === 0));
  const comTimer = !!soTimer && r.grupo !== 'Insumo';   // cronômetro e aviso das favas só na tela de Bater o gelato (produtora)
  const kg = LOTE_PADRAO;   // lote FIXO de 6 kg (decisão do gerente): o auxiliar não altera
  // preparo (grupo Insumo): o auxiliar digita o peso do 1º ingrediente e o resto é calculado na proporção
  const preparo = r.grupo === 'Insumo' && ings.length > 1 && Number(ings[0].g) > 0;
  const baseG = () => { const v = Number(st.baseG); return v > 0 ? v : Number(ings[0].g); };
  const chaveItem = (i) => i + ':' + (ings[i] ? ings[i].n : '');
  const feitos = () => (st.feitos[creme] = st.feitos[creme] || []);

  const inner = `
  <div class="card">
    <div class="recipe-title">${scoopBadge(r.grupo)}<span>${esc(r.nomeExib)}</span></div>
    <p class="muted small" style="margin:0">${esc(r.grupo || '')}</p>
  </div>

  ${comTimer ? `<div class="card timer" id="timerCard" data-id="${esc(r.id)}">
    <div class="tm-lab">⏱ Tempo de produção: <b>13 minutos</b></div>
    <div class="tm-clock" id="tmClock">13:00</div>
    <div class="btnrow"><button class="btn" id="tmGo">▶ Iniciar</button><button class="btn sec" id="tmReset">↺ Zerar</button></div>
    <p class="muted small" style="margin:6px 0 0">Ao zerar o tempo, o celular apita.</p></div>` : ''}

  ${(soTimer && avisos.length) ? `<div class="aviso" role="alert">${avisos.map((t) => `<div>${esc(t)}</div>`).join('')}</div>` : ''}

  ${lembretes.length ? `<div class="lembrete"><h3>Lembretes</h3><ul>${lembretes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}

  ${(tem15 && !soTimer) ? `<div class="seg" id="segCreme">
    <button data-v="20" class="${creme === '20' ? 'on' : ''}">${r.alt === 'masc30' ? 'Mascarpone de creme 35%' : 'Creme de leite 20%'}</button>
    <button data-v="15" class="${creme === '15' ? 'on' : ''}">${r.alt === 'masc30' ? 'Mascarpone de creme 30%' : 'Creme de leite 15%'}</button></div>` : ''}

  ${soTimer ? '' : `<div class="card"><h3>⚖️ ${preparo ? 'Quantidade & ingredientes' : 'Lote & ingredientes'}</h3>
    ${preparo ? `<label class="lab" for="baseG">${esc(ings[0].n)} que você vai usar (g)</label>
      <input class="inp" id="baseG" type="number" inputmode="decimal" min="1" step="any" value="${esc(String(baseG()))}" style="font-size:20px;font-weight:700">
      <p class="muted small" style="margin:6px 0 10px">Os outros ingredientes são calculados na hora.</p>`
    : `<p class="muted small" style="margin:0 0 8px">Lote de <b>${nf(kg, 0)} kg</b></p>`}
    <div class="btnrow" style="justify-content:flex-end;margin-bottom:6px">
      <button class="btn sec mini" id="limparCheckBtn">↺ Limpar marcações</button>
    </div>
    <table class="ix" id="tbl"></table>
  </div>`}`;

  app().innerHTML = chrome(r.nomeExib, inner, { back: true });
  bindChrome();
  if (comTimer) timerSetup(r.id, r.nomeExib);
  if (soTimer) return;   // sem tabela de insumos nem seletor de versão

  const tbl = $('#tbl');
  function renderTabela() {
    const marc = feitos();
    let total = 0, soma = 0, nMarc = 0;
    const linhas = ings.map((i, idx) => {
      const g = preparo ? (Number(i.g) || 0) / Number(ings[0].g) * baseG() : (Number(i.g) || 0) * kg;
      const feito = marc.includes(chaveItem(idx));
      total += g;
      if (feito) { soma += g; nMarc++; }
      return `<tr class="${feito ? 'ing-feito' : ''}">
        <td>${esc(i.n)}${i.fim ? ' <span class="muted small">(no fim)</span>' : ''}</td>
        <td class="v" style="text-align:right">${(!preparo && Number(i.g) === 0 && i.fim) ? '<b>100 g por cuba</b>' : fmtG(g)}</td>
        <td style="text-align:center"><input type="checkbox" class="ing-check" data-idx="${idx}" aria-label="marcar ${esc(i.n)}" ${feito ? 'checked' : ''}></td></tr>`;
    }).join('');
    const completo = nMarc > 0 && Math.abs(soma - total) < 0.5;
    const somaHtml = nMarc ? `<b style="color:${completo ? 'var(--ok)' : 'var(--ink2)'}">${completo ? '✓ ' : ''}${nf(soma, 0)}</b>` : '';
    tbl.innerHTML = `
      <tr><th>Ingrediente</th><th style="text-align:right">g</th><th style="text-align:center">✓</th></tr>
      ${linhas}
      <tr><td><b>Total</b></td><td class="v" style="text-align:right"><b>${nf(total, 0)}</b></td>
        <td class="v" style="text-align:center;white-space:nowrap" title="soma dos ingredientes já marcados">${somaHtml}</td></tr>`;
  }
  renderTabela();
  const bi = $('#baseG');
  if (bi) bi.oninput = () => {
    const v = parseFloat(String(bi.value).replace(',', '.'));
    st.baseG = v > 0 ? v : null;     // vazio/inválido volta ao padrão
    salvarEstado(); renderTabela();
  };

  // marca sem recarregar a tela (não perde a posição da rolagem)
  tbl.onchange = (e) => {
    const cb = e.target;
    if (!cb.classList || !cb.classList.contains('ing-check')) return;
    const k = chaveItem(Number(cb.dataset.idx));
    const marc = feitos();
    const pos = marc.indexOf(k);
    if (cb.checked && pos < 0) marc.push(k);
    if (!cb.checked && pos >= 0) marc.splice(pos, 1);
    salvarEstado();
    renderTabela();
  };

  const sc = $('#segCreme');
  if (sc) sc.onclick = (e) => {
    const v = e.target.dataset && e.target.dataset.v;
    if (!v || v === creme) return;
    st.creme = v; salvarEstado(); viewRecipe(id);
  };

  $('#limparCheckBtn').onclick = () => {
    st.feitos = {};
    salvarEstado(); viewRecipe(id);
  };
}

/* ============================================================ ROTAS */
function render() {
  if (!dados) { viewLogin(); return; }
  const h = (location.hash || '#/').split('?')[0];
  const m = h.match(/^#\/r\/(.+)$/);
  const mb = h.match(/^#\/bater\/(.+)$/);
  if (mb) { let id = mb[1]; try { id = decodeURIComponent(id); } catch (e) { /* mantém */ } viewRecipe(id, true); }
  else if (m) { let id = m[1]; try { id = decodeURIComponent(id); } catch (e) { /* mantém */ } viewRecipe(id); }
  else viewHome();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

// ao voltar para o app, confere se o gerente mudou a lista
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !dados) return;
  const antes = visual();
  await carregarCfg();
  if (dados && visual() !== antes) render();
});

/* ============================================================ INÍCIO */
// a senha vale 24 h por aparelho; depois disso é pedida de novo (para todos)
const VALIDADE = 24 * 60 * 60 * 1000;
function chaveValida() {
  try {
    const o = JSON.parse(lsGet(K.chave) || 'null');
    if (o && typeof o.k === 'string' && typeof o.t === 'number' && Date.now() - o.t < VALIDADE && Date.now() >= o.t) return o.k;
  } catch (e) { /* formato antigo ou inválido */ }
  lsDel(K.chave);
  return null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && dados && !chaveValida()) sair();
});
async function iniciar() {
  const tinha = !!lsGet(K.chave);
  const guardada = chaveValida();
  if (!guardada && tinha) { viewLogin('Por segurança, digite a senha de novo (vale 24 horas).'); return; }
  if (guardada && window.crypto && crypto.subtle) {
    try {
      envelope = await carregarEnvelope();
      dados = await decifrar(b64d(guardada), envelope);
    } catch (e) {
      // chave não serve mais (senha ou arquivo mudou) ou sem rede: volta ao login
      if (envelope) lsDel(K.chave);
      dados = null;
    }
    if (dados) { await abrir(); return; }
  }
  viewLogin();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
iniciar();
})();
