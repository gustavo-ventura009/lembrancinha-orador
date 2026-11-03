package br.com.lembrancinha.orador;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Serviço em primeiro plano que toca e vibra EM LOOP até você fechar a notificação (arrastar) ou tocar em "Parar".
 * O som/vibração são nossos (não do canal de notificação), então o Android não corta depois de ~1 minuto
 * nem reduz o volume das notificações seguintes ("cooldown").
 */
public class AlarmeService extends Service {
    static final String CANAL = "lod_alarme_v1";
    static final String CANAL_FALLBACK = "lod_alarme_fallback_v1";
    static final String ACAO_PARAR = "br.com.lembrancinha.orador.ALARME_PARAR";
    static final int ID_NOTIF = 4711;
    static final int ID_FALLBACK = 4712;
    private static final long[] PADRAO = {0, 900, 500, 900, 1500};

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable aoLimite = new Runnable() { @Override public void run() { encerrar(); } };
    private MediaPlayer player;
    private Vibrator vibrador;
    private PowerManager.WakeLock wake;
    private boolean tocando = false;

    /** Chamado pelo AlarmeReceiver. Se o sistema barrar o serviço, cai numa notificação insistente comum. */
    static void iniciar(Context ctx, String titulo, String corpo, String sab) {
        Intent i = new Intent(ctx, AlarmeService.class);
        i.putExtra("titulo", titulo).putExtra("corpo", corpo).putExtra("sab", sab);
        try {
            ContextCompat.startForegroundService(ctx, i);
        } catch (Exception e) {
            publicarFallback(ctx, titulo, corpo);
        }
    }

    static void parar(Context ctx) {
        try { ctx.stopService(new Intent(ctx, AlarmeService.class)); } catch (Exception ignorado) {}
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(ID_FALLBACK);
        AlarmeStore.prefs(ctx).edit().putBoolean(AlarmeStore.K_TOCANDO, false).putString(AlarmeStore.K_TOCANDO_SAB, "").apply();
    }

    static void criarCanais(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel c = new NotificationChannel(CANAL, "Lembrete que insiste até você fechar", NotificationManager.IMPORTANCE_HIGH);
        c.setDescription("Toca e vibra continuamente até você arrastar a notificação ou tocar em Parar.");
        c.setSound(null, null);          // quem toca é o serviço, não o canal
        c.enableVibration(false);
        c.setBypassDnd(true);
        c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(c);
        NotificationChannel f = new NotificationChannel(CANAL_FALLBACK, "Lembrete (reserva)", NotificationManager.IMPORTANCE_HIGH);
        f.enableVibration(true);
        f.setVibrationPattern(PADRAO);
        AudioAttributes aa = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        f.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), aa);
        f.setBypassDnd(true);
        nm.createNotificationChannel(f);
    }

    static int icone(Context ctx) {
        int id = ctx.getResources().getIdentifier("ic_stat_lembrancinha", "drawable", ctx.getPackageName());
        return id != 0 ? id : android.R.drawable.ic_lock_idle_alarm;
    }

    static PendingIntent abrirApp(Context ctx, int req) {
        Intent i = new Intent(ctx, MainActivity.class).putExtra("lod_alarme", true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(ctx, req, i, flags);
    }

    static PendingIntent intencaoParar(Context ctx) {
        Intent i = new Intent(ctx, AlarmeService.class).setAction(ACAO_PARAR);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getService(ctx, 9100, i, flags);
    }

    static Notification montar(Context ctx, String titulo, String corpo) {
        criarCanais(ctx);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CANAL)
                .setSmallIcon(icone(ctx))
                .setContentTitle(titulo == null || titulo.isEmpty() ? "Lembrancinha do orador" : titulo)
                .setContentText(corpo == null ? "" : corpo)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(corpo == null ? "" : corpo))
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(false)
                .setOnlyAlertOnce(false)
                .setContentIntent(abrirApp(ctx, 9101))
                .setFullScreenIntent(abrirApp(ctx, 9102), true)
                .setDeleteIntent(intencaoParar(ctx))              // arrastar a notificação = fechar = parar
                .addAction(0, "Parar", intencaoParar(ctx));
        return b.build();
    }

    /** Reserva: notificação comum, mas insistente (som e vibração repetem até ser dispensada). */
    static void publicarFallback(Context ctx, String titulo, String corpo) {
        try {
            criarCanais(ctx);
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CANAL_FALLBACK)
                    .setSmallIcon(icone(ctx))
                    .setContentTitle(titulo == null || titulo.isEmpty() ? "Lembrancinha do orador" : titulo)
                    .setContentText(corpo == null ? "" : corpo)
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setVibrate(PADRAO)
                    .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), android.media.AudioManager.STREAM_ALARM)
                    .setAutoCancel(false)
                    .setContentIntent(abrirApp(ctx, 9101))
                    .setFullScreenIntent(abrirApp(ctx, 9102), true);
            Notification n = b.build();
            n.flags |= Notification.FLAG_INSISTENT;
            nm.notify(ID_FALLBACK, n);
        } catch (Exception ignorado) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACAO_PARAR.equals(intent.getAction())) { encerrar(); return START_NOT_STICKY; }
        if (intent == null) { encerrar(); return START_NOT_STICKY; }   // reinício sem dados: não toca à toa
        String titulo = intent.getStringExtra("titulo"), corpo = intent.getStringExtra("corpo"), sab = intent.getStringExtra("sab");
        Notification n = montar(this, titulo, corpo);
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(ID_NOTIF, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(ID_NOTIF, n);
        } catch (Exception e) {
            publicarFallback(this, titulo, corpo);
            stopSelf();
            return START_NOT_STICKY;
        }
        AlarmeStore.prefs(this).edit().putBoolean(AlarmeStore.K_TOCANDO, true).putString(AlarmeStore.K_TOCANDO_SAB, sab == null ? "" : sab).apply();
        if (!tocando) {
            tocando = true;
            segurarCpu();
            vibrar();
            tocarSom();
        }
        handler.removeCallbacks(aoLimite);
        int limite = AlarmeStore.limiteMin(this);
        if (limite > 0) handler.postDelayed(aoLimite, limite * 60_000L);   // 0 = sem limite
        return START_NOT_STICKY;
    }

    private void segurarCpu() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lembrancinha:alarme");
                wake.acquire(6 * 60 * 60 * 1000L);   // teto de segurança de 6 h
            }
        } catch (Exception ignorado) {}
    }

    private void vibrar() {
        if (!AlarmeStore.vibrar(this)) return;
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrador = vm == null ? null : vm.getDefaultVibrator();
            } else {
                vibrador = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrador == null) return;
            AudioAttributes aa = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
            if (Build.VERSION.SDK_INT >= 26) vibrador.vibrate(VibrationEffect.createWaveform(PADRAO, 0), aa);   // 0 = repete para sempre
            else vibrador.vibrate(PADRAO, 0, aa);
        } catch (Exception ignorado) {}
    }

    private void tocarSom() {
        if (!AlarmeStore.som(this)) return;
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
            player.prepare();
            player.start();
        } catch (Exception e) {
            if (player != null) { try { player.release(); } catch (Exception ignorado) {} player = null; }
        }
    }

    private void encerrar() {
        handler.removeCallbacks(aoLimite);
        tocando = false;
        try { if (vibrador != null) vibrador.cancel(); } catch (Exception ignorado) {}
        try { if (player != null) { player.stop(); player.release(); } } catch (Exception ignorado) {}
        player = null;
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception ignorado) {}
        AlarmeStore.prefs(this).edit().putBoolean(AlarmeStore.K_TOCANDO, false).putString(AlarmeStore.K_TOCANDO_SAB, "").apply();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(aoLimite);
        try { if (vibrador != null) vibrador.cancel(); } catch (Exception ignorado) {}
        try { if (player != null) { player.release(); } } catch (Exception ignorado) {}
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception ignorado) {}
        AlarmeStore.prefs(this).edit().putBoolean(AlarmeStore.K_TOCANDO, false).apply();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
