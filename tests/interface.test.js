// node tests/interface.test.js — usa um DOM falso mínimo (sem navegador)
const assert = require('assert');
require('../js/datas.js'); require('../js/grupos.js'); require('../js/selecao.js'); require('../js/notificacoes.js');
globalThis.LOD.store = { state: globalThis.LOD.grupos.estadoInicial() };
globalThis.LOD.ui = { esc: (s) => String(s), statusEntrega: () => ({ classe: '', texto: '' }), modal() {} };
require('../js/historico.js');
let ok = 0; const t = (n, f) => { f(); ok++; console.log('✔', n); };

t('Histórico não acumula ouvintes de clique no #view a cada renderização', () => {
  let adicionados = 0;
  const campo = { addEventListener() {}, focus() {}, setSelectionRange() {}, value: '' };
  const cont = { innerHTML: '', onclick: null, addEventListener() { adicionados++; }, querySelector: () => campo };
  for (let i = 0; i < 5; i++) globalThis.LOD.historico.render(cont);
  assert.strictEqual(adicionados, 0);            // nenhum addEventListener no #view
  assert.strictEqual(typeof cont.onclick, 'function'); // um único ouvinte, substituído a cada render
});

t('tema: escolher claro/escuro grava a preferência e muda o atributo; auto segue o sistema', () => {
  const attrs = {}; const store = {};
  globalThis.window = undefined;
  const root = globalThis;
  root.document = { documentElement: { setAttribute: (k, v) => (attrs[k] = v) }, querySelector: () => ({ setAttribute() {} }) };
  root.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => (store[k] = v) };
  root.matchMedia = () => ({ matches: true, addEventListener() {} });
  delete require.cache[require.resolve('../js/tema.js')];
  const T = require('../js/tema.js');
  assert.strictEqual(T.preferencia(), 'auto'); assert.strictEqual(attrs['data-tema'], 'escuro'); // sistema escuro
  T.definir('claro'); assert.strictEqual(attrs['data-tema'], 'claro'); assert.strictEqual(store.lod_tema, 'claro');
  T.definir('escuro'); assert.strictEqual(attrs['data-tema'], 'escuro');
  T.definir('lixo'); assert.strictEqual(T.preferencia(), 'auto');
});
t('lembrete do navegador respeita "aguardando confirmação" até quinta 20:00', () => {
  const { datas: D, grupos: G, selecao: S, notificacoes: N } = globalThis.LOD;
  const st = G.estadoInicial();
  D.setNow(() => new Date('2026-11-04T12:00:00Z'));   // quarta 09:00 em São Paulo
  S.marcarAguardando(st, '2026-11-07', st.families[0].id);
  const sit = (iso, hour, minute, weekday) => N.situacao(st, { iso, hour, minute, weekday }, iso);
  assert.strictEqual(sit('2026-11-04', 9, 0, 3).ativo, false);     // quarta: pausado
  assert.strictEqual(sit('2026-11-05', 19, 59, 4).ativo, false);   // quinta 19:59: pausado
  assert.strictEqual(sit('2026-11-05', 20, 0, 4).ativo, true);     // quinta 20:00: volta
  assert.strictEqual(sit('2026-11-06', 9, 0, 5).ativo, true);      // sexta
  S.cancelarAguardando(st, '2026-11-07');
  assert.strictEqual(sit('2026-11-04', 9, 0, 3).ativo, true);      // sem pausa: lembra normalmente
});
console.log(`\n${ok} testes passaram.`);
