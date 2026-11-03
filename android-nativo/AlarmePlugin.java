package br.com.lembrancinha.orador;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/** Ponte JS ⇄ nativo dos lembretes que insistem (Capacitor.Plugins.Alarme). */
@CapacitorPlugin(name = "Alarme")
public class AlarmePlugin extends Plugin {

    private Context ctx() { return getContext().getApplicationContext(); }

    /** agendar({ alarmes: [{quando(ms), titulo, corpo, sab}], som, vibrar, limiteMin }) */
    @PluginMethod
    public void agendar(PluginCall call) {
        try {
            JSArray alarmes = call.getArray("alarmes");
            AlarmeStore.salvarOpcoes(ctx(), call.getBoolean("som", true), call.getBoolean("vibrar", true), call.getInt("limiteMin", 0));
            AlarmeStore.salvarLista(ctx(), alarmes == null ? new JSONArray() : alarmes);
            AlarmeStore.armarProximo(ctx());
            call.resolve();
        } catch (Exception e) {
            call.reject("Falha ao agendar: " + e.getMessage());
        }
    }

    @PluginMethod
    public void configurar(PluginCall call) {
        AlarmeStore.salvarOpcoes(ctx(), call.getBoolean("som", true), call.getBoolean("vibrar", true), call.getInt("limiteMin", 0));
        call.resolve();
    }

    @PluginMethod
    public void cancelarTudo(PluginCall call) {
        AlarmeStore.salvarLista(ctx(), new JSONArray());
        AlarmeStore.armarProximo(ctx());
        call.resolve();
    }

    /** Para o som/vibração que estiverem tocando agora. */
    @PluginMethod
    public void parar(PluginCall call) {
        AlarmeService.parar(ctx());
        call.resolve();
    }

    /** Dispara um alarme de teste daqui a N segundos (mesmo caminho dos lembretes reais). */
    @PluginMethod
    public void testar(PluginCall call) {
        try {
            int s = Math.max(1, call.getInt("segundos", 5));
            AlarmManager am = (AlarmManager) ctx().getSystemService(Context.ALARM_SERVICE);
            JSONObject o = new JSONObject();
            o.put("titulo", "Lembrancinha do orador");
            o.put("corpo", "Teste: este lembrete insiste até você fechar a notificação.");
            o.put("sab", "");
            AlarmeStore.armar(ctx(), am, AlarmeStore.REQ_TESTE, o, System.currentTimeMillis() + s * 1000L);
            call.resolve();
        } catch (Exception e) {
            call.reject("Falha no teste: " + e.getMessage());
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context c = ctx();
        JSObject r = new JSObject();
        r.put("tocando", AlarmeStore.prefs(c).getBoolean(AlarmeStore.K_TOCANDO, false));
        r.put("sab", AlarmeStore.prefs(c).getString(AlarmeStore.K_TOCANDO_SAB, ""));
        r.put("exato", AlarmeStore.podeExato(c));
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        r.put("bateriaLivre", pm != null && (Build.VERSION.SDK_INT < 23 || pm.isIgnoringBatteryOptimizations(c.getPackageName())));
        boolean tela = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            tela = nm != null && nm.canUseFullScreenIntent();
        }
        r.put("telaCheia", tela);
        r.put("notificacoes", NotificationManagerCompat.from(c).areNotificationsEnabled());
        r.put("som", AlarmeStore.som(c));
        r.put("vibrar", AlarmeStore.vibrar(c));
        r.put("limiteMin", AlarmeStore.limiteMin(c));
        long agora = System.currentTimeMillis(), prox = 0; int total = 0;
        JSONArray l = AlarmeStore.lista(c);
        for (int i = 0; i < l.length(); i++) {
            JSONObject o = l.optJSONObject(i);
            if (o == null) continue;
            long q = o.optLong("quando", 0);
            if (q > agora) { total++; if (prox == 0 || q < prox) prox = q; }
        }
        r.put("total", total);
        r.put("proximo", prox);
        call.resolve(r);
    }

    /** abrir({ tipo: 'bateria' | 'exatos' | 'telaCheia' | 'notificacoes' | 'app' }) — abre a tela certa do Android. */
    @PluginMethod
    public void abrir(PluginCall call) {
        String tipo = call.getString("tipo", "app");
        String pkg = ctx().getPackageName();
        Uri uri = Uri.parse("package:" + pkg);
        Intent i;
        switch (tipo) {
            case "bateria":
                i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, uri);
                break;
            case "exatos":
                i = Build.VERSION.SDK_INT >= 31 ? new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, uri) : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri);
                break;
            case "telaCheia":
                i = Build.VERSION.SDK_INT >= 34 ? new Intent("android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT", uri) : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri);
                break;
            case "notificacoes":
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
                break;
            default:
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception e) {
            try {
                Intent geral = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(geral);
            } catch (Exception e2) {
                call.reject("Não foi possível abrir as configurações do Android.");
                return;
            }
        }
        call.resolve();
    }
}
