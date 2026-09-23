function openMusicPanel(){
  if(!room){toast('Entre em uma sala primeiro','err');return;}
  const wasOn=$('musicPanel').classList.contains('on');
  $('musicPanel').classList.toggle('on');
  musicUpdateLoginUI();
  // Ao abrir sem nada buscado ainda, já mostra sugestões em alta — assim dá pra escolher sem saber o nome de nada
  if(!wasOn && !musicCurrentQuery && !$('musicSearchInput').value.trim()) musicLoadTrending();
}
function closeMusicPanel(e){ if(!e||e.currentTarget===e.target||!e.type) $('musicPanel').classList.remove('on'); }
function musicUpdateLoginUI(){
  // Login com Google removido — busca fica sempre liberada.
  const loginBtn=$('musicLoginBtn'),logoutBtn=$('musicLogoutBtn'),searchSec=$('musicSearchSec'),userInfo=$('musicUserInfo');
  if(!loginBtn) return;
  loginBtn.style.display='none'; logoutBtn.style.display='none'; searchSec.style.display='flex';
  userInfo.innerHTML='';
}
let musicNextToken=null, musicCurrentQuery='', musicTypeTimer=null;
// Busca "ao vivo": dispara sozinha ~500ms depois que a pessoa para de digitar — não precisa apertar Enter nem saber o nome exato
function musicOnType(){
  clearTimeout(musicTypeTimer);
  const q=$('musicSearchInput').value.trim();
  if(!q){ musicTypeTimer=setTimeout(musicLoadTrending,300); return; }
  musicTypeTimer=setTimeout(()=>musicSearch(true),500);
}
function musicQuick(query){ $('musicSearchInput').value=query; musicSearch(); }
async function musicSearch(silent){
  const q=$('musicSearchInput').value.trim(); if(!q) return;
  musicNextToken=null; musicCurrentQuery=q;
  if(!silent) $('musicResults').innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--ash);font-size:.8rem">Buscando...</div>';
  hideMusicSectionLabel();
  await musicFetchPage(true);
}
function hideMusicSectionLabel(){ const l=qs('#musicSearchSec .msec-lbl.mdisc-lbl'); if(l)l.remove(); }
// "Descobrir": mostra música em alta assim que o painel abre, sem precisar digitar nada
async function musicLoadTrending(){
  musicCurrentQuery=''; musicNextToken=null;
  $('musicResults').innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--ash);font-size:.8rem">Carregando sugestões...</div>';
  try{
    const url=`https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&videoCategoryId=10&regionCode=BR&maxResults=20&key=${encodeURIComponent(YT_API_KEY)}`;
    const res=await fetch(url);
    if(!res.ok){ $('musicResults').innerHTML=''; return; } // silencioso — não é erro crítico, é só a tela inicial
    const data=await res.json();
    if(!data.items?.length){ $('musicResults').innerHTML=''; return; }
    const html=data.items.map(it=>{
      const id=it.id; const sn=it.snippet;
      const thumb=sn.thumbnails?.default?.url||'';
      const title=(sn.title||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
      const chan=sn.channelTitle||'';
      return musicTrackRowHtml(id,title,chan,thumb);
    }).join('');
    $('musicResults').innerHTML=`<div class="msec-lbl mdisc-lbl" style="margin-bottom:.15rem">🔥 Em alta agora</div>`+html;
  }catch(e){ $('musicResults').innerHTML=''; console.error(e); }
}
function musicTrackRowHtml(id,title,chan,thumb){
  return `<div class="mtr" onclick="musicAddTrack('${id}','${title.replace(/'/g,"\\'")}','${chan.replace(/'/g,"\\'")}','${thumb}')">
    <img class="mtr-thumb" src="${thumb}" loading="lazy" onerror="this.style.display='none'">
    <div class="mtr-info"><div class="mtr-title">${title}</div><div class="mtr-chan">${chan}</div></div>
    <svg class="mtr-dur" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><polygon points="5,3 19,12 5,21"/></svg>
  </div>`;
}
async function musicFetchPage(isNew){
  try{
    let url=`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=30&key=${encodeURIComponent(YT_API_KEY)}&q=${encodeURIComponent(musicCurrentQuery)}`;
    if(musicNextToken&&!isNew) url+=`&pageToken=${encodeURIComponent(musicNextToken)}`;
    const res=await fetch(url);
    if(!res.ok){$('musicResults').innerHTML='<div style="text-align:center;padding:1rem;color:var(--ash);font-size:.8rem">Erro ao buscar — verifique a YT_API_KEY no código.</div>';return;}
    const data=await res.json();
    musicNextToken=data.nextPageToken||null;
    if(isNew&&!data.items?.length){$('musicResults').innerHTML='<div style="text-align:center;padding:1rem;color:var(--ash);font-size:.8rem">Nenhum resultado</div>';return;}
    const html=data.items.map(it=>{
      const id=it.id.videoId; const sn=it.snippet;
      const thumb=sn.thumbnails?.default?.url||'';
      const title=(sn.title||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
      const chan=sn.channelTitle||'';
      return musicTrackRowHtml(id,title,chan,thumb);
    }).join('');
    if(isNew) $('musicResults').innerHTML=html; else $('musicResults').insertAdjacentHTML('beforeend',html);
    if(musicNextToken) $('musicResults').insertAdjacentHTML('beforeend',`<div style="display:flex;justify-content:center;padding:.75rem 0 .25rem"><button class="btn bg2 bsm" onclick="musicFetchPage(false)" style="font-size:.78rem;width:100%">Carregar mais</button></div>`);
  }catch(e){if(isNew)$('musicResults').innerHTML='<div style="text-align:center;padding:1rem;color:var(--ash);font-size:.8rem">Erro ao buscar</div>';console.error(e);}
}
function musicAddTrack(vid,title,artist,thumb){
  if(!room){toast('Entre em uma sala primeiro','err');return;}
  const existing = activeMusicCardId && qs('[data-item-id="'+activeMusicCardId+'"]');
  if(existing){ switchMusicCardTo(existing,vid,title,artist,thumb,true); }
  else{
    const c=$('items'),id='msc_'+Date.now();
    mkMusicCard(vid,title,artist,thumb,60+Math.random()*200,60+Math.random()*160,id,c,true);
    activeMusicCardId=id;
  }
  toast('♪ '+title.slice(0,28)+(title.length>28?'…':''));
  const bar=$('musicNowPlayingBar'); if(bar){bar.style.display='block';$('musicNowTitle').textContent=title;$('musicNowArtist').textContent=artist;}
  // Painel fica aberto de propósito, pra mostrar as sugestões parecidas logo acima do player
  musicShowSimilar(vid,title,artist);
}
/* Troca a faixa dentro do MESMO card/player de música (usa loadVideoById via postMessage,
   sem recriar o iframe) — é o que faz "colocar outra música" nunca abrir um card novo. */
function switchMusicCardTo(card,vid,title,artist,thumb,broadcastIt){
  const uid=card.dataset.ytuid;
  card.dataset.vid=vid; card.dataset.title=title; card.dataset.artist=artist; card.dataset.thumb=thumb;
  const titleEl=card.querySelector('.music-title'); if(titleEl){titleEl.textContent=title;titleEl.title=title;}
  const artistEl=card.querySelector('.music-artist'); if(artistEl)artistEl.textContent=artist;
  const p=ytPlrs[uid]; if(p&&p.loadVideoById)p.loadVideoById(vid);
  if(broadcastIt)broadcast({type:'MEDIA_SWITCH_MUSIC',itemId:card.dataset.itemId,vid,title,artist,thumb});
}
function applyMusicSwitch(itemId,vid,title,artist,thumb){
  const card=qs('[data-item-id="'+itemId+'"]'); if(!card)return;
  switchMusicCardTo(card,vid,title,artist,thumb,false);
}
// Sugere músicas parecidas com a que acabou de ser escolhida, sem precisar saber nomes de outras faixas
async function musicShowSimilar(vid,title,artist){
  const sec=$('musicSimilarSec'), grid=$('musicSimilarResults');
  sec.style.display='flex'; grid.innerHTML='<div style="color:var(--ash);font-size:.72rem;padding:.4rem 0">Buscando parecidas...</div>';
  try{
    // Tenta usar as tags reais do vídeo (mais preciso); se não tiver, cai pro artista/título
    let query=artist||title;
    try{
      const infoUrl=`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(vid)}&key=${encodeURIComponent(YT_API_KEY)}`;
      const infoRes=await fetch(infoUrl);
      if(infoRes.ok){
        const infoData=await infoRes.json();
        const tags=infoData.items?.[0]?.snippet?.tags;
        if(tags?.length) query=tags.slice(0,3).join(' ');
      }
    }catch(e){}
    const url=`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=10&key=${encodeURIComponent(YT_API_KEY)}&q=${encodeURIComponent(query)}`;
    const res=await fetch(url);
    if(!res.ok){ grid.innerHTML=''; sec.style.display='none'; return; }
    const data=await res.json();
    const items=(data.items||[]).filter(it=>it.id.videoId!==vid).slice(0,8);
    if(!items.length){ sec.style.display='none'; return; }
    grid.innerHTML=items.map(it=>{
      const id=it.id.videoId, sn=it.snippet;
      const thumb=sn.thumbnails?.default?.url||'';
      const t=(sn.title||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
      const chan=sn.channelTitle||'';
      return `<div class="msug" onclick="musicAddTrack('${id}','${t.replace(/'/g,"\\'")}','${chan.replace(/'/g,"\\'")}','${thumb}')">
        <img src="${thumb}" loading="lazy" onerror="this.style.display='none'"><span>${t}</span>
      </div>`;
    }).join('');
  }catch(e){ sec.style.display='none'; console.error(e); }
}
function mkMusicCard(vid,title,artist,thumb,x,y,id,container,emit){
  const uid='mcp_'+id;
  const cardW=340, cardH=200;
  const w=document.createElement('div'); w.className='card music-card'; w.dataset.type='music'; w.dataset.vid=vid; w.dataset.itemId=id; w.dataset.ytuid=uid; w.dataset.title=title; w.dataset.artist=artist; w.dataset.thumb=thumb;
  Object.assign(w.style,{position:'absolute',left:x+'px',top:y+'px',zIndex:++zTop,width:cardW+'px',height:cardH+'px',display:'flex',flexDirection:'column'});
  const titleSafe=title.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const artistSafe=artist.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  w.innerHTML=`
    <div class="ch" style="flex-shrink:0"><span class="ct">♪ Música</span><button class="cx" onclick="removeEl(this.closest('.card'))">×</button></div>
    <div class="music-card-inner">
      <div class="disc-wrap" id="disc-${uid}">
        <div class="disc-wave"></div>
        <div class="disc-wave w2"></div>
        <div class="disc-ring"></div>
        <div class="disc-ring2"></div>
        <img class="disc-art" src="${DISC_THEME_URL}" onerror="this.style.background='var(--ridge)';this.src=''" alt="">
      </div>
      <div class="music-info" style="flex:1;min-width:0">
        <div class="music-title" title="${titleSafe}">${titleSafe}</div>
        <div class="music-artist">${artistSafe}</div>
        <div class="music-ctrls">
          <button class="mcbtn" onclick="mSeek('${uid}',-10)" title="-10s"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 100-.49"/></svg></button>
          <button class="mcbtn play-btn" id="mplay-${uid}" onclick="mToggle('${uid}')"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></button>
          <button class="mcbtn" onclick="mSeek('${uid}',10)" title="+10s"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 110-.49"/></svg></button>
        </div>
        <div class="music-prog">
          <div class="prog-bar-wrap" onclick="mProgClick(event,'${uid}')">
            <div class="prog-bar-fill" id="mprog-${uid}"></div>
          </div>
          <div class="prog-times"><span id="mct-${uid}">0:00</span><span id="mdt-${uid}">—:——</span></div>
        </div>
      </div>
    </div>
    <div id="mypc-${uid}" style="position:absolute;right:1px;bottom:1px;width:2px;height:2px;overflow:hidden;opacity:.01;pointer-events:none"></div>`;
  const rzh=document.createElement('div'); rzh.className='rzh'; w.appendChild(rzh);
  container.appendChild(w); els.push(w);
  if(emit) broadcast({type:'ADD_ITEM',item:{type:'music',vid,title,artist,thumb,x,y,id}});
  setTimeout(()=>initMusicYT(uid,vid),300);
}
let mPlaying=observarReproducao({});  // mesma ponte de sessão de mídia usada pelo vídeo (ver js/core.js)
function initMusicYT(uid,vid){
  const cont=document.getElementById('mypc-'+uid); if(!cont||cont.dataset.ytinit)return; cont.dataset.ytinit='1';
  const origin=location.origin||'https://localhost';
  const src=`https://www.youtube.com/embed/${vid}?enablejsapi=1&playsinline=1&rel=0&modestbranding=1&controls=0&iv_load_policy=3&origin=${encodeURIComponent(origin)}`;
  const ifr=document.createElement('iframe');
  ifr.src=src; ifr.width='1'; ifr.height='1';
  ifr.style.cssText='border:none;display:block;width:1px;height:1px;'; 
  ifr.allow='autoplay; fullscreen; encrypted-media; picture-in-picture'; ifr.setAttribute('playsinline','');
  cont.appendChild(ifr);
  let _base=0,_playing=false,_wall=0,_dur=0;
  const msg=(func,args)=>{try{ifr.contentWindow.postMessage(JSON.stringify({event:'command',func,args:args||''}),'*');}catch(e){}};
  const proxy={
    playVideo(){desiredPlaying[uid]=true;_base=proxy.getCurrentTime();_wall=Date.now();_playing=true;msg('playVideo');setDiscPlaying(uid,true);setPlayIcon(uid,true);},
    pauseVideo(){desiredPlaying[uid]=false;_base=proxy.getCurrentTime();_playing=false;msg('pauseVideo');setDiscPlaying(uid,false);setPlayIcon(uid,false);},
    togglePlay(){if(_playing)proxy.pauseVideo();else proxy.playVideo();},
    seekTo(t){_base=t;_wall=Date.now();msg('seekTo',[t,true]);},
    loadVideoById(newVid){ suppressSync(uid,2000); _base=0;_wall=Date.now();_dur=0;_playing=true;desiredPlaying[uid]=true; msg('loadVideoById',[newVid]); setDiscPlaying(uid,true); setPlayIcon(uid,true); },
    getCurrentTime(){
      const t = _playing ? _base+(Date.now()-_wall)/1000 : _base;
      // nunca ultrapassa a duração: sem isto o contador seguia além do fim
      return (_dur>0 && t>_dur) ? _dur : t;
    },
    getDuration(){return _dur;},
    isPlaying(){return _playing;},
    setVolume(v){ msg('setVolume',[Math.round(Math.max(0,Math.min(1,v))*100)]); }
  };
  ytPlrs[uid]=proxy; mPlaying[uid]=false; desiredPlaying[uid]=false;
  applyVolumeToPlayer(uid);
  /* DURAÇÃO INFINITA — corrigido.
     O YouTube só começa a informar tempo e duração DEPOIS que o player pede para
     "ouvir" (evento 'listening'). Sem isso ele nunca respondia com a duração, e o
     tempo total ficava zerado para sempre. Enviamos assim que o quadro carrega e
     repetimos algumas vezes, porque o pedido feito cedo demais é ignorado. */
  const pedirInfo=()=>{ try{ ifr.contentWindow.postMessage(JSON.stringify({event:'listening',id:uid}),'*'); }catch(e){} };
  ifr.addEventListener('load',()=>{ pedirInfo(); setTimeout(pedirInfo,400); setTimeout(pedirInfo,1200); });
  setTimeout(pedirInfo,800);
  window.addEventListener('message',ev=>{
    if(ev.source!==ifr.contentWindow)return; // sem isso, cards de música diferentes brigavam pelo mesmo estado (disco/ícone/progresso trocados)
    try{
      const d=JSON.parse(ev.data);
      if(d.event==='onStateChange'){
        if(d.info===1){_base=proxy.getCurrentTime();_wall=Date.now();_playing=true;desiredPlaying[uid]=true;setDiscPlaying(uid,true);setPlayIcon(uid,true);if(!isSuppressed(uid))broadcast({type:'VID_SYNC',uid_player:uid,action:'play',time:_base,at:Date.now()});}
        else if(d.info===2){   // pausada pelo usuário
          _base=proxy.getCurrentTime();_playing=false;desiredPlaying[uid]=false;
          setDiscPlaying(uid,false);setPlayIcon(uid,false);
          if(!isSuppressed(uid))broadcast({type:'VID_SYNC',uid_player:uid,action:'pause',time:_base,at:Date.now()});
        }
        else if(d.info===0){   // ACABOU
          /* O fim era tratado como uma pausa qualquer. Como o tempo é calculado
             pelo relógio (o player não avisa a cada segundo), ele seguia subindo
             depois do fim e passava da duração — daí a contagem que não parava e
             o final "errado". Aqui travamos exatamente na duração. */
          _playing=false; desiredPlaying[uid]=false;
          _base = _dur>0 ? _dur : proxy.getCurrentTime();
          setDiscPlaying(uid,false); setPlayIcon(uid,false);
          const el=$('mt-'+uid); if(el) el.textContent=fmtTime(_base)+' / '+fmtTime(_dur);
          if(!isSuppressed(uid))broadcast({type:'VID_SYNC',uid_player:uid,action:'pause',time:_base,at:Date.now()});
        }
      }
      if(d.event==='onError'){ toast('Essa música não pôde ser reproduzida (indisponível/bloqueada)','err'); }
      if(!_playing&&d.info?.currentTime!=null)_base=d.info.currentTime;
      // a duração chega em formatos diferentes conforme a versão do player
      const dur = d.info?.duration ?? d.info?.videoData?.duration ?? d.duration;
      if(dur && dur>0) _dur=dur;
    }catch(e){}
  });
  setInterval(()=>{
    const ct=document.getElementById('mct-'+uid),prog=document.getElementById('mprog-'+uid),dt=document.getElementById('mdt-'+uid);
    if(!ct)return;
    const t=proxy.getCurrentTime(),dur=_dur;
    ct.textContent=fmtTime(t);
    if(dur>0){if(dt)dt.textContent=fmtTime(dur);if(prog)prog.style.width=Math.min(100,(t/dur)*100)+'%';}
  },500);
}
function setDiscPlaying(uid,playing){
  const disc=document.getElementById('disc-'+uid); if(!disc)return;
  if(playing)disc.classList.add('disc-playing'); else disc.classList.remove('disc-playing');
}
function setPlayIcon(uid,playing){
  const btn=document.getElementById('mplay-'+uid); if(!btn)return;
  btn.innerHTML=playing?
    '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>':
    '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
}
function mToggle(uid){const p=ytPlrs[uid];if(!p)return;if(p.isPlaying()){p.pauseVideo();broadcast({type:'VID_SYNC',uid_player:uid,action:'pause',time:p.getCurrentTime(),at:Date.now()});}else{p.playVideo();broadcast({type:'VID_SYNC',uid_player:uid,action:'play',time:p.getCurrentTime(),at:Date.now()});}}
function mSeek(uid,d){const p=ytPlrs[uid];if(!p)return;const t=Math.max(0,(p.getCurrentTime()||0)+d);p.seekTo(t);broadcast({type:'VID_SYNC',uid_player:uid,action:p.isPlaying()?'play':'pause',time:t,at:Date.now()});}
function mProgClick(e,uid){const p=ytPlrs[uid];if(!p)return;const r=e.currentTarget.getBoundingClientRect();const pct=(e.clientX-r.left)/r.width;const dur=p.getDuration();if(dur>0){const t=pct*dur;p.seekTo(t);broadcast({type:'VID_SYNC',uid_player:uid,action:p.isPlaying()?'play':'pause',time:t,at:Date.now()});}}

/* ── YOUTUBE PANEL ── */
