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
const K = { chave: 'prod_chave', cfg: 'prod_cfg', cfgDev: 'prod_cfg_dev', estado: 'prod_estado', tema: 'prod_tema' };
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
    };
  });
  return out;
}
function cfgSalva() {
  try { const o = JSON.parse(lsGet(K.cfg) || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
}
async function carregarCfg() {
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

function receitasVisiveis() {
  if (!dados || !cfg) return [];
  return dados.receitas
    .filter((r) => cfg[r.id] && cfg[r.id].visivel === true)
    .map((r) => Object.assign({}, r, { nomeExib: (cfg[r.id].nome || '').trim() || r.nome }));
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
    if (dados) render();
    return;
  }
  if (ini) { cfg = ini; cfgFonte = 'salvo'; }
  else { cfg = {}; cfgFonte = ''; }
  render();
  const antes = JSON.stringify(cfg);
  await carregarCfg();
  if (dados && JSON.stringify(cfg) !== antes) render();
  else if (dados) atualizarRodape();
}

/* ============================================================ LISTA */
function viewHome() {
  const inner = `
    <input class="inp" id="q" type="search" placeholder="🔎 Buscar sabor…" value="${esc(filtro.q)}" autocomplete="off">
    <div class="seg" id="segCat">${['Todos', 'Creme', 'Fitness', 'Sorbet'].map((c) =>
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

/* ============================================================ RECEITA */
function viewRecipe(id) {
  const r = receitasVisiveis().find((x) => x.id === id);
  if (!r) { location.hash = '#/'; return; }
  const vars = r.variantes || {};
  const tem15 = !!(vars['15'] && vars['15'].length) && !!(vars['20'] && vars['20'].length);
  const st = estadoDe(id);
  let creme = tem15 && st.creme === '15' ? '15' : (vars['20'] && vars['20'].length ? '20' : Object.keys(vars)[0]);
  const ings = vars[creme] || [];
  const leite1 = r.leite && r.leite[creme] > 0 ? Number(r.leite[creme]) : 0;
  const lembretes = (r.lembretes || []).filter((t) => String(t || '').trim());
  let kg = st.kg > 0 ? st.kg : LOTE_PADRAO;
  const chaveItem = (i) => i + ':' + (ings[i] ? ings[i].n : '');
  const feitos = () => (st.feitos[creme] = st.feitos[creme] || []);

  const inner = `
  <div class="card">
    <div class="recipe-title">${scoopBadge(r.grupo)}<span>${esc(r.nomeExib)}</span></div>
    <p class="muted small" style="margin:0">${esc(r.grupo || '')}</p>
  </div>

  ${lembretes.length ? `<div class="lembrete"><h3>Lembretes</h3><ul>${lembretes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}

  ${tem15 ? `<div class="seg" id="segCreme">
    <button data-v="20" class="${creme === '20' ? 'on' : ''}">Creme de leite 20%</button>
    <button data-v="15" class="${creme === '15' ? 'on' : ''}">Creme de leite 15%</button></div>` : ''}

  <div class="card"><h3>⚖️ Lote & ingredientes</h3>
    <div class="${leite1 ? 'grid2' : ''}">
      <div><label class="lab" for="loteKg">Tamanho do lote (kg)</label>
        <input class="inp" id="loteKg" inputmode="decimal" autocomplete="off" value="${nf(kg, 2)}"></div>
      ${leite1 ? `<div><label class="lab" for="loteLeite">…ou pelo leite (g)</label>
        <input class="inp" id="loteLeite" inputmode="decimal" autocomplete="off" value="${nf(leite1 * kg, 0)}"></div>` : ''}
    </div>
    ${leite1 ? '<p class="muted small" style="margin:-4px 0 8px">Mude um dos dois — o outro se ajusta e todos os ingredientes acompanham.</p>' : ''}
    <div class="btnrow" style="justify-content:flex-end;margin-bottom:6px">
      <button class="btn sec mini" id="limparCheckBtn">↺ Limpar marcações e lote</button>
    </div>
    <table class="ix" id="tbl"></table>
  </div>`;

  app().innerHTML = chrome(r.nomeExib, inner, { back: true });
  bindChrome();

  const tbl = $('#tbl');
  function renderTabela() {
    const marc = feitos();
    let total = 0, soma = 0, nMarc = 0;
    const linhas = ings.map((i, idx) => {
      const g = (Number(i.g) || 0) * kg;
      const feito = marc.includes(chaveItem(idx));
      total += g;
      if (feito) { soma += g; nMarc++; }
      return `<tr class="${feito ? 'ing-feito' : ''}">
        <td>${esc(i.n)}${i.fim ? ' <span class="muted small">(no fim)</span>' : ''}</td>
        <td class="v" style="text-align:right">${fmtG(g)}</td>
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

  const kgEl = $('#loteKg'), leiteEl = $('#loteLeite');
  const soltaEnter = (el) => { el.onkeydown = (e) => { if (e.key === 'Enter') el.blur(); }; };
  kgEl.oninput = () => {
    const v = parseNum(kgEl.value);
    if (!(v > 0)) return;
    kg = v; st.kg = v; salvarEstado();
    if (leiteEl) leiteEl.value = nf(leite1 * kg, 0);
    renderTabela();
  };
  kgEl.onchange = () => { kgEl.value = nf(kg, 2); };
  soltaEnter(kgEl);
  if (leiteEl) {
    leiteEl.oninput = () => {
      const v = parseNum(leiteEl.value);
      if (!(v > 0) || !leite1) return;
      kg = v / leite1; st.kg = kg; salvarEstado();
      kgEl.value = nf(kg, 2);
      renderTabela();
    };
    leiteEl.onchange = () => { leiteEl.value = nf(leite1 * kg, 0); };
    soltaEnter(leiteEl);
  }

  const sc = $('#segCreme');
  if (sc) sc.onclick = (e) => {
    const v = e.target.dataset && e.target.dataset.v;
    if (!v || v === creme) return;
    st.creme = v; salvarEstado(); viewRecipe(id);
  };

  $('#limparCheckBtn').onclick = () => {
    st.feitos = {}; delete st.kg;               // o lote volta ao padrão só aqui
    salvarEstado(); viewRecipe(id);
  };
}

/* ============================================================ ROTAS */
function render() {
  if (!dados) { viewLogin(); return; }
  const h = (location.hash || '#/').split('?')[0];
  const m = h.match(/^#\/r\/(.+)$/);
  if (m) { let id = m[1]; try { id = decodeURIComponent(id); } catch (e) { /* mantém */ } viewRecipe(id); }
  else viewHome();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

// ao voltar para o app, confere se o gerente mudou a lista
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !dados) return;
  const antes = JSON.stringify(cfg);
  await carregarCfg();
  if (dados && JSON.stringify(cfg) !== antes) render();
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
