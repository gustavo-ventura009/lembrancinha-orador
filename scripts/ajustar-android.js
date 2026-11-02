// Depois de "cap add android": permissões (Android 13+), ícone do app, ícone pequeno das notificações e CANAL DE ALERTA nativo.
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const res = path.join(raiz, 'android', 'app', 'src', 'main', 'res');

// 1) Permissões
const f = path.join(raiz, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
let x = fs.readFileSync(f, 'utf8');
for (const p of ['POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM', 'RECEIVE_BOOT_COMPLETED', 'VIBRATE', 'WAKE_LOCK']) {
  if (!x.includes(`android.permission.${p}"`)) x = x.replace('</manifest>', `    <uses-permission android:name="android.permission.${p}" />\n</manifest>`);
}
fs.writeFileSync(f, x);

// 2) Ícone do app (a imagem enviada): troca os PNGs e remove o ícone adaptativo padrão do Capacitor
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });
for (const d of fs.readdirSync(path.join(raiz, 'icone'))) {
  const dest = path.join(res, d);
  fs.mkdirSync(dest, { recursive: true });
  for (const a of fs.readdirSync(path.join(raiz, 'icone', d))) fs.copyFileSync(path.join(raiz, 'icone', d, a), path.join(dest, a));
  fs.rmSync(path.join(dest, 'ic_launcher_foreground.png'), { force: true });
}

// 3) Ícone pequeno (monocromático) da barra de notificações: um sino
fs.mkdirSync(path.join(res, 'drawable'), { recursive: true });
fs.writeFileSync(path.join(res, 'drawable', 'ic_stat_lembrancinha.xml'),
`<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.89,2 2,2zM18,16v-5c0,-3.07 -1.64,-5.64 -4.5,-6.32V4c0,-0.83 -0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.63,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z"/>
</vector>
`);

// 4) Alerta forte. O plugin de notificações só sabe ligar/desligar a vibração do canal (padrão curto do Android), então o canal
//    "lembretes-orador-v3" é criado AQUI, em código nativo, com um padrão de vibração longo (~1 minuto) e importância alta.
//    Ao criar o canal, o app (js/android.js) só o reutiliza. Se algo falhar, o build PARA (melhor do que gerar um APK fraco em silêncio).
function achar(dir, nome) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const c = path.join(dir, e.name);
    if (e.isDirectory()) { const r = achar(c, nome); if (r) return r; } else if (e.name === nome) return c;
  }
  return null;
}
const main = achar(path.join(raiz, 'android', 'app', 'src', 'main', 'java'), 'MainActivity.java');
if (!main) throw new Error('MainActivity.java não encontrado em android/app/src/main/java: o canal de alerta não pôde ser criado.');
const pkg = (/^\s*package\s+([\w.]+)\s*;/m.exec(fs.readFileSync(main, 'utf8')) || [])[1];
if (!pkg) throw new Error('Não consegui ler o package de MainActivity.java.');

const java = [
  `package ${pkg};`,
  '',
  'import android.app.Notification;',
  'import android.app.NotificationChannel;',
  'import android.app.NotificationManager;',
  'import android.content.Context;',
  'import android.media.AudioAttributes;',
  'import android.media.RingtoneManager;',
  'import android.net.Uri;',
  'import android.os.Build;',
  'import android.os.Bundle;',
  'import com.getcapacitor.BridgeActivity;',
  '',
  'public class MainActivity extends BridgeActivity {',
  '    // Mesmo id usado em js/android.js. Se um dia mudar o padrão de vibração, troque o id nos dois lugares (o Android não altera canal já criado).',
  '    private static final String CANAL = "lembretes-orador-v3";',
  '',
  '    @Override',
  '    public void onCreate(Bundle savedInstanceState) {',
  '        super.onCreate(savedInstanceState);',
  '        criarCanalDeAlerta();',
  '    }',
  '',
  '    // 35 ciclos de (1,2 s vibrando + 0,5 s parado) = cerca de 1 minuto de vibração por notificação.',
  '    private static long[] padraoDeVibracao() {',
  '        final int ciclos = 35;',
  '        long[] p = new long[1 + ciclos * 2];',
  '        p[0] = 0;',
  '        for (int i = 0; i < ciclos; i++) {',
  '            p[1 + i * 2] = 1200;',
  '            p[2 + i * 2] = 500;',
  '        }',
  '        return p;',
  '    }',
  '',
  '    private void criarCanalDeAlerta() {',
  '        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;',
  '        try {',
  '            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);',
  '            if (nm == null) return;',
  '            NotificationChannel canal = new NotificationChannel(CANAL, "Lembretes da lembrancinha", NotificationManager.IMPORTANCE_HIGH);',
  '            canal.setDescription("Escolher quem entrega a lembrancinha do orador");',
  '            canal.enableVibration(true);',
  '            canal.setVibrationPattern(padraoDeVibracao());',
  '            canal.enableLights(true);',
  '            canal.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);',
  '            Uri som = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);',
  '            AudioAttributes atributos = new AudioAttributes.Builder()',
  '                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)',
  '                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)',
  '                    .build();',
  '            canal.setSound(som, atributos);',
  '            nm.createNotificationChannel(canal);',
  '        } catch (Exception e) {',
  '            // sem canal nativo o app ainda cria o canal pelo plugin (vibração curta padrão)',
  '        }',
  '    }',
  '}',
  ''
].join('\n');
fs.writeFileSync(main, java);
console.log(`Canal de alerta nativo criado em ${path.relative(raiz, main)} (vibração ~1 min, importância alta).`);
console.log('Android ajustado (permissões, ícone e canal de alerta).');
