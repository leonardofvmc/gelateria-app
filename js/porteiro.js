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
     login aprovado       → PIN de 8 dígitos (cria no 1º acesso, pede em
                            toda abertura) → busca a chave, destranca,
                            carrega o app
     e-mail não confirmado→ tela "Confirme seu e-mail" (contas e-mail/senha)
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

/* ============================================================ TRAVA POR PIN
   PIN do app: 8 dígitos, o mesmo em todos os aparelhos do usuário.
   • Nunca guardamos o PIN: só PBKDF2-SHA256 (salt 16 B, 310 000 voltas).
   • Nuvem: pinsApp/{email-minúsculo} = { hash, salt, iter, atualizadoEm,
     aparelho[, redefinidoEm] }   (hash/salt em base64)
   • Cópia local (localStorage) pra conferir sem internet.
   • 5 erros seguidos → sai da conta, apaga a cópia local, volta ao login.
     O contador fica no localStorage (recarregar a página não zera).
   • Parte pura (sem tela) fica em PIN pra poder ser testada sozinha. */
const PIN = (function () {
  const ITER = 310000, MAX_ERROS = 5, SEGUNDO_PLANO_MS = 10 * 60 * 1000;
  const mem = {};                       // plano B se o localStorage estiver bloqueado
  const lsGet = (k) => { try { const v = localStorage.getItem(k); return v === null ? (mem[k] ?? null) : v; } catch (e) { return mem[k] ?? null; } };
  const lsSet = (k, v) => { mem[k] = v; try { localStorage.setItem(k, v); } catch (e) {} };
  const lsDel = (k) => { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} };
  const id = (email) => String(email || '').trim().toLowerCase();
  const kReg = (e) => 'pin.reg:' + id(e), kErr = (e) => 'pin.err:' + id(e), kRedef = (e) => 'pin.redef:' + id(e);

  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (t) => Uint8Array.from(atob(t), c => c.charCodeAt(0));

  function valido(p) { return typeof p === 'string' && /^\d{8}$/.test(p); }
  // devolve o motivo (texto) se o PIN é fácil demais; null se pode usar
  function fraco(p) {
    if (/^(\d)\1{7}$/.test(p)) return 'Não use o mesmo número 8 vezes.';
    const d = Array.from(p, Number);
    const passo = (k) => d.every((x, i) => i === 0 || (x - d[i - 1] + 10) % 10 === k);
    if (passo(1) || passo(9)) return 'Não use sequência (como 12345678 ou 87654321).';
    if (/^(\d\d)\1{3}$/.test(p) || /^(\d{4})\1$/.test(p)) return 'Não use um PIN que se repete (como 12121212 ou 12341234).';
    return null;
  }

  async function derivar(p, salt, iter) {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(p), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, km, 256));
  }
  async function gerar(p) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { hash: b64(await derivar(p, salt, ITER)), salt: b64(salt), iter: ITER };
  }
  function regValido(r) {
    try {
      return !!r && typeof r.hash === 'string' && typeof r.salt === 'string'
        && Number.isInteger(r.iter) && r.iter >= 100000 && r.iter <= 2000000
        && unb64(r.hash).length === 32 && unb64(r.salt).length === 16;
    } catch (e) { return false; }
  }
  async function conferir(p, r) {
    if (!valido(p) || !regValido(r)) return false;
    const h = await derivar(p, unb64(r.salt), r.iter), esp = unb64(r.hash);
    let dif = 0; for (let i = 0; i < esp.length; i++) dif |= h[i] ^ esp[i];   // sem atalho
    return dif === 0;
  }
  const igual = (a, b) => !!a && !!b && a.hash === b.hash && a.salt === b.salt;

  // cópia local
  function lerCache(email) { try { const r = JSON.parse(lsGet(kReg(email)) || 'null'); return regValido(r) ? { hash: r.hash, salt: r.salt, iter: r.iter } : null; } catch (e) { return null; } }
  function gravarCache(email, r) { lsSet(kReg(email), JSON.stringify({ hash: r.hash, salt: r.salt, iter: r.iter })); }
  function limparCache(email) { lsDel(kReg(email)); }
  // contador de erros
  function erros(email) { const n = parseInt(lsGet(kErr(email)) || '0', 10); return n > 0 ? n : 0; }
  function registrarErro(email) { const n = erros(email) + 1; lsSet(kErr(email), String(n)); return n; }
  function zerarErros(email) { lsDel(kErr(email)); }
  // "esqueci o PIN": vale até criar o PIN novo (localStorage + sessionStorage)
  function marcarRedefinicao(email) {
    lsSet(kRedef(email), String(Date.now()));
    try { sessionStorage.setItem(kRedef(email), '1'); } catch (e) {}
  }
  function redefinicaoPendente(email) {
    let ss = null; try { ss = sessionStorage.getItem(kRedef(email)); } catch (e) {}
    return !!(lsGet(kRedef(email)) || ss);
  }
  function limparRedefinicao(email) { lsDel(kRedef(email)); try { sessionStorage.removeItem(kRedef(email)); } catch (e) {} }

  function aparelho() {
    const ua = String((navigator && navigator.userAgent) || '');
    const so = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Outro';
    const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
    return (so + ' · ' + nav).slice(0, 60);
  }
  // doc que vai pro Firestore (sem PIN, só o resultado do hash)
  function docNuvem(r, redefinido) {
    const d = { hash: r.hash, salt: r.salt, iter: r.iter, atualizadoEm: new Date().toISOString(), aparelho: aparelho() };
    if (redefinido) d.redefinidoEm = d.atualizadoEm;
    return d;
  }

  // Rebloqueio: guarda a hora em que o app foi pro segundo plano; ao voltar,
  // se passou o limite, manda recarregar (a página recarregada nasce trancada).
  function criarVigia(o) {
    o = Object.assign({ limiteMs: SEGUNDO_PLANO_MS, agora: () => Date.now(), recarregar: () => location.reload() }, o);
    let oculto = null;
    return function (estado) {
      if (estado === 'hidden') { if (oculto === null) oculto = o.agora(); return 'oculto'; }
      if (estado !== 'visible') return 'ignorado';
      const ficou = oculto === null ? 0 : o.agora() - oculto;
      oculto = null;
      if (ficou >= o.limiteMs) { o.recarregar(); return 'recarregou'; }
      return 'ok';
    };
  }

  return { ITER, MAX_ERROS, SEGUNDO_PLANO_MS, valido, fraco, gerar, conferir, regValido, igual,
           lerCache, gravarCache, limparCache, erros, registrarErro, zerarErros,
           marcarRedefinicao, redefinicaoPendente, limparRedefinicao, aparelho, docNuvem, criarVigia };
})();

let avisoLogin = '';   // recado mostrado uma vez na tela de login (ex.: "PIN errado 5 vezes")
let vigiaLigado = false;
function ligarRebloqueio() {
  if (vigiaLigado) return; vigiaLigado = true;
  const v = PIN.criarVigia({ recarregar: () => { document.body.style.visibility = 'hidden'; location.reload(); } });
  document.addEventListener('visibilitychange', () => v(document.visibilityState));
  // página restaurada do cache de "voltar" (bfcache) mantém a memória: recarrega
  window.addEventListener('pageshow', (e) => { if (e.persisted) { document.body.style.visibility = 'hidden'; location.reload(); } });
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
  ligarRebloqueio();
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
  if (avisoLogin) { errEl.className = 'dica'; errEl.textContent = avisoLogin; avisoLogin = ''; }
  try { const salvo = localStorage.getItem('lastEmail'); if (salvo) emailEl.value = salvo; } catch (e) {}
  const doAuth = async () => {
    errEl.textContent = ''; errEl.className = 'dica bad';
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

/* ---------- e-mail verificado ---------- */
function viewConfirmarEmail(user) {
  tela('Acesso', `
  <div class="login-hero">
    <div class="logo">${logo(ICON.cadeado, 46)}</div>
    <h2>Confirme seu e-mail</h2>
  </div>
  <div class="card">
    <p>Para usar o app, confirme que <b>${esc(user.email || '')}</b> é mesmo seu.</p>
    <p class="muted small">Abra o e-mail que enviamos (veja também o spam), toque no link e volte aqui. Se não achou, toque em Reenviar.</p>
    <div id="ceMsg" class="dica" style="min-height:18px;margin-bottom:6px"></div>
    <button class="btn" id="ceJa" style="width:100%">✔ Já confirmei</button>
    <button class="btn sec" id="ceRe" style="width:100%;margin-top:8px">✉ Reenviar e-mail de confirmação</button>
    <button class="btn sec" id="ceSair" style="width:100%;margin-top:8px">🚪 Sair desta conta</button>
  </div>`);
  const msg = $('#ceMsg');
  const dizer = (t, ruim) => { msg.className = ruim ? 'dica bad' : 'dica'; msg.textContent = t; };
  $('#ceJa').onclick = async () => {
    $('#ceJa').disabled = true; dizer('Conferindo…');
    try {
      if (await window.CLOUD.recarregarUsuario()) { fluxo(window.CLOUD.currentUser()); return; }
      dizer('Ainda não consta como confirmado. Toque no link do e-mail e tente de novo.', true);
    } catch (e) { dizer(window.CLOUD.authError(e), true); }
    $('#ceJa').disabled = false;
  };
  $('#ceRe').onclick = async () => {
    $('#ceRe').disabled = true;
    try { await window.CLOUD.reenviarVerificacao(); dizer('Enviei de novo para ' + (user.email || '') + '. Veja também o spam.'); }
    catch (e) { dizer(window.CLOUD.authError(e), true); }
    setTimeout(() => { const b = $('#ceRe'); if (b) b.disabled = false; }, 15000);
  };
  $('#ceSair').onclick = async () => { try { await window.CLOUD.logout(); } catch (e) {} };
}

/* ---------- PIN: telas ---------- */
function campoPin(el, aoCompletar) {
  el.addEventListener('input', () => {
    const v = el.value.replace(/\D/g, '').slice(0, 8);
    if (v !== el.value) el.value = v;
    if (aoCompletar && v.length === 8) aoCompletar();
  });
}
const CAMPO_PIN = 'type="password" inputmode="numeric" pattern="\\d{8}" maxlength="8" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"';
const ESTILO_PIN = 'text-align:center;font-size:26px;letter-spacing:.35em;padding-left:.35em';

// 5 erros: sai da conta e volta ao login (o caminho de recuperação)
async function bloquearPorErros(email) {
  PIN.limparCache(email); PIN.zerarErros(email);
  avisoLogin = 'PIN errado ' + PIN.MAX_ERROS + ' vezes: por segurança saí da conta. Entre de novo. Se esqueceu o PIN, toque em “Esqueci o PIN” na tela do PIN para criar outro.';
  try { await window.CLOUD.logout(); } catch (e) {}
}
async function esqueciPin(email) {
  PIN.marcarRedefinicao(email); PIN.limparCache(email); PIN.zerarErros(email);
  avisoLogin = 'Entre de novo com a sua conta (Esqueci a senha, se precisar). Depois você cria um PIN novo.';
  try { await window.CLOUD.logout(); } catch (e) {}
}

// Pede o PIN. Resolve quando acertar. 5 erros → bloquearPorErros (nunca resolve).
function pedirPinEntrada(email, reg) {
  return new Promise((ok) => {
    tela('PIN do app', `
    <div class="login-hero">
      <div class="logo">${logo(ICON.cadeado, 46)}</div>
      <h2>Digite o PIN do app</h2>
      <p class="muted small">${esc(email)}</p>
    </div>
    <div class="card">
      <label class="lab">PIN (8 números)</label>
      <input class="inp" id="pnInp" ${CAMPO_PIN} style="${ESTILO_PIN}" placeholder="••••••••">
      <div id="pnErr" class="dica bad" style="min-height:18px"></div>
      <button class="btn" id="pnBtn" style="width:100%">🔓 Abrir</button>
      <p class="small" style="text-align:center;margin-top:12px"><a href="#" id="pnEsq">Esqueci o PIN</a></p>
    </div>`);
    const inp = $('#pnInp'), err = $('#pnErr'), btn = $('#pnBtn');
    const resta = () => { const n = PIN.erros(email); err.textContent = n ? `PIN incorreto. Restam ${Math.max(PIN.MAX_ERROS - n, 0)} tentativa(s).` : ''; };
    resta();
    let ocupado = false;
    const tentar = async () => {
      if (ocupado) return;
      if (!PIN.valido(inp.value)) { err.textContent = 'Digite os 8 números do PIN.'; return; }
      ocupado = true; btn.disabled = true;
      let certo = false;
      try { certo = await PIN.conferir(inp.value, reg); } catch (e) { certo = false; }
      if (certo) { PIN.zerarErros(email); ok(); return; }
      const n = PIN.registrarErro(email);
      if (n >= PIN.MAX_ERROS) { await bloquearPorErros(email); return; }
      inp.value = ''; resta(); ocupado = false; btn.disabled = false; inp.focus();
    };
    campoPin(inp, tentar);
    btn.onclick = tentar;
    inp.onkeydown = (e) => { if (e.key === 'Enter') tentar(); };
    $('#pnEsq').onclick = (e) => { e.preventDefault(); esqueciPin(email); };
    inp.focus();
  });
}

// Cria (ou redefine) o PIN: grava o hash na nuvem e na cópia local, depois resolve.
function pedirNovoPin(email, redefinicao) {
  return new Promise((ok) => {
    tela('PIN do app', `
    <div class="login-hero">
      <div class="logo">${logo(ICON.cadeado, 46)}</div>
      <h2>${redefinicao ? 'Crie um PIN novo' : 'Crie o PIN do app (8 dígitos)'}</h2>
      <p class="muted small">${esc(email)}</p>
    </div>
    <div class="card">
      <p class="small" style="margin-top:0">O app vai pedir este PIN toda vez que for aberto. Ele vale em todos os seus aparelhos.</p>
      <p class="small"><b>Use um PIN diferente do PIN do celular.</b> Não use datas de aniversário nem sequências.</p>
      <label class="lab">PIN novo (8 números)</label>
      <input class="inp" id="pcA" ${CAMPO_PIN} style="${ESTILO_PIN}" placeholder="••••••••">
      <label class="lab">Repita o PIN</label>
      <input class="inp" id="pcB" ${CAMPO_PIN} style="${ESTILO_PIN}" placeholder="••••••••">
      <div id="pcErr" class="dica bad" style="min-height:18px"></div>
      <button class="btn" id="pcBtn" style="width:100%">🔑 Salvar PIN</button>
      <button class="btn sec" id="pcSair" style="width:100%;margin-top:8px">🚪 Sair desta conta</button>
    </div>`);
    const a = $('#pcA'), b = $('#pcB'), err = $('#pcErr'), btn = $('#pcBtn');
    campoPin(a, () => b.focus()); campoPin(b, null);
    let ocupado = false;
    const salvar = async () => {
      if (ocupado) return;
      err.textContent = '';
      if (!PIN.valido(a.value)) { err.textContent = 'O PIN precisa ter exatamente 8 números.'; return; }
      const f = PIN.fraco(a.value);
      if (f) { err.textContent = f; return; }
      if (a.value !== b.value) { err.textContent = 'Os dois PINs não são iguais.'; return; }
      ocupado = true; btn.disabled = true; btn.textContent = '…';
      try {
        const reg = await PIN.gerar(a.value);
        await window.CLOUD.setPinApp(PIN.docNuvem(reg, redefinicao));
        PIN.gravarCache(email, reg); PIN.zerarErros(email); PIN.limparRedefinicao(email);
        ok();
      } catch (e) {
        err.textContent = 'Não consegui salvar o PIN na nuvem — confira a internet e tente de novo.';
        ocupado = false; btn.disabled = false; btn.textContent = '🔑 Salvar PIN';
      }
    };
    btn.onclick = salvar;
    b.onkeydown = (e) => { if (e.key === 'Enter') salvar(); };
    $('#pcSair').onclick = async () => { try { await window.CLOUD.logout(); } catch (e) {} };
    a.focus();
  });
}

// Depois da aprovação: garante que o PIN (criado ou conferido) bate com o da nuvem.
//   jaConferido = cópia local contra a qual o usuário JÁ digitou o PIN (ou null).
async function garantirPin(email, redefinicao, jaConferido) {
  if (redefinicao) { await pedirNovoPin(email, true); return; }
  let remoto;
  try { remoto = await window.CLOUD.getPinApp(); }
  catch (e) {
    if (jaConferido) return;              // sem internet: vale a cópia local
    throw falha('rede');
  }
  if (!remoto || !PIN.regValido(remoto)) {   // ainda não tem PIN na nuvem
    PIN.limparCache(email);
    await pedirNovoPin(email, false);
    return;
  }
  PIN.gravarCache(email, remoto);
  if (PIN.igual(jaConferido, remoto)) return;
  await pedirPinEntrada(email, remoto);      // PIN mudou em outro aparelho: pede o novo
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
  // e-mail/senha só entra com o e-mail confirmado (Google já vem confirmado)
  if (!user.emailVerified) { viewConfirmarEmail(user); return; }
  const email = String(user.email || '').trim().toLowerCase();
  // 1) PIN com cópia local: pede ANTES de qualquer chamada à nuvem
  const redef = PIN.redefinicaoPendente(email);
  const local = redef ? null : PIN.lerCache(email);
  if (local) { await pedirPinEntrada(email, local); if (!atual()) return; }
  app().innerHTML = '<div class="loading">Verificando acesso…</div>';
  let a;
  try { a = await window.CLOUD.prepararAcesso(); }
  catch (e) { if (atual()) viewErro('Sem conexão com a nuvem. Verifique a internet.'); return; }
  if (!atual()) return;
  if (!a || a.status !== 'aprovado') { viewAguardando(a || {}); return; }

  // 2) PIN: cria no 1º acesso / redefinição, ou confere com o da nuvem.
  //    Tudo isto acontece ANTES de buscar a chave e decifrar o app.
  try { await garantirPin(email, redef, local); }
  catch (e) { if (atual()) viewErro(e.motivo === 'rede' ? 'Sem internet para conferir o PIN neste aparelho.' : (e.message || String(e))); return; }
  if (!atual()) return;
  app().innerHTML = '<div class="loading">Abrindo…</div>';

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

window.PORTEIRO = { destrancar, PIN };   // usado só nos testes
iniciar();
})();
