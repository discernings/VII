const BOARD_W = 12000, BOARD_H = 9000;   // tela útil (bem maior que antes)
const BOARD_MIN_SCALE = 0.15, BOARD_MAX_SCALE = 3;
let boardView = { x:0, y:0, scale:1 };
let boardPan = null;             // {startX,startY,ox,oy} enquanto arrasta o fundo
let boardSpaceDown = false;      // barra de espaço segurada = modo pan
let boardPinch = null;           // {dist,scale,cx,cy} durante pinça de 2 dedos
let boardSelectedEdge = null;    // id do conector selecionado (mostra ações)
let boardEdgeDrag = null;        // {id} enquanto entorta um conector
let boardResize = null;          // {id,startX,startY,startW,startH}
let _edgeEls = {};               // id -> {path,hit,handle,arrow} reaproveitados
let _edgeRAF = null;             // fila de redesenho (coalesce vários pedidos num frame só)
let _nodeStamp = {};             // id -> updated_at já aplicado (evita re-render à toa)

let _zoomLblRAF=null, _movingTO=null;
function markBoardMoving(){
  const inner=$('boardInner'); if(!inner) return;
  inner.classList.add('moving');
  clearTimeout(_movingTO);
  _movingTO=setTimeout(()=>inner.classList.remove('moving'),260);
}
function applyBoardTransform(){
  markBoardMoving();
  const inner=$('boardInner');
  if(inner) inner.style.transform=`translate3d(${boardView.x}px,${boardView.y}px,0) scale(${boardView.scale})`;
  // a grade é desenhada pelo .board-outer (tamanho da tela) e segue o transform via CSS vars
  const outer=$('boardOuter');
  if(outer){
    outer.style.setProperty('--bs',boardView.scale);
    outer.style.setProperty('--bx',boardView.x+'px');
    outer.style.setProperty('--by',boardView.y+'px');
  }
  // atualizar texto força layout; uma vez por frame basta
  if(!_zoomLblRAF) _zoomLblRAF=requestAnimationFrame(()=>{
    _zoomLblRAF=null;
    const zl=$('boardZoomLabel'); if(zl) zl.textContent=Math.round(boardView.scale*100)+'%';
  });
}
/* converte coordenada de tela → coordenada do quadro */
function boardPoint(clientX,clientY){
  const r=$('boardOuter').getBoundingClientRect();
  return { x:(clientX-r.left-boardView.x)/boardView.scale, y:(clientY-r.top-boardView.y)/boardView.scale };
}
function boardViewportCenter(){
  const o=$('boardOuter'); if(!o) return {x:0,y:0};
  const r=o.getBoundingClientRect();
  return boardPoint(r.left+r.width/2, r.top+r.height/2);
}
/* zoom mantendo fixo o ponto sob o cursor/dedos */
function boardZoomAt(clientX,clientY,factor){
  const old=boardView.scale;
  const next=Math.min(BOARD_MAX_SCALE,Math.max(BOARD_MIN_SCALE,old*factor));
  if(next===old) return;
  const r=$('boardOuter').getBoundingClientRect();
  const px=clientX-r.left, py=clientY-r.top;
  boardView.x = px-(px-boardView.x)*(next/old);
  boardView.y = py-(py-boardView.y)*(next/old);
  boardView.scale=next;
  applyBoardTransform();
}
function boardZoomBy(f){
  const r=$('boardOuter').getBoundingClientRect();
  boardZoomAt(r.left+r.width/2, r.top+r.height/2, f);
}
function boardZoomReset(){ boardView={x:0,y:0,scale:1}; applyBoardTransform(); }
/* enquadra todo o conteúdo na tela */
function boardFitAll(){
  const ns=Object.values(boardNodes); if(!ns.length){ boardZoomReset(); return; }
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  ns.forEach(n=>{ const w=n.w||180,h=n.h||120;
    minX=Math.min(minX,n.x||0); minY=Math.min(minY,n.y||0);
    maxX=Math.max(maxX,(n.x||0)+w); maxY=Math.max(maxY,(n.y||0)+h); });
  const o=$('boardOuter').getBoundingClientRect();
  const pad=80;
  const s=Math.min(BOARD_MAX_SCALE,Math.max(BOARD_MIN_SCALE,
    Math.min((o.width-pad*2)/(maxX-minX||1),(o.height-pad*2)/(maxY-minY||1))));
  boardView.scale=s;
  boardView.x=(o.width-(maxX-minX)*s)/2-minX*s;
  boardView.y=(o.height-(maxY-minY)*s)/2-minY*s;
  applyBoardTransform();
}

/* ── ciclo de vida ── */
async function openBoard(){
  if(!U.id){ toast('Faça login para usar o quadro','err'); return; }
  $('boardPanel').classList.add('on');
  document.body.classList.add('board-open'); // congela/oculta a cena de baixo (ver CSS)
  initBoardViewportEvents();
  applyBoardTransform();
  await loadBoardFull();
  startBoardPolling();
  startBoardClock();
}
function closeBoard(){
  document.body.classList.remove('board-digitando');
  $('boardPanel').classList.remove('on');
  document.body.classList.remove('board-open');
  stopBoardPolling();
  stopBoardClock();
  boardConnectMode=false; boardConnectFrom=null; boardSelectedEdge=null;
  $('boardConnectBtn').classList.remove('on'); $('boardHint').style.display='none';
  document.querySelectorAll('.board-node.connect-sel').forEach(e=>e.classList.remove('connect-sel'));
}
let _boardLoading=false;
function startBoardPolling(){
  stopBoardPolling();
  boardPollTimer=setInterval(()=>{
    if(document.hidden)return;      // aba em segundo plano: não gasta rede/CPU
    if(_boardLoading)return;        // já tem uma carga em andamento — não empilha requisições
    if(boardDrag||boardResize||boardEdgeDrag)return; // não recarrega no meio de uma interação
    loadBoardFull();
  },6000);
}
function stopBoardPolling(){ if(boardPollTimer){ clearInterval(boardPollTimer); boardPollTimer=null; } }

let _boardEventsReady=false;
function initBoardViewportEvents(){
  if(_boardEventsReady) return; _boardEventsReady=true;
  const outer=$('boardOuter');

  // zoom pela roda / trackpad (ctrl+scroll = pinça no trackpad)
  let _wheelRAF=null, _wAcc={x:0,y:0,z:0,cx:0,cy:0};
  outer.addEventListener('wheel',e=>{
    e.preventDefault();
    if(e.ctrlKey||e.metaKey){ _wAcc.z+=e.deltaY; _wAcc.cx=e.clientX; _wAcc.cy=e.clientY; }
    else if(e.shiftKey){ _wAcc.x-=e.deltaY; }
    else { _wAcc.x-=e.deltaX; _wAcc.y-=e.deltaY; }
    if(_wheelRAF) return;
    _wheelRAF=requestAnimationFrame(()=>{
      _wheelRAF=null;
      if(_wAcc.z){ boardZoomAt(_wAcc.cx,_wAcc.cy,Math.pow(1.0016,-_wAcc.z)); _wAcc.z=0; }
      if(_wAcc.x||_wAcc.y){ boardView.x+=_wAcc.x; boardView.y+=_wAcc.y; _wAcc.x=_wAcc.y=0; applyBoardTransform(); }
    });
  },{passive:false});

  // pan arrastando o fundo (ou com botão do meio / espaço em qualquer lugar)
  outer.addEventListener('pointerdown',e=>{
    const onEmpty = e.target===outer || e.target===$('boardInner') || e.target===$('boardSvg');
    if(e.button===1 || boardSpaceDown || onEmpty){
      if(!onEmpty && e.button!==1 && !boardSpaceDown) return;
      boardPan={ startX:e.clientX, startY:e.clientY, ox:boardView.x, oy:boardView.y };
      outer.classList.add('panning');
      try{ outer.setPointerCapture(e.pointerId); }catch(err){}
      if(onEmpty){
        const anterior=boardSelectedEdge;
        boardSelectedEdge=null;
        if(anterior) scheduleEdgeRedraw([anterior]);
      }
    }
  });
  // pointermove pode disparar mais rápido que a tela atualiza; limitamos a 1 por frame
  let _panRAF=null;
  outer.addEventListener('pointermove',e=>{
    if(!boardPan) return;
    boardPan.lx=e.clientX; boardPan.ly=e.clientY;
    if(_panRAF) return;
    _panRAF=requestAnimationFrame(()=>{
      _panRAF=null; if(!boardPan) return;
      boardView.x=boardPan.ox+(boardPan.lx-boardPan.startX);
      boardView.y=boardPan.oy+(boardPan.ly-boardPan.startY);
      applyBoardTransform();
    });
  });
  const endPan=()=>{ boardPan=null; outer.classList.remove('panning'); };
  outer.addEventListener('pointerup',endPan);
  outer.addEventListener('pointercancel',endPan);

  // pinça de dois dedos no celular
  outer.addEventListener('touchstart',e=>{
    if(e.touches.length===2){
      const [a,b]=e.touches;
      boardPinch={ dist:Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY) };
      endPan();
    }
  },{passive:true});
  outer.addEventListener('touchmove',e=>{
    if(e.touches.length===2&&boardPinch){
      e.preventDefault();
      const [a,b]=e.touches;
      const d=Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY);
      boardZoomAt((a.clientX+b.clientX)/2,(a.clientY+b.clientY)/2,d/boardPinch.dist);
      boardPinch.dist=d;
    }
  },{passive:false});
  outer.addEventListener('touchend',()=>{ if(boardPinch) boardPinch=null; },{passive:true});

  // atalhos: espaço = pan, Delete = apaga conector selecionado, +/- zoom, 0 reset
  document.addEventListener('keydown',e=>{
    if(!$('boardPanel').classList.contains('on')) return;
    const typing=document.activeElement&&document.activeElement.isContentEditable;
    if(e.code==='Space'&&!typing){ boardSpaceDown=true; outer.classList.add('pan-ready'); e.preventDefault(); }
    if((e.key==='Delete'||e.key==='Backspace')&&boardSelectedEdge&&!typing){ e.preventDefault(); deleteBoardEdge(boardSelectedEdge); }
    if(e.key==='Escape'){ boardSelectedEdge=null; scheduleEdgeRedraw(); if(boardConnectMode) toggleBoardConnect(); }
    if(!typing&&(e.key==='+'||e.key==='=')) boardZoomBy(1.15);
    if(!typing&&e.key==='-') boardZoomBy(1/1.15);
    if(!typing&&e.key==='0') boardZoomReset();
  });
  document.addEventListener('keyup',e=>{
    if(e.code==='Space'){ boardSpaceDown=false; outer.classList.remove('pan-ready'); }
  });
}

/* ── carga / sincronização ── */
async function loadBoardFull(){
  if(_boardLoading)return;
  _boardLoading=true;
  try{
  const supa=getSupa();
  const [nodesRes,edgesRes]=await Promise.all([
    supa.from('board_nodes').select('*').order('created_at',{ascending:true}),
    supa.from('board_edges').select('*')
  ]);
  if(nodesRes.error){ console.error('loadBoardFull nodes error',nodesRes.error); toast('Erro ao carregar o quadro: '+nodesRes.error.message,'err'); return; }
  if(edgesRes.error){ console.error('loadBoardFull edges error',edgesRes.error); }
  const nodes=nodesRes.data||[], edges=edgesRes.data||[];
  const freshNodeIds=new Set(nodes.map(n=>n.id));
  Object.keys(boardNodes).forEach(id=>{
    if(!freshNodeIds.has(id) && !(boardDrag&&boardDrag.id===id)){
      const el=document.getElementById('bn-'+id); if(el) el.remove();
      delete boardNodes[id]; delete _nodeStamp[id];
    }
  });
  nodes.forEach(n=>{
    if(boardDrag&&boardDrag.id===n.id) return;      // não atropela o que estou arrastando
    if(boardResize&&boardResize.id===n.id) return;  // nem o que estou redimensionando
    const el=document.getElementById('bn-'+n.id);
    const bodyFocused=el&&document.activeElement&&el.contains(document.activeElement)&&document.activeElement.isContentEditable;
    if(bodyFocused) return;                          // nem o que estou escrevendo
    // só re-renderiza se realmente mudou desde a última vez (evita trabalho de DOM a cada 6s)
    const stamp=n.updated_at||n.created_at||'';
    if(_nodeStamp[n.id]===stamp && boardNodes[n.id]) return;
    _nodeStamp[n.id]=stamp;
    boardNodes[n.id]=n; renderBoardNode(n);
  });
  const freshEdgeIds=new Set(edges.map(e=>e.id));
  Object.keys(boardEdges).forEach(id=>{
    if(!freshEdgeIds.has(id)){ delete boardEdges[id]; removeEdgeEls(id); }
  });
  edges.forEach(e=>{
    const prev=boardEdges[e.id];
    // BUG CORRIGIDO (conector voltava a ficar reto): se as colunas bend_x/bend_y
    // ainda não existem no banco, a linha que volta do servidor não traz a
    // curvatura — e sobrescrever cegamente zerava o que você acabou de entortar.
    // Só aceitamos a curvatura do servidor quando ela realmente veio.
    if(prev && e.bend_x==null && e.bend_y==null){ e.bend_x=prev.bend_x||0; e.bend_y=prev.bend_y||0; }
    // curvatura que eu fiz e ainda não foi confirmada pelo servidor tem prioridade
    const pend=_bendPending[e.id];
    if(pend){
      if(e.bend_x===pend.x && e.bend_y===pend.y) delete _bendPending[e.id]; // servidor alcançou
      else { e.bend_x=pend.x; e.bend_y=pend.y; }
    }
    // e nunca atropela o conector que está sendo entortado neste instante
    if(boardEdgeDrag && boardEdgeDrag.id===e.id && prev){ e.bend_x=prev.bend_x; e.bend_y=prev.bend_y; }
    boardEdges[e.id]=e;
  });
  rebuildEdgeIndex();
  scheduleEdgeRedraw();
  }finally{ _boardLoading=false; }
}

/* ── nós ── */
/* translate3d em vez de left/top: sai do caminho de layout e vai direto pro
   compositor da GPU — é a diferença entre arrastar travando e arrastar liso. */
function setNodePos(el,x,y){ el.style.transform=`translate3d(${x}px,${y}px,0)`; }
/* Índice nó -> conectores, pra redesenhar SÓ o que o movimento afeta
   (antes, mexer numa nota redesenhava todos os conectores do quadro). */
let _edgeIndex={};
function rebuildEdgeIndex(){
  _edgeIndex={};
  Object.values(boardEdges).forEach(e=>{
    (_edgeIndex[e.from_node]=_edgeIndex[e.from_node]||[]).push(e.id);
    (_edgeIndex[e.to_node]=_edgeIndex[e.to_node]||[]).push(e.id);
  });
}
function edgesOfNode(id){ return _edgeIndex[id]||[]; }
/* Mostra quando a nota/imagem foi criada, em linguagem natural. */
function relTime(iso){
  const t=new Date(iso).getTime();
  if(isNaN(t)) return '';
  const s=Math.floor((Date.now()-t)/1000);
  if(s<60)    return 'agora';
  const m=Math.floor(s/60);   if(m<60) return m+' min';
  const h=Math.floor(m/60);   if(h<24) return h+' h';
  const d=Math.floor(h/24);   if(d<7)  return d+' d';
  return new Date(iso).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
}
/* Mantém os horários em dia sem re-renderizar as notas (só troca o texto). */
let _boardClock=null;
function startBoardClock(){
  stopBoardClock();
  _boardClock=setInterval(()=>{
    if(document.hidden) return;
    Object.values(boardNodes).forEach(n=>{
      if(!n.created_at) return;
      const el=document.getElementById('bn-'+n.id);
      const t=el&&el.querySelector('.board-node-time');
      if(t) t.textContent=relTime(n.created_at);
    });
  },60000);
}
function stopBoardClock(){ if(_boardClock){ clearInterval(_boardClock); _boardClock=null; } }
function renderBoardNode(n){
  let el=document.getElementById('bn-'+n.id);
  const isImg=n.type==='image';
  if(!el){
    el=document.createElement('div');
    el.id='bn-'+n.id; el.className='board-node'+(isImg?' board-node-img':'');
    el.dataset.bnId=n.id;
    const canEdit=n.created_by===U.id;
    el.innerHTML=`<div class="board-node-head" data-drag>
        <span class="board-node-chevron"></span>
        <span class="board-node-dot"></span>
        <span class="board-node-owner"></span>
        <span class="board-node-time"></span>
        <span class="board-node-actions">
          <span class="board-node-link" data-link title="Conectar a partir desta">⤳</span>
          ${canEdit?'<span class="board-node-del" data-del title="Apagar">×</span>':''}
        </span>
      </div>
      ${isImg?`<img src="${n.image_url||''}" draggable="false">`:'<div class="board-node-body" contenteditable="true" spellcheck="false"></div>'}
      <span class="board-node-rz" data-rz title="Redimensionar"></span>
      <button class="board-node-reply" data-reply title="Responder" aria-label="Responder esta nota">+</button>`;
    el.querySelector('[data-drag]').addEventListener('pointerdown',e=>startBoardDrag(e,n.id));
    el.querySelector('[data-rz]').addEventListener('pointerdown',e=>startBoardResize(e,n.id));
    el.querySelector('[data-link]').addEventListener('click',e=>{ e.stopPropagation(); startConnectFrom(n.id); });
    /* Disponível pra QUALQUER pessoa, dona da nota ou não — funciona nos dois
       sentidos, como pedido: responder uma nota de outra pessoa, ou deixar que
       outra pessoa responda uma nota sua. */
    el.querySelector('[data-reply]').addEventListener('click',e=>{ e.stopPropagation(); responderNota(n.id); });
    const del=el.querySelector('[data-del]'); if(del) del.addEventListener('click',e=>{ e.stopPropagation(); deleteBoardNode(n.id); });
    if(!isImg){
      const body=el.querySelector('.board-node-body');
      body.addEventListener('focus',()=>document.body.classList.add('board-digitando'));
      body.addEventListener('blur',()=>{
        document.body.classList.remove('board-digitando');
        saveBoardNodeContent(n.id,body.innerText);
      });
      body.addEventListener('pointerdown',e=>e.stopPropagation());
      // cresce sozinha conforme o texto — o problema antigo de "texto grande e a nota não acompanha"
      body.addEventListener('input',()=>autoGrowNode(n.id));
    }
    el.addEventListener('pointerdown',()=>{ el.style.zIndex=++zTop; },{passive:true});
    el.addEventListener('click',()=>{ if(boardConnectMode) handleBoardConnectClick(n.id); });
    $('boardInner').appendChild(el);
  }
  setNodePos(el,n.x||0,n.y||0);
  el.style.width=(n.w||180)+'px';
  if(isImg) el.style.height=(n.h||220)+'px';
  else el.style.height=n.h?(n.h+'px'):'auto';
  n._w=null; n._h=null;               // invalida o cache; remedimos fora do caminho crítico
  requestAnimationFrame(()=>{ if(boardNodes[n.id]){ const e2=document.getElementById('bn-'+n.id); if(e2){ n._w=e2.offsetWidth; n._h=e2.offsetHeight; } } });
  if(!isImg){
    /* A cor escolhida não vira mais o fundo inteiro (aquele visual de post-it
       pastel) — no novo desenho o cartão é escuro, no estilo "bloco", e a cor
       vira o acento: contorno luminoso e a pastilha do cabeçalho. Isso mantém
       a escolha de cor útil, só traduzida pro visual novo. */
    el.style.setProperty('--nota-cor', n.color||'#f5d78a');
    const body=el.querySelector('.board-node-body');
    if(body && document.activeElement!==body) body.innerText=n.content||'';
  }
  const ownerEl=el.querySelector('.board-node-owner'); if(ownerEl) ownerEl.textContent=(n.created_by===U.id)?'você':'';
  // horário de criação, em formato relativo ("agora", "12 min", "3 h", "5 d")
  const timeEl=el.querySelector('.board-node-time');
  if(timeEl && n.created_at){
    timeEl.textContent=relTime(n.created_at);
    timeEl.title=new Date(n.created_at).toLocaleString('pt-BR');
  }
}
/* garante que a nota nunca "corte" o texto: cresce a altura até caber */
let _growRAF={};
function autoGrowNode(id){
  // Agrupa num frame: digitar rápido disparava uma medição de layout por tecla.
  if(_growRAF[id]) return;
  _growRAF[id]=requestAnimationFrame(()=>{
    delete _growRAF[id];
    const el=document.getElementById('bn-'+id); if(!el) return;
    const n=boardNodes[id]; if(!n) return;
    el.style.height='auto';
    const needed=el.scrollHeight;
    if(!n.h || needed>n.h){ n.h=needed; }
    el.style.height=n.h+'px';
    n._w=el.offsetWidth; n._h=el.offsetHeight;
    scheduleEdgeRedraw(edgesOfNode(id));
  });
}

/* ══════════════════════════════════════════════════════════════════
   COLISÃO AO CRIAR
   Antes toda nota nascia no centro da tela, então cada nova caía exatamente em
   cima da anterior. Agora procuramos um lugar livre em espiral a partir do
   centro: o primeiro ponto onde a nota não encosta em nenhuma outra.
   ══════════════════════════════════════════════════════════════════ */
const GAP = 18;   // respiro mínimo entre notas

/* Mede a nota como ela está NA TELA, agora.
   Era aqui que a colisão falhava: eu usava as medidas guardadas, e notas de
   texto não têm altura fixa — uma nota com texto longo ocupa 400px enquanto o
   registro dizia 130. A conta dava "cabe" e a nota nova nascia por cima.
   Ler o tamanho real resolve. Só acontece ao criar uma nota, então o custo é
   irrelevante. */
function medidaReal(id,n){
  const el=document.getElementById('bn-'+id);
  if(el && el.offsetWidth>0) return [el.offsetWidth, el.offsetHeight];
  return [n.w||200, n.h||130];
}
function colideComAlguma(x,y,w,h,ignorarId){
  for(const id in boardNodes){
    if(id===ignorarId) continue;
    const n=boardNodes[id]; if(!n) continue;
    const [nw,nh]=medidaReal(id,n);
    if(x < (n.x||0)+nw+GAP && x+w+GAP > (n.x||0) &&
       y < (n.y||0)+nh+GAP && y+h+GAP > (n.y||0)) return true;
  }
  return false;
}
/* Espiral quadrada: anda em anéis cada vez maiores até achar espaço.
   É barato mesmo com muitas notas, porque para no primeiro lugar livre. */
function acharLugarLivre(w,h,ignorarId){
  const c=boardViewportCenter();
  let x=Math.round(c.x-w/2), y=Math.round(c.y-h/2);
  if(!colideComAlguma(x,y,w,h,ignorarId)) return {x,y};
  const passo=Math.max(w,h)*0.75;   // passo maior: notas altas exigem mais espaço
  for(let anel=1; anel<=22; anel++){
    const r=anel*passo;
    // 8 direções por anel: direita, baixo, esquerda, cima e as diagonais
    const pontos=[];
    for(let a=0;a<12;a++){                 // 12 direções por anel em vez de 8
      const ang=(a/12)*Math.PI*2;
      pontos.push([Math.cos(ang)*r, Math.sin(ang)*r]);
    }
    for(const [dx,dy] of pontos){
      const nx=Math.round(c.x-w/2+dx), ny=Math.round(c.y-h/2+dy);
      if(nx<0||ny<0||nx+w>BOARD_W||ny+h>BOARD_H) continue;
      if(!colideComAlguma(nx,ny,w,h,ignorarId)) return {x:nx,y:ny};
    }
  }
  // quadro muito cheio: desloca um pouco para não sobrepor exatamente
  return { x:x+Math.round(Math.random()*120), y:y+Math.round(Math.random()*120) };
}

/* Depois que a nota é desenhada, o tamanho REAL aparece — e pode ser bem maior
   que o reservado (texto longo). Se ela tiver invadido alguma vizinha, movemos
   para um lugar livre usando o tamanho verdadeiro e salvamos a nova posição.
   Reservar espaço na criação não basta sozinho: só depois de renderizar dá para
   saber quanto a nota realmente ocupa. */
function ajustarSeColidir(id){
  requestAnimationFrame(()=>{
    const n=boardNodes[id]; if(!n) return;
    const [w,h]=medidaReal(id,n);
    if(!colideComAlguma(n.x,n.y,w,h,id)) return;   // já está bem posicionada
    const pos=acharLugarLivre(w,h,id);
    n.x=pos.x; n.y=pos.y;
    const el=document.getElementById('bn-'+id);
    if(el) setNodePos(el,pos.x,pos.y);
    scheduleEdgeRedraw(edgesOfNode(id));
    const stamp=new Date().toISOString();
    getSupa().from('board_nodes').update({x:pos.x,y:pos.y,updated_at:stamp}).eq('id',id)
      .then(({error})=>{ if(!error) _nodeStamp[id]=stamp; });
  });
}

/* Cor escolhida antes de criar. Fica guardada entre notas, então dá para criar
   várias da mesma cor sem reescolher. */
let corNotaEscolhida = null;
function abrirSeletorCorNota(){
  const p=$('notaCores'); if(!p) return;
  if(!p.dataset.pronto){
    p.dataset.pronto='1';
    p.innerHTML=BOARD_COLORS.map(c=>
      `<i data-c="${c}" style="background:${c}" title="${c}"></i>`).join('')
      +`<i class="nota-cor-aleatoria" data-c="" title="Cor aleatória">?</i>`;
    p.addEventListener('click',e=>{
      const i=e.target.closest('i'); if(!i) return;
      corNotaEscolhida = i.dataset.c || null;
      p.querySelectorAll('i').forEach(x=>x.classList.toggle('on',x===i));
      p.classList.remove('on');
      addBoardNote();                 // escolheu a cor: já cria
    });
  }
  p.classList.toggle('on');
}

/* ══════════════════════════════════════════════════════════════════
   RESPONDER UMA NOTA
   Cria uma nota nova já conectada à original, do jeito que qualquer pessoa —
   dona da nota original ou não — pode fazer, nos dois sentidos. Reaproveita
   exatamente a mesma inserção usada pelo botão "Conectar" manual, então o
   resultado nunca diverge do comportamento já testado dos conectores.
   ══════════════════════════════════════════════════════════════════ */
async function responderNota(id){
  const original=boardNodes[id]; if(!original) return;
  const supa=getSupa();
  const [ow,oh]=medidaReal(id,original);

  /* Nasce ao lado da nota original, um pouco abaixo — como o "follow-up
     block" do exemplo. Se não houver espaço ali, a busca em espiral
     (a mesma da criação normal) acha o próximo lugar livre. */
  const desejo={ x:Math.round((original.x||0)+ow+60), y:Math.round((original.y||0)+40) };
  const pos = colideComAlguma(desejo.x,desejo.y,240,220)
    ? acharLugarLivre(240,220)
    : desejo;

  const row={ type:'text', content:'', x:pos.x, y:pos.y, w:220, h:150,
              color:original.color||BOARD_COLORS[0], created_by:U.id, reply_to:id };
  const { data, error }=await supa.from('board_nodes').insert(row).select().maybeSingle();
  if(error){
    // a coluna reply_to pode não existir ainda no banco — tenta de novo sem ela
    if(/reply_to/.test(error.message||'')){
      delete row.reply_to;
      const retry=await supa.from('board_nodes').insert(row).select().maybeSingle();
      if(retry.error){ toast('Erro ao responder: '+retry.error.message,'err'); return; }
      return finalizarResposta(id,retry.data);
    }
    console.error('responderNota error',error); toast('Erro ao responder: '+error.message,'err'); return;
  }
  finalizarResposta(id,data);
}
async function finalizarResposta(idOriginal,data){
  boardNodes[data.id]=data; _nodeStamp[data.id]=data.updated_at||data.created_at||'';
  renderBoardNode(data);
  ajustarSeColidir(data.id);

  // mesma inserção usada pelo "Conectar" manual — o cabo de luz nasce sozinho
  const { data:edge, error:edgeErr }=await getSupa().from('board_edges')
    .insert({ from_node:idOriginal, to_node:data.id, created_by:U.id }).select().maybeSingle();
  if(!edgeErr){ boardEdges[edge.id]=edge; rebuildEdgeIndex(); scheduleEdgeRedraw(); }

  const el=document.getElementById('bn-'+data.id); const body=el?.querySelector('.board-node-body');
  if(body){ body.focus(); }
}

async function addBoardNote(){
  const supa=getSupa();
  const color = corNotaEscolhida || BOARD_COLORS[Math.floor(Math.random()*BOARD_COLORS.length)];
  /* Reserva ESPAÇO PARA CRESCER: a nota nasce com 200x130 mas engorda conforme
     você escreve. Procurar espaço só para o tamanho inicial fazia a nota
     invadir as vizinhas assim que o texto aumentava. */
  const pos = acharLugarLivre(240,300);
  const row={ type:'text', content:'Nova nota', x:pos.x, y:pos.y, w:200, h:130, color, created_by:U.id };
  const { data, error }=await supa.from('board_nodes').insert(row).select().maybeSingle();
  if(error){ console.error('addBoardNote error',error); toast('Erro ao criar nota: '+error.message,'err'); return; }
  boardNodes[data.id]=data; _nodeStamp[data.id]=data.updated_at||data.created_at||''; renderBoardNode(data);
  ajustarSeColidir(data.id);
  const el=document.getElementById('bn-'+data.id); const body=el?.querySelector('.board-node-body');
  if(body){ body.focus(); const range=document.createRange(); range.selectNodeContents(body); const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
}

function handleBoardImage(input){
  const file=input.files[0]; if(!file) return;
  uploadBoardImage(file); input.value='';
}
async function uploadBoardImage(file){
  const supa=getSupa();
  const { data:userData }=await supa.auth.getUser(); const user=userData.user;
  if(!user){ toast('Sessão expirada, faça login de novo','err'); return; }
  toast('Enviando imagem...','ok');
  const ext=(file.type.split('/')[1]||'png').replace('jpeg','jpg');
  const path=`${user.id}/img-${Date.now()}.${ext}`;
  const { error:upErr }=await supa.storage.from('board').upload(path,file,{ cacheControl:'3600', upsert:true, contentType:file.type });
  if(upErr){ console.error('uploadBoardImage error',upErr); toast('Erro ao enviar imagem: '+upErr.message,'err'); return; }
  const { data:pub }=supa.storage.from('board').getPublicUrl(path);
  if(!pub?.publicUrl){ toast('Erro ao gerar link da imagem','err'); return; }
  const pos=acharLugarLivre(220,220);
  const row={ type:'image', image_url:pub.publicUrl, x:pos.x, y:pos.y, w:220, h:220, created_by:U.id };
  const { data, error }=await supa.from('board_nodes').insert(row).select().maybeSingle();
  if(error){ console.error('uploadBoardImage insert error',error); toast('Erro ao adicionar imagem: '+error.message,'err'); return; }
  boardNodes[data.id]=data; _nodeStamp[data.id]=data.updated_at||data.created_at||''; renderBoardNode(data);
  ajustarSeColidir(data.id);
}

function saveBoardNodeContent(id,text){
  const n=boardNodes[id]; if(!n||n.content===text) return; n.content=text;
  const el=document.getElementById('bn-'+id);
  const h=el?Math.round(el.offsetHeight):null;
  if(h) n.h=h;
  const patch={ content:text, updated_at:new Date().toISOString() };
  if(h) patch.h=h;
  getSupa().from('board_nodes').update(patch).eq('id',id).then(({error})=>{
    if(error){ console.error('saveBoardNodeContent error',error); toast('Erro ao salvar nota: '+error.message,'err'); }
    else _nodeStamp[id]=patch.updated_at;
  });
  ajustarSeColidir(id);   // o texto cresceu: garante que não ficou por cima de outra
}

/* ── arrastar nó ── */
function startBoardDrag(e,id){
  if(boardConnectMode) return;
  e.preventDefault(); e.stopPropagation();
  const el=document.getElementById('bn-'+id); if(!el) return;
  const n0=boardNodes[id]||{};
  boardDrag={ id, startX:e.clientX, startY:e.clientY, startLeft:n0.x||0, startTop:n0.y||0, edges:edgesOfNode(id) };
  try{ el.setPointerCapture(e.pointerId); }catch(err){}
  el.style.zIndex=++zTop; el.classList.add('dragging');
  el.addEventListener('pointermove',onBoardDragMove);
  el.addEventListener('pointerup',endBoardDrag,{once:true});
  el.addEventListener('pointercancel',endBoardDrag,{once:true});
}
function onBoardDragMove(e){
  if(!boardDrag) return;
  const el=document.getElementById('bn-'+boardDrag.id); if(!el) return;
  // divide pela escala: no zoom out, 1px de mouse = mais px de quadro
  const dx=(e.clientX-boardDrag.startX)/boardView.scale, dy=(e.clientY-boardDrag.startY)/boardView.scale;
  const nx=Math.max(0,Math.min(BOARD_W,boardDrag.startLeft+dx)), ny=Math.max(0,Math.min(BOARD_H,boardDrag.startTop+dy));
  setNodePos(el,nx,ny);
  if(boardNodes[boardDrag.id]){ boardNodes[boardDrag.id].x=nx; boardNodes[boardDrag.id].y=ny; }
  if(boardDrag.edges.length) scheduleEdgeRedraw(boardDrag.edges);
}
function endBoardDrag(){
  if(!boardDrag) return;
  const id=boardDrag.id; const el=document.getElementById('bn-'+id);
  if(el){ el.removeEventListener('pointermove',onBoardDragMove); el.classList.remove('dragging'); }
  const n=boardNodes[id];
  boardDrag=null;
  if(n){
    const stamp=new Date().toISOString();
    getSupa().from('board_nodes').update({ x:Math.round(n.x), y:Math.round(n.y), updated_at:stamp }).eq('id',id).then(({error})=>{
      if(error){ console.error('endBoardDrag save error',error); toast('Erro ao salvar posição: '+error.message,'err'); }
      else _nodeStamp[id]=stamp;
    });
  }
}

/* ── redimensionar nó ── */
function startBoardResize(e,id){
  e.preventDefault(); e.stopPropagation();
  const el=document.getElementById('bn-'+id); if(!el) return;
  boardResize={ id, startX:e.clientX, startY:e.clientY, startW:el.offsetWidth, startH:el.offsetHeight };
  try{ el.setPointerCapture(e.pointerId); }catch(err){}
  el.classList.add('resizing');
  el.addEventListener('pointermove',onBoardResizeMove);
  el.addEventListener('pointerup',endBoardResize,{once:true});
  el.addEventListener('pointercancel',endBoardResize,{once:true});
}
function onBoardResizeMove(e){
  if(!boardResize) return;
  const el=document.getElementById('bn-'+boardResize.id); if(!el) return;
  const dx=(e.clientX-boardResize.startX)/boardView.scale, dy=(e.clientY-boardResize.startY)/boardView.scale;
  const w=Math.max(120,boardResize.startW+dx), h=Math.max(80,boardResize.startH+dy);
  el.style.width=w+'px'; el.style.height=h+'px';
  const n=boardNodes[boardResize.id]; if(n){ n.w=w; n.h=h; n._w=w; n._h=h; }
  scheduleEdgeRedraw(edgesOfNode(boardResize.id));
}
function endBoardResize(){
  if(!boardResize) return;
  const id=boardResize.id, el=document.getElementById('bn-'+id);
  if(el){ el.removeEventListener('pointermove',onBoardResizeMove); el.classList.remove('resizing'); }
  const n=boardNodes[id]; boardResize=null;
  if(n){
    const stamp=new Date().toISOString();
    getSupa().from('board_nodes').update({ w:Math.round(n.w), h:Math.round(n.h), updated_at:stamp }).eq('id',id).then(({error})=>{
      if(error){ console.error('endBoardResize save error',error); toast('Erro ao salvar tamanho: '+error.message,'err'); }
      else _nodeStamp[id]=stamp;
    });
  }
}

/* ── conectores ── */
function toggleBoardConnect(){
  boardConnectMode=!boardConnectMode; boardConnectFrom=null;
  $('boardConnectBtn').classList.toggle('on',boardConnectMode);
  $('boardHint').style.display=boardConnectMode?'block':'none';
  document.querySelectorAll('.board-node.connect-sel').forEach(e=>e.classList.remove('connect-sel'));
}
function startConnectFrom(id){
  if(!boardConnectMode){ boardConnectMode=true; $('boardConnectBtn').classList.add('on'); $('boardHint').style.display='block'; }
  boardConnectFrom=id;
  document.querySelectorAll('.board-node.connect-sel').forEach(e=>e.classList.remove('connect-sel'));
  document.getElementById('bn-'+id)?.classList.add('connect-sel');
}
async function handleBoardConnectClick(id){
  if(!boardConnectFrom){ startConnectFrom(id); return; }
  if(boardConnectFrom===id) return;
  const fromId=boardConnectFrom;
  document.getElementById('bn-'+fromId)?.classList.remove('connect-sel');
  boardConnectFrom=null;
  const { data, error }=await getSupa().from('board_edges').insert({ from_node:fromId, to_node:id, created_by:U.id }).select().maybeSingle();
  if(error){ console.error('handleBoardConnectClick error',error); toast('Erro ao conectar: '+error.message,'err'); return; }
  boardEdges[data.id]=data; rebuildEdgeIndex(); scheduleEdgeRedraw();
}

/* Geometria: liga as bordas dos cards (não o centro) e curva a linha.
   O quanto entorta vem de bend_x/bend_y — deslocamento perpendicular guardado
   por conector. Se essas colunas não existirem no banco, a curva ainda funciona
   na sessão atual, só não persiste (ver saveEdgeBend). */
/* Dimensões vêm do CACHE (n._w/n._h), nunca de offsetWidth/offsetHeight.
   Ler offsetWidth força o navegador a recalcular o layout na hora ("layout
   thrashing"); fazendo isso para cada conector a cada frame de arrasto, o
   quadro inteiro engasgava. Agora medimos só quando o nó muda de verdade. */
function nodeDims(n,id){
  if(n._w&&n._h) return [n._w,n._h];
  const el=document.getElementById('bn-'+id);
  if(el){ n._w=el.offsetWidth; n._h=el.offsetHeight; return [n._w,n._h]; }
  return [n.w||180,n.h||120];
}
function edgeGeometry(edge){
  const a=boardNodes[edge.from_node], b=boardNodes[edge.to_node];
  if(!a||!b) return null;
  const [aw,ah]=nodeDims(a,edge.from_node);
  const [bw,bh]=nodeDims(b,edge.to_node);
  const acx=(a.x||0)+aw/2, acy=(a.y||0)+ah/2;
  const bcx=(b.x||0)+bw/2, bcy=(b.y||0)+bh/2;
  const mx=(acx+bcx)/2, my=(acy+bcy)/2;
  const bx=mx+(edge.bend_x||0), by=my+(edge.bend_y||0);
  const p1=rectAnchor(a.x||0,a.y||0,aw,ah,bx,by);
  const p2=rectAnchor(b.x||0,b.y||0,bw,bh,bx,by);
  return { p1,p2,cx:bx,cy:by,mx,my };
}
function rectAnchor(x,y,w,h,tx,ty){
  const cx=x+w/2, cy=y+h/2, dx=tx-cx, dy=ty-cy;
  if(!dx&&!dy) return {x:cx,y:cy};
  const sx=dx?(w/2)/Math.abs(dx):Infinity, sy=dy?(h/2)/Math.abs(dy):Infinity;
  const s=Math.min(sx,sy);
  return { x:cx+dx*s, y:cy+dy*s };
}
/* Coalesce vários pedidos de redesenho num único frame — antes isso rodava
   dezenas de vezes por segundo recriando o SVG inteiro, principal fonte de travamento. */
let _edgeDirty=null; // null = redesenhar tudo; Set = só esses conectores
function scheduleEdgeRedraw(ids){
  if(ids&&_edgeDirty){ ids.forEach(i=>_edgeDirty.add(i)); }
  else if(ids&&!_edgeRAF){ _edgeDirty=new Set(ids); }
  else _edgeDirty=null;
  if(_edgeRAF) return;
  _edgeRAF=requestAnimationFrame(()=>{ _edgeRAF=null; const d=_edgeDirty; _edgeDirty=null; redrawBoardEdges(d); });
}
function removeEdgeEls(id){
  const g=_edgeEls[id];
  if(g){ Object.values(g).forEach(el=>el&&el.remove()); delete _edgeEls[id]; }
  if(boardSelectedEdge===id) boardSelectedEdge=null;
}
function redrawBoardEdges(only){
  const svg=$('boardSvg'); if(!svg) return;
  ensureEdgeDefs(svg);
  if(!only) Object.keys(_edgeEls).forEach(id=>{ if(!boardEdges[id]) removeEdgeEls(id); });
  const list=only?[...only].map(id=>boardEdges[id]).filter(Boolean):Object.values(boardEdges);
  list.forEach(edge=>{
    const geo=edgeGeometry(edge);
    if(!geo){ removeEdgeEls(edge.id); return; }
    const sel=boardSelectedEdge===edge.id;
    let g=_edgeEls[edge.id];
    if(!g){  // cria uma vez e reaproveita — nada de innerHTML='' a cada frame
      const NS='http://www.w3.org/2000/svg';
      const hit=document.createElementNS(NS,'path');   // traço invisível e grosso: facilita clicar
      hit.setAttribute('class','board-edge-hit'); hit.setAttribute('fill','none');
      hit.setAttribute('stroke','transparent'); hit.setAttribute('stroke-width','18');
      hit.addEventListener('pointerdown',ev=>{
        ev.stopPropagation();
        const anterior=boardSelectedEdge;
        boardSelectedEdge=edge.id;
        // redesenha só o que mudou de estado: o anterior e o novo
        scheduleEdgeRedraw(anterior && anterior!==edge.id ? [anterior,edge.id] : [edge.id]);
      });
      hit.addEventListener('pointerenter',()=>{ if(g&&g.glass) g.glass.classList.add('hover'); });
      hit.addEventListener('pointerleave',()=>{ if(g&&g.glass) g.glass.classList.remove('hover'); });
      hit.addEventListener('dblclick',ev=>{ ev.stopPropagation(); resetEdgeBend(edge.id); });
      /* Duas camadas formam o efeito de vidro, sem usar desfoque (que é caro):
         uma faixa larga e translúcida por baixo, e o traço colorido por cima.
         A de baixo dá o contorno suave; a de cima dá a cor. */
      const glass=document.createElementNS(NS,'path');
      glass.setAttribute('class','board-edge-glass'); glass.setAttribute('fill','none');
      glass.setAttribute('stroke','url(#boardEdgeGlass)');
      glass.setAttribute('stroke-linecap','round');
      const path=document.createElementNS(NS,'path');
      path.setAttribute('class','board-edge'); path.setAttribute('fill','none');
      path.setAttribute('stroke','url(#boardEdgeGrad)');
      path.setAttribute('stroke-linecap','round');
      // SEM seta: o exemplo usa um cabo de luz sem direção marcada, só a curva
      const nucleo=document.createElementNS(NS,'path');   // fio de luz bem fino por cima
      nucleo.setAttribute('class','board-edge-nucleo'); nucleo.setAttribute('fill','none');
      nucleo.setAttribute('stroke','url(#boardEdgeNucleo)');
      nucleo.setAttribute('stroke-linecap','round');
      /* A alça é pequena de propósito (fica discreta), mas 7px é impossível de
         acertar com o dedo. Por isso existe um círculo INVISÍVEL bem maior por
         cima, que recebe o toque. É o mesmo truque dos botões pequenos: alvo
         grande, desenho pequeno. */
      const handle=document.createElementNS(NS,'circle'); // parte visível
      handle.setAttribute('class','board-edge-handle'); handle.setAttribute('r','8');
      const handleHit=document.createElementNS(NS,'circle'); // área de toque
      handleHit.setAttribute('class','board-edge-handle-hit');
      handleHit.setAttribute('r','26');
      handleHit.setAttribute('fill','transparent');
      handleHit.addEventListener('pointerdown',ev=>startEdgeBend(ev,edge.id));
      handle.addEventListener('pointerdown',ev=>startEdgeBend(ev,edge.id));
      const del=document.createElementNS(NS,'g');         // ação de apagar, só quando selecionado
      del.setAttribute('class','board-edge-del');
      const dh=document.createElementNS(NS,'circle'); dh.setAttribute('r','24'); dh.setAttribute('fill','transparent');
      del.appendChild(dh);   // área de toque ampliada para o dedo
      const dc=document.createElementNS(NS,'circle'); dc.setAttribute('r','11'); dc.setAttribute('fill','rgba(196,92,92,.95)');
      const dt=document.createElementNS(NS,'text'); dt.setAttribute('text-anchor','middle'); dt.setAttribute('dy','3.5');
      dt.setAttribute('font-size','11'); dt.setAttribute('fill','#fff'); dt.textContent='×';
      del.appendChild(dc); del.appendChild(dt);
      del.addEventListener('pointerdown',ev=>{ ev.stopPropagation(); deleteBoardEdge(edge.id); });
      /* Encaixe orgânico nas duas pontas: uma elipse esticada e girada na
         direção do fio (não um círculo uniforme), pra lembrar aquele "bico"
         triangular e arredondado do exemplo, onde o brilho parece nascer
         alongado saindo do cartão, e não só um pingo de luz solto. */
      const soqueteA=document.createElementNS(NS,'ellipse');
      soqueteA.setAttribute('class','board-edge-socket'); soqueteA.setAttribute('rx','9'); soqueteA.setAttribute('ry','3.4');
      const soqueteB=document.createElementNS(NS,'ellipse');
      soqueteB.setAttribute('class','board-edge-socket'); soqueteB.setAttribute('rx','9'); soqueteB.setAttribute('ry','3.4');
      /* Duas fitas escuras e finas, trançadas uma na outra (fase oposta) —
         é isso que dá a textura de "veia"/cabo trançado do exemplo, no lugar
         de duas linhas simplesmente paralelas. */
      const trancaA=document.createElementNS(NS,'path');
      trancaA.setAttribute('class','board-edge-tranca'); trancaA.setAttribute('fill','none');
      const trancaB=document.createElementNS(NS,'path');
      trancaB.setAttribute('class','board-edge-tranca'); trancaB.setAttribute('fill','none');
      // pulso de luz que percorre o cabo continuamente — "uma luz passando como veia"
      const pulso=document.createElementNS(NS,'path');
      pulso.setAttribute('class','board-edge-pulso'); pulso.setAttribute('fill','none');
      svg.appendChild(hit); svg.appendChild(glass);
      svg.appendChild(path); svg.appendChild(nucleo);
      svg.appendChild(trancaA); svg.appendChild(trancaB); svg.appendChild(pulso);
      svg.appendChild(soqueteA); svg.appendChild(soqueteB);
      svg.appendChild(handleHit); svg.appendChild(handle); svg.appendChild(del);
      g=_edgeEls[edge.id]={hit,glass,path,nucleo,trancaA,trancaB,pulso,soqueteA,soqueteB,handle,handleHit,del};
    }
    /* As duas pontas recuam um pouco em direção ao meio da curva — é o que dá
       aquele respiro entre o cartão e o cabo, com o pontinho de luz flutuando
       bem na borda, como no exemplo. Antes só o fim recuava, e só por causa da
       seta que existia ali; sem seta nenhuma, faz sentido recuar os dois lados
       igualmente, por estética, não para esconder nada. */
    const RECUO=8;
    function recuar(px,py){
      const vx=px-geo.cx, vy=py-geo.cy, comp=Math.hypot(vx,vy);
      if(comp<=RECUO) return {x:px,y:py};
      return { x:px-(vx/comp)*RECUO, y:py-(vy/comp)*RECUO };
    }
    const ini=recuar(geo.p1.x,geo.p1.y), fim=recuar(geo.p2.x,geo.p2.y);

    /* A "espinha" do cabo: sai quase na horizontal de cada cartão e só se
       inclina de verdade depois, como um fio real penderia — não um arco
       simétrico e redondo de manual de geometria. O teto de curvatura (bem
       mais apertado agora) evita que isto vire aquele laço grande de antes. */
    function espinha(p1,p2,ctrl){
      const c1={x:p1.x+(ctrl.x-p1.x)*0.55, y:p1.y+(ctrl.y-p1.y)*0.15};
      const c2={x:p2.x+(ctrl.x-p2.x)*0.55, y:p2.y+(ctrl.y-p2.y)*0.15};
      return { P0:p1,P1:c1,P2:c2,P3:p2 };
    }
    function pontoCubica(P0,P1,P2,P3,t){
      const mt=1-t;
      const x = mt*mt*mt*P0.x + 3*mt*mt*t*P1.x + 3*mt*t*t*P2.x + t*t*t*P3.x;
      const y = mt*mt*mt*P0.y + 3*mt*mt*t*P1.y + 3*mt*t*t*P2.y + t*t*t*P3.y;
      const tx = 3*mt*mt*(P1.x-P0.x) + 6*mt*t*(P2.x-P1.x) + 3*t*t*(P3.x-P2.x);
      const ty = 3*mt*mt*(P1.y-P0.y) + 6*mt*t*(P2.y-P1.y) + 3*t*t*(P3.y-P2.y);
      return {x,y,tx,ty};
    }
    /* Constrói uma fita que se afasta e volta pra espinha, sempre fechando bem
       nas pontas (envelope=0 em t=0 e t=1) e abrindo no meio (pico em t=0.5) —
       é o "abre no meio, fecha nas pontas" do exemplo. Duas fitas com fase
       oposta cruzam uma a outra ao longo do caminho, formando a trança. */
    function fitaTrancada(esp,amplitude,voltas,fase){
      const N=22; let d='';
      for(let i=0;i<=N;i++){
        const t=i/N;
        const p=pontoCubica(esp.P0,esp.P1,esp.P2,esp.P3,t);
        const comp=Math.hypot(p.tx,p.ty)||1;
        const nx=-p.ty/comp, ny=p.tx/comp;                  // perpendicular à tangente local
        const envelope=Math.sin(t*Math.PI);                 // 0 nas pontas, pico no meio
        const off=amplitude*envelope*Math.sin(t*voltas*Math.PI*2+fase);
        const x=p.x+nx*off, y=p.y+ny*off;
        d += (i===0?'M ':'L ')+x.toFixed(1)+' '+y.toFixed(1)+' ';
      }
      return d;
    }
    const esp=espinha(ini,fim,{x:geo.cx,y:geo.cy});
    const dEspinha=`M ${esp.P0.x} ${esp.P0.y} C ${esp.P1.x} ${esp.P1.y} ${esp.P2.x} ${esp.P2.y} ${esp.P3.x} ${esp.P3.y}`;
    g.path.setAttribute('d',dEspinha); g.hit.setAttribute('d',dEspinha);
    if(g.glass)  g.glass.setAttribute('d',dEspinha);
    if(g.nucleo) g.nucleo.setAttribute('d',dEspinha);
    if(g.pulso)  g.pulso.setAttribute('d',dEspinha);
    // as duas fitas trançadas, fase invertida uma da outra — se cruzam ao longo do fio
    if(g.trancaA) g.trancaA.setAttribute('d', fitaTrancada(esp,9,1.4,0));
    if(g.trancaB) g.trancaB.setAttribute('d', fitaTrancada(esp,9,1.4,Math.PI));

    // orienta cada encaixe na direção real do fio que sai dele (ângulo da tangente)
    if(g.soqueteA){
      const ang=Math.atan2(esp.P1.y-ini.y, esp.P1.x-ini.x)*180/Math.PI;
      g.soqueteA.setAttribute('cx',ini.x); g.soqueteA.setAttribute('cy',ini.y);
      g.soqueteA.setAttribute('transform',`rotate(${ang} ${ini.x} ${ini.y})`);
    }
    if(g.soqueteB){
      const ang=Math.atan2(fim.y-esp.P2.y, fim.x-esp.P2.x)*180/Math.PI;
      g.soqueteB.setAttribute('cx',fim.x); g.soqueteB.setAttribute('cy',fim.y);
      g.soqueteB.setAttribute('transform',`rotate(${ang} ${fim.x} ${fim.y})`);
    }
    g.path.classList.toggle('sel',sel);
    /* O estado do vidro é marcado AQUI, não por regra de vizinhança no CSS.
       A camada de vidro é inserida ANTES do traço no desenho, e o seletor de
       irmão só enxerga elementos posteriores — por isso o realce ao selecionar
       nunca chegava a aparecer. */
    if(g.glass) g.glass.classList.toggle('sel',sel);
    // alça aparece ao passar o mouse/selecionar; o ponto da curva em t=0.5
    const hx=0.25*geo.p1.x+0.5*geo.cx+0.25*geo.p2.x, hy=0.25*geo.p1.y+0.5*geo.cy+0.25*geo.p2.y;
    g.handle.setAttribute('cx',hx); g.handle.setAttribute('cy',hy);
    g.handle.classList.toggle('show',sel);
    if(g.handleHit){
      g.handleHit.setAttribute('cx',hx); g.handleHit.setAttribute('cy',hy);
      // só aceita toque quando o conector está selecionado
      g.handleHit.style.pointerEvents = sel ? 'auto' : 'none';
    }
    const canDel=edge.created_by===U.id;
    g.del.style.display=(sel&&canDel)?'':'none';
    g.del.setAttribute('transform',`translate(${hx+22},${hy-16})`);
  });
}
function ensureEdgeDefs(svg){
  if(svg.querySelector('#boardEdgeSocket')) return;
  const NS='http://www.w3.org/2000/svg';
  const defs=document.createElementNS(NS,'defs');
  /* Degradê aplicado ao traço. Fica no <defs> e é reaproveitado por TODOS os
     conectores — um só objeto de pintura, independente de quantas ligações
     existam. Evitei sombra ou desfoque em SVG de propósito: são caros de
     repintar e o quadro já sofreu com isso antes. */
  const grad=document.createElementNS(NS,'linearGradient');
  grad.setAttribute('id','boardEdgeGrad');
  grad.setAttribute('gradientUnits','userSpaceOnUse');
  grad.setAttribute('x1','0'); grad.setAttribute('y1','0');
  grad.setAttribute('x2','0'); grad.setAttribute('y2','1200');
  [['0%','rgba(200,235,255,.95)'],
   ['50%','rgba(235,245,255,.9)'],
   ['100%','rgba(190,210,255,.9)']].forEach(([off,cor])=>{
    const s=document.createElementNS(NS,'stop');
    s.setAttribute('offset',off); s.setAttribute('stop-color',cor);
    grad.appendChild(s);
  });
  defs.appendChild(grad);
  /* Núcleo bem fino e quase branco por cima de tudo — é o que dá a
     impressão de "cabo de luz" em vez de traço colorido comum. */
  const nucleo=document.createElementNS(NS,'linearGradient');
  nucleo.setAttribute('id','boardEdgeNucleo');
  nucleo.setAttribute('gradientUnits','userSpaceOnUse');
  nucleo.setAttribute('x1','0'); nucleo.setAttribute('y1','0');
  nucleo.setAttribute('x2','0'); nucleo.setAttribute('y2','1200');
  [['0%','rgba(255,255,255,.95)'],['100%','rgba(235,240,255,.85)']].forEach(([off,cor])=>{
    const s=document.createElementNS(NS,'stop');
    s.setAttribute('offset',off); s.setAttribute('stop-color',cor);
    nucleo.appendChild(s);
  });
  defs.appendChild(nucleo);
  /* Degradê do contorno de vidro: branco e tons frios bem baixos. */
  const glassGrad=document.createElementNS(NS,'linearGradient');
  glassGrad.setAttribute('id','boardEdgeGlass');
  glassGrad.setAttribute('gradientUnits','userSpaceOnUse');
  glassGrad.setAttribute('x1','0'); glassGrad.setAttribute('y1','0');
  glassGrad.setAttribute('x2','0'); glassGrad.setAttribute('y2','1200');
  [['0%','rgba(255,255,255,.28)'],
   ['50%','rgba(240,240,242,.16)'],
   ['100%','rgba(225,225,230,.2)']].forEach(([off,cor])=>{
    const s=document.createElementNS(NS,'stop');
    s.setAttribute('offset',off); s.setAttribute('stop-color',cor);
    glassGrad.appendChild(s);
  });
  defs.appendChild(glassGrad);
  /* Pontos de conexão: pequenos círculos luminosos onde o cabo encosta em
     cada cartão — é o "soquete" que aparece no exemplo, no lugar da seta. */
  const socket=document.createElementNS(NS,'radialGradient');
  socket.setAttribute('id','boardEdgeSocket');
  [['0%','rgba(255,255,255,1)'],['45%','rgba(240,240,245,.92)'],['100%','rgba(220,220,230,0)']]
    .forEach(([off,cor])=>{
      const s=document.createElementNS(NS,'stop');
      s.setAttribute('offset',off); s.setAttribute('stop-color',cor);
      socket.appendChild(s);
    });
  defs.appendChild(socket);
  svg.appendChild(defs);
}
/* entortar o conector arrastando a alça */
function startEdgeBend(e,id){
  e.preventDefault(); e.stopPropagation();
  boardEdgeDrag={ id };
  boardSelectedEdge=id;
  const move=ev=>{
    const edge=boardEdges[id]; if(!edge) return;
    const p=boardPoint(ev.clientX,ev.clientY);
    /* Resolve o ponto de controle para que o meio da curva caia sob o dedo.
       Duas mudanças em relação à versão anterior:

       1. UM PASSO SÓ, sem repetir o cálculo. Repetir tentava refinar a posição,
          mas as bordas mudam de face conforme a curva gira, e o refinamento
          ficava perseguindo um alvo móvel.

       2. LIMITE DE CURVATURA. Antes não havia teto: arrastar o dedo para longe
          gerava curvaturas de milhares de pixels — era isso que produzia aquele
          laço gigante atravessando o quadro. Agora a curva não passa de 1,2 vez
          a distância entre as notas, que já permite curvas bem acentuadas sem
          nunca escapar do controle. */
    const geo=edgeGeometry(edge); if(!geo) return;
    let cx = 2*p.x - (geo.p1.x + geo.p2.x)/2;
    let cy = 2*p.y - (geo.p1.y + geo.p2.y)/2;
    let bx = cx - geo.mx, by = cy - geo.my;

    const distNos = Math.hypot(geo.p2.x-geo.p1.x, geo.p2.y-geo.p1.y) || 1;
/* Teto bem mais apertado que antes. O exemplo mostra um cabo quase reto, só
       ondulando de leve — nunca um arco grande e redondo como um parêntese. Um
       teto generoso permitia esse laço enorme mesmo com pouco arrasto na alça. */
    const tetoCurva = Math.max(70, distNos*0.5);
    const forca = Math.hypot(bx,by);
    if(forca > tetoCurva){
      const k = tetoCurva/forca;
      bx*=k; by*=k;
    }
    edge.bend_x=bx; edge.bend_y=by;
    scheduleEdgeRedraw([id]);   // redesenha só este conector
  };
  const up=()=>{
    document.removeEventListener('pointermove',move);
    document.removeEventListener('pointerup',up);
    boardEdgeDrag=null; saveEdgeBend(id); scheduleEdgeRedraw([id]);
  };
  document.addEventListener('pointermove',move);
  document.addEventListener('pointerup',up);
}
function resetEdgeBend(id){
  const edge=boardEdges[id]; if(!edge) return;
  edge.bend_x=0; edge.bend_y=0; scheduleEdgeRedraw([id]); saveEdgeBend(id);
}
/* Persiste a curvatura. Se o banco ainda não tiver as colunas bend_x/bend_y,
   ignoramos o erro silenciosamente: a curva continua valendo nesta sessão e o
   resto do quadro segue funcionando normalmente. */
/* Guarda o que EU curvei e ainda não vi confirmado pelo servidor. Enquanto o id
   estiver aqui, o valor local vence qualquer coisa que venha do banco.
   Era esta a causa do conector "voltar a ficar reto": se a escrita falhasse
   (coluna ausente ou falta de policy de UPDATE no RLS), o banco continuava com 0
   e o poll de 6s trazia esse 0 por cima da curva que você acabou de fazer. */
let _bendPending={};   // id -> {x,y}
let _bendWarned=false;
function saveEdgeBend(id){
  const edge=boardEdges[id]; if(!edge) return;
  const x=Math.round(edge.bend_x||0), y=Math.round(edge.bend_y||0);
  _bendPending[id]={x,y};
  getSupa().from('board_edges').update({ bend_x:x, bend_y:y }).eq('id',id).select().maybeSingle().then(({data,error})=>{
    if(error){
      if(!_bendWarned){
        _bendWarned=true;
        console.warn('Curvatura não salva no banco:',error.message);
        toast('A curva vale nesta sessão, mas o banco recusou salvar','err');
      }
      return; // mantém em _bendPending: local continua vencendo
    }
    // confirmado pelo servidor com o mesmo valor → pode soltar
    if(data && data.bend_x===x && data.bend_y===y) delete _bendPending[id];
  });
}

async function deleteBoardNode(id){
  const { error }=await getSupa().from('board_nodes').delete().eq('id',id);
  if(error){ console.error('deleteBoardNode error',error); toast('Erro ao apagar: '+error.message,'err'); return; }
  delete boardNodes[id]; delete _nodeStamp[id]; document.getElementById('bn-'+id)?.remove();
  Object.keys(boardEdges).forEach(eid=>{ const e=boardEdges[eid]; if(e.from_node===id||e.to_node===id){ delete boardEdges[eid]; removeEdgeEls(eid); } });
  rebuildEdgeIndex(); scheduleEdgeRedraw();
}
async function deleteBoardEdge(id){
  const { error }=await getSupa().from('board_edges').delete().eq('id',id);
  if(error){ console.error('deleteBoardEdge error',error); toast('Erro ao apagar corrente: '+error.message,'err'); return; }
  delete boardEdges[id]; delete _bendPending[id]; removeEdgeEls(id); rebuildEdgeIndex(); scheduleEdgeRedraw();
}

function openFriendsHub(){
  if(!U.id){ toast('Faça login para ver amigos e conversas','err'); return; }
  $('friendsHubPanel').classList.add('on');
  switchFhubTab(currentFhubTab);
}
function closeFriendsHub(e){
  if(e && e.target!==$('friendsHubPanel')) return;
  $('friendsHubPanel').classList.remove('on');
}
function switchFhubTab(tab){
  currentFhubTab=tab;
  document.querySelectorAll('.fhub-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  $('fhubConvList').style.display=tab==='conv'?'flex':'none';
  $('fhubReqList').style.display=tab==='req'?'flex':'none';
  if(tab==='conv') loadConversations(); else loadFriendRequests();
}
async function loadConversations(){
  if(!U.id) return;
  const supa=getSupa();
  const box=$('fhubConvList');
  const { data, error }=await supa.from('dm_messages').select('*').or(`sender.eq.${U.id},recipient.eq.${U.id}`).order('created_at',{ascending:false}).limit(300);
  if(error){ console.error('loadConversations error:',error); box.innerHTML='<div class="ge">Erro ao carregar conversas</div>'; return; }
  if(!data||!data.length){ box.innerHTML='<div class="ge">Nenhuma conversa ainda. Busque membros para começar.</div>'; return; }
  const order=[], map=new Map();
  data.forEach(m=>{
    const otherId=m.sender===U.id?m.recipient:m.sender;
    if(!map.has(otherId)){ map.set(otherId,m); order.push(otherId); }
  });
  box.innerHTML='';
  for(const otherId of order){
    const last=map.get(otherId);
    const { data:p } = await supa.from('profiles').select('id,name,username,photo,color,frame,frame_scale,frame_x,frame_y').eq('id',otherId).maybeSingle();
    const row=document.createElement('div'); row.className='fhub-row'; row.onclick=()=>openDM(otherId);
    const av=document.createElement('div'); av.className='fhub-av'; av.innerHTML=avatarHTML(p||{name:'U'});
    const info=document.createElement('div'); info.className='fhub-info';
    const unread=dmUnreadBySender[otherId]||0;
    info.innerHTML=`${nameRowHTML((p&&p.name)||'Usuário',otherId,'fhub-name')}<div class="fhub-sub">${(last.sender===U.id?'Você: ':'')+(last.content||'').slice(0,40)}</div>`;
    if(unread)info.querySelector('.name-row').insertAdjacentHTML('beforeend','<span style="color:var(--green);flex-shrink:0">•</span>');
    row.appendChild(av); row.appendChild(info); box.appendChild(row);
  }
}
async function loadFriendRequests(){
  if(!U.id) return;
  const supa=getSupa();
  const box=$('fhubReqList');
  const { data, error }=await supa.from('friendships').select('*').eq('recipient',U.id).eq('status','pending').order('created_at',{ascending:false});
  if(error){ console.error('loadFriendRequests error:',error); box.innerHTML='<div class="ge">Erro ao carregar solicitações</div>'; return; }
  fabPendingReq=(data||[]).length; updateFabBadge();
  if(!data||!data.length){ box.innerHTML='<div class="ge">Nenhuma solicitação pendente</div>'; return; }
  box.innerHTML='';
  for(const f of data){
    const { data:p } = await supa.from('profiles').select('id,name,username,photo,color,frame,frame_scale,frame_x,frame_y').eq('id',f.requester).maybeSingle();
    const row=document.createElement('div'); row.className='fhub-row';
    const av=document.createElement('div'); av.className='fhub-av'; av.innerHTML=avatarHTML(p||{name:'U'});
    const openReq=()=>{ closeFriendsHub(); openProfile(f.requester); };
    av.onclick=openReq;
    const info=document.createElement('div'); info.className='fhub-info'; info.onclick=openReq;
    info.innerHTML=`${nameRowHTML((p&&p.name)||'Usuário',f.requester,'fhub-name')}<div class="fhub-sub">${p&&p.username?'@'+p.username:'quer ser seu amigo'}</div>`;
    const acts=document.createElement('div'); acts.className='fhub-acts';
    const acceptBtn=document.createElement('button'); acceptBtn.className='btn bp bsm'; acceptBtn.textContent='Aceitar';
    acceptBtn.onclick=async(e)=>{ e.stopPropagation(); await acceptFriendRequest(f.requester,true); loadFriendRequests(); };
    const declineBtn=document.createElement('button'); declineBtn.className='btn bg2 bsm'; declineBtn.textContent='Recusar';
    declineBtn.onclick=async(e)=>{ e.stopPropagation(); await declineFriendRequest(f.requester,true); loadFriendRequests(); };
    acts.appendChild(acceptBtn); acts.appendChild(declineBtn);
    row.appendChild(av); row.appendChild(info); row.appendChild(acts);
    box.appendChild(row);
  }
}

/* Amigos */
async function sendFriendRequest(toId){
  const supa=getSupa(); const { data:meData }=await supa.auth.getUser(); if(!meData.user){ toast('Faça login para adicionar amigos','err'); return; }
  const from=meData.user.id; if(from===toId) return;
  const exists=await supa.from('friendships').select('status').or(`and(requester.eq.${from},recipient.eq.${toId}),and(requester.eq.${toId},recipient.eq.${from})`).maybeSingle();
  if(exists.data){ toast(exists.data.status==='accepted'?'Vocês já são amigos':'Pedido já existe','err'); openProfile(toId); return; }
  const { error }=await supa.from('friendships').insert({ requester:from, recipient:toId, status:'pending' });
  if(error){ console.warn(error); toast('Erro','err'); return; }
  toast('Pedido enviado','ok'); openProfile(toId);
}
async function acceptFriendRequest(fromId,silent){ const supa=getSupa(); const me=(await supa.auth.getUser()).data.user.id; const { error }=await supa.from('friendships').update({ status:'accepted' }).match({ requester:fromId, recipient:me }); if(error){ console.warn(error); toast('Erro','err'); return; } toast('Amigo adicionado','ok'); if(!silent) openProfile(fromId); pollFriendRequestsCount(); }
async function declineFriendRequest(fromId,silent){ const supa=getSupa(); const me=(await supa.auth.getUser()).data.user.id; const { error }=await supa.from('friendships').delete().match({ requester:fromId, recipient:me }); if(error){ console.warn(error); toast('Erro','err'); return; } toast('Solicitação recusada','ok'); if(!silent) closeModal('profileModal'); pollFriendRequestsCount(); }
async function cancelFriendRequest(toId){ const supa=getSupa(); const me=(await supa.auth.getUser()).data.user.id; const { error }=await supa.from('friendships').delete().match({ requester:me, recipient:toId }); if(error){ console.warn(error); toast('Erro','err'); return; } toast('Pedido cancelado','ok'); openProfile(toId); }
async function removeFriend(uid){ const supa=getSupa(); const me=(await supa.auth.getUser()).data.user.id; const { error }=await supa.from('friendships').delete().or(`and(requester.eq.${me},recipient.eq.${uid}),and(requester.eq.${uid},recipient.eq.${me})`); if(error){ console.warn(error); toast('Erro','err'); return; } toast('Removido','ok'); openProfile(uid); }
function applyTbPos(pos){
  if(document.body.classList.contains('light'))return;
  const tb=$('toolbar'),rs=$('roomScene'),rb=$('rbody'),cw=$('cw');
  tb.className='toolbar'; rb.style.flexDirection='';
  if(tb.parentNode)tb.parentNode.removeChild(tb);
  if(pos==='top') rs.insertBefore(tb,rb);
  else if(pos==='bottom'){tb.classList.add('tb-bottom');rs.appendChild(tb);}
  else if(pos==='left'){tb.classList.add('tb-left');rb.style.flexDirection='row';rb.insertBefore(tb,cw);}
  else if(pos==='right'){tb.classList.add('tb-right');rb.style.flexDirection='row';rb.appendChild(tb);}
}

/* ── ROOM ── */
