package fm.there.app;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TheaterPlugin.class);
        super.onCreate(savedInstanceState);

        /* Bloqueio de anúncios também na tela do próprio aplicativo (onde vivem os
           players de vídeo e música). Estendemos o cliente que o Capacitor já usa
           e sobrescrevemos APENAS a interceptação de requisições — assim a ponte
           entre o app e a página continua funcionando exatamente como antes. */
        try {
            final Bridge bridge = getBridge();
            final WebView wv = bridge.getWebView();
            wv.setWebViewClient(new BridgeWebViewClient(bridge) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                    WebResourceResponse bloqueado = AdBlock.interceptar(req);
                    if (bloqueado != null) return bloqueado;
                    return super.shouldInterceptRequest(view, req);
                }
            });
        } catch (Throwable t) {
            // se algo mudar no Capacitor, o app segue normal — só sem bloqueio aqui
            android.util.Log.w("there.fm", "bloqueio de anúncios não aplicado: " + t.getMessage());
        }
    }

    /* ──────────────────────────────────────────────────────────────
       SEGUNDO PLANO

       Ao sair da tela, o Android suspende o aplicativo e o Capacitor pausa a
       página — o áudio morria junto. Aqui fazemos duas coisas:

       1. Ligamos o serviço em primeiro plano (a notificação), que impede o
          sistema de congelar o processo.
       2. NÃO deixamos a página ser pausada: mantemos os temporizadores e o
          áudio rodando, chamando resume logo em seguida.

       Sem os dois juntos não funciona: o serviço sozinho mantém o processo vivo
       mas a página fica pausada, e retomar a página sozinha não impede o sistema
       de congelar tudo.
       ────────────────────────────────────────────────────────────── */
    @Override
    public void onPause() {
        super.onPause();
        try {
            final WebView wv = getBridge().getWebView();
            if (wv == null) return;
            wv.onResume();        // desfaz a pausa aplicada pelo Capacitor
            wv.resumeTimers();    // mantém os relógios da página correndo

            /* CORRIGIDO: antes o serviço acendia SEMPRE ao minimizar, mesmo sem
               nada tocando — desperdiçava bateria e multiplicava as chances de
               esbarrar na restrição do Android para iniciar serviço em primeiro
               plano vindo de segundo plano (que é justamente uma causa comum de
               encerramento forçado). Agora perguntamos à própria página se algo
               está tocando de verdade antes de acender qualquer coisa. */
            wv.evaluateJavascript(
                "(window.__algoTocando ? window.__algoTocando() : false)",
                valor -> {
                    if ("true".equals(valor)) PlaybackService.iniciar(MainActivity.this);
                }
            );
        } catch (Throwable ignored) {}
    }

    @Override
    public void onResume() {
        super.onResume();
        try {
            PlaybackService.parar(this);   // de volta à tela: a notificação sai
            WebView wv = getBridge().getWebView();
            if (wv != null) { wv.onResume(); wv.resumeTimers(); }
        } catch (Throwable ignored) {}
    }

    @Override
    public void onDestroy() {
        PlaybackService.parar(this);       // fechou o app de vez: para tudo
        super.onDestroy();
    }
}
