'use strict';
/* ── CONSTANTS ── */
const SUPA_URL  = 'https://vhflsjrawbvmokyzegef.supabase.co';
const SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoZmxzanJhd2J2bW9reXplZ2VmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NjY4OTksImV4cCI6MjA5NDU0Mjg5OX0._ej361ZjDBcnFuBHn3YIhvGmpRhZLWhG8Rth4p6ugZ0';
const KLIPY_KEY = 'hc7D7nAjR0hmqWoHyNrgifqGKw2TdZAIMugS0SJCOqlVk7OrIgIe1pjExXBlaz4r';
const DISC_THEME_URL = 'https://i.postimg.cc/j5f4ysBr/3fd216ae1e7d0755e48b1b6268b3ad61.jpg'; // imagem fixa do disco — mesma em todos os cards, não gira
const YT_CLIENT_ID = '1076461455830-tgstle9p0ofpviqr8qd5puc9frp9321n.apps.googleusercontent.com'; // não usado mais, mantido por compatibilidade
const YT_API_KEY = 'AIzaSyD6KXzYmg42GL9thLhmEOvKPoyjc90MMA8'; // chave simples da YouTube Data API v3 — não expira, sem login
const DRAWCOLORS = ['#eae6de','#c45c5c','#5c7ec4','#5cc47e','#c4a05c','#f97316','#9b5cc4','#000000'];
const HEAD=32, CTRL=40, VID_W=460, VID_H=258; // video card dimensions
const SUGG=92, NOTE_H=34; // altura extra: faixa "a seguir" (YouTube) e nota do embed genérico
/* Badge "Owner" — aparece permanentemente ao lado do nome de quem faz login com este e-mail,
   em qualquer lugar do app onde o nome dessa pessoa apareça (sala, perfil, chat, chamada, etc). */
const OWNER_EMAIL = 'tenya152408@gmail.com'; // e-mail de login do dono da plataforma
const OWNER_BADGE_GIF = 'https://i.postimg.cc/htHhLbRX/Suoming-chibi-cartoon-dance-hold-mouth-hand-shake.gif';
let OWNER_UID = null; // resolvido uma vez a partir do e-mail acima e guardado em cache

/* ── STATE ── */
let U        = {name:'',email:'',photo:'',id:'',color:'#c45c5c',username:'',bio:'',banner:null,frame:null,frame_scale:1,frame_x:0,frame_y:0};
let room     = null;
let els      = [];
let peers    = {};
/* Ponte pra parte nativa saber se há algo tocando de verdade. O app nativo
   consulta isso ANTES de acender o serviço de segundo plano — sem essa
   pergunta, ele acendia a notificação toda vez que você minimizava o app,
   mesmo sem nada tocando, o que é desperdício de bateria e aumenta a chance
   de esbarrar nas restrições do Android para iniciar serviço em primeiro
   plano a partir de segundo plano. */
window.__algoTocando = function(){
  try{
    if (typeof callActive!=='undefined' && callActive) return true;
    if (typeof desiredPlaying==='object'){
      for(const k in desiredPlaying) if(desiredPlaying[k]) return true;
    }
    if (typeof mPlaying==='object'){
      for(const k in mPlaying) if(mPlaying[k]) return true;
    }
    return false;
  }catch(e){ return false; }
};
let ytPlrs   = {};  // uid -> YT.Player (ou proxy compatível: playVideo/pauseVideo/seekTo/getCurrentTime/getDuration/isPlaying)
let _vtTimers = {}; // uid -> id do setInterval que atualiza o tempo exibido (limpo ao remover o card)
let ytReady  = false;
let activeVideoCardId = null; // itemId do card de vídeo único que é reaproveitado (não abre outro item a cada vídeo novo)
let activeMusicCardId = null; // itemId do card de música único, mesma lógica
let desiredPlaying = {};      // uid -> true/false: o que deveria estar tocando (usado pra "curar" pausas sozinhas)
let _syncSuppress   = {};     // uid -> true enquanto aplicamos uma sync recebida (evita eco/loop de broadcast)
let gifMode  = 'canvas';
let tbPos    = 'top';
let pendImg  = null;
let zTop     = 10;
let hbTimer  = null;
let _supa    = null;
let _ch      = null;
let channel  = null; // alias for _ch
let ytGToken = localStorage.getItem('tfm_yt_token') || null; // Google OAuth access token para YouTube Data API

/* ── QUADRO COLABORATIVO (estilo Miro) ── */
let boardNodes = {};           // id -> row do banco (board_nodes)
let boardEdges = {};           // id -> row do banco (board_edges)
let boardPollTimer = null;
let boardConnectMode = false;
let boardConnectFrom = null;
let boardDrag = null;          // {id,startX,startY,startLeft,startTop}
const BOARD_COLORS = ['#f5d78a','#a8e6b0','#a8d4f5','#f5a8c8','#d7c1f0'];

/* pendências de upload de perfil */
let pendingAvatarFile = null;
let pendingBannerFile = null;

/* ── CHAMADA DE VOZ (WebRTC em malha, sinalização pelo mesmo canal do Supabase) ── */
/* ══════════════════════════════════════════════════════════════════
   SERVIDORES DE CONEXÃO — causa principal do "às vezes não escuto".
   Antes havia só STUN. STUN apenas descobre o seu endereço público e torce
   pra que os dois lados consigam se ligar DIRETO. Em rede móvel (4G/5G) e em
   boa parte dos roteadores domésticos com NAT restrito, essa ligação direta
   não acontece — e sem alternativa a chamada fica muda, às vezes só de um
   lado (por isso "eu escuto e ela não", ou o contrário).
   TURN resolve: é um retransmissor que repassa o áudio quando a conexão
   direta falha. Sem ele, nada mais que eu ajustasse resolveria esses casos.
   Os TURN abaixo são públicos e gratuitos (Open Relay). Funcionam bem, mas
   se um dia a chamada ficar instável em todo lugar, vale contratar um TURN
   dedicado — é barato e é o que garante 100% de conectividade. */
const CALL_ICE_SERVERS = [
  {urls:'stun:stun.l.google.com:19302'},
  {urls:'stun:stun1.l.google.com:19302'},
  {urls:'stun:openrelay.metered.ca:80'},
  {urls:'turn:openrelay.metered.ca:80',            username:'openrelayproject', credential:'openrelayproject'},
  {urls:'turn:openrelay.metered.ca:443',           username:'openrelayproject', credential:'openrelayproject'},
  {urls:'turns:openrelay.metered.ca:443?transport=tcp', username:'openrelayproject', credential:'openrelayproject'}
];
let callActive   = false;      // estou na chamada agora?
let callPeers    = {};         // uid -> {pc, audioEl, analyser, level, pendingCandidates}
let callParticipants = {};     // uid -> {name,color,photo,muted}
let localRawStream  = null;    // stream cru do microfone (antes do supressor)
let localSentStream = null;    // stream já tratada pelo supressor — é o que vai pros outros
let localMuted    = false;
let localDeafened = false;
let callAudioCtx  = null;
let noiseGateNode = null;      // AudioWorkletNode (ou ScriptProcessorNode de fallback) que faz o gate de ruído
let noiseGateSensitivity = 0.35; // 0..1 — abaixo desse nível de energia, o áudio é atenuado
/* DESLIGADO por padrão: o supressor extra roda em JavaScript e, sob carga, perde
   o prazo de processamento e estala. A supressão nativa do navegador (ativada nas
   constraints do getUserMedia) continua funcionando e não tem esse problema.
   Quem quiser o gate extra pode ligar no botão do painel da chamada. */
let noiseGateEnabled = false;
let rawAnalyser   = null;        // nível do microfone ANTES do supressor
let _micWatch     = null;        // vigia do caminho de áudio
let _silentTicks  = 0;           // ciclos seguidos com voz na entrada e silêncio na saída
let _gateBypassed = false;       // supressor desativado automaticamente por segurança
let localAnalyser = null;      // pra mostrar o medidor de nível / indicador de "falando"
let callMeterRAF  = null;

/* drag/resize */
let D=null, R=null, raf=null, px=0,py=0,pw=0,ph=0;

/* draw */
let drawMode=false, drawing=false, eraser=false;
let drawColor='#eae6de', drawHist=[], lastDX=0, lastDY=0;

/* ── INIT ── */
/* Cada etapa do boot roda isolada num try/catch: se UMA falhar (arquivo que não
   carregou, erro de rede, o que for), as OUTRAS continuam normalmente — antes,
   uma exceção em qualquer uma delas interrompia tudo que vinha depois na mesma
   função, inclusive coisas essenciais como checkAuth() (que decide se mostra a
   tela de login ou a principal). A remoção da intro já não depende mais disso
   (ver o script logo depois da div#intro no HTML), mas essa blindagem evita
   que o resto do app também trave por causa de uma falha isolada. */
function safeInit(name,fn){
  try{ fn(); }catch(e){ console.error('[boot] falha ao iniciar "'+name+'":',e); }
}
document.addEventListener('DOMContentLoaded', ()=>{
  safeInit('buildDrawColors',   buildDrawColors);
  safeInit('loadFramePresets',  ()=>{ loadFramePresets().then(buildFramePresets).catch(e=>console.error('[boot] loadFramePresets:',e)); });
  safeInit('ytUpdateLoginUI',   ytUpdateLoginUI);
  safeInit('initProfileSystem', initProfileSystem);
  safeInit('checkAuth',         checkAuth);
  safeInit('initPointer',       initPointer);
  safeInit('initDraw',          initDraw);
  safeInit('initCropDrag',      initCropDrag);
  safeInit('startPlaybackWatchdog', startPlaybackWatchdog);
  safeInit('initNetworkRecovery', initNetworkRecovery);
  safeInit('carregarEscala', carregarEscala);   // aplica o tamanho salvo já na abertura
  safeInit('resolveOwnerUid',   resolveOwnerUid);
  safeInit('globalListeners', ()=>{
    window.addEventListener('pagehide',()=>{ if(callActive)endCall(true); });
    window.addEventListener('resize', ()=>{ drawGrid(); resizeDC(); });
    document.querySelectorAll('.modal').forEach(m=>
      m.addEventListener('click', e=>{ if(e.target===m) m.classList.remove('on'); }));
    document.getElementById('settingsPanel').addEventListener('click', e=>{
      if(e.target===document.getElementById('settingsPanel')) closeSettings();
    });
    document.addEventListener('keydown', e=>{
      if(e.key==='Escape'){ document.querySelectorAll('.modal').forEach(m=>m.classList.remove('on')); closeSettings(); }
      if((e.key==='Delete'||e.key==='Backspace')&&e.target.tagName!=='INPUT'&&e.target.tagName!=='TEXTAREA') delSel();
    });
  });
});
function onYouTubeIframeAPIReady(){ ytReady=true; }

/* ── HELPERS ── */
const $  = id => document.getElementById(id);

/* ══════════════════════════════════════════════════════════════════
   CONFIRMAÇÃO PRÓPRIA — substitui o confirm() nativo do navegador.
   O confirm() nativo expõe o domínio do site na própria caixa de diálogo
   ("discernings.github.io says..."), o que parece feio e fora do controle
   do visual do app. Esta versão é um modal comum da interface, com o
   mesmo estilo do resto do site, e devolve uma Promise<boolean> — então
   os call sites viram só um `await customConfirm(...)` no lugar do antigo
   `if(!confirm(...))return`.
   ══════════════════════════════════════════════════════════════════ */
function customConfirm(message,opts){
  opts=opts||{};
  return new Promise(resolve=>{
    let box=$('customConfirmBox');
    if(!box){
      box=document.createElement('div');
      box.id='customConfirmBox';
      box.className='cc-ov';
      box.innerHTML=`<div class="cc-box">
        <div class="cc-msg" id="ccMsg"></div>
        <div class="cc-actions">
          <button class="btn bg2" id="ccCancel"></button>
          <button class="btn bp" id="ccOk"></button>
        </div>
      </div>`;
      document.body.appendChild(box);
      // BUG evitado: esse listener de clique-fora só é registrado UMA vez (na criação
      // do modal). Se ele capturasse `finish` direto por closure, ficaria travado na
      // promessa da PRIMEIRA chamada pra sempre — clicar fora numa segunda confirmação
      // resolveria a promessa errada (a antiga, já resolvida) em vez da atual. Por isso
      // ele sempre chama o que estiver guardado em box._finish, atualizado a cada chamada.
      box.addEventListener('click',e=>{ if(e.target===box && box._finish) box._finish(false); });
    }
    const finish=ok=>{
      box.classList.remove('on');
      document.removeEventListener('keydown',onKey);
      resolve(ok);
    };
    box._finish=finish;
    const onKey=e=>{ if(e.key==='Escape')finish(false); if(e.key==='Enter')finish(true); };
    $('ccMsg').textContent=message;
    $('ccCancel').textContent=opts.cancelLabel||'Cancelar';
    $('ccOk').textContent=opts.okLabel||'Confirmar';
    $('ccOk').className='btn '+(opts.danger?'bp':'bp');
    $('ccOk').style.background=opts.danger?'linear-gradient(135deg,var(--crimson),#7a2f2f)':'';
    $('ccCancel').onclick=()=>finish(false);
    $('ccOk').onclick=()=>finish(true);
    box.classList.add('on');
    document.addEventListener('keydown',onKey);
    setTimeout(()=>$('ccOk').focus(),50);
  });
}

const qs = sel => document.querySelector(sel);
function toast(msg,type='',onClick=null){
  const t=document.createElement('div'); t.className='toast '+type+(onClick?' clickable':''); t.textContent=msg;
  if(onClick){ t.onclick=()=>{ onClick(); t.remove(); }; }
  document.body.appendChild(t);
  const dur=onClick?5200:2800;
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(40px)'; t.style.transition='all .3s'; setTimeout(()=>t.remove(),320); }, dur);
}
function closeModal(id){ $(id).classList.remove('on'); }
function darken(hex){
  if(!hex||hex.length<7) return '#222';
  return `rgb(${Math.max(0,parseInt(hex.slice(1,3),16)-55)},${Math.max(0,parseInt(hex.slice(3,5),16)-55)},${Math.max(0,parseInt(hex.slice(5,7),16)-55)})`;
}
function fmtTime(t){ return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0'); }

/* ── ANTI-ECO / ANTI-PAUSA ESPONTÂNEA ──
   Problema original: ao aplicar uma sync recebida (play/pause/seek de outra pessoa),
   o player local disparava seu próprio evento de estado, que era rebroadcast, criando
   loops de play/pause entre participantes — e, em cima disso, iframes escondidos ou fora
   da tela (ex: player de música em -9999px) eram pausados sozinhos pelo navegador por
   otimização de energia. As funções abaixo resolvem os dois problemas:
   1) suppressSync/isSuppressed: enquanto aplicamos uma ação vinda da rede, ignoramos o
      eco do próprio evento do player, evitando o loop.
   2) startPlaybackWatchdog: verifica periodicamente se algo que "deveria" estar tocando
      parou sozinho (throttle do navegador, perda de foco, etc) e retoma automaticamente. */
/* Janela de silêncio depois de aplicar uma sincronização recebida.
   Subiu de 1,2s para 2,5s porque era CURTA DEMAIS: dar seek e voltar a tocar
   leva mais que isso (o player precisa rebufferizar), então os eventos gerados
   pela nossa própria ação vazavam da janela e eram reenviados como se fossem
   uma ação do usuário — com um tempo já velho. O outro lado obedecia e voltava
   atrás; o eco ia e voltava, arrastando os dois pra trás poucos segundos por vez.
   É exatamente o "volta sozinho" que só parava ao pausar e dar play (porque a
   pausa manual zera a disputa). */
function suppressSync(uid,ms){
  _syncSuppress[uid]=true;
  clearTimeout(_syncSuppress['_t_'+uid]);
  _syncSuppress['_t_'+uid]=setTimeout(()=>{_syncSuppress[uid]=false;},ms||2500);
}
function isSuppressed(uid){ return !!_syncSuppress[uid]; }
function startPlaybackWatchdog(){
  setInterval(()=>{
    if(document.hidden)return; // com a aba oculta o navegador pausa de propósito; não brigar com ele
    const uids=Object.keys(ytPlrs);
    if(!uids.length)return;    // sem players, não faz nada
    uids.forEach(uid=>{
      if(!desiredPlaying[uid]||isSuppressed(uid))return;
      const p=ytPlrs[uid]; if(!p)return;
      try{ if(!p.isPlaying())p.playVideo(); }catch(e){}
    });
  },3000);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)return;
    // Ao voltar pra aba/app, retoma o que devia estar tocando (mobile/OS costuma pausar iframes em background)
    Object.keys(ytPlrs).forEach(uid=>{
      if(!desiredPlaying[uid])return;
      const p=ytPlrs[uid]; if(!p)return;
      try{ if(!p.isPlaying())p.playVideo(); }catch(e){}
    });
  });
}
function setConnStatus(s){
  const dot=$('connDot'), lbl=$('connLbl'); if(!dot||!lbl) return;
  const states={SUBSCRIBED:['#5cc47e','conectado'],JOINING:['#c4a060','conectando...'],CHANNEL_ERROR:['#c45c5c','erro · reconectando'],TIMED_OUT:['#c45c5c','timeout'],CLOSED:['#4a4540','desconectado']};
  const [color,text]=states[s]||['#c4a060','conectando...'];
  dot.style.background=color; lbl.textContent=text;
}

/* ── AUTH PHOTO ── */
function handlePhoto(input,form){
  const f=input.files[0]; if(!f) return;
  const r=new FileReader(); r.onload=e=>openCropModal(e.target.result,f.type||'image/png',form); r.readAsDataURL(f);
  input.value='';
}

/* ── AUTH ── */
