// node tests/android.test.js
const assert = require('assert');
require('../js/datas.js'); require('../js/grupos.js'); require('../js/selecao.js'); require('../js/android.js');
const { datas: D, grupos: G, selecao: S, android: A } = globalThis.LOD;
const agora = Date.parse('2026-11-01T21:00:00Z'); // domingo 01/11 18:00 em São Paulo
D.setNow(() => new Date(agora));
const st = G.estadoInicial();
let ok = 0; const t = (n, f) => { f(); ok++; console.log('✔', n); };

t('sábado sem família: 5 horários x 4 dias (qua-sáb), primeiro na quarta 04/11 às 08h de Brasília', () => {
  const l = A.agenda(st, agora, '2026-11-01').filter((x) => x.sab === '2026-11-07');
  assert.strictEqual(l.length, 20);
  assert.strictEqual(l[0].quando.toISOString(), '2026-11-04T11:00:00.000Z');
  assert.strictEqual(l[19].quando.toISOString(), '2026-11-07T23:00:00.000Z');
});
t('aceita horários com minutos e agenda no minuto exato', () => {
  const st2 = G.estadoInicial();
  st2.settings.lembreteHoras = ['08:15', '14:45'];
  const l = A.agenda(st2, agora, '2026-11-01').filter((x) => x.sab === '2026-11-07');
  assert.strictEqual(l.length, 8);
  assert.strictEqual(l[0].quando.toISOString(), '2026-11-04T11:15:00.000Z');
  assert.strictEqual(l[1].quando.toISOString(), '2026-11-04T17:45:00.000Z');
  assert.strictEqual(new Set(l.map((x) => x.id)).size, l.length);
});
t('confirmar a família do sábado remove só as notificações dele', () => {
  const fam = st.families[0];
  S.confirmar(st, fam.id, '2026-11-07', new Date().toISOString());
  const l = A.agenda(st, agora, '2026-11-01');
  assert.ok(!l.some((x) => x.sab === '2026-11-07'));
  assert.ok(l.some((x) => x.sab === '2026-11-14'));
});
t('sábado sem reunião não agenda; ids únicos; nada no passado', () => {
  S.marcarSemReuniao ? S.marcarSemReuniao(st, '2026-11-14') : st.semReuniao.push('2026-11-14');
  const l = A.agenda(st, agora, '2026-11-01');
  assert.ok(!l.some((x) => x.sab === '2026-11-14'));
  assert.strictEqual(new Set(l.map((x) => x.id)).size, l.length);
  assert.ok(l.every((x) => x.quando.getTime() > agora));
});
t('nome do grupo só na primeira semana pendente', () => {
  const st2 = G.estadoInicial();
  const l = A.agenda(st2, agora, '2026-11-01');
  assert.ok(l.filter((x) => x.sab === '2026-11-07').every((x) => x.grupo));
  assert.ok(l.filter((x) => x.sab !== '2026-11-07').every((x) => x.grupo === null));
});

const fs = require('fs'), os = require('os'), path = require('path');

t('script ajustar-android: permissões, serviço, receptor e código nativo entram no projeto Android', () => {
  const { ajustar, PERMISSOES } = require('../scripts/ajustar-android.js');
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-'));
  fs.cpSync(path.join(__dirname, '..', 'android-nativo'), path.join(raiz, 'android-nativo'), { recursive: true });
  fs.cpSync(path.join(__dirname, '..', 'icone'), path.join(raiz, 'icone'), { recursive: true });
  const main = path.join(raiz, 'android', 'app', 'src', 'main');
  fs.mkdirSync(path.join(main, 'res'), { recursive: true });
  fs.writeFileSync(path.join(main, 'AndroidManifest.xml'), '<?xml version="1.0"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application>\n        <activity android:name=".MainActivity" />\n    </application>\n    <uses-permission android:name="android.permission.INTERNET" />\n</manifest>\n');
  ajustar(raiz); ajustar(raiz);   // rodar duas vezes não duplica nada
  const x = fs.readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8');
  for (const p of PERMISSOES) assert.strictEqual(x.split(`android.permission.${p}"`).length - 1, 1, p);
  for (const p of ['FOREGROUND_SERVICE_SPECIAL_USE', 'USE_FULL_SCREEN_INTENT', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', 'USE_EXACT_ALARM']) assert.ok(x.includes(p), p);
  assert.strictEqual(x.split('.AlarmeService').length - 1, 1);
  assert.ok(x.includes('foregroundServiceType="specialUse"') && x.includes('.AlarmeReceiver') && x.includes('BOOT_COMPLETED'));
  const pkg = path.join(main, 'java', 'br', 'com', 'lembrancinha', 'orador');
  for (const a of ['AlarmePlugin', 'AlarmeService', 'AlarmeReceiver', 'AlarmeStore', 'MainActivity']) assert.ok(fs.existsSync(path.join(pkg, a + '.java')), a);
  assert.ok(fs.readFileSync(path.join(pkg, 'MainActivity.java'), 'utf8').includes('registerPlugin(AlarmePlugin.class)'));
});

t('o serviço repete vibração para sempre (repeat 0) e não usa som/vibração do canal', () => {
  const j = fs.readFileSync(path.join(__dirname, '..', 'android-nativo', 'AlarmeService.java'), 'utf8');
  assert.ok(/createWaveform\(PADRAO, 0\)/.test(j) && /setLooping\(true\)/.test(j));
  assert.ok(/setDeleteIntent/.test(j) && /ACAO_PARAR/.test(j));   // arrastar a notificação = parar
});

(async () => {
  const chamadas = { agendar: [], parar: 0, cancel: 0 };
  let tocando = { tocando: true, sab: '2026-11-07' };
  globalThis.Capacitor = { isNativePlatform: () => true, Plugins: {
    LocalNotifications: { checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }), deleteChannel: async () => {},
      getPending: async () => ({ notifications: [{ id: 1 }] }), cancel: async () => { chamadas.cancel++; } },
    Alarme: { agendar: async (a) => { chamadas.agendar.push(a); }, status: async () => tocando, parar: async () => { chamadas.parar++; tocando = { tocando: false, sab: '' }; } } } };
  const stNovo = G.estadoInicial();
  globalThis.LOD.store = { state: stNovo, aoMudar() {} };
  globalThis.LOD.ui = { dataHora: (x) => x };
  const realNow = Date.now; Date.now = () => agora;
  try {
    await A.sincronizar();
    assert.strictEqual(chamadas.agendar.length, 1);
    const a = chamadas.agendar[0];
    assert.deepStrictEqual([a.som, a.vibrar, a.limiteMin], [true, true, 0]);   // padrão: tudo ligado, até fechar
    assert.ok(a.alarmes.length > 20 && a.alarmes.every((x) => typeof x.quando === 'number' && x.quando > agora && x.sab && x.corpo));
    assert.strictEqual(chamadas.cancel, 1);          // limpa notificações antigas do plugin
    assert.strictEqual(chamadas.parar, 0);           // sábado ainda pendente: não para o que toca
    stNovo.settings.alarme = { som: false, vibrar: true, limiteMin: 15 };
    S.confirmar(stNovo, stNovo.families[0].id, '2026-11-07', new Date().toISOString());
    await A.sincronizar();
    assert.strictEqual(chamadas.parar, 1);           // família confirmada: para o alarme que tocava
    const b = chamadas.agendar[1];
    assert.deepStrictEqual([b.som, b.vibrar, b.limiteMin], [false, true, 15]);
    assert.ok(!b.alarmes.some((x) => x.sab === '2026-11-07'));
    ok += 2; console.log('✔ sincronizar envia alarmes ao plugin nativo com as opções e para o alarme do sábado resolvido');
    console.log('✔ opções padrão e limites'); A.opcoes(G.estadoInicial()); ok++;
  } finally { Date.now = realNow; }
  console.log(`\n${ok} testes passaram.`);
})().catch((e) => { console.error(e); process.exit(1); });
