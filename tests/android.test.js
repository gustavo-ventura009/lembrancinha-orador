// node tests/android.test.js
const assert = require('assert');
require('../js/datas.js'); require('../js/grupos.js'); require('../js/selecao.js'); require('../js/android.js');
const { datas: D, grupos: G, selecao: S, android: A } = globalThis.LOD;
const agora = Date.parse('2026-11-01T21:00:00Z'); // domingo 01/11 18:00 em São Paulo
D.setNow(() => new Date(agora));
const novo = () => G.estadoInicial();
let st = novo();
let ok = 0; const t = (n, f) => { f(); ok++; console.log('✔', n); };
const principais = (l, sab) => l.filter((x) => x.sab === sab && !x.reforco);

t('sábado sem família: 5 horários x 4 dias (qua-sáb), primeiro na quarta 04/11 às 08h de Brasília', () => {
  const l = principais(A.agenda(st, agora, '2026-11-01'), '2026-11-07');
  assert.strictEqual(l.length, 20);
  assert.strictEqual(l[0].quando.toISOString(), '2026-11-04T11:00:00.000Z');
  assert.strictEqual(l[19].quando.toISOString(), '2026-11-07T23:00:00.000Z');
});
t('reforço: por padrão 2 repetições, +3 e +6 minutos depois de cada horário, só na semana que está valendo', () => {
  assert.strictEqual(A.reforcoVezes(st), 2);
  const l = A.agenda(st, agora, '2026-11-01');
  const ref = l.filter((x) => x.sab === '2026-11-07' && x.reforco);
  assert.strictEqual(ref.length, 40);
  const mudos = l.filter((x) => x.quando.toISOString() === '2026-11-04T11:03:00.000Z' || x.quando.toISOString() === '2026-11-04T11:06:00.000Z');
  assert.deepStrictEqual(mudos.map((x) => x.reforco), [1, 2]);
  assert.ok(l.filter((x) => x.sab !== '2026-11-07').every((x) => x.reforco === 0), 'semanas seguintes não têm reforço');
});
t('reforço configurável (0 desliga) e valores inválidos voltam ao padrão', () => {
  const s2 = novo(); s2.settings.reforcoVezes = 0;
  assert.ok(A.agenda(s2, agora, '2026-11-01').every((x) => x.reforco === 0));
  s2.settings.reforcoVezes = 4;
  assert.strictEqual(A.agenda(s2, agora, '2026-11-01').filter((x) => x.sab === '2026-11-07' && x.reforco).length, 80);
  s2.settings.reforcoVezes = 99; assert.strictEqual(A.reforcoVezes(s2), 2);
});
t('ids únicos, inteiros de 32 bits e abaixo do faixa reservada ao teste; lista ordenada por horário', () => {
  const l = A.agenda(st, agora, '2026-11-01');
  assert.strictEqual(new Set(l.map((x) => x.id)).size, l.length);
  assert.ok(l.every((x) => Number.isInteger(x.id) && x.id < 900000000));
  for (let i = 1; i < l.length; i++) assert.ok(l[i - 1].quando <= l[i].quando);
});
t('muitos horários: abre mão dos reforços para ficar abaixo do limite de alarmes do Android', () => {
  const s3 = novo(); s3.settings.lembreteHoras = Array.from({ length: 24 }, (_, i) => i);
  const l = A.agenda(s3, agora, '2026-11-01');
  assert.ok(l.length <= 400); assert.ok(l.every((x) => x.reforco === 0));
});
t('confirmar a família do sábado remove todas as notificações dele (inclusive reforços)', () => {
  const fam = st.families[0];
  S.confirmar(st, fam.id, '2026-11-07', new Date().toISOString());
  const l = A.agenda(st, agora, '2026-11-01');
  assert.ok(!l.some((x) => x.sab === '2026-11-07'));
  assert.ok(l.some((x) => x.sab === '2026-11-14'));
});
t('sábado sem reunião não agenda; nada no passado', () => {
  S.marcarSemReuniao ? S.marcarSemReuniao(st, '2026-11-14') : st.semReuniao.push('2026-11-14');
  const l = A.agenda(st, agora, '2026-11-01');
  assert.ok(!l.some((x) => x.sab === '2026-11-14'));
  assert.ok(l.every((x) => x.quando.getTime() > agora));
});
t('nome do grupo só na primeira semana pendente', () => {
  const l = A.agenda(novo(), agora, '2026-11-01');
  assert.ok(l.filter((x) => x.sab === '2026-11-07').every((x) => x.grupo));
  assert.ok(l.filter((x) => x.sab !== '2026-11-07').every((x) => x.grupo === null));
});

// ---- script de build: cria o canal de alerta nativo e para com erro claro se não achar o MainActivity
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
function montarProjetoFalso(comMain) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-android-'));
  fs.cpSync(path.join(__dirname, '..', 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  fs.cpSync(path.join(__dirname, '..', 'icone'), path.join(dir, 'icone'), { recursive: true });
  const main = path.join(dir, 'android', 'app', 'src', 'main');
  fs.mkdirSync(path.join(main, 'res'), { recursive: true });
  fs.writeFileSync(path.join(main, 'AndroidManifest.xml'), '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n</manifest>\n');
  if (comMain) {
    fs.mkdirSync(path.join(main, 'java', 'br', 'com', 'lembrancinha', 'orador'), { recursive: true });
    fs.writeFileSync(path.join(main, 'java', 'br', 'com', 'lembrancinha', 'orador', 'MainActivity.java'), 'package br.com.lembrancinha.orador;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n');
  }
  return dir;
}
const rodar = (dir) => cp.spawnSync(process.execPath, [path.join(dir, 'scripts', 'ajustar-android.js')], { encoding: 'utf8' });
t('ajustar-android: grava MainActivity com canal v3, vibração longa, mesmo package, sem FLAG_INSISTENT', () => {
  const dir = montarProjetoFalso(true);
  const r = rodar(dir); assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  const j = fs.readFileSync(path.join(dir, 'android/app/src/main/java/br/com/lembrancinha/orador/MainActivity.java'), 'utf8');
  assert.ok(j.startsWith('package br.com.lembrancinha.orador;'));
  assert.ok(j.includes('"lembretes-orador-v3"') && j.includes('setVibrationPattern') && j.includes('IMPORTANCE_HIGH') && j.includes('extends BridgeActivity'));
  assert.ok(!j.includes('FLAG_INSISTENT'));
  assert.ok(fs.readFileSync(path.join(dir, 'android/app/src/main/AndroidManifest.xml'), 'utf8').includes('android.permission.VIBRATE'));
  fs.rmSync(dir, { recursive: true, force: true });
});
t('ajustar-android: sem MainActivity o build falha com mensagem clara (nunca gera APK fraco em silêncio)', () => {
  const dir = montarProjetoFalso(false);
  const r = rodar(dir); assert.notStrictEqual(r.status, 0);
  assert.ok(/MainActivity\.java não encontrado/.test(r.stderr));
  fs.rmSync(dir, { recursive: true, force: true });
});
t('canal do JS e do Java usam o mesmo id', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'android.js'), 'utf8');
  const sh = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'ajustar-android.js'), 'utf8');
  assert.ok(js.includes("const CANAL = 'lembretes-orador-v3'") && sh.includes('"lembretes-orador-v3"'));
});
console.log(`\n${ok} testes passaram.`);
