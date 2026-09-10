/* ── PLAYER DE VÍDEO ÚNICO (YouTube / Vimeo / Twitch / arquivo direto·HLS) ──
   Só existe UM card de vídeo "tocável" por vez: colocar um novo vídeo/link
   carrega dentro do mesmo player (mesmo card, mesmo elemento), em vez de abrir
   um card novo cada vez. Todos os quatro tipos usam a mesma interface
   (playVideo/pauseVideo/seekTo/getCurrentTime/getDuration/isPlaying) registrada
   em ytPlrs[uid], por isso os controles, o SYNC e o watchdog anti-pausa funcionam
   igual pra qualquer um deles. Só o embed "genérico" (site desconhecido) fica de
   fora, porque não existe API pra controlar o play/pause de uma página qualquer. */
function openVideoModal(){ openUniversalVideoPanel(); }
function addVideo(){ addUniversalVideo(); }
function kindLabel(kind,source){
  if(kind==='youtube')return 'YouTube';
  if(kind==='vimeo')return 'Vimeo';
  if(kind==='twitch')return 'Twitch';
  if(kind==='html5')return isHLS(source)?'Live/HLS':'Vídeo';
  return 'Vídeo';
}
function kindOpenHref(kind,source){
  if(kind==='youtube')return 'https://www.youtube.com/watch?v='+source;
  if(kind==='vimeo')return 'https://vimeo.com/'+source;
  if(kind==='twitch'){ const [t,id]=source.split(':'); return t==='channel'?'https://twitch.tv/'+id:'https://twitch.tv/videos/'+id; }
  return null;
}
/* Ponto de entrada único: usa o player já aberto se existir, senão cria um novo (e passa a ser o único). */
function loadVideoUnified(kind,source){
  if(!room){toast('Entre em uma sala primeiro','err');return;}
  _claimHostNext=true;   // quem coloca o vídeo passa a ser o relógio da sessão
  const existing = activeVideoCardId && qs('[data-item-id="'+activeVideoCardId+'"]');
  if(existing){ switchVideoCardTo(existing,kind,source,true); }
  else{
    const c=$('items'), id='vid_'+Date.now();
    const x=60+Math.random()*180, y=60+Math.random()*160;
    mkMediaVid(kind,source,x,y,id,c,true);
    activeVideoCardId=id;
    if(_claimHostNext){ setSyncHost('ytp_'+id,U.id); _claimHostNext=false; }
    startSyncTicker();
  }
  toast(kindLabel(kind,source)+' carregado no player · SYNC');
}
function mkMediaVid(kind,source,x,y,id,container,broadcastIt){
  const uid='ytp_'+id;
  const w=document.createElement('div'); w.className='card vid-card'; w.dataset.type='video'; w.dataset.itemId=id; w.dataset.ytuid=uid; w.dataset.kind=kind;
  if(kind==='youtube'){ w.dataset.vid=source; } else { w.dataset.vid=''; w.dataset.embedUrl=source; }
  const extra=0;   // a faixa 'a seguir' começa recolhida; o card só cresce quando ela abre
  Object.assign(w.style,{position:'absolute',left:x+'px',top:y+'px',zIndex:++zTop,width:VID_W+'px',height:(HEAD+VID_H+CTRL+extra)+'px',display:'flex',flexDirection:'column'});
  const href=kindOpenHref(kind,source);
  w.innerHTML=`<div class="ch" style="height:${HEAD}px;flex-shrink:0"><span class="ct">▶ ${kindLabel(kind,source)}</span><div style="display:flex;align-items:center;gap:.38rem"><span class="vsync">SYNC</span>${href?`<a class="vcbtn" href="${href}" target="_blank" rel="noopener" title="Abrir original" style="line-height:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></a>`:''}<button class="cx" onclick="removeEl(this.closest('.card'))">×</button></div></div><div id="ypc-${uid}" class="ypc" style="flex:1;min-height:0;width:100%;background:#000;overflow:hidden;position:relative"></div><div class="vbar" id="vbar-${uid}" onpointerdown="vBarSeek(event,'${uid}')" title="Arraste para navegar"><div class="vbar-fill" id="vbf-${uid}"></div><span class="vbar-knob" id="vbk-${uid}"></span></div><div class="vctrl" style="height:${CTRL}px;flex-shrink:0"><button class="vcbtn" onclick="vPlay('${uid}')"><svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5,3 19,12 5,21"/></svg></button><button class="vcbtn" onclick="vPause('${uid}')"><svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button><button class="vcbtn" onclick="vSeek('${uid}',-10)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 100-.49"/></svg></button><button class="vcbtn" onclick="vSeek('${uid}',10)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 110-.49"/></svg></button><span class="vtime" id="vt-${uid}">0:00</span><span class="vtime vtime-dur" id="vd-${uid}"></span><button class="vcbtn vc-embed" onclick="openEmbedFor('${uid}')" title="Trocar / incorporar outro vídeo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></button><button class="vcbtn vc-upnext vc-big" id="vnb-${uid}" onclick="toggleUpNext('${uid}')" title="Mostrar/ocultar próximos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="18 15 12 9 6 15"/></svg></button></div><div class="vupnext" id="vun-${uid}"></div>`;
  const rzh=document.createElement('div'); rzh.className='rzh'; w.appendChild(rzh);
  container.appendChild(w); els.push(w);
  if(broadcastIt)broadcast({type:'ADD_ITEM',item:{type:'video',kind,source,x,y,id}});
  setTimeout(()=>initMediaPlayer(uid,kind,source,VID_W,VID_H),300);
  if(kind==='youtube')setTimeout(()=>videoShowSuggestions(uid,source),900);
}
/* Troca o vídeo/embed dentro do MESMO card (mesmo player quando possível — YouTube usa
   loadVideoById nativo, sem recriar o iframe). Chamado tanto ao colocar um link novo
   quanto ao clicar numa sugestão "a seguir". */
function switchVideoCardTo(card,kind,source,broadcastIt){
  const uid=card.dataset.ytuid, oldKind=card.dataset.kind;
  card.dataset.kind=kind;
  if(kind==='youtube'){ card.dataset.vid=source; card.dataset.embedUrl=''; } else { card.dataset.vid=''; card.dataset.embedUrl=source; }
  const ctSpan=card.querySelector('.ct'); if(ctSpan)ctSpan.textContent='▶ '+kindLabel(kind,source);
  const openLink=card.querySelector('a.vcbtn'); const href=kindOpenHref(kind,source);
  if(openLink&&href)openLink.href=href;
  /* TROCA DE VÍDEO — janela de silêncio LONGA (6s), e é aqui que estava o problema.
     Ao carregar um vídeo novo, o player dispara uma sequência de eventos (carregando,
     buffer, tocando) que leva vários segundos pra assentar, e os dois lados fazem isso
     ao mesmo tempo em ritmos diferentes. Com a janela curta, esses eventos vazavam e
     eram enviados como se fossem ação do usuário, com tempos defasados — cada lado
     mandava o outro voltar, repetidamente, nos primeiros segundos de reprodução.
     Seis segundos cobrem o carregamento inteiro; depois disso os dois já estão
     estáveis e a sincronização normal assume. */
  if(oldKind===kind && kind==='youtube' && ytPlrs[uid] && ytPlrs[uid].loadVideoById){
    suppressSync(uid,6000); ytPlrs[uid].loadVideoById(source); desiredPlaying[uid]=true;
  }else{
    const cont=$('ypc-'+uid); if(cont){cont.innerHTML='';delete cont.dataset.ytinit;}
    delete ytPlrs[uid]; delete desiredPlaying[uid]; clearInterval(_vtTimers[uid]); delete _vtTimers[uid];
    suppressSync(uid,6000);   // faltava aqui: ao recriar o player do zero, o eco era ainda pior
    setTimeout(()=>initMediaPlayer(uid,kind,source,VID_W,VID_H),50);
  }
  const wrap=$('vun-'+uid);
  if(wrap) wrap.innerHTML='';                      // limpa as do vídeo anterior
  if(kind==='youtube' && _upNextOpen[uid]) videoShowSuggestions(uid,source);
  if(broadcastIt){
    setSyncHost(uid,U.id);            // eu troquei o vídeo: eu viro o relógio
    broadcast({type:'MEDIA_SWITCH',itemId:card.dataset.itemId,kind,source,uid:U.id});
  }
  startSyncTicker();
}
function applyMediaSwitch(itemId,kind,source,fromUid){
  const card=qs('[data-item-id="'+itemId+'"]'); if(!card)return;
  switchVideoCardTo(card,kind,source,false);
  if(fromUid) setSyncHost(card.dataset.ytuid,fromUid);  // quem trocou é o relógio
  startSyncTicker();
}
function initMediaPlayer(uid,kind,source,iw,ih,retries){
  if(kind==='youtube')return initYT(uid,source,iw,ih,retries);
  if(kind==='vimeo')return initVimeo(uid,source,iw,ih,retries);
  if(kind==='twitch')return initTwitch(uid,source,iw,ih,retries);
  if(kind==='html5'){ const cont=$('ypc-'+uid); if(!cont||cont.dataset.ytinit)return; cont.dataset.ytinit='1'; return initHtml5(uid,source,cont); }
}
function initYT(uid,vid,iw,ih,_retries){
  _retries=(_retries||0)+1;
  if(!ytReady && window.YT && window.YT.Player){ ytReady=true; }
  if(!ytReady){
    if(_retries>40){
      const cont=$('ypc-'+uid);
      if(cont)cont.innerHTML=`<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;color:#9a9aa5;font-size:.72rem;text-align:center;padding:.5rem">
        <span>Não foi possível carregar o player aqui.</span>
        <a href="https://www.youtube.com/watch?v=${vid}" target="_blank" rel="noopener" style="color:#8fd6b0;text-decoration:underline">Abrir no YouTube ↗</a>
      </div>`;
      return;
    }
    setTimeout(()=>initYT(uid,vid,iw,ih,_retries),500);
    return;
  }
  const cont=$('ypc-'+uid); if(!cont||cont.dataset.ytinit)return; cont.dataset.ytinit='1';
  const p=new YT.Player(cont,{width:String(iw||VID_W),height:String(ih||VID_H),videoId:vid,
    playerVars:{autoplay:0,controls:0,modestbranding:1,rel:0,fs:1,iv_load_policy:3,playsinline:1},
    events:{
      onReady:()=>{ ytPlrs[uid]=p; desiredPlaying[uid]=false;
        p.setVolumeUnified=v=>{ try{ p.setVolume(Math.round(v*100)); }catch(e){} };
        p.setRate=r=>{ try{ p.setPlaybackRate(r); }catch(e){} };
        applyVolumeToPlayer(uid);
        // Timer registrado em _vtTimers pra ser limpo quando o card sai (antes vazava:
        // um setInterval por player, pra sempre, mesmo depois de trocar de vídeo).
        clearInterval(_vtTimers[uid]);
        _vtTimers[uid]=setInterval(()=>{
          if(document.hidden)return;              // não gasta CPU com a aba em segundo plano
          const el=$('vt-'+uid); if(!el){ clearInterval(_vtTimers[uid]); delete _vtTimers[uid]; return; }
          try{
            const t=p.getCurrentTime()||0;
            el.textContent=fmtTime(t);
            atualizarBarra(uid,t,(p.getDuration&&p.getDuration())||0);
          }catch(e){}
        },500); },
      onStateChange:e=>{
        if(isSuppressed(uid))return; // eco de uma sync que acabamos de aplicar — ignora, evita loop
        if(e.data===YT.PlayerState.PLAYING){ desiredPlaying[uid]=true; broadcast({type:'VID_SYNC',uid_player:uid,action:'play',time:p.getCurrentTime(),at:Date.now()}); }
        if(e.data===YT.PlayerState.PAUSED){ desiredPlaying[uid]=false; broadcast({type:'VID_SYNC',uid_player:uid,action:'pause',time:p.getCurrentTime(),at:Date.now()}); }
      },
      onError:()=>{ toast('Esse vídeo não pôde ser reproduzido (indisponível/bloqueado)','err'); }
    }});
}
/* Vimeo — usa o SDK oficial (player.js), API assíncrona baseada em Promise;
   mantemos um cache local (_cur/_dur/_playing) atualizado via evento timeupdate
   pra expor a mesma interface síncrona que o resto do player usa. */
function initVimeo(uid,vid,iw,ih,_retries){
  _retries=(_retries||0)+1;
  if(!(window.Vimeo && window.Vimeo.Player)){
    if(_retries>40){ const cont=$('ypc-'+uid); if(cont)cont.innerHTML='<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#9a9aa5;font-size:.72rem;text-align:center;padding:.5rem">Não foi possível carregar o player do Vimeo aqui.</div>'; return; }
    setTimeout(()=>initVimeo(uid,vid,iw,ih,_retries),500); return;
  }
  const cont=$('ypc-'+uid); if(!cont||cont.dataset.ytinit)return; cont.dataset.ytinit='1';
  let _cur=0,_dur=0,_playing=false;
  const player=new Vimeo.Player(cont,{id:Number(vid),width:iw,height:ih,controls:false,autoplay:false});
  desiredPlaying[uid]=false;
  player.on('play',()=>{ if(isSuppressed(uid))return; _playing=true; desiredPlaying[uid]=true; broadcast({type:'VID_SYNC',uid_player:uid,action:'play',time:_cur,at:Date.now()}); });
  player.on('pause',()=>{ if(isSuppressed(uid))return; _playing=false; desiredPlaying[uid]=false; broadcast({type:'VID_SYNC',uid_player:uid,action:'pause',time:_cur,at:Date.now()}); });
  player.on('timeupdate',d=>{
    _cur=d.seconds||0; _dur=d.duration||0;
    const el=$('vt-'+uid); if(el)el.textContent=fmtTime(_cur);
    atualizarBarra(uid,_cur,_dur);
  });
  player.on('error',()=>{ toast('Esse vídeo do Vimeo não pôde ser reproduzido','err'); });
  ytPlrs[uid]={
    playVideo(){ desiredPlaying[uid]=true; player.play().catch(()=>{}); },
    pauseVideo(){ desiredPlaying[uid]=false; player.pause().catch(()=>{}); },
    seekTo(t){ _cur=t; player.setCurrentTime(t).catch(()=>{}); },
    getCurrentTime(){ return _cur; },
    getDuration(){ return _dur; },
    isPlaying(){ return _playing; },
    setVolume(v){ player.setVolume(v).catch(()=>{}); },   // Vimeo usa 0..1
    setRate(r){ player.setPlaybackRate(r).catch(()=>{}); }
  };
  applyVolumeToPlayer(uid);
}
/* Twitch — usa o SDK oficial de embed (Twitch.Player), que já expõe play/pause/seek/getCurrentTime. */
function initTwitch(uid,source,iw,ih,_retries){
  _retries=(_retries||0)+1;
  if(!(window.Twitch && window.Twitch.Player)){
    if(_retries>40){ const cont=$('ypc-'+uid); if(cont)cont.innerHTML='<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#9a9aa5;font-size:.72rem;text-align:center;padding:.5rem">Não foi possível carregar o player da Twitch aqui.</div>'; return; }
    setTimeout(()=>initTwitch(uid,source,iw,ih,_retries),500); return;
  }
  const cont=$('ypc-'+uid); if(!cont||cont.dataset.ytinit)return; cont.dataset.ytinit='1';
  const [type,tid]=source.split(':');
  const opts={width:iw,height:ih,parent:[location.hostname]};
  if(type==='video')opts.video=tid; else if(type==='clip')opts.clip=tid; else opts.channel=tid;
  const player=new Twitch.Player(cont.id,opts);
  let _playing=false;
  desiredPlaying[uid]=false;
  /* A Twitch não avisa o tempo sozinha, então perguntamos periodicamente.
     Sem isto o card dela ficaria sem tempo e sem barra de progresso. */
  clearInterval(_vtTimers[uid]);
  _vtTimers[uid]=setInterval(()=>{
    if(document.hidden) return;
    const el=$('vt-'+uid);
    if(!el){ clearInterval(_vtTimers[uid]); delete _vtTimers[uid]; return; }
    try{
      const t=player.getCurrentTime()||0, d=player.getDuration()||0;
      el.textContent=fmtTime(t);
      atualizarBarra(uid,t,d);
    }catch(e){}
  },500);
  player.addEventListener(Twitch.Player.PLAY,()=>{ if(isSuppressed(uid))return; _playing=true; desiredPlaying[uid]=true; try{broadcast({type:'VID_SYNC',uid_player:uid,action:'play',time:player.getCurrentTime()||0,at:Date.now()});}catch(e){} });
  player.addEventListener(Twitch.Player.PAUSE,()=>{ if(isSuppressed(uid))return; _playing=false; desiredPlaying[uid]=false; try{broadcast({type:'VID_SYNC',uid_player:uid,action:'pause',time:player.getCurrentTime()||0,at:Date.now()});}catch(e){} });
  ytPlrs[uid]={
    playVideo(){ desiredPlaying[uid]=true; try{player.play();}catch(e){} },
    pauseVideo(){ desiredPlaying[uid]=false; try{player.pause();}catch(e){} },
    seekTo(t){ try{player.seek(t);}catch(e){} },
    getCurrentTime(){ try{return player.getCurrentTime()||0;}catch(e){return 0;} },
    getDuration(){ try{return player.getDuration()||0;}catch(e){return 0;} },
    isPlaying(){ return _playing; },
    setVolume(v){ try{ player.setVolume(v); }catch(e){} }  // Twitch usa 0..1 (sem controle de velocidade: correção só por salto)
  };
  applyVolumeToPlayer(uid);
}
/* Arquivo direto (mp4/webm/...) ou HLS (.m3u8) — <video> nativo. Os eventos play/pause/seeked
   do próprio elemento cobrem qualquer forma de interação (nossos botões ou os controles nativos). */
function initHtml5(uid,src,cont){
  const vidEl=document.createElement('video'); vidEl.controls=true; vidEl.preload='metadata'; vidEl.playsInline=true;
  vidEl.style.cssText='width:100%;height:100%;background:#000;display:block;object-fit:contain';
  cont.appendChild(vidEl);
  if(isHLS(src)){
    if(vidEl.canPlayType('application/vnd.apple.mpegurl')){ vidEl.src=src; }
    else if(window.Hls && Hls.isSupported()){ const hls=new Hls(); hls.loadSource(src); hls.attachMedia(vidEl); }
    else{
      let tries=0;
      const wait=setInterval(()=>{
        tries++;
        if(window.Hls && Hls.isSupported()){ clearInterval(wait); const hls=new Hls(); hls.loadSource(src); hls.attachMedia(vidEl); }
        else if(tries>20){ clearInterval(wait); vidEl.src=src; }
      },150);
    }
  }else{ vidEl.src=src; }
  desiredPlaying[uid]=false;
  vidEl.addEventListener('play',()=>{ if(isSuppressed(uid))return; desiredPlaying[uid]=true; broadcast({type:'VID_SYNC',uid_player:uid,action:'play',time:vidEl.currentTime,at:Date.now()}); });
  vidEl.addEventListener('pause',()=>{ if(isSuppressed(uid))return; desiredPlaying[uid]=false; broadcast({type:'VID_SYNC',uid_player:uid,action:'pause',time:vidEl.currentTime,at:Date.now()}); });
  vidEl.addEventListener('seeked',()=>{ if(isSuppressed(uid))return; broadcast({type:'VID_SYNC',uid_player:uid,action:vidEl.paused?'pause':'play',time:vidEl.currentTime,at:Date.now()}); });
  vidEl.addEventListener('timeupdate',()=>{
    const el=$('vt-'+uid); if(el)el.textContent=fmtTime(vidEl.currentTime||0);
    atualizarBarra(uid,vidEl.currentTime||0,vidEl.duration||0);
  });
  /* Erro num arquivo direto quase sempre significa que o CDN do site recusou a
     requisição por vir de outro domínio (proteção de hotlink). Explicamos isso e
     apontamos o caminho que funciona, em vez de só dizer "não carregou". */
  /* BUG CORRIGIDO: eu mostrava o aviso de bloqueio em QUALQUER evento de erro e
     nunca o removia. Vídeos que carregavam normalmente exibiam o aviso por cima
     do player (um erro passageiro de rede, ou o próprio hls.js se recuperando de
     um segmento, já bastava). Agora o aviso só aparece quando o vídeo realmente
     não conseguiu carregar NADA, e some assim que a reprodução começa. */
  const clearVideoWarning=()=>{
    const f=vidEl.parentElement && vidEl.parentElement.querySelector('.ifr-fallback');
    if(f) f.remove();
  };
  ['loadeddata','canplay','playing','progress'].forEach(ev=>
    vidEl.addEventListener(ev,clearVideoWarning));

  vidEl.addEventListener('error',()=>{
    // hls.js cuida dos próprios erros e se recupera sozinho: não interferir
    if(isHLS(src) && window.Hls && Hls.isSupported()) return;
    // se já há dados carregados, não é bloqueio — é soluço passageiro
    if(vidEl.readyState>0) return;
    const err=vidEl.error;
    // só trata falha real de origem/rede; decodificação e abortos não são bloqueio
    if(err && err.code!==MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && err.code!==MediaError.MEDIA_ERR_NETWORK) return;
    const holder=vidEl.parentElement;
    if(holder && !holder.querySelector('.ifr-fallback')){
      const d=document.createElement('div');
      d.className='ifr-fallback';
      d.innerHTML='<span>Não consegui carregar este arquivo. Se for de um site de vídeo, '
        +'ele provavelmente só permite reprodução no domínio dele.<br>'
        +'Use <b>Buscar na página</b> e escolha um resultado do tipo <b>Player</b>.</span>'
        +'<a href="'+src+'" target="_blank" rel="noopener">Abrir o arquivo ↗</a>'
        +'<button onclick="retryHtml5Video(this)">Tentar de novo</button>';
      holder.style.position='relative';
      holder.appendChild(d);
    }
  });
  ytPlrs[uid]={
    playVideo(){ desiredPlaying[uid]=true; vidEl.play().catch(()=>{}); },
    pauseVideo(){ desiredPlaying[uid]=false; vidEl.pause(); },
    seekTo(t){ vidEl.currentTime=t; },
    getCurrentTime(){ return vidEl.currentTime||0; },
    getDuration(){ return vidEl.duration||0; },
    isPlaying(){ return !vidEl.paused; },
    setVolume(v){ vidEl.volume=Math.max(0,Math.min(1,v)); },
    setRate(r){ vidEl.playbackRate=r; }
  };
  applyVolumeToPlayer(uid);
}
/* ══════════════════════════════════════════════════════════════════
   SINCRONIA CONTÍNUA (correção de deriva)

   Até agora a sincronia acontecia só nos EVENTOS: alguém dá play, pausa ou
   pula, e a mensagem vai para os outros. O problema é que, entre um evento e
   outro, os players vão se afastando sozinhos — buffering, conexão mais lenta,
   celular economizando energia. Em dez minutos de vídeo, dois lados podem ficar
   vários segundos separados sem que ninguém tenha tocado em nada.

   A correção é o que apps de assistir junto fazem por baixo: um dos lados é o
   RELÓGIO da sessão e anuncia sua posição a cada 3 segundos; os outros comparam
   e se ajustam continuamente.

   O detalhe que faz diferença é COMO se ajusta:
     • diferença < 0,3s  → ignora (imperceptível, e corrigir só atrapalharia)
     • 0,3s a 2s        → muda a VELOCIDADE em 5% por alguns segundos até
                          encostar. Ninguém percebe, e o vídeo nunca "pula".
     • acima de 2s      → aí sim salta, porque a diferença já é grande demais
                          para ser absorvida suavemente.
   Saltar a cada pequena diferença deixaria o vídeo picotando o tempo todo; é
   por isso que o ajuste fino é feito pela velocidade.
   ══════════════════════════════════════════════════════════════════ */
let _claimHostNext=false;
let videoHost={};      // uid do player -> quem é o relógio da sessão
let _tickTimer=null;
let _lastTickAt={};    // uid -> quando chegou o último anúncio (para detectar host ausente)
let _rateFix={};       // uid -> temporizador que devolve a velocidade normal

function setSyncHost(uidPlayer,hostUid){ videoHost[uidPlayer]=hostUid; }
function isSyncHost(uidPlayer){ return videoHost[uidPlayer]===U.id; }

/* O relógio anuncia sua posição periodicamente. */
function startSyncTicker(){
  if(_tickTimer) return;
  _tickTimer=setInterval(()=>{
    if(document.hidden) return;
    Object.keys(ytPlrs).forEach(uid=>{
      if(!isSyncHost(uid)) return;
      const p=ytPlrs[uid]; if(!p) return;
      try{
        broadcast({type:'VID_TICK',uid_player:uid,time:p.getCurrentTime()||0,
                   playing:!!p.isPlaying(),at:Date.now()});
      }catch(e){}
    });
    // Se o relógio sumiu (saiu da sala), o participante restante assume.
    Object.keys(ytPlrs).forEach(uid=>{
      const last=_lastTickAt[uid]||0;
      if(!isSyncHost(uid) && last && Date.now()-last>12000){
        setSyncHost(uid,U.id);
        _lastTickAt[uid]=Date.now();
      }
    });
  },3000);
}
function stopSyncTicker(){ if(_tickTimer){ clearInterval(_tickTimer); _tickTimer=null; } }

/* Recebe o anúncio do relógio e se ajusta. */
function applyVidTick(uidPlayer,time,playing,sentAt){
  const p=ytPlrs[uidPlayer]; if(!p) return;
  _lastTickAt[uidPlayer]=Date.now();
  if(isSyncHost(uidPlayer)) return;      // eu sou o relógio: não me corrijo
  if(isSuppressed(uidPlayer)) return;    // acabei de aplicar algo: espera assentar
  try{
    const lag=sentAt?Math.max(0,(Date.now()-sentAt)/1000):0;
    if(lag>10) return;                   // anúncio velho demais para ser confiável
    const expected=time+(playing?lag:0);
    const cur=p.getCurrentTime()||0;
    const drift=cur-expected;
    const abs=Math.abs(drift);

    // estado de reprodução também acompanha o relógio
    if(playing && !p.isPlaying()){ desiredPlaying[uidPlayer]=true; p.playVideo(); }
    if(!playing && p.isPlaying()){ desiredPlaying[uidPlayer]=false; p.pauseVideo(); }

    if(abs<0.3){ restoreRate(uidPlayer); return; }        // já está junto
    if(abs>2){                                            // longe demais: salta
      suppressSync(uidPlayer,1500);
      p.seekTo(expected,true);
      restoreRate(uidPlayer);
      return;
    }
    // diferença pequena: encosta mudando a velocidade, sem salto perceptível
    if(p.setRate){
      const rate=drift>0?0.95:1.05;   // atrasado acelera, adiantado desacelera
      try{ p.setRate(rate); }catch(e){}
      clearTimeout(_rateFix[uidPlayer]);
      _rateFix[uidPlayer]=setTimeout(()=>restoreRate(uidPlayer),Math.min(6000,abs*8000));
    }else{
      // player sem controle de velocidade (Twitch): só corrige se ficar feio
      if(abs>1.2){ suppressSync(uidPlayer,1500); p.seekTo(expected,true); }
    }
  }catch(e){}
}
function restoreRate(uid){
  clearTimeout(_rateFix[uid]); delete _rateFix[uid];
  const p=ytPlrs[uid]; if(p&&p.setRate){ try{ p.setRate(1); }catch(e){} }
}
/* ══════════════════════════════════════════════════════════════════
   BARRA DE PROGRESSO — sincronizada.

   Arrastar a barra é uma ação como qualquer outra: o tempo escolhido é aplicado
   aqui e anunciado para a sala, exatamente como os botões de avançar e voltar.
   O relógio da sessão continua corrigindo a deriva depois disso, então todo
   mundo converge para o mesmo instante mesmo com internet diferente.
   ══════════════════════════════════════════════════════════════════ */
function vBarSeek(ev,uid){
  const p=ytPlrs[uid]; if(!p) return;
  const barra=$('vbar-'+uid); if(!barra) return;
  const dur=(p.getDuration&&p.getDuration())||0;
  if(!dur||!isFinite(dur)) return;          // sem duração não há como posicionar

  const aplicar=e=>{
    const r=barra.getBoundingClientRect();
    const frac=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
    const t=frac*dur;
    atualizarBarra(uid,t,dur);              // resposta imediata ao dedo
    return t;
  };
  ev.preventDefault();
  try{ barra.setPointerCapture(ev.pointerId); }catch(e){}
  let tempoFinal=aplicar(ev);

  const mover=e=>{ tempoFinal=aplicar(e); };
  const soltar=()=>{
    barra.removeEventListener('pointermove',mover);
    barra.removeEventListener('pointerup',soltar);
    barra.removeEventListener('pointercancel',soltar);
    try{
      suppressSync(uid,1200);               // evita o eco do próprio seek
      p.seekTo(tempoFinal,true);
      broadcast({type:'VID_SYNC',uid_player:uid,
                 action:p.isPlaying()?'play':'pause',
                 time:tempoFinal,at:Date.now()});
    }catch(e){}
  };
  barra.addEventListener('pointermove',mover);
  barra.addEventListener('pointerup',soltar);
  barra.addEventListener('pointercancel',soltar);
}
/* Desenha a posição atual. Chamado pelo mesmo temporizador que já atualiza o
   tempo, então não cria trabalho extra. */
function atualizarBarra(uid,t,dur){
  const f=$('vbf-'+uid), k=$('vbk-'+uid), d=$('vd-'+uid);
  if(dur>0&&isFinite(dur)){
    const pct=Math.max(0,Math.min(100,(t/dur)*100));
    if(f) f.style.width=pct+'%';
    if(k) k.style.left=pct+'%';
    if(d) d.textContent=fmtTime(dur);
  }else{
    if(f) f.style.width='0%';
    if(d) d.textContent='';               // ao vivo ou duração desconhecida
  }
}
function vPlay(uid){ const p=ytPlrs[uid]; if(p){desiredPlaying[uid]=true;p.playVideo();broadcast({type:'VID_SYNC',uid_player:uid,action:'play',time:p.getCurrentTime(),at:Date.now()});} }
function vPause(uid){ const p=ytPlrs[uid]; if(p){desiredPlaying[uid]=false;p.pauseVideo();broadcast({type:'VID_SYNC',uid_player:uid,action:'pause',time:p.getCurrentTime(),at:Date.now()});} }
function vSeek(uid,d){ const p=ytPlrs[uid]; if(p){const t=Math.max(0,(p.getCurrentTime()||0)+d);p.seekTo(t,true);broadcast({type:'VID_SYNC',uid_player:uid,action:p.isPlaying()?'play':'pause',time:t,at:Date.now()});} }
/* "A seguir": busca vídeos parecidos com o que está tocando (por tags/título — a API do
   YouTube não tem mais busca "relacionados", então usamos o mesmo truque que já funciona
   pro player de música) e mostra dentro do próprio card pra continuar sem sair do player. */
async function videoShowSuggestions(uid,vid){
  const wrap=$('vun-'+uid); if(!wrap)return;
  wrap.innerHTML='<span class="vun-lbl">Buscando a seguir...</span>';
  try{
    let query='';
    try{
      const infoUrl=`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(vid)}&key=${encodeURIComponent(YT_API_KEY)}`;
      const infoRes=await fetch(infoUrl);
      if(infoRes.ok){
        const infoData=await infoRes.json();
        const sn=infoData.items?.[0]?.snippet;
        query = sn?.tags?.length ? sn.tags.slice(0,3).join(' ') : (sn?.title||'');
      }
    }catch(e){}
    if(!query){ wrap.innerHTML=''; return; }
    const url=`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&key=${encodeURIComponent(YT_API_KEY)}&q=${encodeURIComponent(query)}`;
    const res=await fetch(url);
    if(!res.ok){ wrap.innerHTML=''; return; }
    const data=await res.json();
    const items=(data.items||[]).filter(it=>it.id.videoId!==vid).slice(0,8);
    if(!items.length){ wrap.innerHTML=''; return; }
    wrap.innerHTML='<span class="vun-lbl">A seguir</span>'+items.map(it=>{
      const id=it.id.videoId, sn=it.snippet;
      const thumb=sn.thumbnails?.default?.url||'';
      const t=(sn.title||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
      return `<div class="vun-item" onclick="videoPlayNext('${uid}','${id}')" title="${t.replace(/"/g,'&quot;')}">`
        +`<div class="vun-thumb"><img src="${thumb}" loading="lazy" onerror="this.style.display='none'">`
        +`<span class="vun-pl"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="6,4 20,12 6,20"/></svg></span></div>`
        +`<span class="vun-t">${t}</span></div>`;
    }).join('');
  }catch(e){ wrap.innerHTML=''; }
}
/* "A seguir" começa RECOLHIDA e abre/fecha pelo botão da barra, com uma transição
   leve de altura+opacidade. O card guarda a preferência enquanto existir, então
   trocar de vídeo não reabre a faixa sozinha. */
let _upNextOpen={};
function toggleUpNext(uid){
  const wrap=$('vun-'+uid); if(!wrap) return;
  const card=qs('[data-ytuid="'+uid+'"]');
  const open=!_upNextOpen[uid];
  _upNextOpen[uid]=open;
  wrap.classList.toggle('open',open);
  const btn=$('vnb-'+uid); if(btn) btn.classList.toggle('on',open);

  if(open){
    /* BUG CORRIGIDO: as sugestões só eram buscadas ao criar o card. Se a busca
       falhasse, ou se o vídeo não fosse do YouTube, a faixa ficava vazia — e
       como o CSS só a exibe quando tem conteúdo, o botão parecia morto.
       Agora ele carrega sob demanda e sempre mostra alguma coisa: lista,
       "procurando..." ou uma explicação. */
    const kind=card?card.dataset.kind:'';
    const vid =card?card.dataset.vid:'';
    if(!wrap.children.length){
      if(kind==='youtube' && vid){
        wrap.innerHTML='<span class="vun-lbl">buscando...</span>';
        videoShowSuggestions(uid,vid);
      }else{
        wrap.innerHTML='<span class="vun-lbl">sem sugestões</span>'
          +'<span class="vun-empty">A lista de próximos só existe para vídeos do YouTube.</span>';
      }
    }
  }
  if(card){
    // o card cresce/encolhe junto, pra faixa não cobrir o vídeo
    const h=parseInt(card.style.height)||0;
    if(h) card.style.height=(open?h+SUGG:Math.max(HEAD+120+CTRL,h-SUGG))+'px';
    syncPlayerSize(uid);
  }
}
function videoPlayNext(uid,newVid){
  const card=qs('[data-ytuid="'+uid+'"]'); if(!card)return;
  switchVideoCardTo(card,'youtube',newVid,true);
}
/* Embed genérico (site desconhecido) — sem API de controle disponível, então só a posição
   e a presença do card são sincronizadas entre os participantes; deixamos isso claro na UI. */
/* Botão ao lado do player: abre o painel pra colar link, descobrir ou buscar
   o vídeo dentro de uma página — e o resultado troca ESTE player. */
function openEmbedFor(uid){
  const card=qs('[data-ytuid="'+uid+'"]');
  if(card) activeVideoCardId=card.dataset.itemId;   // garante que o resultado vá pro card certo
  openUniversalVideoPanel();
}
function addGenericIframe(url){
  const c=$('items'), id='ifr_'+Date.now();
  const x=60+Math.random()*180, y=60+Math.random()*160;
  mkGenericIframe(url,x,y,id,c,true);
  toast('Vídeo incorporado — posição sincronizada, mas o play/pause não é controlável nesse site');
}
/* Normaliza a URL de embed antes de usar. Cada item aqui é uma causa real de
   "fica preto e não carrega" que estava sem tratamento: */
function normalizeEmbedUrl(url){
  let u=String(url||'').trim();
  if(!u) return u;
  // 1) PROTOCOLO: o site roda em HTTPS. Um embed em http:// é bloqueado pelo
  //    navegador como "conteúdo misto", sem mensagem nenhuma — só tela preta.
  if(u.startsWith('//')) u='https:'+u;
  u=u.replace(/^http:\/\//i,'https://');
  try{
    const p=new URL(u);
    // 2) TWITCH exige o parâmetro parent com o domínio de quem incorpora,
    //    senão recusa a conexão e não mostra nada.
    if(/twitch\.tv/i.test(p.hostname) && !p.searchParams.get('parent')){
      p.searchParams.set('parent',location.hostname);
      u=p.toString();
    }
    // 3) YOUTUBE: link normal (watch?v=) não funciona em iframe; precisa ser /embed/.
    if(/youtube\.com\/watch/i.test(u)){
      const v=p.searchParams.get('v');
      if(v) u='https://www.youtube.com/embed/'+v;
    }
    if(/youtu\.be\//i.test(u)) u='https://www.youtube.com/embed/'+p.pathname.replace(/^\//,'');
    // 4) VIMEO: página normal não incorpora; o endereço de player sim.
    if(/^(www\.)?vimeo\.com$/i.test(p.hostname)){
      const id=p.pathname.replace(/^\//,'').split('/')[0];
      if(/^\d+$/.test(id)) u='https://player.vimeo.com/video/'+id;
    }
  }catch(e){}
  return u;
}
function mkGenericIframe(embedUrl,x,y,id,container,broadcastIt){
  embedUrl=normalizeEmbedUrl(embedUrl);
  const w=document.createElement('div'); w.className='card vid-card'; w.dataset.type='iframe'; w.dataset.itemId=id; w.dataset.embedUrl=embedUrl;
  Object.assign(w.style,{position:'absolute',left:x+'px',top:y+'px',zIndex:++zTop,width:VID_W+'px',height:(HEAD+VID_H+NOTE_H)+'px',display:'flex',flexDirection:'column'});
  w.innerHTML=`<div class="ch" style="height:${HEAD}px;flex-shrink:0"><span class="ct">▶ Vídeo</span><div style="display:flex;align-items:center;gap:.38rem"><span class="vnosync" title="Este player não permite controle externo">SEM SYNC</span><button class="vcbtn" onclick="recarregarIframeCard(this)" title="Recarregar (útil se travar no meio)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M20.49 9A9 9 0 105.64 18.36L1 14M23 4l-4.64 5.36"/></svg></button><button class="vcbtn" onclick="findSyncForCard(this)" title="Procurar versão que sincroniza"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></button><a class="vcbtn" href="${embedUrl}" target="_blank" rel="noopener" title="Abrir em nova aba" style="line-height:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></a><button class="cx" onclick="removeEl(this.closest('.card'))">×</button></div></div>`;

  const holder=document.createElement('div');
  holder.style.cssText='position:relative;flex:1;min-height:0;width:100%;background:#000;overflow:hidden';

  const ifr=document.createElement('iframe');
  ifr.src=embedUrl;
  ifr.style.cssText='border:none;display:block;width:100%;height:100%;';
  // 5) PERMISSÕES: sem "allow" completo, vários players recusam iniciar.
  ifr.allow='autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write; web-share';
  ifr.allowFullscreen=true;
  ifr.setAttribute('referrerpolicy','strict-origin-when-cross-origin'); // alguns exigem referer
  ifr.setAttribute('loading','eager');
  holder.appendChild(ifr);

  /* 6) AVISO EM VEZ DE TELA PRETA: não dá pra saber de fora se o site recusou o
        embed (a política de mesma origem impede ler o resultado). Então, se em 6s
        o iframe não sinalizar carregamento, mostramos um aviso com o botão pra
        abrir no site — em vez de deixar você olhando um retângulo preto sem pista
        do que aconteceu. */
  let loaded=false;
  ifr.addEventListener('load',()=>{ loaded=true; const f=holder.querySelector('.ifr-fallback'); if(f) f.remove(); });
  ifr.addEventListener('error',()=>showIframeFallback(holder,embedUrl));
  setTimeout(()=>{ if(!loaded) showIframeFallback(holder,embedUrl); },6000);

  w.appendChild(holder);
  const note=document.createElement('div'); note.className='vun-note';
  note.textContent='Player incorporado — a posição é sincronizada, mas o play/pause não é controlável neste site.';
  w.appendChild(note);
  const rzh=document.createElement('div'); rzh.className='rzh'; w.appendChild(rzh);
  container.appendChild(w); els.push(w);
  if(broadcastIt)broadcast({type:'ADD_ITEM',item:{type:'iframe',embedUrl,x,y,id}});
}
/* Do próprio card: procura o mesmo conteúdo onde a sincronia funciona.
   Como o player embutido não informa o título, partimos da URL de embed —
   a busca lida bem com isso porque limpa e normaliza o texto antes. */
async function findSyncForCard(btn){
  const card=btn.closest('.card'); if(!card) return;
  const url=card.dataset.embedUrl||'';
  toast('Procurando versão sincronizada...');
  try{
    let title='';
    const html=await fetchPageHtml(url);
    if(html) title=getPageTitle(html);
    if(!title){ // sem título: usa o trecho legível da URL
      title=decodeURIComponent(url).replace(/https?:\/\/[^/]+\//,'')
              .replace(/[/_-]+/g,' ').replace(/\.(html?|php)$/,'').trim();
    }
    const alts=await findSyncableAlternatives(title);
    if(!alts.length){ toast('Não encontrei uma versão sincronizável desse vídeo','err'); return; }
    _syncAlts=alts;
    openUniversalVideoPanel();
    uvSwitchTab('scan');
    $('scanResults').innerHTML='';
    suggestSyncableFromList(alts);
  }catch(e){
    console.error('findSyncForCard',e);
    toast('Não consegui procurar agora','err');
  }
}
/* Botão de recarregar SEMPRE visível no card, não só quando o carregamento
   falha de cara. Muitos sites de vídeo (principalmente agregadores com proxy
   de streaming pago por anúncio) travam no MEIO da reprodução sem disparar
   nenhum evento de erro — o iframe carregou certinho no início, então o aviso
   de falha nunca aparece. Sem um jeito manual de recarregar, a única saída
   era apagar o card inteiro e recriar.
   Trocar o endereço por um levemente diferente (um parâmetro extra no fim)
   força o navegador a buscar tudo de novo, em vez de reaproveitar o que
   travou — o que costuma bastar quando a causa é um proxy/token expirado do
   próprio site. */
function recarregarIframeCard(btn){
  const card=btn.closest('.card'); if(!card) return;
  const holder=card.querySelector('div[style*="position:relative"]');
  const ifr=card.querySelector('iframe'); if(!ifr) return;
  const base=card.dataset.embedUrl||ifr.src;
  const separador=base.includes('?')?'&':'?';
  ifr.src=base+separador+'_r='+Date.now();
  const f=holder&&holder.querySelector('.ifr-fallback'); if(f) f.remove();
  toast('Recarregando o player...');
}
function showIframeFallback(holder,url){
  if(holder.querySelector('.ifr-fallback')) return;
  const d=document.createElement('div');
  d.className='ifr-fallback';
  d.innerHTML=`<span>Este site não permite ser incorporado aqui.</span>
    <a href="${url}" target="_blank" rel="noopener">Abrir em nova aba ↗</a>
    <button onclick="retryIframe(this)">Tentar de novo</button>`;
  holder.appendChild(d);
}
function retryHtml5Video(btn){
  const holder=btn.closest('div'); if(!holder) return;
  const v=holder.querySelector('video'); const f=holder.querySelector('.ifr-fallback');
  if(f) f.remove();
  if(v){ const s=v.src; v.src=''; setTimeout(()=>{ v.src=s; v.load(); },80); }
}
function retryIframe(btn){
  const holder=btn.closest('div[style*="position:relative"]')||btn.parentElement.parentElement;
  const ifr=holder.querySelector('iframe');
  const fb=holder.querySelector('.ifr-fallback');
  if(fb) fb.remove();
  if(ifr){ const s=ifr.src; ifr.src='about:blank'; setTimeout(()=>{ ifr.src=s; },80); }
}

/* ── CARD CREATORS ── */
function mkGif(src,x,y,id,c,emit){
  const w=document.createElement('div'); w.className='card gif-card'; w.dataset.type='gif'; w.dataset.src=src; w.dataset.itemId=id;
  Object.assign(w.style,{position:'absolute',left:x+'px',top:y+'px',zIndex:++zTop,width:'240px',height:'210px',display:'flex',flexDirection:'column'});
  w.innerHTML=`<div class="ch"><span class="ct">GIF</span><button class="cx" onclick="removeEl(this.closest('.card'))">×</button></div><div class="cb" style="flex:1;min-height:0;overflow:hidden;padding:0;cursor:default"><img src="${src}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block"></div>`;
  const rzh=document.createElement('div'); rzh.className='rzh'; w.appendChild(rzh);
  c.appendChild(w); els.push(w);
  if(emit)broadcast({type:'ADD_ITEM',item:{type:'gif',src,x,y,id}});
}
function mkImg(src,x,y,id,c,emit){
  const w=document.createElement('div'); w.className='card img-card'; w.dataset.type='image'; w.dataset.itemId=id;
  Object.assign(w.style,{position:'absolute',left:x+'px',top:y+'px',zIndex:++zTop,width:'260px',height:'220px',display:'flex',flexDirection:'column'});
  const img=document.createElement('img'); img.loading='lazy'; img.src=src; img.style.cssText='width:100%;height:100%;object-fit:cover;display:block';
  const cb=document.createElement('div'); cb.className='cb'; cb.style.cssText='flex:1;min-height:0;overflow:hidden;padding:0;cursor:default'; cb.appendChild(img);
  w.innerHTML=`<div class="ch"><span class="ct">Imagem</span><button class="cx" onclick="removeEl(this.closest('.card'))">×</button></div>`;
  w.appendChild(cb); const rzh=document.createElement('div'); rzh.className='rzh'; w.appendChild(rzh);
  w.dataset.src=src; // necessário para sendState() reenviar a imagem a quem entra depois na sala
  c.appendChild(w); els.push(w);
  if(emit)broadcast({type:'ADD_ITEM',item:{type:'image',src,x,y,id}});
}
function removeEl(el){
  if(!el)return; const id=el.dataset.itemId, uid=el.dataset.ytuid;
  if(uid){ delete ytPlrs[uid]; delete desiredPlaying[uid]; clearInterval(_vtTimers[uid]); delete _vtTimers[uid]; }
  if(id===activeVideoCardId)activeVideoCardId=null;
  if(id===activeMusicCardId)activeMusicCardId=null;
  el.remove(); els=els.filter(e=>e!==el); if(id)broadcast({type:'REMOVE_ITEM',itemId:id}); toast('Removido');
}

/* ── MUSIC PANEL ── */
