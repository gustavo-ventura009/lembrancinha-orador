package br.com.lembrancinha.orador;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlarmePlugin.class);   // plugin nativo dos lembretes que insistem
        super.onCreate(savedInstanceState);
        mostrarSobreBloqueio(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        mostrarSobreBloqueio(intent);
    }

    /** Se o app foi aberto pelo lembrete, acende a tela e aparece por cima da tela de bloqueio. */
    private void mostrarSobreBloqueio(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("lod_alarme", false)) return;
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }
}
