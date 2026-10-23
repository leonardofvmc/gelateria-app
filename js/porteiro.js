/* ============================================================
   PORTEIRO — a única parte do app que fica aberta no site publicado
   ------------------------------------------------------------
   No site publicado o app vem TRANCADO: receitas, insumos, custos,
   fábrica, vendas, escala e o próprio código das telas estão em
   app.bin, criptografado (AES-256-GCM). Quem baixar o arquivo sem
   login só vê bytes embaralhados.

   A chave que destranca mora no Firestore, em
   gelaterias/{gid}/meta/chave — e as regras do Firestore só deixam
   ler quem o dono aprovou na aba Pessoas. Então:
     sem login            → tela de login
     login não aprovado   → tela "aguardando liberação"
     login aprovado       → busca a chave, destranca, carrega o app
     #/m?d=…  (QR)        → cardápio público, sem login (só nome,
                            descrição e selos — nada de receita)

   Este arquivo NÃO entra no app de desenvolvimento (index.html da
   pasta app-gelato carrega os arquivos abertos). Ele só existe no
   site gerado por ferramentas/trancar.py.
   ============================================================ */
(function () {
'use strict';
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const app = () => $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SVG = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  scoop: SVG('<path d="M12 21 5.5 11h13z"/><circle cx="9" cy="8" r="3.4"/><circle cx="14.5" cy="7.5" r="3.4"/><circle cx="12" cy="5" r="3.2"/>'),
  pessoas: SVG('<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.4 3.4 0 0 1 0 5.6M17.5 14.2a6.5 6.5 0 0 1 4 5.8"/>'),
  cadeado: SVG('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
};
const logo = (ic, px) => `<span class="scoop" style="width:82px;height:82px;border-radius:24px;background:var(--brand-soft);color:var(--brand)">${ic.replace('viewBox', `width="${px}" height="${px}" viewBox`)}</span>`;
function tela(titulo, inner) {
  app().innerHTML = `<div class="topbar"><h1>${esc(titulo)}</h1></div><div class="wrap">${inner}</div>`;
}

/* ---------- base64url (mesmo formato do QR do cardápio) ---------- */
function b64urlDec(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
async function inflar(u8) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ============================================================ CARDÁPIO PÚBLICO
   Cópia da tela de menu do ui.js, só o caminho do QR: os dados vêm
   inteiros no próprio link, então não precisa de login nem de app.bin. */
async function decodeMenu(d) {
  const kind = d[0]; const u8 = b64urlDec(d.slice(1));
  const bytes = kind === 'z' ? await inflar(u8) : u8;
  return JSON.parse(new TextDecoder().decode(bytes));
}
function badgesHTML(sel, lang) {
  const L = lang === 'es'
    ? { leite: '🥛 Lácteo', ovo: '🥚 Huevo', oleo: '🌰 Frutos secos', veg: '🌱 Vegano', sl: 'Sin lactosa' }
    : { leite: '🥛 Leite', ovo: '🥚 Ovo', oleo: '🌰 Oleaginosas', veg: '🌱 Vegano', sl: 'Sem lactose' };
  const out = [];
  if (sel.leite) out.push(L.leite);
  if (sel.ovo) out.push(L.ovo);
  if (sel.oleaginosas) out.push(L.oleo);
  if (sel.vegano) out.push(L.veg); else if (sel.semLactose) out.push(L.sl);
  return out.map(x => `<span>${x}</span>`).join('');
}
let menuLang = 'pt';
async function viewMenu(query) {
  let data = null;
  const m = /[?&]d=([^&]+)/.exec(query || '');
  if (m) { try { data = await decodeMenu(decodeURIComponent(m[1])); } catch (e) { data = null; } }
  document.body.style.paddingBottom = '20px';
  if (!data) {
    app().innerHTML = `<div class="menu-hero"><h1>🍨 La Maddalena</h1><p>Gelato artesanale · Porto de Galinhas</p></div>
      <p class="muted" style="text-align:center;padding:24px">Cardápio indisponível — escaneie o QR do balcão de novo.<br>Menú no disponible — escanee el QR del mostrador de nuevo.</p>`;
    return;
  }
  const L = menuLang === 'es'
    ? { hoje: 'Sabores de hoy', cremes: 'Cremas', sorbets: 'Sorbetes (sin leche)', casq: 'Cono artesanal', rodape: 'Hecho a mano todos los días' }
    : { hoje: 'Sabores de hoje', cremes: 'Cremes', sorbets: 'Sorbets (sem leite)', casq: 'Casquinha artesanal', rodape: 'Feito à mão todos os dias' };
  const grupo = (cat) => data.i.filter(x => x.c === cat);
  const item = (x) => `<div class="mitem">
    <div class="mn">${esc(x.n)}</div>
    <div class="md">${esc(menuLang === 'es' ? (x.e || x.p) : (x.p || x.e))}</div>
    <div class="mb">${badgesHTML({ leite: x.b.l, ovo: x.b.o, oleaginosas: x.b.g, vegano: x.b.v, semLactose: x.b.s }, menuLang)}</div>
  </div>`;
  app().innerHTML = `
  <div class="menu-hero">
    <h1>🍨 ${esc(data.t)}</h1>
    <p>${esc(data.sub)}</p>
    <div class="mlang">
      <button class="${menuLang === 'pt' ? 'on' : ''}" data-l="pt">🇧🇷 Português</button>
      <button class="${menuLang === 'es' ? 'on' : ''}" data-l="es">🇪🇸 Español</button>
    </div>
  </div>
  <p class="msec" style="text-align:center;margin-top:16px">✨ ${L.hoje} ✨</p>
  ${grupo('Creme').length ? `<p class="msec">🍨 ${L.cremes}</p>` + grupo('Creme').map(item).join('') : ''}
  ${grupo('Sorbet').length ? `<p class="msec">🍧 ${L.sorbets}</p>` + grupo('Sorbet').map(item).join('') : ''}
  ${grupo('Casquinha').length ? `<p class="msec">🍦 ${L.casq}</p>` + grupo('Casquinha').map(item).join('') : ''}
  <p class="muted small" style="text-align:center;padding:18px">🌊 ${L.rodape} · Porto de Galinhas</p>`;
  $$('.mlang button').forEach(b => b.onclick = () => { menuLang = b.dataset.l; viewMenu(query); });
}

/* ============================================================ DESTRANCAR
   app.bin = 'LMG1' + nonce (12 bytes) + AES-256-GCM( deflate-raw( JSON ) )
   JSON = [{ n: 'js/ui.js', c: '<código>' }, …] na ordem do index.html. */
const MAGICO = 'LMG1';
function chaveBytes(txt) {
  const limpo = String(txt || '').trim().replace(/^lm1-/, '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(limpo)) return null;
  const u8 = b64urlDec(limpo);
  return u8.length === 32 ? u8 : null;
}
// Erro com motivo, pra cada tela saber o que mostrar.
function falha(motivo) { const e = new Error(motivo); e.motivo = motivo; return e; }

async function destrancar(chaveTxt) {
  const raw = chaveBytes(chaveTxt);
  if (!raw) throw falha('chave');
  let resp;
  try { resp = await fetch('app.bin', { cache: 'no-store' }); } catch (e) { throw falha('rede'); }
  if (!resp.ok) throw falha('rede');
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (String.fromCharCode(...buf.slice(0, 4)) !== MAGICO) throw falha('formato');
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  let plano;
  try {
    plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(4, 16), additionalData: buf.slice(0, 4) }, key, buf.slice(16));
  } catch (e) { throw falha('chave'); }   // GCM recusa chave errada (e arquivo adulterado)
  return JSON.parse(new TextDecoder().decode(await inflar(new Uint8Array(plano))));
}

// Cada arquivo vira um <script> próprio, na ordem — igual ao index.html
// de desenvolvimento, então o app não percebe diferença nenhuma.
function injetar(arq) {
  return new Promise((ok, erro) => {
    const url = URL.createObjectURL(new Blob([arq.c + '\n//# sourceURL=' + arq.n], { type: 'text/javascript' }));
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => { URL.revokeObjectURL(url); ok(); };
    s.onerror = () => erro(new Error('falha ao carregar ' + arq.n));
    document.body.appendChild(s);
  });
}

let carregado = null;   // { uid } de quem destrancou, depois que o app sobe
async function carregarApp(arquivos) {
  const u = window.CLOUD.currentUser();
  carregado = { uid: u ? u.uid : null };
  app().innerHTML = '<div class="loading">Carregando a gelateria…</div>';
  for (const arq of arquivos) await injetar(arq);
}

/* ============================================================ TELAS */
let loginMode = 'login'; // login | signup
function viewLogin() {
  tela('Acesso', `
  <div class="login-hero">
    <div class="logo">${logo(ICON.scoop, 50)}</div>
    <h2>La Maddalena</h2>
    <p class="muted">${loginMode === 'login' ? 'Entre para acessar as receitas da gelateria' : 'Crie sua conta — o responsável libera o acesso'}</p>
  </div>
  <div class="card">
    <label class="lab">E-mail</label>
    <input class="inp" id="lgEmail" type="email" inputmode="email" autocomplete="username" placeholder="voce@exemplo.com">
    <label class="lab">Senha</label>
    <input class="inp" id="lgSenha" type="password" autocomplete="current-password" placeholder="mín. 6 caracteres">
    <div id="lgErr" class="dica bad" style="min-height:18px"></div>
    <button class="btn" id="lgBtn" style="width:100%">${loginMode === 'login' ? '🔓 Entrar' : '✨ Criar conta'}</button>
    <p class="small" style="text-align:center;margin-top:12px">
      ${loginMode === 'login'
        ? 'Ainda não tem conta? <a href="#" id="lgToggle">Criar conta</a>'
        : 'Já tem conta? <a href="#" id="lgToggle">Fazer login</a>'}
    </p>
    ${loginMode === 'login' ? '<p class="small" style="text-align:center;margin-top:4px"><a href="#" id="lgEsqueci">Esqueci a senha</a></p>' : ''}
  </div>
  <p class="muted small" style="text-align:center">${loginMode === 'login'
    ? 'Suas receitas são as mesmas em todos os aparelhos com este login.'
    : 'Contas novas entram como “aguardando”: o responsável pela gelateria precisa liberar antes de você ver as receitas.'}</p>`);
  const emailEl = $('#lgEmail'), senhaEl = $('#lgSenha'), errEl = $('#lgErr');
  try { const salvo = localStorage.getItem('lastEmail'); if (salvo) emailEl.value = salvo; } catch (e) {}
  const doAuth = async () => {
    errEl.textContent = '';
    const email = emailEl.value.trim(), senha = senhaEl.value;
    if (!email || !senha) { errEl.textContent = 'Preencha e-mail e senha.'; return; }
    $('#lgBtn').disabled = true; $('#lgBtn').textContent = '…';
    try {
      if (loginMode === 'login') await window.CLOUD.login(email, senha);
      else await window.CLOUD.signup(email, senha);
      try { localStorage.setItem('lastEmail', email); } catch (e) {}
      // onAuth dispara fluxo() sozinho
    } catch (e) {
      errEl.textContent = window.CLOUD.authError(e);
      $('#lgBtn').disabled = false; $('#lgBtn').textContent = loginMode === 'login' ? '🔓 Entrar' : '✨ Criar conta';
    }
  };
  $('#lgBtn').onclick = doAuth;
  senhaEl.onkeydown = (e) => { if (e.key === 'Enter') doAuth(); };
  $('#lgToggle').onclick = (e) => { e.preventDefault(); loginMode = loginMode === 'login' ? 'signup' : 'login'; viewLogin(); };
  const esq = $('#lgEsqueci');
  if (esq) esq.onclick = async (e) => {
    e.preventDefault();
    const email = emailEl.value.trim();
    if (!email) { errEl.className = 'dica bad'; errEl.textContent = 'Digite o e-mail primeiro.'; return; }
    try {
      await window.CLOUD.resetSenha(email);
      errEl.className = 'dica';
      errEl.textContent = 'Mandei um link para ' + email + ' (veja também o spam). Crie a senha nova e volte aqui.';
    } catch (err) { errEl.className = 'dica bad'; errEl.textContent = window.CLOUD.authError(err); }
  };
}

function botoesSair() {
  return `<button class="btn" id="agBtn" style="width:100%;margin-top:8px">↻ Verificar de novo</button>
    <button class="btn sec" id="agSair" style="width:100%;margin-top:8px">🚪 Sair desta conta</button>`;
}
function bindSair() {
  $('#agBtn').onclick = () => location.reload();
  $('#agSair').onclick = async () => { await window.CLOUD.logout(); location.hash = '#/'; location.reload(); };
}

function viewAguardando(a) {
  const semGelateria = a.status === 'sem-gelateria';
  tela('Acesso', `
  <div class="login-hero">
    <div class="logo">${logo(ICON.pessoas, 46)}</div>
    <h2>${semGelateria ? 'Gelateria não encontrada' : 'Aguardando liberação'}</h2>
  </div>
  <div class="card">
    ${semGelateria
      ? `<p>Sua conta foi criada, mas o app ainda não sabe a qual gelateria ela pertence.</p>
         <p class="muted small">Isso acontece quando a conta dona ainda não abriu o app depois da última atualização. Peça para o responsável abrir o app uma vez e tente de novo.</p>`
      : `<p>Sua conta <b>${esc(a.email || '')}</b> foi criada e o pedido de acesso já foi enviado ao responsável pela gelateria.</p>
         <p class="muted small">Assim que ele aprovar, as receitas aparecem aqui — não precisa criar outra conta nem reinstalar o app. Toque em Verificar para atualizar.</p>`}
    ${botoesSair()}
  </div>`);
  bindSair();
}

// Aprovado, mas a chave ainda não foi cadastrada (ou não abre esta versão).
function viewSemChave(chaveNaoConfere) {
  tela('Acesso', `
  <div class="login-hero">
    <div class="logo">${logo(ICON.cadeado, 46)}</div>
    <h2>App sendo atualizado</h2>
  </div>
  <div class="card">
    <p>${chaveNaoConfere
      ? 'Esta versão do app foi trancada com uma chave nova, que ainda não foi cadastrada.'
      : 'O app ainda não recebeu a chave que abre as receitas.'}</p>
    <p class="muted small">Peça para o responsável pela gelateria abrir o app uma vez e cadastrar a chave. Depois toque em Verificar.</p>
    ${botoesSair()}
  </div>`);
  bindSair();
}

// Só o dono vê: cadastra a chave uma vez (fica no Firestore, protegida
// pelas mesmas regras das receitas).
function viewCadastrarChave(chaveNaoConfere) {
  tela('Chave do app', `
  <div class="login-hero">
    <div class="logo">${logo(ICON.cadeado, 46)}</div>
    <h2>${chaveNaoConfere ? 'Chave nova' : 'Cadastrar a chave'}</h2>
  </div>
  <div class="card">
    <p>${chaveNaoConfere
      ? 'Esta versão do app foi trancada com uma chave nova. Cole a chave nova abaixo — é só desta vez.'
      : 'As receitas agora ficam trancadas no site. Cole a chave abaixo para destrancar — <b>é só uma vez</b>: depois disso toda a equipe aprovada entra direto.'}</p>
    <label class="lab">Chave (começa com lm1-)</label>
    <input class="inp" id="chInp" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="lm1-…">
    <div id="chErr" class="dica bad" style="min-height:18px"></div>
    <button class="btn" id="chBtn" style="width:100%">🔑 Salvar e abrir</button>
    <button class="btn sec" id="agSair" style="width:100%;margin-top:8px">🚪 Sair desta conta</button>
  </div>`);
  $('#agSair').onclick = async () => { await window.CLOUD.logout(); location.hash = '#/'; location.reload(); };
  $('#chBtn').onclick = async () => {
    const err = $('#chErr'); err.textContent = '';
    const txt = $('#chInp').value.trim();
    if (!chaveBytes(txt)) { err.textContent = 'Isso não parece a chave — confira se colou ela inteira.'; return; }
    $('#chBtn').disabled = true; $('#chBtn').textContent = '…';
    try {
      const arquivos = await destrancar(txt);       // só salva se abrir de verdade
      await window.CLOUD.put('meta', 'chave', { k: txt, em: new Date().toISOString().slice(0, 10) });
      await carregarApp(arquivos);
    } catch (e) {
      err.textContent = e.motivo === 'chave' ? 'Essa chave não abre esta versão do app.'
        : e.motivo === 'rede' ? 'Sem internet para conferir a chave — tente de novo.'
        : 'Não consegui salvar: ' + (e.message || e);
      $('#chBtn').disabled = false; $('#chBtn').textContent = '🔑 Salvar e abrir';
    }
  };
}

function viewErro(msg) {
  tela('Acesso', `
  <div class="login-hero">
    <div class="logo">${logo(ICON.scoop, 50)}</div>
    <h2>La Maddalena</h2>
  </div>
  <div class="card" style="background:var(--badbg);color:var(--bad)"><b>Não consegui abrir o app.</b><br>${esc(msg)}</div>
  <button class="btn" id="erBtn" style="width:100%">↻ Tentar de novo</button>`);
  $('#erBtn').onclick = () => location.reload();
}

/* ============================================================ FLUXO */
let rodada = 0;   // descarta resultado de uma volta antiga se o login mudou no meio
async function fluxo(user) {
  const minha = ++rodada;
  const atual = () => minha === rodada;
  if (carregado) {
    // app já destrancado: saiu da conta (ou trocou) → recarrega, pra não
    // sobrar nada destrancado na memória
    if (!user || user.uid !== carregado.uid) location.reload();
    return;
  }
  if (!user) { viewLogin(); return; }
  app().innerHTML = '<div class="loading">Verificando acesso…</div>';
  let a;
  try { a = await window.CLOUD.prepararAcesso(); }
  catch (e) { if (atual()) viewErro('Sem conexão com a nuvem. Verifique a internet.'); return; }
  if (!atual()) return;
  if (!a || a.status !== 'aprovado') { viewAguardando(a || {}); return; }

  let doc = null;
  try { doc = await window.CLOUD.getDocData('meta', 'chave'); } catch (e) { doc = null; }
  if (!atual()) return;
  const dono = window.CLOUD.isDono();
  if (!doc || !doc.k) { dono ? viewCadastrarChave(false) : viewSemChave(false); return; }
  try {
    const arquivos = await destrancar(doc.k);
    if (!atual()) return;
    await carregarApp(arquivos);
  } catch (e) {
    if (!atual()) return;
    if (e.motivo === 'chave') { dono ? viewCadastrarChave(true) : viewSemChave(true); return; }
    viewErro(e.motivo === 'rede' ? 'Sem internet e sem cópia salva neste aparelho.' : (e.message || String(e)));
  }
}

async function iniciar() {
  try { document.documentElement.dataset.theme = localStorage.getItem('theme') || ''; } catch (e) {}
  const [path, query] = (location.hash || '#/').split('?');
  if (path.startsWith('#/m')) { await viewMenu('?' + (query || '')); return; }
  if (!window.CLOUD || !window.CLOUD.enabled) { viewErro('Configuração da nuvem ausente.'); return; }
  if (!window.crypto || !crypto.subtle || !window.DecompressionStream) {
    viewErro('Este navegador é antigo demais para abrir o app. Atualize o navegador.'); return;
  }
  try { await window.CLOUD.init(); }
  catch (e) { viewErro('Sem conexão com a nuvem. Verifique a internet.'); return; }
  if (ouvindo) { fluxo(window.CLOUD.currentUser()); return; }
  ouvindo = true;
  window.CLOUD.onAuth((u) => { fluxo(u); });
}
let ouvindo = false;
// cardápio do QR aberto e depois trocado de hash sem recarregar: recomeça
window.addEventListener('hashchange', () => { if (!carregado) iniciar(); });

window.PORTEIRO = { destrancar };   // usado só nos testes
iniciar();
})();
