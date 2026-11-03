package br.com.lembrancinha.orador;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Dispara quando chega a hora de um lembrete: inicia o serviço que toca/vibra e arma o próximo alarme. */
public class AlarmeReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null) return;
        String acao = intent.getAction();
        if (AlarmeStore.ACAO_DISPARAR.equals(acao)) {
            AlarmeService.iniciar(ctx, intent.getStringExtra("titulo"), intent.getStringExtra("corpo"), intent.getStringExtra("sab"));
            AlarmeStore.armarProximo(ctx);
            AlarmeStore.limparPassado(ctx);
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(acao)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(acao)
                || Intent.ACTION_TIME_CHANGED.equals(acao)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(acao)
                || "android.intent.action.QUICKBOOT_POWERON".equals(acao)) {
            AlarmeStore.armarProximo(ctx);   // depois de reiniciar o celular, volta a agendar sozinho
        }
    }
}
