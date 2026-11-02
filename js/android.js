/* Ponte com o app Android (Capacitor): agenda notificações NATIVAS, que tocam com o app fechado.
   Regras: de quarta a sábado, nas horas configuradas, para cada sábado ainda SEM família confirmada.
   Confirmar a família do sábado cancela as notificações dele. Abrir o app ou tocar na notificação não cancela nada.

   Alerta: o canal "lembretes-orador-v3" é criado NATIVAMENTE em MainActivity.java (scripts/ajustar-android.js) com uma
   vibração longa (~1 min) e importância alta. Além disso, cada horário ganha um "reforço": o mesmo aviso se repete a cada
   3 minutos (2 vezes por padrão) para o celular não passar despercebido. Confirmar a família cancela os reforços também. */
(function (root) {
  const LOD = (root.LOD = root.LOD || {});
  const D = () => LOD.datas, ST = () => LOD.store, S = () => LOD.selecao, G = () => LOD.grupos;
  const CANAL = 'lembretes-orador-v3';   // canal novo: o Android não deixa alterar um canal já criado
  const CANAIS_ANTIGOS = ['lembretes-orador', 'lembretes-orador-v2'];
  const SEMANAS = 6;        // quantos sábados à frente ficam agendados (reagenda a cada abertura do app)
  const UTC_MENOS_3 = 3;    // America/Sao_Paulo é UTC-3 o ano todo (sem horário de verão desde 2019)
  const REFORCO_MIN = 3;    // minutos entre o aviso e cada reforço
  const REFORCO_PADRAO = 2; // reforços por horário (0 = desligado)
  const LIMITE = 400;       // o Android aceita ~500 alarmes por app; ficamos abaixo
  const ID_TESTE = 900000000;

  function reforcoVezes(state) {
    const v = state.settings && state.settings.reforcoVezes;
    return Number.isInteger(v) && v >= 0 && v <= 4 ? v : REFORCO_PADRAO;
  }

  /** Lista pura e testável das notificações a agendar.
      Retorna [{id, quando(Date), sab, grupo, reforco}] ordenada por horário; reforco 0 = aviso principal, 1..N = repetições. */
  function agenda(state, agoraMs, hojeIso) {
    const horas = [...new Set(state.settings.lembreteHoras)].sort((a, b) => a - b);
    const montar = (vezes) => {
      const out = [];
      let sab = D().proximoSabado(hojeIso), primeira = true;
      for (let i = 0; i < SEMANAS; i++, sab = D().addDias(sab, 7)) {
        if (S().entregaDoSabado(state, sab) || S().semReuniao(state, sab)) continue;
        const grupo = primeira ? S().grupoDaSemana(state, sab).name : null;   // semanas seguintes: só a data
        const comReforco = primeira;                                           // reforço só na semana que está valendo
        primeira = false;
        for (let k = 3; k >= 0; k--) {               // quarta, quinta, sexta, sábado
          const dia = D().addDias(sab, -k);
          const [y, m, d] = dia.split('-').map(Number);
          horas.forEach((h) => {
            const base = (((y % 100) * 100 + m) * 100 + d) * 100 + h;   // AAMMDDHH (8 dígitos)
            for (let r = 0; r <= (comReforco ? vezes : 0); r++) {
              const quando = new Date(Date.UTC(y, m - 1, d, h + UTC_MENOS_3, r * REFORCO_MIN, 0));
              if (quando.getTime() <= agoraMs) continue;
              out.push({ id: base * 10 + r, quando, sab, grupo, reforco: r });
            }
          });
        }
      }
      return out.sort((a, b) => a.quando - b.quando || a.id - b.id);
    };
    let lista = montar(reforcoVezes(state));
    if (lista.length > LIMITE) lista = montar(0);            // muitos horários: abre mão dos reforços
    return lista.length > LIMITE ? lista.slice(0, LIMITE) : lista;
  }

  const LN = () => root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.LocalNotifications;
  const nativo = () => !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform() && LN());
  let ocupado = false, repetir = false;

  async function garantirPermissao(ln) {
    let perm = await ln.checkPermissions();
    if (perm.display !== 'granted') perm = await ln.requestPermissions();   // Android 13: POST_NOTIFICATIONS
    return perm.display === 'granted';
  }
  /** O canal já nasce nativo (MainActivity). Isto é só uma garantia: se ele existir, o Android ignora a recriação. */
  async function garantirCanal(ln) {
    for (const c of CANAIS_ANTIGOS) { try { await ln.deleteChannel({ id: c }); } catch (e) {} }
    try { await ln.createChannel({ id: CANAL, name: 'Lembretes da lembrancinha', description: 'Escolher quem entrega a lembrancinha do orador', importance: 5, visibility: 1, vibration: true, lights: true }); } catch (e) {}
  }
  /** Tira da barra as notificações antigas já entregues (quem abre o app já viu); não mexe nas agendadas. */
  async function limparEntregues(ln) {
    try { await ln.removeAllDeliveredNotifications(); } catch (e) {}
  }

  async function sincronizar() {
    if (!nativo()) return;
    if (ocupado) { repetir = true; return; }
    ocupado = true;
    try {
      const ln = LN();
      if (!(await garantirPermissao(ln))) return;
      await garantirCanal(ln);
      const pend = await ln.getPending();
      const cancelar = (pend.notifications || []).filter((n) => n.id < ID_TESTE);   // preserva um teste em andamento
      if (cancelar.length) await ln.cancel({ notifications: cancelar.map((n) => ({ id: n.id })) });
      const lista = agenda(ST().state, Date.now(), D().hoje());
      if (lista.length) await ln.schedule({
        notifications: lista.map((n) => ({
          id: n.id, channelId: CANAL,
          title: n.reforco ? 'Lembrancinha do orador — ainda pendente' : 'Lembrancinha do orador',
          body: `Ainda não há família confirmada para o sábado ${D().br(n.sab)}.` + (n.grupo ? ` Vez do ${G().rotulo(n.grupo)}.` : ''),
          autoCancel: false,   // tocar nela não a remove: só sai quando você arrasta para o lado
          smallIcon: 'ic_stat_lembrancinha', schedule: { at: n.quando, allowWhileIdle: true }, extra: { sab: n.sab }
        }))
      });
      if (!document.hidden) await limparEntregues(ln);
    } catch (e) { console.warn('Notificações nativas:', e); }
    finally { ocupado = false; if (repetir) { repetir = false; sincronizar(); } }
  }

  /** Teste: dispara em 5 s o MESMO tipo de alerta dos lembretes (canal e vibração iguais).
      Cada teste usa um id novo e limpa os anteriores, para o Android nunca tratá-lo como "atualização" silenciosa. */
  async function testar() {
    const ln = LN();
    if (!(await garantirPermissao(ln))) throw new Error('Notificações bloqueadas: ative em Configurações do Android → Apps → Lembrancinha do Orador → Notificações.');
    await garantirCanal(ln);
    await limparEntregues(ln);
    try {
      const pend = await ln.getPending();
      const antigos = (pend.notifications || []).filter((n) => n.id >= ID_TESTE);
      if (antigos.length) await ln.cancel({ notifications: antigos.map((n) => ({ id: n.id })) });
    } catch (e) {}
    const id = ID_TESTE + (Date.now() % 90000000);
    await ln.schedule({ notifications: [{ id, channelId: CANAL, title: 'Lembrancinha do orador — teste', body: 'Teste: a vibração deve durar cerca de 1 minuto (ou até você abrir a notificação).', autoCancel: false, smallIcon: 'ic_stat_lembrancinha', schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true } }] });
  }

  /** Lê o canal como o Android o enxerga hoje (o usuário pode ter mexido nele) e avisa se estiver silencioso. */
  async function diagnosticoCanal() {
    try {
      const r = await LN().listChannels();
      const c = (r.channels || []).find((x) => x.id === CANAL);
      if (!c) return { ok: false, msg: 'O canal de lembretes ainda não existe. Toque em “Reagendar agora”.' };
      const problemas = [];
      if (c.importance < 4) problemas.push('a importância do canal está baixa (o Android toca em silêncio)');
      if (c.vibration === false) problemas.push('a vibração do canal está desligada');
      if (c.sound === '' || c.sound === null) problemas.push('o canal está sem som');
      return problemas.length ? { ok: false, msg: 'Atenção: ' + problemas.join('; ') + '. Segure uma notificação do app → Configurações → “Lembretes da lembrancinha” → ligue Alerta/Som e Vibração.' } : { ok: true };
    } catch (e) { return { ok: true }; }   // versão do plugin sem listChannels: não bloqueia nada
  }

  /** Texto de situação para a tela de Configurações. */
  async function resumo() {
    const ln = LN();
    const perm = (await ln.checkPermissions()).display;
    const lista = agenda(ST().state, Date.now(), D().hoje());
    const permTxt = perm === 'granted' ? 'permitidas' : 'BLOQUEADAS (ative nas configurações do Android)';
    const principais = lista.filter((n) => !n.reforco).length;
    const prox = lista.length ? `${principais} lembretes agendados (${lista.length - principais} reforços); o próximo é ${LOD.ui.dataHora(lista[0].quando.toISOString())}.` : 'Nenhum lembrete pendente (todos os próximos sábados já têm família ou não têm reunião).';
    const diag = await diagnosticoCanal();
    return `Notificações do Android: <strong>${permTxt}</strong>. ${prox}` + (diag.ok ? '' : `<br><strong style="color:var(--vermelho)">${diag.msg}</strong>`);
  }

  function iniciar() {
    if (!nativo()) return;
    sincronizar();
    ST().aoMudar(sincronizar);   // confirmar/desfazer/marcar sem reunião reagenda (e cancela) na hora
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });
    LN().addListener('localNotificationActionPerformed', (ev) => {
      const sab = ev && ev.notification && ev.notification.extra && ev.notification.extra.sab;
      if (LOD.app && LOD.app.abrirSugestao) LOD.app.abrirSugestao(sab);   // só abre a tela; não cancela nada
    });
  }

  LOD.android = { agenda, sincronizar, iniciar, testar, resumo, nativo, reforcoVezes };
  if (typeof module !== 'undefined') module.exports = LOD.android;
})(typeof window !== 'undefined' ? window : globalThis);
