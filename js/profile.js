/* ── CROP/ZOOM DE FOTO ──
   Antes o upload ia direto pro círculo (avatar) ou pro retângulo (banner) com
   object-fit:cover/background-size:cover, cortando cegamente partes importantes
   da imagem sem deixar a pessoa escolher o enquadramento.
   Agora a pessoa ajusta zoom e posição num editor antes de confirmar, e o
   resultado já sai "assado" num canvas (quadrado pro avatar, retangular 3:1
   pro banner) — sem mais cortes surpresa em nenhum lugar do app (avatar,
   moldura, banner do perfil público, etc).
   shape: 'circle' (avatar, padrão) ou 'rect' (banner) — controla a forma do
   stage e as proporções do canvas de saída. */
let cropState=null, cropTarget=null, cropDrag=null;
function openCropModal(dataUrl,mime,target,shape){
  shape=shape||'circle';
  const stage=$('cropStage'), modal=$('cropModal'), cImg=$('cropImg');
  stage.classList.toggle('rect',shape==='rect');
  const title=$('cropTitle'), desc=$('cropDesc');
  if(shape==='rect'){
    if(title) title.textContent='Ajustar banner';
    if(desc) desc.textContent='Arraste a imagem para posicionar e use o zoom para enquadrar o banner.';
  } else {
    if(title) title.textContent='Ajustar foto';
    if(desc) desc.textContent='Arraste a imagem para posicionar e use o zoom para enquadrar melhor.';
  }
  // esconde a imagem antiga enquanto a nova carrega, pra não piscar conteúdo/tamanho errados
  cImg.style.visibility='hidden';
  // CRÍTICO: o modal precisa estar visível (display:flex) ANTES de medir o stage.
  // Com display:none (estado padrão do modal), clientWidth/clientHeight sempre retornam 0.
  modal.classList.add('on');
  // A altura do stage do banner é calculada e fixada em PIXELS aqui, em vez de depender de
  // "aspect-ratio" do CSS (que pode não estar disponível/aplicado a tempo em todo navegador
  // ou webview). Isso garante 3:1 sempre — é o que evita o banner "quase quadrado" e a imagem
  // parecendo dar zoom sozinha (o zoom mínimo era calculado achando que o stage era quadrado).
  if(shape==='rect'){
    const w=stage.clientWidth||300;
    stage.style.height=Math.round(w/3)+'px';
  } else {
    stage.style.height='';
  }
  const img=new Image();
  img.onload=()=>{
    // lê o tamanho real (em px) do stage já visível, já com a altura correta aplicada
    const stageW=stage.clientWidth||(shape==='rect'?300:240), stageH=stage.clientHeight||(shape==='rect'?100:240);
    const minScale=Math.max(stageW/img.naturalWidth, stageH/img.naturalHeight);
    const outW=shape==='rect'?900:480, outH=shape==='rect'?300:480;
    cropState={ mime:(mime&&mime.startsWith('image/'))?mime:'image/png', natW:img.naturalWidth, natH:img.naturalHeight, stageW, stageH, minScale, scale:minScale, x:0, y:0, shape, outW, outH };
    cropTarget=target;
    cImg.src=dataUrl;
    cImg.onload=()=>{
      // centraliza a imagem no meio do stage ao abrir
      cropState.x=(stageW-cropState.natW*cropState.scale)/2;
      cropState.y=(stageH-cropState.natH*cropState.scale)/2;
      $('cropZoom').value=1;
      cropRender();
      cImg.style.visibility='visible';
    };
  };
  img.src=dataUrl;
}
function cropRender(){
  if(!cropState) return;
  const s=cropState, w=s.natW*s.scale, h=s.natH*s.scale;
  const minX=s.stageW-w, minY=s.stageH-h;
  s.x=Math.min(0,Math.max(minX,s.x));
  s.y=Math.min(0,Math.max(minY,s.y));
  const cImg=$('cropImg');
  cImg.style.width=w+'px'; cImg.style.height=h+'px';
  cImg.style.transform=`translate(${s.x}px,${s.y}px)`;
}
function cropUpdateZoom(){
  if(!cropState) return;
  const s=cropState, zoom=parseFloat($('cropZoom').value)||1;
  const oldScale=s.scale, newScale=s.minScale*zoom;
  const cx=s.stageW/2, cy=s.stageH/2;
  // mantém o ponto central da tela fixo enquanto o zoom muda
  const relX=(cx-s.x)/oldScale, relY=(cy-s.y)/oldScale;
  s.scale=newScale;
  s.x=cx-relX*newScale; s.y=cy-relY*newScale;
  cropRender();
}
function initCropDrag(){
  const stage=$('cropStage'); if(!stage) return;
  const onDown=(x,y,pid)=>{ if(!cropState) return; cropDrag={sx:x,sy:y,ox:cropState.x,oy:cropState.y}; stage.classList.add('dragging'); };
  const onMove=(x,y)=>{ if(!cropDrag||!cropState) return; cropState.x=cropDrag.ox+(x-cropDrag.sx); cropState.y=cropDrag.oy+(y-cropDrag.sy); cropRender(); };
  const onUp=()=>{ cropDrag=null; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerdown',e=>{ e.preventDefault(); stage.setPointerCapture(e.pointerId); onDown(e.clientX,e.clientY); });
  stage.addEventListener('pointermove',e=>{ if(cropDrag) e.preventDefault(); onMove(e.clientX,e.clientY); });
  window.addEventListener('pointerup',onUp);
  stage.addEventListener('pointercancel',onUp);
}
function cropCancel(){ $('cropModal').classList.remove('on'); $('cropStage').classList.remove('rect'); cropState=null; cropTarget=null; cropDrag=null; }
function cropConfirm(){
  if(!cropState){ cropCancel(); return; }
  const s=cropState;
  const canvas=document.createElement('canvas'); canvas.width=s.outW; canvas.height=s.outH;
  const ctx=canvas.getContext('2d');
  const kx=s.outW/s.stageW, ky=s.outH/s.stageH;
  ctx.drawImage($('cropImg'), s.x*kx, s.y*ky, s.natW*s.scale*kx, s.natH*s.scale*ky);
  const mime=s.mime, target=cropTarget, shape=s.shape;
  canvas.toBlob(blob=>{
    if(!blob){ toast('Erro ao processar imagem','err'); cropCancel(); return; }
    const ext=mime==='image/png'?'png':'jpg';
    // IMPORTANTE: esta "url" é um blob: local — só existe nesta aba, morre ao recarregar
    // a página e nunca é visível para outras pessoas. Por isso ela é usada SOMENTE para
    // pré-visualização imediata na tela, nunca atribuída a U.photo/U.banner, salva no banco
    // ou transmitida pra sala. O valor real e permanente só entra em U.photo/U.banner depois
    // do upload bem-sucedido pro Supabase Storage (feito em saveSettings/criação de perfil).
    const url=URL.createObjectURL(blob);
    if(target==='banner'){
      const file=new File([blob],'banner.'+ext,{type:mime});
      pendingBannerFile=file;
      const sb=$('sbanner'); if(sb) sb.innerHTML=`<img src="${url}"><input type="file" id="spBannerFile" accept="image/*" onchange="handleSBanner(this)">`;
    } else {
      const file=new File([blob],'avatar.'+ext,{type:mime});
      pendingAvatarFile=file;
      if(target==='settings'){
        $('sphoto').innerHTML=`<img src="${url}"><input type="file" id="spFile" accept="image/*" onchange="handleSPhoto(this)">`;
        updateFramePreview();
      } else {
        const wrapId=target==='login'?'loginPP':'signupPP';
        const w=$(wrapId);
        if(w) w.innerHTML=`<img src="${url}"><input type="file" accept="image/*" onchange="handlePhoto(this,'${target}')">`;
      }
    }
    $('cropModal').classList.remove('on'); $('cropStage').classList.remove('rect'); cropState=null; cropTarget=null;
  },mime,0.92);
}
/* ══════════════════════════════════════════════════════════════════
   ARRASTAR E BELISCAR — move e redimensiona segurando direto na moldura ou na
   borda, sem barra deslizante. Um dedo move, dois dedos beliscam pra
   redimensionar (funciona com o dedo no celular e com o mouse — a roda do
   mouse também escala, como atalho no computador).
   ══════════════════════════════════════════════════════════════════ */
function limitar(v,a,b){ return Math.max(a,Math.min(b,v)); }
function attachGesto(el,opts){
  if(!el||el.dataset.gestoPronto) return;
  el.dataset.gestoPronto='1';
  const pointers=new Map();
  let modo=null, capturado=false, startDist=1, startScale=1, startX=0, startY=0, startPX=0, startPY=0;

  /* IMPORTANTE: a captura do toque só acontece DEPOIS de confirmar que é um
     arrasto de verdade (movimento além de um limiar mínimo), nunca no
     momento do toque em si. Isso existe porque avatarFrameWrap contém um
     <input type="file"> invisível por baixo (é assim que tocar no avatar abre
     a galeria de fotos) — capturar o ponteiro de imediato poderia impedir
     esse clique nativo de disparar em alguns navegadores. Um toque parado
     continua funcionando exatamente como antes; só um arrasto de verdade
     assume o gesto. */
  el.addEventListener('pointerdown',e=>{
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===1){
      modo='talvez-arrastar';
      startX=opts.getX(); startY=opts.getY();
      startPX=e.clientX; startPY=e.clientY;
    }else if(pointers.size===2){
      // dois dedos já é inequívoco: não tem como ser um toque de abrir a galeria
      pointers.forEach((_,id)=>{ try{ el.setPointerCapture(id); }catch(_){} });
      capturado=true; modo='pinca';
      const pts=[...pointers.values()];
      startDist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)||1;
      startScale=opts.getScale();
    }
  });
  el.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(modo==='talvez-arrastar'&&pointers.size===1){
      const dx=e.clientX-startPX, dy=e.clientY-startPY;
      if(!capturado && (Math.abs(dx)>6||Math.abs(dy)>6)){
        try{ el.setPointerCapture(e.pointerId); }catch(_){}
        capturado=true; el.style.touchAction='none'; modo='arrastar';
      }
      if(modo==='arrastar'){
        opts.setX(limitar(startX+dx*(opts.fatorX||1),-opts.maxOffset,opts.maxOffset));
        opts.setY(limitar(startY+dy*(opts.fatorY||1),-opts.maxOffset,opts.maxOffset));
        opts.onChange();
      }
    }else if(modo==='pinca'&&pointers.size===2){
      const pts=[...pointers.values()];
      const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)||1;
      opts.setScale(limitar(startScale*(dist/startDist),opts.minScale,opts.maxScale));
      opts.onChange();
    }
  });
  const soltar=e=>{
    pointers.delete(e.pointerId);
    if(pointers.size===1){
      const [[,p]]=pointers;
      modo='arrastar'; startX=opts.getX(); startY=opts.getY(); startPX=p.x; startPY=p.y;
    }else if(pointers.size===0){
      modo=null; capturado=false; el.style.touchAction='';
    }
  };
  el.addEventListener('pointerup',soltar);
  el.addEventListener('pointercancel',soltar);
  // atalho de computador: roda do mouse escala sem precisar de dois dedos
  el.addEventListener('wheel',e=>{
    e.preventDefault();
    const dir=e.deltaY<0?1.06:0.94;
    opts.setScale(limitar(opts.getScale()*dir,opts.minScale,opts.maxScale));
    opts.onChange();
  },{passive:false});
}

/* Escala e posição da moldura agora vêm de U.frame_scale/frame_x/frame_y
   diretamente — não existem mais barras deslizantes lendo esses valores. Quem
   os atualiza é o gesto de arrastar/beliscar (ver attachGesto), com limites
   bem mais largos do que as barras antigas permitiam. */
function updateFramePreview(){
  // A moldura é anexada no wrapper (avatarFrameWrap), não dentro de #sphoto — #sphoto
  // tem overflow:hidden pra recortar a foto em círculo, o que cortava a moldura junto
  // sempre que ela vazava pra fora do círculo (ex: asas, pontas decorativas). O wrapper
  // não tem overflow:hidden, então a moldura pode vazar livremente por cima do avatar.
  const wrap=$('avatarFrameWrap'); if(!wrap) return;
  let fr=wrap.querySelector('.frame-preview');
  if(U.frame){
    if(!fr){
      fr=document.createElement('img'); fr.className='frame-preview'; fr.src=U.frame;
      fr.style.position='absolute'; fr.style.width='100%'; fr.style.height='100%';
      fr.style.pointerEvents='none'; fr.style.zIndex='2';
      wrap.appendChild(fr);
    }else if(fr.getAttribute('src')!==U.frame){ fr.src=U.frame; }
    fr.style.left=(50+(U.frame_x||0))+'%'; fr.style.top=(50+(U.frame_y||0))+'%';
    fr.style.transform=`translate(-50%,-50%) scale(${(U.frame_scale||1)*1.45})`;
  }else if(fr){ fr.remove(); }
  const pct=$('frameEscalaVal'); if(pct) pct.textContent=Math.round((U.frame_scale||1)*100)+'%';
}
function initFrameGesto(){
  const wrap=$('avatarFrameWrap'); if(!wrap) return;
  attachGesto(wrap,{
    getX:()=>U.frame_x||0,           setX:v=>{ U.frame_x=Math.round(v); },
    getY:()=>U.frame_y||0,           setY:v=>{ U.frame_y=Math.round(v); },
    getScale:()=>U.frame_scale||1,   setScale:v=>{ U.frame_scale=Math.round(v*100)/100; },
    // converte pixels de tela em "por cento do wrapper", que é a unidade usada aqui
    fatorX:100/(wrap.offsetWidth||58), fatorY:100/(wrap.offsetHeight||58),
    maxOffset:220,          // bem mais generoso que os ±100 da barra antiga
    minScale:0.3, maxScale:4,  // a barra antiga ia só de 0.5 a 2
    onChange:updateFramePreview
  });
}
/* ══════════════════════════════════════════════════════════════════
   BORDAS DO CARD DE PERFIL

   Imagens decorativas no topo e no rodapé do card. Seguem o mesmo modelo das
   molduras de avatar: a lista vem do banco (tabela `border_presets`), então dá
   para acrescentar bordas novas sem tocar no código.

   Cada borda guarda três ajustes — tamanho, deslocamento horizontal e vertical —
   salvos no perfil. Como ficam no banco, todo mundo que abrir o perfil vê a
   mesma coisa.
   ══════════════════════════════════════════════════════════════════ */
let BORDER_PRESETS=[];
let bordaAtual='topo';        // qual borda está sendo editada

async function loadBorderPresets(){
  try{
    const { data, error }=await getSupa().from('border_presets')
      .select('url').eq('active',true).order('sort_order',{ascending:true});
    if(error) throw error;
    BORDER_PRESETS=(data||[]).map(r=>r.url).filter(Boolean);
    localStorage.setItem('tfm_bordas_cache',JSON.stringify(BORDER_PRESETS));
  }catch(e){
    console.warn('Bordas: usando cópia local —',e.message);
    try{ BORDER_PRESETS=JSON.parse(localStorage.getItem('tfm_bordas_cache')||'[]'); }
    catch(_){ BORDER_PRESETS=[]; }
  }
}
/* Lê e escreve os ajustes da borda em edição, sem repetir código para topo e
   rodapé — os campos seguem o padrão border_topo_* e border_baixo_*. */
function bordaCampos(qual){
  const p = (qual==='topo') ? 'border_top' : 'border_bottom';
  return { url:p, escala:p+'_scale', x:p+'_x', y:p+'_y' };
}
function bordaAba(qual){
  bordaAtual=qual;
  const t=$('bordaAbaTopo'), b=$('bordaAbaBaixo');
  if(t) t.classList.toggle('on',qual==='topo');
  if(b) b.classList.toggle('on',qual==='baixo');
  bordaCarregarControles();
  buildBorderGallery();
}
/* Mostra a porcentagem atual de cada borda — só leitura, não existe mais
   barra: quem muda o valor é o gesto de arrastar/beliscar direto na imagem. */
function bordaCarregarControles(){
  const vt=$('bordaEscalaTopoVal'), vb=$('bordaEscalaBaixoVal');
  if(vt) vt.textContent=Math.round((U.border_top_scale||1)*100)+'%';
  if(vb) vb.textContent=Math.round((U.border_bottom_scale||1)*100)+'%';
}
function bordaRemover(){
  const c=bordaCampos(bordaAtual);
  U[c.url]=null; U[c.escala]=1; U[c.x]=0; U[c.y]=0;
  renderBordaPreview(); buildBorderGallery(); bordaCarregarControles();
}
/* Liga o arrastar/beliscar direto em cada imagem de borda — cada uma mexe
   só nos próprios campos (topo nunca afeta baixo, e vice-versa). */
function initBordaGesto(){
  const alvoTopo=$('bpvBordaTopo'), alvoBaixo=$('bpvBordaBaixo');
  if(alvoTopo) attachGesto(alvoTopo,{
    getX:()=>U.border_top_x||0,          setX:v=>{ U.border_top_x=Math.round(v); },
    getY:()=>U.border_top_y||0,          setY:v=>{ U.border_top_y=Math.round(v); },
    getScale:()=>U.border_top_scale||1,  setScale:v=>{ U.border_top_scale=Math.round(v*100)/100; },
    fatorX:1, fatorY:1,                  // a borda já usa pixels crus, sem conversão
    maxOffset:320,                       // bem mais generoso que os ±100 da barra antiga
    minScale:0.2, maxScale:5,            // a barra antiga ia só de 40% a 200%
    onChange:()=>{ renderBordaPreview(); bordaCarregarControles(); }
  });
  if(alvoBaixo) attachGesto(alvoBaixo,{
    getX:()=>U.border_bottom_x||0,          setX:v=>{ U.border_bottom_x=Math.round(v); },
    getY:()=>U.border_bottom_y||0,          setY:v=>{ U.border_bottom_y=Math.round(v); },
    getScale:()=>U.border_bottom_scale||1,  setScale:v=>{ U.border_bottom_scale=Math.round(v*100)/100; },
    fatorX:1, fatorY:1,
    maxOffset:320,
    minScale:0.2, maxScale:5,
    onChange:()=>{ renderBordaPreview(); bordaCarregarControles(); }
  });
}
function buildBorderGallery(){
  const box=$('bordaGaleria'); if(!box) return;
  const c=bordaCampos(bordaAtual);
  const atual=U[c.url]||null;
  box.innerHTML='';
  const nada=document.createElement('div');
  nada.className='borda-item'+(!atual?' on':'');
  nada.textContent='Nenhuma';
  nada.onclick=()=>{ U[c.url]=null; renderBordaPreview(); buildBorderGallery(); };
  box.appendChild(nada);
  BORDER_PRESETS.forEach(url=>{
    const d=document.createElement('div');
    d.className='borda-item'+(atual===url?' on':'');
    d.onclick=()=>{ U[c.url]=url; renderBordaPreview(); buildBorderGallery(); };
    const img=document.createElement('img'); img.src=url; img.loading='lazy';
    d.appendChild(img); box.appendChild(d);
  });
}
/* Aplica uma borda a um elemento de imagem. Usado tanto na pré-visualização
   quanto no perfil real, para os dois nunca divergirem. */
function aplicarBorda(el,url,escala,dx,dy){
  if(!el) return;
  if(!url){ el.style.display='none'; el.removeAttribute('src'); return; }
  el.style.display='block';
  if(el.getAttribute('src')!==url) el.setAttribute('src',url);
  el.style.transform=`translate(calc(-50% + ${dx||0}px), ${dy||0}px) scale(${escala||1})`;
}
function renderBordaPreview(){
  aplicarBorda($('bpvBordaTopo'),  U.border_top,    U.border_top_scale,    U.border_top_x,    U.border_top_y);
  aplicarBorda($('bpvBordaBaixo'), U.border_bottom, U.border_bottom_scale, U.border_bottom_x, U.border_bottom_y);
  const av=$('bpvAvatar'); if(av) av.innerHTML=avatarHTML(U);
  const nm=$('bpvNome'); if(nm) nm.textContent=($('sNm')&&$('sNm').value.trim())||U.name||'Seu nome';
  const us=$('bpvUser'); const u=($('sUname')&&$('sUname').value.trim())||U.username||'';
  if(us) us.textContent=u?('@'+u):'';
  const bio=$('bpvBio'); if(bio) bio.textContent=($('sBio')&&$('sBio').value.trim())||U.bio||'';
  const bn=$('bpvBanner');
  if(bn) bn.style.background=U.banner?`url('${U.banner}') center/cover`:'linear-gradient(90deg,#181818,#242424)';
}
async function initBordas(){
  await loadBorderPresets();
  bordaCarregarControles();
  buildBorderGallery();
  renderBordaPreview();
  initBordaGesto();
}

/* Molduras — agora vêm da tabela `frame_presets` no Supabase, não mais do código.
   Basta inserir uma linha na tabela (url + ordem) que ela aparece aqui automaticamente,
   sem precisar mexer em nada e sem precisar pedir pra mim toda vez. Guardamos um cache
   local (localStorage) como fallback, pra não deixar a lista vazia se a consulta falhar
   uma vez (rede instável, etc) — na próxima carga bem-sucedida o cache é atualizado. */
let FRAME_PRESETS=[];
async function loadFramePresets(){
  try{
    const { data, error }=await getSupa().from('frame_presets').select('url').eq('active',true).order('sort_order',{ascending:true});
    if(error) throw error;
    FRAME_PRESETS=(data||[]).map(r=>r.url).filter(Boolean);
    localStorage.setItem('tfm_frames_cache',JSON.stringify(FRAME_PRESETS));
  }catch(e){
    console.warn('Não consegui carregar frame_presets do Supabase, usando cache local:',e.message);
    try{ FRAME_PRESETS=JSON.parse(localStorage.getItem('tfm_frames_cache')||'[]'); }catch(_){ FRAME_PRESETS=[]; }
  }
}
function buildFramePresets(){
  const box=$('framePresets'); if(!box) return; box.innerHTML='';
  const none=document.createElement('div'); none.className='gi'+(!U.frame?' sel':''); none.title='Sem moldura';
  none.style.display='flex'; none.style.alignItems='center'; none.style.justifyContent='center'; none.style.fontSize='.68rem'; none.style.color='var(--ash)';
  none.textContent='Nenhuma'; none.onclick=()=>{ U.frame=null; buildFramePresets(); updateFramePreview(); };
  box.appendChild(none);
  FRAME_PRESETS.forEach(url=>{
    const d=document.createElement('div'); d.className='gi'+(U.frame===url?' sel':'');
    d.onclick=()=>{ U.frame=url; buildFramePresets(); updateFramePreview(); };
    const img=document.createElement('img'); img.src=url; d.appendChild(img); box.appendChild(d);
  });
}

/* Upload no Supabase Storage (bucket 'profiles') */
async function uploadProfileFile(file,destPath){
  if(!file) return null;
  const supa=getSupa();
  try{
    const { data:userData }=await supa.auth.getUser(); const user=userData.user;
    const { error }=await supa.storage.from('profiles').upload(destPath,file,{ cacheControl:'3600', upsert:true, contentType:file.type, metadata:{ user_id:user?.id } });
    if(error){ console.error('uploadProfileFile error:',error.message||error); return null; }
    // BUG CORRIGIDO: getPublicUrl() retorna { data: { publicUrl } } no supabase-js v2.
    // O código antigo lia ".publicUrl" direto no objeto de fora (sem passar por ".data"),
    // então SEMPRE retornava undefined — mesmo com o upload funcionando perfeitamente.
    // Por isso a foto/banner nunca recebiam a URL real e ficavam presas na pré-visualização
    // temporária (blob:), que não existe fora da sua aba e some ao recarregar a página.
    const { data:pub }=supa.storage.from('profiles').getPublicUrl(destPath);
    if(!pub?.publicUrl){ console.error('uploadProfileFile: getPublicUrl não retornou URL', pub); return null; }
    return pub.publicUrl;
  }catch(e){ console.error('uploadProfileFile exception:',e); return null; }
}

async function saveSettings(){
  const supa=getSupa();
  const { data:userData }=await supa.auth.getUser(); const user=userData.user;
  const n=$('sNm').value.trim(), em=$('sEm').value.trim();
  const un=$('sUname')?$('sUname').value.trim():U.username;
  const bio=$('sBio')?$('sBio').value.trim():U.bio;
  if(n)U.name=n; if(em)U.email=em; U.username=un||U.username; U.bio=bio||U.bio;

  if(!user){ // sem conta: salva só local
    saveU();
    const aw=qs('.av-wrap[data-uid="'+U.id+'"]'); if(aw)refreshAv(aw,U);
    if(qs('.pi[data-uid="'+U.id+'"]')) upsertPart(U.id,U,'Você');
    broadcastMyInfo(); toast('Salvo localmente (faça login para sincronizar)','ok'); closeSettings(); return;
  }

  if(pendingAvatarFile){ const path=`${user.id}/avatar-${Date.now()}.png`; const url=await uploadProfileFile(pendingAvatarFile,path); if(url){ U.photo=url; } else { toast('Falha ao enviar a foto de perfil — mantendo a anterior','err'); } pendingAvatarFile=null; }
  if(pendingBannerFile){ const path=`${user.id}/banner-${Date.now()}.png`; const url=await uploadProfileFile(pendingBannerFile,path); if(url){ U.banner=url; } else { toast('Falha ao enviar o banner — mantendo o anterior','err'); } pendingBannerFile=null; }

  const payload={ id:user.id, name:U.name, email:U.email, username:U.username, bio:U.bio, color:U.color, card_tint:tintMode(U.card_tint), name_color:U.name_color||null, name_mode:U.name_mode||'auto',
    border_top:U.border_top||null,        border_top_scale:U.border_top_scale||1,
    border_top_x:U.border_top_x||0,       border_top_y:U.border_top_y||0,
    border_bottom:U.border_bottom||null,  border_bottom_scale:U.border_bottom_scale||1,
    border_bottom_x:U.border_bottom_x||0, border_bottom_y:U.border_bottom_y||0,
    photo:U.photo||null, banner:U.banner||null, frame:U.frame||null, frame_scale:U.frame_scale||1, frame_x:U.frame_x||0, frame_y:U.frame_y||0 };
  let { data, error }=await supa.from('profiles').upsert(payload,{onConflict:'id'}).select().maybeSingle();
  if(error && /card_tint|name_color|name_mode|border_/.test(error.message||'')){
    // banco ainda sem a coluna card_tint: salva o resto normalmente em vez de perder tudo
    const { card_tint, name_color, name_mode,
            border_top, border_top_scale, border_top_x, border_top_y,
            border_bottom, border_bottom_scale, border_bottom_x, border_bottom_y,
            ...rest }=payload;
    ({ data, error }=await supa.from('profiles').upsert(rest,{onConflict:'id'}).select().maybeSingle());
    if(!error) console.warn('Colunas card_tint/name_color/name_mode ausentes — adicione-as para salvar essas personalizações.');
  }
  if(error){ console.error(error); toast('Erro ao salvar perfil: '+error.message,'err'); return; }
  U={...U,...payload}; saveU();
  const aw=qs('.av-wrap[data-uid="'+U.id+'"]'); if(aw)refreshAv(aw,U);
  if(qs('.pi[data-uid="'+U.id+'"]')) upsertPart(U.id,U,'Você');
  broadcastMyInfo(); toast('Perfil salvo','ok'); closeSettings();
}

/* ── PERFIL PÚBLICO / AMIGOS ── */
async function openMyPublicProfile(){ if(!U.id){ toast('Faça login para abrir seu perfil público','err'); return; } closeSettings(); openProfile(U.id); }
async function openProfile(uid){
  const supa=getSupa();
  const { data, error }=await supa.from('profiles').select('*').eq('id',uid).maybeSingle();
  if(error){ console.warn(error); toast('Erro ao carregar perfil','err'); return; }
  const p=data||(uid===U.id?U:null);
  if(!p){ toast('Perfil não encontrado','err'); return; }
  const fr=await supa.from('friendships').select('*').or(`requester.eq.${uid},recipient.eq.${uid}`).eq('status','accepted');
  // aplica a cor/tingimento escolhidos pela pessoa no card do próprio perfil
  const _pc=normHex(p.color)||'#c45c5c', [_r,_g,_b]=hexToRgb(_pc);
  const _mbox=$('profileModal')?$('profileModal').querySelector('.mbox'):null;
  const _mode=tintMode(p.card_tint);
  if(_mbox){
    _mbox.style.background = _mode==='none' ? '' : tintBackground(_mode,_r,_g,_b);
    _mbox.style.borderColor=`rgba(${_r},${_g},${_b},.35)`;
    _mbox.style.boxShadow=`0 18px 50px rgba(0,0,0,.6),0 0 0 1px rgba(${_r},${_g},${_b},.16)`;
  }
  /* Bordas decorativas do card — mostradas para QUEM abrir o perfil, com os
     mesmos ajustes que a pessoa escolheu na pré-visualização. */
  aplicarBorda($('pubBordaTopo'),  p.border_top,    p.border_top_scale,    p.border_top_x,    p.border_top_y);
  aplicarBorda($('pubBordaBaixo'), p.border_bottom, p.border_bottom_scale, p.border_bottom_x, p.border_bottom_y);
  $('pubBanner').style.backgroundImage=p.banner?`url('${p.banner}')`:'none';
  if(!p.banner) $('pubBanner').style.background=`linear-gradient(100deg,rgba(${_r},${_g},${_b},.7),rgba(${_r},${_g},${_b},.2))`;
  $('pubAvatar').style.position='relative'; $('pubAvatar').style.overflow='visible';
  $('pubAvatar').innerHTML=avatarHTML(p);
  await resolveOwnerUid();
  // Nome, badge de Owner e tags vivem na MESMA linha. Antes as tags ficavam num bloco
  // abaixo do nome: como essa faixa usa align-items:flex-end sobre o banner (margem
  // negativa), qualquer altura extra empurrava o nome para cima, para dentro do banner.
  // a cor do nome só vale se a pessoa escolheu "própria"; senão calculamos a legível
  const _pnc=(p.name_mode==='custom' && normHex(p.name_color)) ? normHex(p.name_color) : null;
  _profileCtx={ uid, name:p.name||'Usuário', nameColor:_pnc };
  renderNameRow();                 // desenha nome + Owner (tags entram quando carregarem)
  $('pubUname').textContent=p.username?('@'+p.username):''; $('pubBio').textContent=p.bio||'';
  renderProfileTags(uid);
  const actions=$('pubActions'); actions.innerHTML='';
  if(uid!==U.id){
    const q=await supa.from('friendships').select('*').or(`and(requester.eq.${U.id},recipient.eq.${uid}),and(requester.eq.${uid},recipient.eq.${U.id})`).maybeSingle();
    const rel=q.data;
    if(!rel){ const b=document.createElement('button'); b.className='btn bp'; b.textContent='Adicionar'; b.onclick=()=>sendFriendRequest(uid); actions.appendChild(b); }
    else if(rel.status==='pending'){ if(rel.requester===U.id){ const b=document.createElement('button'); b.className='btn bg2'; b.textContent='Cancelar pedido'; b.onclick=()=>cancelFriendRequest(uid); actions.appendChild(b); } else { const b=document.createElement('button'); b.className='btn bp'; b.textContent='Aceitar'; b.onclick=()=>acceptFriendRequest(uid); actions.appendChild(b); } }
    else if(rel.status==='accepted'){ const b=document.createElement('button'); b.className='btn bg2'; b.textContent='Remover'; b.onclick=()=>removeFriend(uid); actions.appendChild(b); }
    const dm=document.createElement('button'); dm.className='btn bg2'; dm.textContent='Mensagem'; dm.onclick=()=>openDM(uid); actions.appendChild(dm);
  } else { const b=document.createElement('button'); b.className='btn bp'; b.textContent='Editar'; b.onclick=()=>openSettings(); actions.appendChild(b); }
  const fl=$('pubFriends'); fl.innerHTML='';
  if(fr.data && fr.data.length){
    const seen=new Set();
    fr.data.forEach(f=>{
      const friendId=f.requester===uid?f.recipient:f.requester;
      if(seen.has(friendId)) return; seen.add(friendId); // evita duplicata visual se houver linhas repetidas no banco
      const wrap=document.createElement('div'); wrap.style.cssText='position:relative;width:40px;height:40px;flex-shrink:0;cursor:pointer';
      wrap.onclick=()=>openProfile(friendId);
      getSupa().from('profiles').select('id,name,photo,color,frame,frame_scale,frame_x,frame_y').eq('id',friendId).maybeSingle().then(rr=>{ wrap.innerHTML=avatarHTML(rr.data||{name:'U'}); });
      fl.appendChild(wrap);
    });
  }
  $('profileModal').classList.add('on');
}
function openMemberSearchModal(){ $('memberSearchModal').classList.add('on'); }
async function searchMembers(){
  let q=$('memberSearchInput').value.trim(); if(!q) return;
  if(q.startsWith('@')) q=q.slice(1).trim();
  if(!q) return;
  const supa=getSupa();
  const box=$('memberSearchResults'); box.className='member-list'; box.innerHTML='<div class="ge">Buscando...</div>';
  const safe=q.replace(/[%,]/g,''); // evita quebrar o filtro .or() do PostgREST
  const { data, error }=await supa.from('profiles').select('id,name,username,photo,color,frame,frame_scale,frame_x,frame_y').or(`name.ilike.%${safe}%,username.ilike.%${safe}%`).limit(30);
  box.innerHTML='';
  if(error){ console.error('searchMembers error:',error); toast('Erro na busca: '+(error.message||'ver console'),'err'); return; }
  if(!data||!data.length){ box.innerHTML='<div class="ge">Nenhum resultado para "'+safe+'".</div>'; return; }
  data.forEach(p=>{
    const row=document.createElement('div'); row.className='member-row'; row.onclick=()=>{ openProfile(p.id); closeModal('memberSearchModal'); };
    const av=document.createElement('div'); av.className='member-av'; av.innerHTML=avatarHTML(p);
    const lbl=document.createElement('div'); lbl.className='member-lbl';
    lbl.innerHTML=`${nameRowHTML(p.name||'Usuário',p.id,'member-name')}${p.username?`<span class="member-uname">@${p.username}</span>`:''}`;
    row.appendChild(av); row.appendChild(lbl); box.appendChild(row);
  });
}

/* ── MENSAGENS PRIVADAS (DM) ── funciona por polling, sem depender de Realtime/Replication.
   Requer a tabela "dm_messages" no Supabase:
   create table dm_messages(id uuid primary key default gen_random_uuid(), sender uuid not null, recipient uuid not null, content text not null, created_at timestamptz not null default now());
   alter table dm_messages enable row level security;
   create policy dm_select on dm_messages for select using (auth.uid()=sender or auth.uid()=recipient);
   create policy dm_insert on dm_messages for insert with check (auth.uid()=sender);
*/
let dmTargetId=null, dmPollTimer=null, dmInboxTimer=null, dmLastSeenAt=null, dmInboxLastAt=null, dmKnownIds=new Set();
let dmTargetProfile=null, dmUnreadBySender={};
async function openDM(uid){
  if(!U.id){ toast('Faça login para enviar mensagens','err'); return; }
  if(uid===U.id){ toast('Você não pode enviar mensagem para si mesmo','err'); return; }
  dmTargetId=uid; dmLastSeenAt=null; dmKnownIds=new Set(); closeModal('profileModal'); closeFriendsHub();
  const supa=getSupa();
  const { data:p }=await supa.from('profiles').select('id,name,username,photo,color,frame,frame_scale,frame_x,frame_y').eq('id',uid).maybeSingle();
  dmTargetProfile=p||{id:uid,name:'Usuário'};
  $('dmTitle').textContent=p?(p.name||(p.username?'@'+p.username:'Conversa')):'Conversa';
  $('dmMessages').innerHTML='<div class="ge">Carregando...</div>';
  $('dmModal').classList.add('on');
  // Ao abrir a conversa, o que estava pendente desse remetente é considerado lido
  if(dmUnreadBySender[uid]){ fabUnreadMsgs=Math.max(0,fabUnreadMsgs-dmUnreadBySender[uid]); dmUnreadBySender[uid]=0; updateFabBadge(); }
  await loadDMHistory(uid);
  startDMPolling(uid);
}
async function loadDMHistory(uid){
  const supa=getSupa();
  const { data, error }=await supa.from('dm_messages').select('*').or(`and(sender.eq.${U.id},recipient.eq.${uid}),and(sender.eq.${uid},recipient.eq.${U.id})`).order('created_at',{ascending:true}).limit(200);
  const box=$('dmMessages'); box.innerHTML='';
  if(error){ console.error('loadDMHistory error:',error); box.innerHTML='<div class="ge">Erro ao carregar mensagens — confira se a tabela "dm_messages" existe no Supabase.</div>'; return; }
  (data||[]).forEach(m=>{ appendDMBubble(m); dmKnownIds.add(m.id); dmLastSeenAt=m.created_at; });
  box.scrollTop=box.scrollHeight;
}
function appendDMBubble(m){
  const box=$('dmMessages'); const mine=m.sender===U.id;
  const row=document.createElement('div'); row.className='dm-row'+(mine?' mine':'');
  const av=document.createElement('div'); av.className='dm-av';
  av.innerHTML=avatarHTML(mine?U:(dmTargetProfile||{name:'U'}));
  const b=document.createElement('div'); b.className='dm-bubble'+(mine?' mine':'');
  b.textContent=m.content;
  row.appendChild(av); row.appendChild(b);
  box.appendChild(row);
}
function startDMPolling(uid){
  stopDMPolling();
  dmPollTimer=setInterval(async ()=>{
    if(dmTargetId!==uid || !$('dmModal').classList.contains('on')) return;
    const supa=getSupa();
    let q=supa.from('dm_messages').select('*').or(`and(sender.eq.${U.id},recipient.eq.${uid}),and(sender.eq.${uid},recipient.eq.${U.id})`).order('created_at',{ascending:true});
    if(dmLastSeenAt) q=q.gt('created_at',dmLastSeenAt);
    const { data, error }=await q;
    if(error||!data||!data.length) return;
    data.forEach(m=>{ if(!dmKnownIds.has(m.id)){ dmKnownIds.add(m.id); appendDMBubble(m); dmLastSeenAt=m.created_at; } });
    $('dmMessages').scrollTop=$('dmMessages').scrollHeight;
  },3000);
}
function stopDMPolling(){ if(dmPollTimer){ clearInterval(dmPollTimer); dmPollTimer=null; } }
function subscribeIncomingDMs(){
  stopIncomingDMPolling();
  dmInboxLastAt=new Date().toISOString();
  pollFriendRequestsCount();
  dmInboxTimer=setInterval(async ()=>{
    if(!U.id) return;
    const supa=getSupa();
    const { data, error }=await supa.from('dm_messages').select('*').eq('recipient',U.id).gt('created_at',dmInboxLastAt).order('created_at',{ascending:true});
    pollFriendRequestsCount();
    if(error||!data||!data.length) return;
    for(const m of data){
      dmInboxLastAt=m.created_at;
      if(dmTargetId===m.sender && $('dmModal').classList.contains('on')){
        if(!dmKnownIds.has(m.id)){ dmKnownIds.add(m.id); appendDMBubble(m); dmLastSeenAt=m.created_at; $('dmMessages').scrollTop=$('dmMessages').scrollHeight; }
      } else {
        dmUnreadBySender[m.sender]=(dmUnreadBySender[m.sender]||0)+1; fabUnreadMsgs++; updateFabBadge();
        const { data:p }=await supa.from('profiles').select('name').eq('id',m.sender).maybeSingle();
        toast('Nova mensagem de '+(p?.name||'alguém'),'ok',()=>openDM(m.sender));
      }
    }
  },8000);
}
function stopIncomingDMPolling(){ if(dmInboxTimer){ clearInterval(dmInboxTimer); dmInboxTimer=null; } }
async function sendDM(){
  const input=$('dmInput'); const text=input.value.trim(); if(!text||!dmTargetId) return;
  input.value='';
  const supa=getSupa();
  const row={sender:U.id,recipient:dmTargetId,content:text};
  const { data, error }=await supa.from('dm_messages').insert(row).select().maybeSingle();
  if(error){ console.error('sendDM error:',error); toast('Erro ao enviar: '+(error.message||'ver console'),'err'); return; }
  if(data){ dmKnownIds.add(data.id); dmLastSeenAt=data.created_at; appendDMBubble(data); }
  else appendDMBubble({...row,created_at:new Date().toISOString()});
  $('dmMessages').scrollTop=$('dmMessages').scrollHeight;
}
function closeDM(){ $('dmModal').classList.remove('on'); stopDMPolling(); dmTargetId=null; }

/* ── CHAT FAB + HUB DE AMIGOS/CONVERSAS (global, dentro e fora de salas) ── */
let fabPendingReq=0, fabUnreadMsgs=0, currentFhubTab='conv';
/* Conversas e Quadro viraram um único menu recolhível (✴) na tela principal —
   por isso as quatro funções abaixo agora controlam o mesmo wrapper. Mantidas
   com esses nomes de propósito: goAuth/goLanding/goRoom já chamam todas elas. */
function showChatFab(){ const w=$('mainMoreWrap'); if(w) w.style.display='flex'; }
function hideChatFab(){ const w=$('mainMoreWrap'); if(w) w.style.display='none'; closeMainMoreMenu(); if($('friendsHubPanel'))$('friendsHubPanel').classList.remove('on'); }
function showBoardFab(){ /* mesmo botão de showChatFab — mantido só por compatibilidade */ }
function hideBoardFab(){ /* idem */ }
let _mainMoreOpen=false;
function toggleMainMoreMenu(){ _mainMoreOpen?closeMainMoreMenu():openMainMoreMenu(); }
function openMainMoreMenu(){
  _mainMoreOpen=true;
  $('mainMoreWrap').classList.add('on');
  setTimeout(()=>document.addEventListener('pointerdown',_mainMoreOutside),0);
}
function closeMainMoreMenu(){
  _mainMoreOpen=false;
  const w=$('mainMoreWrap'); if(w) w.classList.remove('on');
  document.removeEventListener('pointerdown',_mainMoreOutside);
}
function _mainMoreOutside(e){ if(!e.target.closest('#mainMoreWrap')) closeMainMoreMenu(); }
function updateFabBadge(){
  const total=fabPendingReq+fabUnreadMsgs;
  [$('fabBadge'),$('roomFabBadge')].forEach(b=>{
    if(!b) return;
    if(total>0){ b.textContent=total>9?'9+':total; b.style.display='flex'; } else b.style.display='none';
  });
  const rb=$('reqBadge'); if(rb){ if(fabPendingReq>0){ rb.textContent=fabPendingReq>9?'9+':fabPendingReq; rb.style.display='flex'; } else rb.style.display='none'; }
  const dot=$('mainMoreDot'); if(dot) dot.style.display=(total>0)?'block':'none';
}
async function pollFriendRequestsCount(){
  if(!U.id) return;
  const supa=getSupa();
  const { count } = await supa.from('friendships').select('*',{count:'exact',head:true}).eq('recipient',U.id).eq('status','pending');
  fabPendingReq=count||0; updateFabBadge();
}

/* ══════════════════ QUADRO COLABORATIVO (estilo Miro) ══════════════════
   Notas de texto, imagens e correntes (conexões) num quadro compartilhado,
   visível e editável por qualquer pessoa logada. Persistido nas tabelas
   board_nodes/board_edges do Supabase + bucket de Storage "board".        */

/* ══════════════════════════════════════════════════════════════════
   QUADRO COLABORATIVO (estilo Miro) — reescrito para:
   • Tela infinita com zoom (roda/pinça) e pan (arrastar vazio, botão do
     meio ou espaço+arrastar), tudo via CSS transform numa única camada —
     muito mais leve que rolar um <div> gigante.
   • Notas que crescem sozinhas conforme o texto e podem ser
     redimensionadas manualmente pela alça do canto.
   • Conectores em curva de Bézier, com seta, que podem ser entortados
     arrastando a alça do meio. Sem "×" poluindo a tela: clique no
     conector pra selecioná-lo e aí sim aparecem as ações.
   • Pipeline de render otimizado: nada de recriar o SVG inteiro a cada
     movimento — os <path> são reaproveitados por id e as atualizações
     entram numa fila de requestAnimationFrame.
   ══════════════════════════════════════════════════════════════════ */

/* ── viewport ── */
