/* ============================================================
   CLOUD — Firebase Firestore (sincronização entre aparelhos)
   Carregado como script clássico; importa o Firebase (ESM) sob
   demanda via import() dinâmico — só quando há config.
   Sincronização offline é NATIVA do Firestore (persistentLocalCache):
   escreve sem internet e sincroniza sozinho ao voltar online.
   Dados da gelateria: gelaterias/{gid}/{colecao}/{id}
   O {gid} é o uid da conta DONA (window.GELATERIA.donoEmail) —
   todo mundo da equipe lê e escreve no MESMO lugar, não numa
   cópia por pessoa. Quem é membro fica em gelaterias/{gid}/acessos.
   ============================================================ */
window.CLOUD = (function () {
  'use strict';
  const cfg = window.FIREBASE_CONFIG;
  const enabled = !!(cfg && cfg.apiKey);
  const EQUIPE = window.GELATERIA || {};
  const DONO_EMAIL = String(EQUIPE.donoEmail || '').trim().toLowerCase();
  const VER = '10.12.2';
  const CDN = (m) => `https://www.gstatic.com/firebasejs/${VER}/firebase-${m}.js`;

  let S = null;                 // módulos firebase
  let app, db, auth;
  let _user = null;
  let _authReady = null;        // promise: 1º estado de auth resolvido
  let _gid = null;              // uid da conta dona = "id da gelateria"
  let _acesso = null;           // { status, papel, dono }
  const authCbs = [];

  async function load() {
    if (S) return S;
    const [a, au, fs] = await Promise.all([
      import(CDN('app')), import(CDN('auth')), import(CDN('firestore')),
    ]);
    S = Object.assign({}, a, au, fs);
    return S;
  }

  // Pode ser chamado mais de uma vez: no site publicado o porteiro
  // (js/porteiro.js) inicia a nuvem antes, e depois o app chama de novo.
  let _initP = null;
  function init() {
    if (!enabled) return Promise.resolve({ enabled: false });
    if (!_initP) _initP = initUmaVez().catch((e) => { _initP = null; throw e; });
    return _initP;
  }
  async function initUmaVez() {
    await load();
    app = S.initializeApp(cfg);
    db = S.initializeFirestore(app, {
      localCache: S.persistentLocalCache({ tabManager: S.persistentMultipleTabManager() }),
    });
    auth = S.getAuth(app);
    try { await S.setPersistence(auth, S.browserLocalPersistence); } catch (e) {}
    _authReady = new Promise((res) => {
      let first = true;
      S.onAuthStateChanged(auth, (u) => {
        _user = u || null;
        if (!_user) { _gid = null; _acesso = null; }
        authCbs.forEach((cb) => { try { cb(_user); } catch (e) {} });
        if (first) { first = false; res(); }
      });
    });
    await _authReady;
    return { enabled: true };
  }

  function onAuth(cb) { authCbs.push(cb); if (_authReady) cb(_user); }
  function currentUser() { return _user; }
  function uid() { return _user ? _user.uid : null; }

  // ---- auth ----
  async function login(email, senha) { await S.signInWithEmailAndPassword(auth, email.trim(), senha); }
  async function signup(email, senha) {
    const cred = await S.createUserWithEmailAndPassword(auth, email.trim(), senha);
    // conta nova por e-mail/senha nasce NÃO verificada: manda o e-mail de confirmação já
    try { await S.sendEmailVerification(cred.user); } catch (e) { console.warn('verificação de e-mail', e); }
  }
  async function logout() { await S.signOut(auth); }
  // manda o e-mail do Firebase com o link para criar uma senha nova
  async function resetSenha(email) { await S.sendPasswordResetEmail(auth, email.trim()); }
  // ---- e-mail verificado (o porteiro exige; as regras do Firestore também) ----
  async function reenviarVerificacao() {
    if (!_user) throw new Error('sem login');
    await S.sendEmailVerification(_user);
  }
  // Relê a conta no servidor e renova o token (as regras olham o email_verified
  // DO TOKEN, que só atualiza depois do getIdToken(true)). Devolve true/false.
  async function recarregarUsuario() {
    if (!_user) return false;
    await S.reload(_user);
    if (_user.emailVerified) { try { await _user.getIdToken(true); } catch (e) {} }
    return !!_user.emailVerified;
  }

  // ---- PIN do app: pinsApp/{email-minúsculo} = { hash, salt, iter, atualizadoEm, aparelho[, redefinidoEm] }
  // Só o hash PBKDF2 (nunca o PIN). Só o próprio usuário (verificado) lê/escreve.
  function pinRef() { return S.doc(db, 'pinsApp', emailAtual()); }
  async function getPinApp() {
    const snap = await S.getDoc(pinRef());
    return snap.exists() ? snap.data() : null;
  }
  async function setPinApp(dados) { await S.setDoc(pinRef(), dados); }

  function authError(e) {
    const c = (e && e.code) || '';
    const map = {
      'auth/invalid-email': 'E-mail inválido.',
      'auth/missing-password': 'Digite a senha.',
      'auth/weak-password': 'Senha fraca — use ao menos 6 caracteres.',
      'auth/email-already-in-use': 'Este e-mail já tem conta — faça login.',
      'auth/invalid-credential': 'E-mail ou senha incorretos.',
      'auth/wrong-password': 'Senha incorreta.',
      'auth/user-not-found': 'Conta não encontrada — crie uma.',
      'auth/network-request-failed': 'Sem internet para autenticar.',
      'auth/too-many-requests': 'Muitas tentativas — aguarde um pouco.',
      'auth/operation-not-allowed': 'Ative Login por E-mail/Senha no Firebase (Authentication).',
      'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Configuração da nuvem inválida — confira os dados colados em js/config.js.',
      'auth/api-key-not-valid': 'Configuração da nuvem inválida — confira os dados colados em js/config.js.',
      'auth/configuration-not-found': 'Ative Authentication → E-mail/senha no console do Firebase.',
    };
    if (c && c.indexOf('api-key-not-valid') >= 0) return 'Configuração da nuvem inválida — confira os dados colados em js/config.js.';
    return map[c] || ('Erro: ' + (e.message || c));
  }

  /* ---- equipe / acesso ----------------------------------------
     Regra de ouro: o dono é identificado pelo E-MAIL (constante em
     config.js), nunca por um uid que a gente teria que descobrir na
     mão. O uid dele vira o "id da gelateria" e fica publicado em
     indice/dono pra que os demais membros achem o caminho certo. */
  function emailAtual() { return String((_user && _user.email) || '').trim().toLowerCase(); }
  function isDono() { return !!DONO_EMAIL && emailAtual() === DONO_EMAIL; }
  function gid() { return _gid; }
  function acesso() { return _acesso; }
  function podeEditar() { return !!_acesso && (_acesso.dono || _acesso.papel === 'editor') && _acesso.status === 'aprovado'; }
  function acessoId(email) { return String(email || '').trim().toLowerCase(); }
  function agora() { const d = new Date(); return d.toISOString().slice(0, 10); }
  function acessoRef(email) { return S.doc(db, 'gelaterias', _gid, 'acessos', acessoId(email)); }

  // Descobre em qual gelateria este login trabalha.
  async function resolverGid() {
    if (isDono()) {
      _gid = _user.uid;
      // publica o ponteiro pra equipe (idempotente)
      try { await S.setDoc(S.doc(db, 'indice', 'dono'), { uid: _user.uid, email: emailAtual() }); }
      catch (e) { console.warn('não consegui publicar indice/dono', e); }
      return _gid;
    }
    try {
      const snap = await S.getDoc(S.doc(db, 'indice', 'dono'));
      _gid = snap.exists() ? (snap.data().uid || null) : null;
    } catch (e) { console.warn('indice/dono', e); _gid = null; }
    return _gid;
  }

  async function meuAcessoDoc() {
    if (!_gid || !_user) return null;
    try {
      const snap = await S.getDoc(acessoRef(emailAtual()));
      return snap.exists() ? snap.data() : null;
    } catch (e) { console.warn('meuAcesso', e); return null; }
  }

  // Cria a solicitação de entrada (sempre 'pendente' — as regras do
  // Firestore não deixam ninguém se auto-aprovar).
  async function pedirAcesso() {
    if (!_gid || !_user) return;
    await S.setDoc(acessoRef(emailAtual()), {
      email: emailAtual(), nome: '', papel: 'leitor',
      status: 'pendente', criadoEm: agora(), origem: 'solicitacao',
    });
  }

  // Só o dono roda: garante o próprio registro + os pré-aprovados do config.js.
  async function semearEquipe() {
    if (!isDono() || !_gid) return;
    try {
      await S.setDoc(acessoRef(emailAtual()), {
        email: emailAtual(), nome: 'Dono', papel: 'editor',
        status: 'aprovado', criadoEm: agora(), origem: 'dono',
      }, { merge: true });
    } catch (e) { console.warn('acesso do dono', e); }
    for (const p of (EQUIPE.preAprovados || [])) {
      const id = acessoId(p.email);
      if (!id) continue;
      try {
        const snap = await S.getDoc(acessoRef(id));
        const at = snap.exists() ? snap.data() : null;
        // não mexe em quem o dono já ajustou/revogou na mão
        if (at && at.origem === 'manual') continue;
        if (at && at.status === 'aprovado' && at.papel === (p.papel || 'leitor')) continue;
        await S.setDoc(acessoRef(id), {
          email: id, nome: p.nome || '', papel: p.papel || 'leitor',
          status: 'aprovado', criadoEm: (at && at.criadoEm) || agora(), origem: 'pre-aprovado',
        });
      } catch (e) { console.warn('pré-aprovado', id, e); }
    }
  }

  /* Chamado logo após o login. Devolve o estado de acesso e deixa o
     _gid pronto pras leituras/escritas de dados. */
  async function prepararAcesso() {
    await resolverGid();
    if (isDono()) {
      await semearEquipe();
      _acesso = { status: 'aprovado', papel: 'editor', dono: true, email: emailAtual() };
      return _acesso;
    }
    if (!_gid) { // dono nunca abriu o app depois da atualização
      _acesso = { status: 'sem-gelateria', papel: null, dono: false, email: emailAtual() };
      return _acesso;
    }
    let a = await meuAcessoDoc();
    if (!a) { try { await pedirAcesso(); } catch (e) { console.warn('pedirAcesso', e); } a = await meuAcessoDoc(); }
    _acesso = {
      status: (a && a.status) || 'pendente',
      papel: (a && a.papel) || 'leitor',
      dono: false, email: emailAtual(),
    };
    return _acesso;
  }

  // ---- gestão da equipe (tela Pessoas — só o dono) ----
  async function listarAcessos() {
    if (!_gid) return [];
    const snap = await S.getDocs(S.collection(db, 'gelaterias', _gid, 'acessos'));
    return snap.docs.map((d) => d.data());
  }
  async function definirAcesso(email, dados) {
    if (!_gid) throw new Error('gelateria não resolvida');
    const id = acessoId(email);
    const snap = await S.getDoc(acessoRef(id));
    const at = snap.exists() ? snap.data() : {};
    await S.setDoc(acessoRef(id), Object.assign({}, at, dados, {
      email: id, origem: 'manual', criadoEm: at.criadoEm || agora(),
    }));
  }
  async function removerAcesso(email) {
    if (!_gid) throw new Error('gelateria não resolvida');
    await S.deleteDoc(acessoRef(email));
  }

  // ---- dados ----
  function col(name) { return S.collection(db, 'gelaterias', _gid, name); }
  function ref(name, id) { return S.doc(db, 'gelaterias', _gid, name, String(id)); }

  async function getAll(name) {
    const snap = await S.getDocs(col(name));
    return snap.docs.map((d) => d.data());
  }
  // igual a getAll, mas guardando o id de cada documento (usado no backup
  // completo — em 'meta' o id é o nome do documento: compras, escala…)
  async function getAllComId(name) {
    const snap = await S.getDocs(col(name));
    return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  }
  async function getDocData(name, id) {
    const snap = await S.getDoc(ref(name, id));
    return snap.exists() ? snap.data() : null;
  }
  function subscribe(name, cb) {
    return S.onSnapshot(col(name), (snap) => cb(snap.docs.map((d) => d.data())),
      (err) => console.warn('sync', name, err));
  }
  async function put(name, id, data) { await S.setDoc(ref(name, id), data); }
  async function del(name, id) { await S.deleteDoc(ref(name, id)); }

  // ---- Auxiliar de produção: documento PÚBLICO (coleção de topo) ----
  // producaoPublico/config = { receitas: { [id]: { visivel, nome } }, atualizadoEm, por }
  // Só nomes e liga/desliga — nenhum insumo, grama ou nota. Leitura pública por desenho.
  async function getProducaoConfig() {
    const snap = await S.getDoc(S.doc(db, 'producaoPublico', 'config'));
    return snap.exists() ? snap.data() : null;
  }
  async function saveProducaoConfig(cfg) {
    if (!isDono()) throw new Error('Só o dono pode alterar o auxiliar de produção.');
    const src = (cfg && cfg.receitas) || {};
    const receitas = {};
    for (const id of Object.keys(src)) {
      const v = src[id] || {};
      if (!id || typeof v.visivel !== 'boolean') continue;
      receitas[id] = { visivel: v.visivel, nome: typeof v.nome === 'string' ? v.nome.trim().slice(0, 60) : '',
                       creme: ['20', '15', 'ambas'].includes(v.creme) ? v.creme : 'ambas',
                       // só nomes curtos já liberados ao auxiliar (o doc é público)
                       ocultos: (Array.isArray(v.ocultos) ? v.ocultos : [])
                         .filter((n) => typeof n === 'string' && Object.values(window.PROD_PERMITIDOS || {}).includes(n)).slice(0, 40) };
    }
    const doc = { receitas, atualizadoEm: new Date().toISOString() };  // sem e-mail: o doc é público
    await S.setDoc(S.doc(db, 'producaoPublico', 'config'), doc);
    return doc;
  }

  // programação semanal do auxiliar: só ids de receita por dia (doc público, sem e-mail)
  const DIAS_AGENDA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
  async function getProducaoAgenda() {
    const snap = await S.getDoc(S.doc(db, 'producaoPublico', 'agenda'));
    return snap.exists() ? snap.data() : null;
  }
  async function saveProducaoAgenda(agenda) {
    if (!isDono()) throw new Error('Só o dono pode alterar a programação do auxiliar.');
    const dias = {};
    for (const d of DIAS_AGENDA) {
      dias[d] = {};
      // receitas: só ids; "insumos": nomes livres (ex.: produção de um insumo), texto curto
      for (const t of ['insumos', 'descongelar', 'calda', 'congelar', 'bater']) {
        const lista = (agenda && agenda[d] && Array.isArray(agenda[d][t])) ? agenda[d][t] : [];
        if (t === 'insumos') {
          const txt = lista.map((x) => String(x == null ? '' : x).replace(/[|\n\r]/g, ' ').trim().slice(0, 50)).filter(Boolean);
          dias[d][t] = txt.filter((x, i) => txt.indexOf(x) === i).slice(0, 20);
        } else {
          dias[d][t] = lista.filter((id, i) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) && lista.indexOf(id) === i).slice(0, 30);
        }
      }
    }
    const doc = { dias, atualizadoEm: new Date().toISOString() };
    await S.setDoc(S.doc(db, 'producaoPublico', 'agenda'), doc);
    return doc;
  }

  // o que o auxiliar marcou como feito: [{ id:'AAAA-MM-DD_aparelho', itens:[chaves], atualizadoEm }]
  async function getProducaoFeitos() {
    if (!isDono()) throw new Error('Só o dono vê o que o auxiliar marcou.');
    const snap = await S.getDocs(S.collection(db, 'producaoFeitos'));
    return snap.docs.map((d) => {
      const v = d.data() || {};
      return { id: d.id, itens: Object.keys(v.itens || {}).filter((k) => v.itens[k] === true), atualizadoEm: v.atualizadoEm || '' };
    });
  }

  // grava muitos docs em lotes (writeBatch, máx 450/lote)
  async function batchSet(items) {
    for (let i = 0; i < items.length; i += 450) {
      const b = S.writeBatch(db);
      for (const it of items.slice(i, i + 450)) b.set(ref(it.coll, it.id), it.data);
      await b.commit();
    }
  }
  async function clearColl(name) {
    const snap = await S.getDocs(col(name));
    for (let i = 0; i < snap.docs.length; i += 450) {
      const b = S.writeBatch(db);
      for (const d of snap.docs.slice(i, i + 450)) b.delete(d.ref);
      await b.commit();
    }
  }

  return { enabled, init, onAuth, currentUser, uid,
           login, signup, logout, resetSenha, authError,
           reenviarVerificacao, recarregarUsuario, getPinApp, setPinApp,
           isDono, gid, acesso, podeEditar, prepararAcesso,
           listarAcessos, definirAcesso, removerAcesso,
           getProducaoConfig, saveProducaoConfig, getProducaoAgenda, saveProducaoAgenda, getProducaoFeitos,
           getAll, getAllComId, getDocData, subscribe, put, del, batchSet, clearColl };
})();
