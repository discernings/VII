/* ══════════════════════════════════════════════════════════════════
   NAVEGADOR EMBUTIDO — lado JavaScript

   Este arquivo só faz efeito dentro do APK. No site aberto pelo navegador
   comum ele simplesmente não ativa (a checagem no topo cuida disso), então
   pode ficar no projeto sem quebrar nada.

   A ideia central: o navegador embutido é registrado em `ytPlrs` com a MESMA
   interface dos outros players (playVideo, pauseVideo, seekTo, getCurrentTime,
   isPlaying, setRate, setVolume). Como toda a sincronia do app conversa com
   essa interface, o vídeo de qualquer site passa a sincronizar sozinho —
   inclusive a correção contínua de deriva. Não foi preciso escrever
   sincronia nova.
   ══════════════════════════════════════════════════════════════════ */

let Theater = null;
let theaterState = { found:false, t:0, p:false, d:0, title:'', url:'' };
let theaterUid = null;
let _ultimoAchado = 0;
let theaterPageUrl = '';   // endereço da PÁGINA (o que é compartilhado)   // quando vimos um vídeo pela última vez (para a carência)          // id do card que está usando o navegador
let theaterItemId = null;

/* Só existe dentro do app. No site, `Capacitor` não está definido. */
function theaterAvailable(){
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}
function initTheater(){
  if(!theaterAvailable()) return false;
  if(Theater) return true;
  try{
    Theater = pegarPlugin();
    if(!Theater) return false;
    // estado do vídeo chegando da página aberta, a cada meio segundo
    Theater.addListener('videoState', ({state})=>{
      try{
        const s=JSON.parse(state);
        if(s.found){
          theaterState=Object.assign({found:true,t:0,p:false,d:0},s);
          _ultimoAchado=Date.now();
        }else{
          /* CARÊNCIA DE 6s: ao trocar de página ou durante um recarregamento, o
             detector reporta "sem vídeo" por alguns instantes. Antes eu zerava o
             card na hora — era por isso que ele voltava para "Nenhum vídeo
             detectado · 0:00" mesmo com o vídeo ainda tocando. */
          if(Date.now()-_ultimoAchado>6000) theaterState.found=false;
        }
        if(theaterUid) updateTheaterCard();
      }catch(e){}
    });
    // botões da barra do navegador
    Theater.addListener('captured',()=>{ iniciarSessaoTheater(true); });
    Theater.addListener('backToRoom',()=>{ iniciarSessaoTheater(false); });
    Theater.addListener('pageChanged', ({url,title})=>{
      /* Guardamos a URL DA PÁGINA separada da que o detector reporta.
         Quando o vídeo está dentro de um quadro (caso do TokyVideo), o detector
         informa o endereço do quadro — abrir aquilo no aparelho dos outros não
         reproduz a página. Para compartilhar, o certo é sempre a página. */
      theaterPageUrl = url || theaterPageUrl;
      theaterState.title = title || theaterState.title;
    });
    Theater.addListener('theaterClosed', ()=>{ /* janela escondida; vídeo segue tocando */ });
    verificarVersaoPlugin();
    return true;
  }catch(e){ console.warn('Theater indisponível:',e); return false; }
}

/* Confere se o APK tem a versão nova do plugin.
   O JavaScript e o Java são atualizados separadamente: dá para ter o JS novo com
   o Java velho dentro do APK. Quando isso acontece, os comandos de encaixar o
   vídeo no card não existem e falham calados — o vídeo toca invisível e não há
   pista nenhuma do motivo. Este aviso transforma isso em algo visível. */
let _pluginV = 0;
async function verificarVersaoPlugin(){
  try{
    if(typeof Theater.version!=='function'){ _pluginV=1; avisarPluginAntigo(); return; }
    const r=await Theater.version();
    _pluginV=(r && r.v) || 1;
    if(_pluginV<2) avisarPluginAntigo();
    else console.log('[navegador] plugin v'+_pluginV+' — vídeo no card disponível');
  }catch(e){ _pluginV=1; avisarPluginAntigo(); }
}
function avisarPluginAntigo(){
  console.warn('[navegador] plugin antigo no APK');
  setTimeout(()=>toast('O APK está com a versão antiga do navegador. Atualize native/TheaterPlugin.java no repositório e refaça o build.','err'),1500);
}
/* Abre o navegador dentro do app. */
/* Diz exatamente o que está faltando, em vez de falhar em silêncio.
   Antes o botão ficava escondido quando algo dava errado, e não havia como
   saber se o problema era estar no site, o plugin não ter entrado no APK,
   ou outra coisa. */
/* Obtém o plugin por dois caminhos.
   1) registerPlugin — vem da biblioteca JavaScript do Capacitor.
   2) Capacitor.Plugins.Theater — exposto pela parte NATIVA, funciona mesmo
      se a biblioteca não tiver sido carregada.
   O segundo existe justamente porque o primeiro falhou antes: eu instalava o
   pacote no build mas não levava o arquivo JavaScript para dentro do app. */
function pegarPlugin(){
  const C=window.Capacitor; if(!C) return null;
  if(typeof C.registerPlugin==='function'){
    try{ const p=C.registerPlugin('Theater'); if(p) return p; }catch(e){}
  }
  if(C.Plugins && C.Plugins.Theater) return C.Plugins.Theater;
  return null;
}
function theaterDiagnostico(){
  const C=window.Capacitor;
  if(!(C && C.isNativePlatform && C.isNativePlatform()))
    return 'Você está no site pelo navegador. Esta função só existe no aplicativo (APK).';
  if(!pegarPlugin())
    return 'O plugin não foi encontrado no APK. Confira se native/TheaterPlugin.java e native/MainActivity.java estão no repositório e refaça o build.';
  return null;
}
async function openTheater(url){
  const problema=theaterDiagnostico();
  if(problema){ toast(problema,'err'); console.warn('[navegador]',problema); return; }
  if(!initTheater()){ toast('Não consegui iniciar o navegador embutido','err'); return; }
  if(!room){ toast('Entre em uma sala primeiro','err'); return; }
  try{
    /* NÃO criar card aqui. Era esta linha que gerava os cards infinitos:
       abrir o navegador criava um card novo toda vez, e depois de fechar a
       sessão o identificador mudava — os cards antigos ficavam órfãos, sem
       ninguém capaz de fechá-los. O card agora nasce apenas quando existe um
       vídeo de fato (ao capturar ou ao voltar para a sala com vídeo tocando). */
    await Theater.open({ url: url || 'https://www.google.com' });
  }catch(e){
    console.error('[navegador] falha ao abrir',e);
    toast('Falha ao abrir o navegador: '+(e.message||e),'err');
  }
}

/* ══════════════════════════════════════════════════════════════════
   SESSÃO DO NAVEGADOR — reestruturado.

   O que estava quebrado, e por quê:

   • DOIS CAMINHOS criavam o card (o anúncio genérico de item e o aviso de
     abertura). Cada um montava um card diferente, com dados diferentes — daí os
     cards duplicados, vazios ou que não apareciam.
   • FECHAR não avisava ninguém: eu removia o card só na minha tela, enquanto o
     navegador da outra pessoa seguia tocando. Era o "fecho e ela continua
     assistindo".
   • O endereço compartilhado era o do QUADRO INTERNO, não o da página. No
     TokyVideo o vídeo vive dentro de um quadro, então os outros recebiam um
     endereço que não abre nada sozinho.

   Agora existe UMA sessão, com um estado só, e três mensagens claras:
   abrir, atualizar e fechar. Todo mundo entra e sai junto.
   ══════════════════════════════════════════════════════════════════ */
let sessaoTheater = null;   // {itemId, url, host} — igual para todos na sala

/* Entra na sessão. `anunciar` distingue quem capturou (avisa a sala) de quem só
   voltou para a sala (não reanuncia, para não criar sessão duplicada). */
function iniciarSessaoTheater(anunciar){
  const url = theaterPageUrl || theaterState.url || '';
  if(!sessaoTheater){
    sessaoTheater = { itemId:'thr_'+Date.now(), url, host:U.id };
  }else if(url){
    sessaoTheater.url = url;
  }
  ensureTheaterCard(sessaoTheater.itemId);
  aguardarLayoutEEncaixar();
  if(anunciar && room){
    broadcast({ type:'THEATER_OPEN', itemId:sessaoTheater.itemId,
                url:sessaoTheater.url, host:U.id, uid:U.id });
    toast('Vídeo capturado · todos vão abrir a mesma página');
  }
}
/* Espera o card existir e ter tamanho antes de encaixar o vídeo nele.
   Antes eu usava um tempo fixo de 120ms — quando o aparelho demorava um pouco
   mais para desenhar, o encaixe falhava calado e o vídeo ficava tocando atrás. */
function aguardarLayoutEEncaixar(tentativa){
  tentativa=tentativa||0;
  const a=areaDoCard();
  if(a && a.w>40 && a.h>40){ entrarModoCard(); return; }
  if(tentativa>25){
    /* DESISTIU de encaixar (~4s). Antes eu simplesmente parava aqui — e o
       navegador ficava em TELA CHEIA cobrindo a sala inteira, dando a impressão
       de "só aparece a página, sem card". Agora escondemos o navegador: o vídeo
       continua tocando e sincronizado, e o card fica acessível com um botão para
       reabrir a janela. */
    if(Theater){ try{ Theater.hide(); }catch(e){} }
    const card=qs('[data-ytuid="'+theaterUid+'"]');
    if(card){
      const s=card.querySelector('.theater-sub');
      if(s) s.textContent='tocando · toque em Abrir navegador para ver';
    }
    toast('Vídeo tocando em segundo plano — toque em "Abrir navegador" no card');
    return;
  }
  setTimeout(()=>aguardarLayoutEEncaixar(tentativa+1),150);
}

/* Aguarda a página carregar e o vídeo aparecer, e só então encaixa no card.
   Sem isso, o encaixe era tentado com a página ainda em branco. */
/* CORRIGIDO — duas queixas reais vinham desta mesma função, e as duas têm a
   mesma raiz: o navegador ficava VISÍVEL o tempo inteiro enquanto esperava o
   vídeo aparecer, e desistia depois de só ~12s.
   Sites com bastante anúncio e redirecionamento — exatamente o tipo que esse
   recurso mais precisa suportar — não raro levam mais que isso só para
   terminar a cadeia de anúncios antes de chegar no vídeo de verdade. Quem
   abriu a sessão geralmente interage com a página (fecha um anúncio, clica
   em play) sem perceber; quem só está recebendo nunca toca em nada, então a
   espera precisa ser bem mais paciente — e invisível, porque ninguém pediu
   pra "navegar", só pra ver o vídeo sincronizado.
   A correção: esconde a janela logo (alguns segundos bastam pra página
   começar a carregar) e continua procurando o vídeo por baixo dos panos por
   bem mais tempo. Esconder não pausa nada — a página continua carregando
   normalmente, só não fica visível. Se o vídeo aparecer depois, mesmo
   escondido, o encaixe acontece automaticamente, sem precisar de nenhum
   toque. */
function esperarVideoEEncaixar(tentativa){
  tentativa=tentativa||0;
  if(theaterState.found){ aguardarLayoutEEncaixar(); return; }
  // some de vista cedo — por volta de 3s já dá pra página começar a carregar,
  // sem deixar a pessoa olhando uma navegação que não pediu
  if(tentativa===10 && Theater){ try{ Theater.hide(); }catch(e){} }
  if(tentativa>200){                    // ~60s no total: bem mais paciente com anúncios/redirecionamentos
    const card=qs('[data-ytuid="'+theaterUid+'"]');
    if(card){
      const s=card.querySelector('.theater-sub');
      if(s) s.textContent='não encontrei o vídeo — toque em Abrir navegador';
    }
    return;
  }
  setTimeout(()=>esperarVideoEEncaixar(tentativa+1),300);
}
/* Outra pessoa abriu: abro a mesma página aqui e crio o mesmo card. */
async function abrirTheaterRemoto(url,itemId,host){
  if(!itemId) return;
  sessaoTheater = { itemId, url:url||'', host:host||null };
  ensureTheaterCard(itemId);              // o card existe para todos, com ou sem app
  if(!theaterAvailable()){
    marcarCardSemApp(itemId);
    return;
  }
  if(!initTheater()) return;
  if(!url){ marcarCardSemApp(itemId); return; }
  try{
    await Theater.open({ url });
    if(theaterUid) setSyncHost(theaterUid, host || 'remoto');   // quem abriu é o relógio
    /* Espera o vídeo ser detectado antes de encaixar: abrir a página leva alguns
       segundos e, sem essa espera, o encaixe acontecia antes de existir vídeo. */
    esperarVideoEEncaixar();
    toast('Abrindo o mesmo vídeo · sincronizado');
  }catch(e){
    console.error('abrirTheaterRemoto',e);
    marcarCardSemApp(itemId);
  }
}
/* Quem está pelo navegador comum vê o card com a explicação e um link. */
function marcarCardSemApp(itemId){
  const card=qs('[data-item-id="'+itemId+'"]'); if(!card) return;
  const t=card.querySelector('.theater-title');
  const s=card.querySelector('.theater-sub');
  if(t) t.textContent='Assistindo em outro site';
  if(s) s.innerHTML=(sessaoTheater&&sessaoTheater.url)
      ? `<a href="${sessaoTheater.url}" target="_blank" rel="noopener" style="color:var(--green);text-decoration:underline">abrir a página</a> · sincroniza no aplicativo`
      : 'abra pelo aplicativo para acompanhar';
}

/* FECHAR — agora encerra para TODOS. */
async function encerrarSessaoTheater(anunciar,idDoBotao){
  const itemId = idDoBotao || (sessaoTheater ? sessaoTheater.itemId : theaterItemId);
  if(anunciar && room && itemId) broadcast({ type:'THEATER_CLOSE', itemId, uid:U.id });
  await fecharTheaterLocal(itemId);
}
/* Fecha só do meu lado (usado por mim e ao receber o aviso de outra pessoa). */
async function fecharTheaterLocal(itemId){
  try{
    if(Theater){ await sairModoCard(); await Theater.close(); }
  }catch(e){}
  if(window.__thrObs){ clearInterval(window.__thrObs); window.__thrObs=null; }
  /* Remove TODOS os cards de navegador, não apenas o da sessão conhecida.
     Se por qualquer motivo tiver sobrado algum órfão, ele sai junto — assim o
     botão de fechar sempre limpa a tela de verdade. */
  document.querySelectorAll('.card[data-type="theater"]').forEach(el=>{
    el.remove(); els=els.filter(e=>e!==el);
  });
  if(theaterUid){ delete ytPlrs[theaterUid]; delete desiredPlaying[theaterUid]; }
  theaterUid=null; theaterItemId=null; sessaoTheater=null;
  theaterState={found:false,t:0,p:false,d:0,title:'',url:''};
  _modoCard=false;
}
/* Recebido quando outra pessoa fecha. Devolve a promessa para quem chamar poder
   esperar o fechamento terminar de fato. */
function fecharTheaterRemoto(itemId){ return fecharTheaterLocal(itemId); }

/* Cria (uma vez) o card na sala que representa o vídeo do navegador, e o
   registra como player para a sincronia enxergar. */
/* Cria o card UMA vez, sempre com o MESMO id em todos os aparelhos — é isso que
   permite fechar, mover e remover de forma coordenada. Antes cada lado gerava um
   id próprio, então uma ponta não sabia qual card a outra estava fechando. */
function ensureTheaterCard(idSessao){
  const id = idSessao || (sessaoTheater && sessaoTheater.itemId) || ('thr_'+Date.now());
  /* Varre e remove QUALQUER outro card de navegador antes de criar.
     Só pode existir um por vez — sem esta limpeza, qualquer caminho que
     escapasse deixava cards duplicados na tela, sem dono e sem como fechar. */
  document.querySelectorAll('.card[data-type="theater"]').forEach(el=>{
    if(el.dataset.itemId!==id){ el.remove(); els=els.filter(e=>e!==el); }
  });
  const jaExiste = qs('[data-item-id="'+id+'"]');
  if(jaExiste){ theaterItemId=id; theaterUid=jaExiste.dataset.ytuid||('ytp_'+id); return; }
  const c=$('items');
  theaterItemId=id;
  theaterUid='ytp_'+id;

  const w=document.createElement('div');
  w.className='card vid-card'; w.dataset.type='theater';
  w.dataset.itemId=id; w.dataset.ytuid=theaterUid;
  Object.assign(w.style,{position:'absolute',left:'80px',top:'80px',zIndex:++zTop,
    width:VID_W+'px',height:(HEAD+120+CTRL)+'px',display:'flex',flexDirection:'column'});
  w.innerHTML=`<div class="ch" style="height:${HEAD}px;flex-shrink:0">
      <span class="ct">▶ Navegador</span>
      <div style="display:flex;align-items:center;gap:.38rem">
        <span class="vsync">SYNC</span>
        <button class="cx" onclick="encerrarSessaoTheater(true, this.closest('.card').dataset.itemId)">×</button>
      </div>
    </div>
    <div class="theater-body" id="thr-body-${theaterUid}">
      <div class="theater-title" id="thr-title-${theaterUid}">Nenhum vídeo detectado</div>
      <div class="theater-sub" id="thr-sub-${theaterUid}">Abra uma página com vídeo</div>
      <button class="btn bp bsm" onclick="showTheater()" style="margin-top:.5rem">Abrir navegador</button>
    </div>
    <div class="vctrl" style="height:${CTRL}px;flex-shrink:0">
      <button class="vcbtn" onclick="vPlay('${theaterUid}')"><svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5,3 19,12 5,21"/></svg></button>
      <button class="vcbtn" onclick="vPause('${theaterUid}')"><svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button>
      <button class="vcbtn" onclick="vSeek('${theaterUid}',-10)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 100-.49"/></svg></button>
      <button class="vcbtn" onclick="vSeek('${theaterUid}',10)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 110-.49"/></svg></button>
      <span class="vtime" id="vt-${theaterUid}">0:00</span>
    </div>`;
  const rzh=document.createElement('div'); rzh.className='rzh'; w.appendChild(rzh);
  c.appendChild(w); els.push(w);

  /* Registro como player: daqui pra frente a sincronia trata este vídeo
     exatamente como trataria um do YouTube. */
  ytPlrs[theaterUid]={
    playVideo(){  desiredPlaying[theaterUid]=true;  Theater.control({action:'play'}); },
    pauseVideo(){ desiredPlaying[theaterUid]=false; Theater.control({action:'pause'}); },
    seekTo(t){    Theater.control({action:'seek', value:Number(t)||0}); theaterState.t=t; },
    setRate(r){   Theater.control({action:'rate', value:Number(r)||1}); },
    setVolume(v){ Theater.control({action:'vol',  value:Number(v)||0}); },
    getCurrentTime(){ return theaterState.t||0; },
    getDuration(){    return theaterState.d||0; },
    isPlaying(){      return !!theaterState.p; }
  };
  desiredPlaying[theaterUid]=false;
  setSyncHost(theaterUid,U.id);      // quem abriu o navegador é o relógio
  startSyncTicker();
  applyVolumeToPlayer(theaterUid);

  // avisa os outros que existe um card de navegador na sala
  /* Não anunciamos ADD_ITEM aqui: quem cria o card nos outros aparelhos é a
     mensagem THEATER_OPEN. Ter dois caminhos criando card era a origem dos
     cards duplicados e dos cards vazios. */
}

/* ══════════════════════════════════════════════════════════════════
   VÍDEO DENTRO DO CARD
   Antes o vídeo tocava no navegador escondido e o card mostrava só texto —
   você ouvia mas não via. Agora o navegador nativo é posicionado EXATAMENTE
   sobre a área do card, com as barras escondidas e a página isolada (só o
   player visível). O resultado é o vídeo aparecendo dentro do card, como
   qualquer outro player da sala.
   ══════════════════════════════════════════════════════════════════ */
let _modoCard=false, _boundsRAF=null;

function areaDoCard(){
  const card=qs('[data-ytuid="'+theaterUid+'"]'); if(!card) return null;
  const corpo=$('thr-body-'+theaterUid) || card;
  const r=corpo.getBoundingClientRect();
  if(r.width<10||r.height<10) return null;
  return { x:Math.round(r.left), y:Math.round(r.top),
           w:Math.round(r.width), h:Math.round(r.height) };
}
/* Reposiciona o navegador quando o card é arrastado, redimensionado ou a tela gira. */
function encaixarNoCard(){
  if(!_modoCard||!Theater) return;
  if(_boundsRAF) return;
  _boundsRAF=requestAnimationFrame(()=>{
    _boundsRAF=null;
    const a=areaDoCard(); if(!a) return;
    Theater.setBounds(a).catch(()=>{});
  });
}
async function entrarModoCard(){
  if(!Theater) return;
  if(_pluginV<2){ avisarPluginAntigo(); return; }
  const a=areaDoCard(); if(!a) return;
  /* Reaplica o isolamento depois de alguns segundos: anúncios e partes da página
     costumam carregar atrasados e voltam a cobrir o vídeo. Reaplicar garante que
     o que fica visível continue sendo o player. */
  clearTimeout(window.__thrReIso1); clearTimeout(window.__thrReIso2);
  window.__thrReIso1=setTimeout(()=>{ if(_modoCard&&Theater) Theater.isolate({on:true}).catch(()=>{}); },2500);
  window.__thrReIso2=setTimeout(()=>{ if(_modoCard&&Theater) Theater.isolate({on:true}).catch(()=>{}); },6000);
  try{
    await Theater.isolate({on:true});     // esconde o resto da página
    await Theater.setBounds(a);           // encaixa o navegador no card
    _modoCard=true;
    const card=qs('[data-ytuid="'+theaterUid+'"]');
    if(card) card.classList.add('theater-embed');
    // acompanha movimento/redimensionamento do card
    window.addEventListener('resize',encaixarNoCard);
    if(!window.__thrObs){
      window.__thrObs=setInterval(()=>{ if(_modoCard) encaixarNoCard(); },400);
    }
  }catch(e){
    console.error('modo card',e);
    toast('Não consegui encaixar o vídeo no card: '+(e.message||e),'err');
  }
}
async function sairModoCard(){
  if(!Theater) return;
  _modoCard=false;
  const card=qs('[data-ytuid="'+theaterUid+'"]');
  if(card) card.classList.remove('theater-embed');
  try{ await Theater.isolate({on:false}); await Theater.setFullscreen(); }catch(e){}
}
/* Mantém o card em dia com o que está tocando na página. */
function updateTheaterCard(){
  const t=$('thr-title-'+theaterUid), s=$('thr-sub-'+theaterUid), vt=$('vt-'+theaterUid);
  if(t) t.textContent = theaterState.found
      ? (theaterState.title||'Vídeo detectado')
      : 'Nenhum vídeo detectado';
  if(s) s.textContent = theaterState.found
      ? (theaterState.p?'tocando · sincronizado':'pausado · sincronizado')
      : 'Abra uma página com vídeo';
  if(vt) vt.textContent=fmtTime(theaterState.t||0);
  const card=qs('[data-ytuid="'+theaterUid+'"]');
  if(card) card.classList.toggle('theater-live',!!theaterState.found);
}
async function showTheater(){
  if(!Theater) return;
  await sairModoCard();     // devolve a página ao normal antes de navegar
  Theater.show();
}
function hideTheater(){ if(Theater) Theater.hide(); }
async function closeTheaterCard(){ await encerrarSessaoTheater(true); }

/* Botão na barra da sala — só aparece quando rodando como app. */
/* O botão fica sempre visível: se a função não estiver disponível, ele explica
   o motivo ao ser tocado (ver theaterDiagnostico). */
document.addEventListener('DOMContentLoaded',()=>{
  try{
    if(initTheater()) console.log('[navegador] plugin pronto');
    else console.log('[navegador] indisponível:', theaterDiagnostico());
  }catch(e){ console.warn('[navegador]',e); }
});
