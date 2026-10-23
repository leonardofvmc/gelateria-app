/* ============================================================
   CONFIGURAÇÃO DA NUVEM (sincronização entre aparelhos)
   ------------------------------------------------------------
   • DEIXE COMO ESTÁ (null)  → o app funciona SÓ neste aparelho
     (dados no próprio celular). Nada de nuvem, nada de login.

   • PARA SINCRONIZAR entre celulares/computadores, cole aqui as
     credenciais do seu projeto Firebase (grátis). Passo a passo
     completo no arquivo LEIA-ME.md, seção "Sincronizar entre
     aparelhos". Depois de colar, o app pede um login e passa a
     salvar tudo na nuvem, atualizando em todos os aparelhos.

   Exemplo de como fica quando preenchido:

   window.FIREBASE_CONFIG = {
     apiKey: "AIza............",
     authDomain: "gelateria-xxxx.firebaseapp.com",
     projectId: "gelateria-xxxx",
     storageBucket: "gelateria-xxxx.appspot.com",
     messagingSenderId: "000000000000",
     appId: "1:000000000000:web:xxxxxxxxxxxx"
   };
   ============================================================ */

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDUgLdOsrovpbybf2dIn0-nvhw9K8Xx55k",
  authDomain: "gelateria-la-maddalena.firebaseapp.com",
  projectId: "gelateria-la-maddalena",
  storageBucket: "gelateria-la-maddalena.firebasestorage.app",
  messagingSenderId: "904507812778",
  appId: "1:904507812778:web:1b3148c63a9697495f19d3"
};

/* ============================================================
   EQUIPE — quem pode usar o app
   ------------------------------------------------------------
   • donoEmail: a conta DONA da gelateria. É quem enxerga a aba
     "Pessoas", aprova solicitações e manda nas receitas. Todos
     os dados do app moram debaixo desta conta — os outros
     usuários leem/escrevem no MESMO lugar, não numa cópia.

   • preAprovados: e-mails que já entram liberados, sem precisar
     de aprovação manual. Serve pra deixar alguém pronto antes
     mesmo de a pessoa criar a conta.
       papel: 'editor' → mexe em tudo (igual ao dono)
              'leitor' → só consulta, não altera nada

   Quem NÃO estiver aqui e criar conta entra como "pendente" e
   aparece pra você aprovar na aba Pessoas.
   ============================================================ */
window.GELATERIA = {
  donoEmail: "leonardofvmc@gmail.com",
  preAprovados: []
};
