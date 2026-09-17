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
/* ══════════════════════════════════════════════════════════════════
   PRÉ-VISUALIZAÇÃO E AJUSTE DO PERFIL

   Abre como se fosse abrir o perfil de verdade — mesmo banner, mesmo nome,
   mesmo avatar — só que aqui a moldura e as duas bordas ficam editáveis:
   segurar e arrastar move, puxar a alcinha no canto redimensiona. É o mesmo
   jeito de mexer nos cards do quadro (startBoardResize), de propósito — pra
   ser uma interação que a pessoa já conhece, em vez de belisco de dois dedos,
   que era difícil de acertar numa área pequena.
   ══════════════════════════════════════════════════════════════════ */
/* Mostra a moldura no avatar pequeno das configurações — só exibição, sem
   gesto nenhum aqui. Editar de verdade agora acontece na pré-visualização
   grande (abrirPreviewEdit), onde a imagem não fica em cima do botão de
   trocar de foto. */
function updateFramePreview(){
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
}

let pexAba='frame';

/* Mapeia cada camada editável aos campos que ela lê/escreve em U, e à lista
   de imagens disponíveis pra ela. A moldura usa porcentagem (é assim que o
   resto do app — avatares em salas, membros — já espera frame_x/frame_y);
   as bordas usam pixels crus. */
function pexCampos(qual){
  if(qual==='frame') return {
    url:'frame', escala:'frame_scale', x:'frame_x', y:'frame_y',
    wrap:'pexFrameWrap', img:'pexFrame', unidade:'percent',
    min:0.3, max:4, limite:220, presets:()=>FRAME_PRESETS
  };
  if(qual==='bordaTopo') return {
    url:'border_top', escala:'border_top_scale', x:'border_top_x', y:'border_top_y',
    wrap:'pexBordaTopoWrap', img:'pexBordaTopo', unidade:'px',
    min:0.2, max:5, limite:320, presets:()=>BORDER_PRESETS
  };
  return {
    url:'border_bottom', escala:'border_bottom_scale', x:'border_bottom_x', y:'border_bottom_y',
    wrap:'pexBordaBaixoWrap', img:'pexBordaBaixo', unidade:'px',
    min:0.2, max:5, limite:320, presets:()=>BORDER_PRESETS
  };
}
function pexRenderCamada(qual){
  const c=pexCampos(qual);
  const wrap=$(c.wrap), img=$(c.img); if(!wrap||!img) return;
  const url=U[c.url];
  if(!url){ wrap.style.display='none'; return; }
  wrap.style.display='block';
  if(img.getAttribute('src')!==url) img.setAttribute('src',url);
  const escala=U[c.escala]||1, x=U[c.x]||0, y=U[c.y]||0;
  if(c.unidade==='percent'){
    wrap.style.left=(50+x)+'%'; wrap.style.top=(50+y)+'%';
    wrap.style.transform=`translate(-50%,-50%) scale(${escala*1.45})`;
  }else{
    wrap.style.left='50%'; wrap.style.top='0';
    wrap.style.transform=`translate(calc(-50% + ${x}px), ${y}px) scale(${escala})`;
  }
}
function pexRenderTudo(){
  const av=$('pexAv'); if(av) av.innerHTML=avatarFillHTML(U);
  const nm=$('pexNome'); if(nm) nm.textContent=($('sNm')&&$('sNm').value.trim())||U.name||'Seu nome';
  const uname=($('sUname')&&$('sUname').value.trim())||U.username||'';
  const us=$('pexUser'); if(us) us.textContent=uname?('@'+uname):'';
  const bio=$('pexBio'); if(bio) bio.textContent=($('sBio')&&$('sBio').value.trim())||U.bio||'';
  const bn=$('pexBanner');
  if(bn) bn.style.background=U.banner?`url('${U.banner}') center/cover`:'linear-gradient(90deg,#181818,#242424)';
  pexRenderCamada('frame'); pexRenderCamada('bordaTopo'); pexRenderCamada('bordaBaixo');
  updateFramePreview();   // mantém o avatar pequeno das configurações em dia também
  pexAtualizarPct();
}
function pexAtualizarPct(){
  const c=pexCampos(pexAba);
  const el=$('pexPct'); if(el) el.textContent=Math.round((U[c.escala]||1)*100)+'%';
}
function pexAbrirAba(qual){
  pexAba=qual;
  document.querySelectorAll('.pex-aba').forEach(b=>b.classList.toggle('on', b.dataset.aba===qual));
  pexBuildGaleria();
  pexAtualizarPct();
}
function pexBuildGaleria(){
  const box=$('pexGaleria'); if(!box) return;
  const c=pexCampos(pexAba);
  const atual=U[c.url]||null;
  box.innerHTML='';
  const nada=document.createElement('div');
  nada.className='borda-item'+(!atual?' on':'');
  nada.textContent='Nenhuma';
  nada.onclick=()=>{ U[c.url]=null; pexRenderCamada(pexAba); pexBuildGaleria(); };
  box.appendChild(nada);
  (c.presets()||[]).forEach(url=>{
    const d=document.createElement('div');
    d.className='borda-item'+(atual===url?' on':'');
    d.onclick=()=>{ U[c.url]=url; pexRenderCamada(pexAba); pexBuildGaleria(); };
    const img=document.createElement('img'); img.src=url; img.loading='lazy';
    d.appendChild(img); box.appendChild(d);
  });
}
function pexRemover(){
  const c=pexCampos(pexAba);
  U[c.url]=null; U[c.escala]=1; U[c.x]=0; U[c.y]=0;
  pexRenderCamada(pexAba); pexBuildGaleria(); pexAtualizarPct();
}
function limitar(v,a,b){ return Math.max(a,Math.min(b,v)); }
/* Arrastar: segura na IMAGEM (não na alça) e move — captura o toque na hora,
   sem o truque de espera que a moldura pequena precisava, porque aqui a
   imagem não fica em cima de nenhum botão de upload por baixo.
   Redimensionar: puxa a alça no canto — a distância até o centro da camada
   vira a escala. É o mesmo cálculo do redimensionar dos cards do quadro
   (startBoardResize/onBoardResizeMove), só que por distância ao centro em vez
   de largura/altura, porque aqui a camada é sempre quadrada. */
function pexAttachInteracao(qual){
  const c=pexCampos(qual);
  const wrap=$(c.wrap), img=$(c.img); if(!wrap||!img||wrap.dataset.pexPronto) return;
  wrap.dataset.pexPronto='1';
  const alca=wrap.querySelector('.pex-alca');

  img.style.touchAction='none'; img.style.cursor='grab';
  img.addEventListener('pointerdown',e=>{
    e.preventDefault(); e.stopPropagation();
    try{ img.setPointerCapture(e.pointerId); }catch(_){}
    const startX=U[c.x]||0, startY=U[c.y]||0;
    const startPX=e.clientX, startPY=e.clientY;
    const base=wrap.parentElement;
    const fatorX = c.unidade==='percent' ? 100/((base&&base.offsetWidth)||130) : 1;
    const fatorY = c.unidade==='percent' ? 100/((base&&base.offsetHeight)||130) : 1;
    const mover=ev=>{
      U[c.x]=limitar(startX+(ev.clientX-startPX)*fatorX, -c.limite, c.limite);
      U[c.y]=limitar(startY+(ev.clientY-startPY)*fatorY, -c.limite, c.limite);
      pexRenderCamada(qual);
    };
    const soltar=()=>{ img.removeEventListener('pointermove',mover); };
    img.addEventListener('pointermove',mover);
    img.addEventListener('pointerup',soltar,{once:true});
    img.addEventListener('pointercancel',soltar,{once:true});
  });

  if(!alca) return;
  alca.style.touchAction='none';
  alca.addEventListener('pointerdown',e=>{
    e.preventDefault(); e.stopPropagation();
    try{ alca.setPointerCapture(e.pointerId); }catch(_){}
    const mover=ev=>{
      const r=wrap.getBoundingClientRect();
      const cx=r.left+r.width/2, cy=r.top+r.height/2;
      const dist=Math.hypot(ev.clientX-cx, ev.clientY-cy);
      const escalaAtual=U[c.escala]||1;
      const base=Math.hypot(r.width/2,r.height/2)/(escalaAtual||1);   // tamanho "sem escala"
      U[c.escala]=limitar(dist/(base||1), c.min, c.max);
      pexRenderCamada(qual); pexAtualizarPct();
    };
    const soltar=()=>{ alca.removeEventListener('pointermove',mover); };
    alca.addEventListener('pointermove',mover);
    alca.addEventListener('pointerup',soltar,{once:true});
    alca.addEventListener('pointercancel',soltar,{once:true});
  });
}
/* Bordas do card de perfil — mesma ideia das molduras: a lista vem do banco
   (tabela `border_presets`), então dá pra acrescentar bordas novas sem tocar
   no código. Esta declaração tinha sido apagada por engano numa reescrita
   anterior — era isso que fazia a pré-visualização nunca abrir: o clique
   chamava uma função inexistente, o erro travava tudo antes de chegar na
   linha que mostra o modal, e como o botão não captura esse erro, falhava
   sem avisar nada. */
let BORDER_PRESETS=[];
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
async function abrirPreviewEdit(){
  // Blindado: se a busca de imagens falhar por qualquer motivo, o modal ainda
  // abre — é sempre pior ficar sem abrir nada do que abrir sem as galerias
  // atualizadas. O clique era feito direto por onclick, sem quem capturasse
  // um erro, então uma falha aqui antes travava tudo em silêncio.
  try{ await loadFramePresets(); }catch(e){ console.error('loadFramePresets:',e); }
  try{ await loadBorderPresets(); }catch(e){ console.error('loadBorderPresets:',e); }
  try{
    pexRenderTudo();
    pexAttachInteracao('frame'); pexAttachInteracao('bordaTopo'); pexAttachInteracao('bordaBaixo');
    pexAbrirAba(pexAba);
  }catch(e){ console.error('abrirPreviewEdit:',e); }
  $('previewEditModal').classList.add('on');
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
