package br.com.lembrancinha.orador;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Guarda a lista de alarmes (SharedPreferences) e arma sempre só o PRÓXIMO no AlarmManager.
 * Quando ele dispara, o AlarmeReceiver arma o seguinte. Assim nada depende do app estar aberto.
 */
public final class AlarmeStore {
    static final String PREFS = "lod_alarme";
    static final String K_LISTA = "lista";
    static final String K_SOM = "som";
    static final String K_VIBRAR = "vibrar";
    static final String K_LIMITE_MIN = "limite_min";
    static final String K_TOCANDO_SAB = "tocando_sab";
    static final String K_TOCANDO = "tocando";
    static final String ACAO_DISPARAR = "br.com.lembrancinha.orador.ALARME_DISPARAR";
    static final int REQ_PROXIMO = 7001;
    static final int REQ_TESTE = 7002;

    private AlarmeStore() {}

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean som(Context c) { return prefs(c).getBoolean(K_SOM, true); }
    static boolean vibrar(Context c) { return prefs(c).getBoolean(K_VIBRAR, true); }
    /** 0 = toca até você fechar a notificação. */
    static int limiteMin(Context c) { return prefs(c).getInt(K_LIMITE_MIN, 0); }

    static void salvarOpcoes(Context c, boolean som, boolean vibrar, int limiteMin) {
        prefs(c).edit().putBoolean(K_SOM, som).putBoolean(K_VIBRAR, vibrar).putInt(K_LIMITE_MIN, Math.max(0, limiteMin)).apply();
    }

    static void salvarLista(Context c, JSONArray lista) {
        prefs(c).edit().putString(K_LISTA, lista.toString()).apply();
    }

    static JSONArray lista(Context c) {
        try { return new JSONArray(prefs(c).getString(K_LISTA, "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    static PendingIntent intencao(Context c, int req, JSONObject alarme) {
        Intent i = new Intent(c, AlarmeReceiver.class).setAction(ACAO_DISPARAR);
        if (alarme != null) {
            i.putExtra("titulo", alarme.optString("titulo", "Lembrancinha do orador"));
            i.putExtra("corpo", alarme.optString("corpo", ""));
            i.putExtra("sab", alarme.optString("sab", ""));
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(c.getApplicationContext(), req, i, flags);
    }

    static boolean podeExato(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return Build.VERSION.SDK_INT < 31 || (am != null && am.canScheduleExactAlarms());
    }

    /** Arma exatamente um alarme: o primeiro da lista que ainda está no futuro. */
    static void armarProximo(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent antigo = intencao(c, REQ_PROXIMO, null);
        am.cancel(antigo);
        JSONArray l = lista(c);
        long agora = System.currentTimeMillis();
        JSONObject prox = null;
        for (int i = 0; i < l.length(); i++) {
            JSONObject o = l.optJSONObject(i);
            if (o == null) continue;
            long q = o.optLong("quando", 0);
            if (q > agora && (prox == null || q < prox.optLong("quando"))) prox = o;
        }
        if (prox == null) return;
        armar(c, am, REQ_PROXIMO, prox, prox.optLong("quando"));
    }

    static void armar(Context c, AlarmManager am, int req, JSONObject alarme, long quando) {
        PendingIntent pi = intencao(c, req, alarme);
        try {
            if (podeExato(c)) {
                if (Build.VERSION.SDK_INT >= 23) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, quando, pi);
                else am.setExact(AlarmManager.RTC_WAKEUP, quando, pi);
            } else {
                // Sem permissão de alarme exato: setAlarmClock não precisa dela e é tratado como despertador pelo sistema.
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(quando, pi), pi);
            }
        } catch (SecurityException e) {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(quando, pi), pi);
        }
    }

    /** Remove da lista tudo que já passou (menos 10 min de tolerância) para a lista não crescer. */
    static void limparPassado(Context c) {
        JSONArray l = lista(c), n = new JSONArray();
        long corte = System.currentTimeMillis() - 10 * 60 * 1000L;
        for (int i = 0; i < l.length(); i++) {
            JSONObject o = l.optJSONObject(i);
            if (o != null && o.optLong("quando", 0) > corte) n.put(o);
        }
        salvarLista(c, n);
    }
}
