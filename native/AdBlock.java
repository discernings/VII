package fm.there.app;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * BLOQUEADOR DE ANÚNCIOS
 *
 * Funciona interceptando cada requisição que o navegador faz. Se o endereço for
 * de publicidade ou rastreamento, devolvemos uma resposta vazia em vez de deixar
 * carregar. É o mesmo princípio dos bloqueadores conhecidos.
 *
 * Duas observações honestas sobre o alcance:
 *
 * • Anúncios do YouTube dentro do player oficial são parcialmente bloqueados.
 *   Os pedidos de anúncio saem por domínios de publicidade (bloqueados aqui),
 *   mas o vídeo do anúncio em si pode vir do MESMO servidor que entrega o vídeo
 *   normal — bloquear esse servidor derrubaria o vídeo junto. Por isso a maioria
 *   some, mas não dá para prometer 100%.
 *
 * • Sites que servem o anúncio do próprio domínio (alguns players de filme)
 *   escapam do bloqueio por endereço. Para esses existe a limpeza visual, que
 *   remove os elementos de anúncio da página depois que ela carrega.
 */
public class AdBlock {

    /** Domínios de publicidade e rastreamento. Comparados por sufixo. */
    private static final Set<String> DOMINIOS = new HashSet<>(Arrays.asList(
        "doubleclick.net", "googlesyndication.com", "googleadservices.com",
        "google-analytics.com", "googletagmanager.com", "googletagservices.com",
        "adservice.google.com", "adnxs.com", "adsystem.com", "amazon-adsystem.com",
        "rubiconproject.com", "pubmatic.com", "openx.net", "criteo.com", "criteo.net",
        "taboola.com", "outbrain.com", "revcontent.com", "mgid.com", "adsterra.com",
        "propellerads.com", "popads.net", "popcash.net", "exoclick.com", "juicyads.com",
        "trafficjunky.net", "hilltopads.net", "adcash.com", "clickadu.com",
        "onclickalgo.com", "onclckmn.com", "zeydoo.com", "poweredby.jads.co",
        "scorecardresearch.com", "quantserve.com", "moatads.com", "adroll.com",
        "bluekai.com", "krxd.net", "sharethrough.com", "smartadserver.com",
        "yieldmo.com", "teads.tv", "spotxchange.com", "springserve.com",
        "imasdk.googleapis.com", "innovid.com", "flashtalking.com", "serving-sys.com",
        "hotjar.com", "fullstory.com", "mixpanel.com", "segment.io", "branch.io",
        "appsflyer.com", "adjust.com", "kochava.com", "onesignal.com",
        "facebook.net", "connect.facebook.net", "ads-twitter.com", "analytics.tiktok.com"
    ));

    /** Trechos que denunciam publicidade em qualquer domínio. */
    private static final List<String> PADROES = Arrays.asList(
        "/pagead/", "/adsbygoogle", "/ad_status", "/get_midroll_", "/api/stats/ads",
        "/googleads", "/ad-choices", "/adserver", "/ad_frame",
        "/banners/", "/popunder", "/prebid", "/vast.xml", "/vmap.xml",
        "adframe.js", "advertisement", "/sponsored/", "/promoted/"
    );

    /* Padrões que exigem posição exata (não apenas "conter o texto").
       "ads.js" e "advert" soltos como texto bateram em nomes de arquivo
       perfeitamente legítimos de players de vídeo: reloads.js, payloads.js,
       threads.js, downloads.js, uploads.js, e endereços como
       ".../advertorial-manifest.json" — nenhum desses é anúncio. Isso explica
       um congelamento bem específico: se o player carrega o próximo trecho do
       vídeo por um script com um desses nomes comuns, bloqueávamos ele bem na
       troca de cena. Agora exigimos que o nome apareça como um SEGMENTO
       próprio do caminho (depois de uma barra ou no início), não como
       sobra de outra palavra. */
    private static final java.util.regex.Pattern PADRAO_ADS_JS =
        java.util.regex.Pattern.compile("(^|/)ads\\.js(\\?|$)");
    private static final java.util.regex.Pattern PADRAO_ADVERT =
        java.util.regex.Pattern.compile("/advert(?:[/.?]|$)");

    private static final byte[] VAZIO = new byte[0];

    public static boolean bloquear(String url) {
        if (url == null || url.isEmpty()) return false;
        String u = url.toLowerCase();

        // não interferir no que faz o vídeo funcionar
        if (u.contains("googlevideo.com/videoplayback")) return false;
        if (u.contains("/manifest") || u.endsWith(".m3u8") || u.endsWith(".mpd")) return false;

        try {
            int i = u.indexOf("://");
            if (i > 0) {
                String resto = u.substring(i + 3);
                int corte = resto.indexOf('/');
                String host = (corte > 0 ? resto.substring(0, corte) : resto);
                int porta = host.indexOf(':');
                if (porta > 0) host = host.substring(0, porta);
                for (String d : DOMINIOS) {
                    if (host.equals(d) || host.endsWith("." + d)) return true;
                }
            }
        } catch (Exception ignored) {}

        for (String p : PADROES) {
            if (u.contains(p)) return true;
        }
        if (PADRAO_ADS_JS.matcher(u).find())  return true;
        if (PADRAO_ADVERT.matcher(u).find())  return true;
        return false;
    }

    /** Resposta vazia: a página segue carregando, só sem o anúncio. */
    public static WebResourceResponse respostaVazia() {
        return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(VAZIO));
    }

    public static WebResourceResponse interceptar(WebResourceRequest req) {
        try {
            if (req != null && req.getUrl() != null && bloquear(req.getUrl().toString())) {
                return respostaVazia();
            }
        } catch (Exception ignored) {}
        return null;   // null = deixa carregar normalmente
    }

    /**
     * LIMPEZA VISUAL — para anúncios servidos pelo próprio site, que passam pelo
     * bloqueio por endereço. Some com os elementos e impede que voltem, usando
     * um observador de mudanças na página (muitos sites reinserem o anúncio).
     */
    public static final String CSS_LIMPEZA =
        "(function(){" +
        "  if (window.__adClean) return; window.__adClean = 1;" +
        "  var SEL = ['ins.adsbygoogle','[id^=\"google_ads\"]','[id^=\"div-gpt-ad\"]'," +
        "             'iframe[src*=\"doubleclick\"]','iframe[src*=\"googlesyndication\"]'," +
        "             'iframe[src*=\"adservice\"]','iframe[id^=\"aswift\"]'," +
        "             '[class*=\"ad-banner\"]','[class*=\"ad-container\"]','[class*=\"ad-wrapper\"]'," +
        "             '[class*=\"advertisement\"]','[id*=\"banner-ad\"]','[data-ad-slot]'," +
        "             '.popunder','.pop-overlay','[class*=\"sticky-ad\"]'];" +
        "  function limpar(){" +
        "    for (var i=0;i<SEL.length;i++){" +
        "      try{" +
        "        var n = document.querySelectorAll(SEL[i]);" +
        "        for (var j=0;j<n.length;j++){" +
        "          if (n[j].querySelector && n[j].querySelector('video')) continue;" +
        "          n[j].style.setProperty('display','none','important');" +
        "        }" +
        "      }catch(e){}" +
        "    }" +
        "  }" +
        "  limpar();" +
        "  try{" +
        "    var mo = new MutationObserver(function(){ limpar(); });" +
        "    mo.observe(document.documentElement,{childList:true,subtree:true});" +
        "  }catch(e){ setInterval(limpar, 1500); }" +
        "})();";
}
