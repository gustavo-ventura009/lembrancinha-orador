/* Ponte com o app Android (Capacitor): agenda alarmes NATIVOS (plugin "Alarme"), que tocam e vibram EM LOOP, com o app fechado,
   até você arrastar a notificação ou tocar em "Parar". Não dependem do canal de notificação (que o Android corta em ~1 min).
   Regras: de quarta a sábado, nas horas configuradas, para cada sábado ainda SEM família confirmada.
   Confirmar a família do sábado cancela os alarmes dele (e para o que estiver tocando). Abrir o app não cancela nada. */
(function (root) {
  const LOD = (root.LOD = root.LOD || {});
  const D = () => LOD.datas, ST = () => LOD.store, S = () => LOD.selecao, G = () => LOD.grupos;
    const CANAIS_ANTIGOS = ['lembretes-orador', 'lembretes-orador-v2', 'lembretes-orador-v3', 'lembretes-orador-v4'];   // canais da versão anterior (removidos)
  const SEMANAS = 6;        // quantos sábados à frente ficam agendados (reagenda a cada abertura do app)
  const UTC_MENOS_3 = 3;    // America/Sao_Paulo é UTC-3 o ano todo (sem horário de verão desde 2019)

  /** Lista pura e testável das notificações a agendar. Retorna [{id, quando(Date), sab, grupo}]. */
  function agenda(state, agoraMs, hojeIso) {
    const horarios = [...new Set(state.settings.lembreteHoras.map((h) => G().horarioTexto(h)))].sort((a, b) => G().minutosDoHorario(a) - G().minutosDoHorario(b));
    const out = [];
    let sab = D().proximoSabado(hojeIso), primeira = true;
    for (let i = 0; i < SEMANAS; i++, sab = D().addDias(sab, 7)) {
      if (S().entregaDoSabado(state, sab) || S().semReuniao(state, sab)) continue;
      const grupo = primeira ? S().grupoDaSemana(state, sab).name : null;   // semanas seguintes: só a data
      primeira = false;
      for (let k = 3; k >= 0; k--) {               // quarta, quinta, sexta, sábado
        const dia = D().addDias(sab, -k);
        const [y, m, d] = dia.split('-').map(Number);
        horarios.forEach((horario) => {
          const [h, min] = horario.split(':').map(Number);
          const quando = new Date(Date.UTC(y, m - 1, d, h + UTC_MENOS_3, min, 0));
          if (quando.getTime() <= agoraMs) return;
          const minutoDoDia = h * 60 + min;
          out.push({ id: (((((y % 100) * 100 + m) * 100 + d) * 1440) + minutoDoDia), quando, sab, grupo });
        });
      }
    }
    return out;
  }

  const LN = () => root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.LocalNotifications;
  const AL = () => root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.Alarme;   // plugin nativo próprio (android-nativo/)
  const nativo = () => !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform() && LN() && AL());
  const LIMITES = [[0, 'Até eu fechar a notificação'], [5, 'Por 5 minutos'], [15, 'Por 15 minutos'], [30, 'Por 30 minutos'], [60, 'Por 1 hora']];
  /** Opções de som/vibração/duração, guardadas nas configurações (valores padrão: tudo ligado, até fechar). */
  function opcoes(state) {
    const a = (state.settings && state.settings.alarme) || {};
    return { som: a.som !== false, vibrar: a.vibrar !== false, limiteMin: Number.isFinite(a.limiteMin) && a.limiteMin >= 0 ? a.limiteMin : 0 };
  }
  let ocupado = false, repetir = false;

  /** Para o alarme que estiver tocando se o sábado dele já foi resolvido (família confirmada ou sem reunião). */
  async function pararSeResolvido(al) {
    try {
      const st = await al.status();
      if (st.tocando && st.sab && (S().entregaDoSabado(ST().state, st.sab) || S().semReuniao(ST().state, st.sab))) await al.parar();
    } catch (e) { console.warn('Parar alarme resolvido:', e); }
  }

  async function sincronizar() {
    if (!nativo()) return;
    if (ocupado) { repetir = true; return; }
    ocupado = true;
    try {
      const ln = LN(), al = AL();
      let perm = await ln.checkPermissions();
      if (perm.display !== 'granted') perm = await ln.requestPermissions();   // Android 13+: POST_NOTIFICATIONS (sem ela a notificação do alarme fica escondida)
      // Limpeza da versão anterior: notificações agendadas pelo plugin e canais antigos
      for (const id of CANAIS_ANTIGOS) { try { await ln.deleteChannel({ id }); } catch (e) {} }
      try {
        const pend = await ln.getPending();
        if (pend.notifications && pend.notifications.length) await ln.cancel({ notifications: pend.notifications.map((n) => ({ id: n.id })) });
      } catch (e) {}
      await pararSeResolvido(al);
      const lista = agenda(ST().state, Date.now(), D().hoje());
      await al.agendar({
        ...opcoes(ST().state),
        alarmes: lista.map((n) => ({
          id: n.id, quando: n.quando.getTime(), sab: n.sab, titulo: 'Lembrancinha do orador',
          corpo: `Ainda não há família confirmada para o sábado ${D().br(n.sab)}.` + (n.grupo ? ` Vez do ${G().rotulo(n.grupo)}.` : '')
        }))
      });
    } catch (e) { console.warn('Alarmes nativos:', e); }
    finally { ocupado = false; if (repetir) { repetir = false; sincronizar(); } }
  }

  /** Teste: dispara um alarme real em 5 segundos (saia do app e bloqueie a tela para testar de verdade). */
  async function testar() {
    const ln = LN(), al = AL();
    let perm = await ln.checkPermissions();
    if (perm.display !== 'granted') perm = await ln.requestPermissions();
    if (perm.display !== 'granted') throw new Error('Notificações bloqueadas: ative em Configurações do Android → Apps → Lembrancinha do Orador → Notificações.');
    await al.configurar(opcoes(ST().state));
    await al.testar({ segundos: 5 });
  }

  const sim = (v) => (v ? '✅' : '❌');

  /** Situação de tudo que o Android precisa liberar, como ele está aplicando agora. Retorna HTML. */
  async function resumo() {
    const al = AL();
    const st = await al.status();
    const lista = agenda(ST().state, Date.now(), D().hoje());
    const prox = lista.length ? `${lista.length} lembretes agendados; o próximo é ${LOD.ui.dataHora(lista[0].quando.toISOString())}.` : 'Nenhum lembrete pendente (todos os próximos sábados já têm família ou não têm reunião).';
    const linhas = [
      prox,
      st.tocando ? '🔔 <strong>Alarme tocando agora.</strong>' : '',
      `${sim(st.notificacoes)} Notificações do app: <strong>${st.notificacoes ? 'permitidas' : 'BLOQUEADAS'}</strong>`,
      `${sim(st.bateriaLivre)} Bateria: <strong>${st.bateriaLivre ? 'sem restrição' : 'OTIMIZADA — o Android pode segurar os lembretes'}</strong>`,
      `${sim(st.exato)} Alarmes exatos: <strong>${st.exato ? 'permitidos' : 'NÃO permitidos (vai usar o modo despertador)'}</strong>`,
      `${sim(st.telaCheia)} Acender a tela bloqueada: <strong>${st.telaCheia ? 'permitido' : 'NÃO permitido'}</strong>`
    ].filter(Boolean);
    return linhas.join('<br>');
  }

  /** Abre a tela do Android certa: 'bateria' | 'exatos' | 'telaCheia' | 'notificacoes' | 'app'. */
  async function abrirAjuste(tipo) { await AL().abrir({ tipo }); }
  async function parar() { await AL().parar(); }
  async function status() { return AL().status(); }

  function iniciar() {
    if (!nativo()) return;
    sincronizar();
    ST().aoMudar(sincronizar);   // confirmar/desfazer/marcar sem reunião reagenda (e cancela) na hora
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });
    ST().aoMudar(() => pararSeResolvido(AL()));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) mostrarFaixa(); });
    setInterval(mostrarFaixa, 3000);
    mostrarFaixa();
  }

  /** Faixa fixa no topo enquanto o alarme toca, com botão para parar (o app aberto não cancela o alarme sozinho). */
  async function mostrarFaixa() {
    try {
      const st = await status();
      let f = document.getElementById('faixa-alarme');
      if (!st.tocando) { if (f) f.remove(); return; }
      if (!f) {
        f = document.createElement('div'); f.id = 'faixa-alarme';
        f.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#b3261e;color:#fff;padding:12px 14px;display:flex;gap:12px;align-items:center;justify-content:space-between;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.4)';
        f.innerHTML = '<span>🔔 Lembrete tocando</span><button type="button" style="background:#fff;color:#b3261e;border:0;border-radius:8px;padding:8px 16px;font-weight:700">PARAR</button>';
        f.querySelector('button').onclick = async () => { await parar(); f.remove(); };
        document.body.appendChild(f);
      }
    } catch (e) { /* app fora do Android ou plugin indisponível */ }
  }

  LOD.android = { agenda, sincronizar, iniciar, testar, resumo, abrirAjuste, parar, status, opcoes, LIMITES, nativo };
  if (typeof module !== 'undefined') module.exports = LOD.android;
})(typeof window !== 'undefined' ? window : globalThis);
