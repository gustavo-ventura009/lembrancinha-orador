// Depois de "cap add android": permissões, ícones e o ALARME NATIVO que insiste até você fechar a notificação.
const fs = require('fs'), path = require('path');

const PERMISSOES = [
  'POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM', 'USE_EXACT_ALARM', 'RECEIVE_BOOT_COMPLETED', 'VIBRATE', 'WAKE_LOCK',
  'MODIFY_AUDIO_SETTINGS', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_SPECIAL_USE', 'USE_FULL_SCREEN_INTENT', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
];

const COMPONENTES = `
        <service android:name=".AlarmeService" android:exported="false" android:foregroundServiceType="specialUse">
            <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="Lembrete tipo despertador que toca e vibra até o usuário dispensar" />
        </service>
        <receiver android:name=".AlarmeReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="android.intent.action.TIME_SET" />
                <action android:name="android.intent.action.TIMEZONE_CHANGED" />
            </intent-filter>
        </receiver>
`;

/** Ajusta o projeto Android gerado pelo "cap add android". Exportada para os testes. */
function ajustar(raiz) {
  const base = path.join(raiz, 'android', 'app', 'src', 'main');
  const res = path.join(base, 'res');

  // 1) Permissões + serviço e receptor do alarme
  const f = path.join(base, 'AndroidManifest.xml');
  let x = fs.readFileSync(f, 'utf8');
  for (const p of PERMISSOES) {
    if (!x.includes(`android.permission.${p}"`)) x = x.replace('</manifest>', `    <uses-permission android:name="android.permission.${p}" />\n</manifest>`);
  }
  if (!x.includes('.AlarmeService')) x = x.replace('</application>', `${COMPONENTES}    </application>`);
  fs.writeFileSync(f, x);

  // 2) Código nativo (plugin, serviço, receptor, MainActivity) copiado de android-nativo/
  const pacote = path.join(base, 'java', 'br', 'com', 'lembrancinha', 'orador');
  fs.mkdirSync(pacote, { recursive: true });
  for (const a of fs.readdirSync(path.join(raiz, 'android-nativo'))) fs.copyFileSync(path.join(raiz, 'android-nativo', a), path.join(pacote, a));

  // 3) Ícone do app (a imagem enviada): troca os PNGs e remove o ícone adaptativo padrão do Capacitor
  fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });
  for (const d of fs.readdirSync(path.join(raiz, 'icone'))) {
    const dest = path.join(res, d);
    fs.mkdirSync(dest, { recursive: true });
    for (const a of fs.readdirSync(path.join(raiz, 'icone', d))) fs.copyFileSync(path.join(raiz, 'icone', d, a), path.join(dest, a));
    fs.rmSync(path.join(dest, 'ic_launcher_foreground.png'), { force: true });
  }

  // 4) Ícone pequeno (monocromático) da barra de notificações: um sino
  fs.mkdirSync(path.join(res, 'drawable'), { recursive: true });
  fs.writeFileSync(path.join(res, 'drawable', 'ic_stat_lembrancinha.xml'),
`<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.89,2 2,2zM18,16v-5c0,-3.07 -1.64,-5.64 -4.5,-6.32V4c0,-0.83 -0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.63,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z"/>
</vector>
`);
  console.log('Android ajustado (permissões, alarme nativo que insiste, ícones).');
}

module.exports = { ajustar, PERMISSOES };
if (require.main === module) ajustar(path.join(__dirname, '..'));
