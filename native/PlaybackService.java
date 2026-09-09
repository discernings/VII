package fm.there.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

/**
 * REPRODUÇÃO EM SEGUNDO PLANO
 *
 * A versão anterior só mantinha o processo vivo, e faltavam duas peças que o
 * Android exige para o SOM continuar saindo:
 *
 * 1. FOCO DE ÁUDIO. Sem pedir foco, o sistema entrega o áudio a outro
 *    aplicativo assim que este sai da tela. A página continua rodando (por isso
 *    o contador da música seguia andando), mas nada é ouvido — e voltava só ao
 *    pausar e dar play, porque isso reconquista o foco sem querer. Era esse o
 *    sintoma exato relatado.
 *
 * 2. SESSÃO DE MÍDIA. É como o sistema reconhece um aplicativo como "tocador".
 *    Sem ela, o Android trata o áudio como som incidental e o suspende ao
 *    empilhar o app em segundo plano, além de não mostrar os controles na
 *    tela de bloqueio.
 */
public class PlaybackService extends Service {

    private static final String CANAL = "there_playback";
    private static final int ID_NOTIFICACAO = 1042;

    private AudioManager audio;
    private AudioFocusRequest pedidoFoco;
    private MediaSessionCompat sessao;
    private boolean comFoco = false;

    @Override
    public void onCreate() {
        super.onCreate();
        criarCanal();
        audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        prepararSessao();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        /* CAUSA MAIS PROVÁVEL DO CRASH — esta chamada não tinha proteção nenhuma.
           startForeground() pode lançar SecurityException em alguns aparelhos e
           versões do Android quando a permissão específica do tipo de serviço
           (FOREGROUND_SERVICE_MEDIA_PLAYBACK) não está reconhecida no exato
           instante da chamada — e diferente do startForegroundService() lá na
           Activity (que já tinha try/catch), essa exceção acontece DEPOIS,
           dentro do próprio ciclo de vida do serviço, e nenhum try/catch de fora
           alcança ela. Sem captura aqui, ela sobe até o sistema e o processo
           inteiro é encerrado — batendo exatamente com "app finalizado ao
           minimizar", sem nenhum erro visível na tela. */
        try {
            startForeground(ID_NOTIFICACAO, montarNotificacao());
        } catch (Throwable t) {
            android.util.Log.w("there.fm", "não consegui virar serviço em primeiro plano: " + t);
            stopSelf();          // desiste deste início específico, sem derrubar o app
            return START_NOT_STICKY;
        }
        pedirFoco();
        try {
            if (sessao != null) {
                sessao.setActive(true);
                sessao.setPlaybackState(new PlaybackStateCompat.Builder()
                        .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE)
                        .setState(PlaybackStateCompat.STATE_PLAYING, 0, 1f)
                        .build());
            }
        } catch (Throwable ignored) {}
        return START_STICKY;
    }

    /** Diz ao sistema que este app está tocando mídia e quer o áudio. */
    private void pedirFoco() {
        if (audio == null || comFoco) return;
        try {
            AudioManager.OnAudioFocusChangeListener ouvinte = foco -> {
                // Perder o foco não deve matar a reprodução: outro app pode ter
                // pedido atenção por um instante (uma notificação, por exemplo).
                comFoco = (foco == AudioManager.AUDIOFOCUS_GAIN);
            };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                        .build();
                pedidoFoco = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(attrs)
                        .setWillPauseWhenDucked(false)     // não pausar quando outro som entra
                        .setOnAudioFocusChangeListener(ouvinte)
                        .build();
                comFoco = audio.requestAudioFocus(pedidoFoco) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            } else {
                comFoco = audio.requestAudioFocus(ouvinte, AudioManager.STREAM_MUSIC,
                        AudioManager.AUDIOFOCUS_GAIN) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            }
        } catch (Throwable ignored) {}
    }

    private void soltarFoco() {
        if (audio == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (pedidoFoco != null) audio.abandonAudioFocusRequest(pedidoFoco);
            } else {
                audio.abandonAudioFocus(null);
            }
        } catch (Throwable ignored) {}
        comFoco = false;
    }

    private void prepararSessao() {
        try {
            sessao = new MediaSessionCompat(this, "there.fm");
            sessao.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                    | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
        } catch (Throwable ignored) {}
    }

    private void criarCanal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel canal = new NotificationChannel(
                    CANAL, "Reprodução", NotificationManager.IMPORTANCE_LOW);
            canal.setDescription("Mantém o som tocando com o aplicativo fora da tela");
            canal.setShowBadge(false);
            canal.setSound(null, null);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(canal);
        }
    }

    private Notification montarNotificacao() {
        Intent abrir = new Intent(this, MainActivity.class);
        abrir.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent toque = PendingIntent.getActivity(this, 0, abrir, flags);

        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CANAL)
                : new Notification.Builder(this);

        return b.setContentTitle("滿月")
                .setContentText("tocando em segundo plano")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(toque)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .build();
    }

    @Override
    public void onDestroy() {
        soltarFoco();
        try { if (sessao != null) { sessao.setActive(false); sessao.release(); } } catch (Throwable ignored) {}
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    public static void iniciar(Context ctx) {
        try {
            Intent i = new Intent(ctx, PlaybackService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Throwable ignored) {}
    }
    public static void parar(Context ctx) {
        try { ctx.stopService(new Intent(ctx, PlaybackService.class)); } catch (Throwable ignored) {}
    }
}
