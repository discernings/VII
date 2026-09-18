function openGifPicker(mode){ gifMode=mode; $('gifModal').classList.add('on'); setTimeout(()=>$('gifSearch').focus(),80); }
// Extrai a melhor url de thumb/full de um item da Klipy, cobrindo variações de schema (file.{sm,md,hd}.{gif,webp}.url)
function klipyPickUrls(item){
  const f=item.file||item.files||{};
  const sizes=['xs','sm','md','hd','lg']; // menor → maior
  let thumb=null, full=null;
  for(const s of sizes){
    const grp=f[s]; if(!grp)continue;
    const url=grp.gif?.url||grp.webp?.url||grp.url;
    if(!url)continue;
    if(!thumb)thumb=url;
    full=url; // fica sempre com a maior disponível
  }
  // fallback: alguns formatos vêm direto em item.url / item.gif
  if(!full) full = item.url || item.gif?.url || item.original?.url || null;
  if(!thumb) thumb = item.thumbnail || item.preview || full;
  return {thumb, full};
}
async function searchGifs(){
  const q=$('gifSearch').value.trim(), r=$('gifResults');
  if(!q){r.innerHTML='<div class="ge">Digite algo para buscar</div>';return;}
  r.innerHTML='<div class="ge">Buscando...</div>';
  try{
    const res=await fetch(`https://api.klipy.com/api/v1/${KLIPY_KEY}/gifs/search?q=${encodeURIComponent(q)}&per_page=24&page=1&content_filter=low`);
    if(!res.ok)throw new Error('HTTP '+res.status);
    const d=await res.json();
    const items=d.data?.data||d.data||d.results||[];
    if(!items.length){r.innerHTML='<div class="ge">Nenhum resultado</div>';return;}
    r.innerHTML='';
    items.forEach(g=>{
      const {thumb,full}=klipyPickUrls(g);
      if(!thumb||!full)return;
      const it=document.createElement('div'); it.className='gi';
      const img=document.createElement('img'); img.src=thumb; img.loading='lazy';
      it.appendChild(img); it.onclick=()=>pickGif(full); r.appendChild(it);
    });
    if(!r.children.length) r.innerHTML='<div class="ge">Nenhum resultado</div>';
  }catch(e){ r.innerHTML='<div class="ge">Erro ao buscar. Tente novamente.</div>'; console.error(e); }
}
function pickGif(url){
  closeModal('gifModal');
  if(gifMode==='chat'){ const av=qs('.av-wrap[data-uid="'+U.id+'"]')||qs('.av-wrap'); if(av){showBubble(av,url,true);broadcast({type:'GIF_CHAT',uid:U.id,url});registrarMensagem(null,url,true,null,true);} }
  else{ const c=$('items'),id='gif_'+Date.now(); mkGif(url,100+Math.random()*300,100+Math.random()*220,id,c,true); toast('GIF adicionado'); }
}

/* ── IMAGE ── */
function openImageModal(){ $('imageModal').classList.add('on'); $('imgPrev').style.display='none'; $('imgFile').value=''; pendImg=null; }
/* CORRIGIDO — prints/fotos recentes não apareciam para os outros.
   A imagem virava base64 e era enviada INTEIRA pelo canal de tempo real. Uma foto
   de celular ou print de tela tem vários MB em base64, muito acima do limite de
   mensagem do Realtime, então o envio falhava sem erro visível: quem mandou via a
   imagem (renderizada localmente), os outros não recebiam nada. Fotos antigas/menores
   passavam por acaso, por caberem no limite — daí a impressão de que "só as salvas
   funcionam". Agora a imagem é redimensionada e enviada ao Storage; pelo canal
   trafega só a URL, que tem algumas centenas de bytes. */
const IMG_MAX_DIM = 1600;   // lado maior; suficiente pra qualidade sem virar arquivo gigante
const IMG_QUALITY  = 0.85;

/* Redimensiona e recomprime no próprio navegador antes de subir. */
function shrinkImage(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onerror=()=>reject(new Error('Falha ao ler o arquivo'));
    r.onload=e=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('Formato de imagem não suportado'));
      img.onload=()=>{
        let {width:w,height:h}=img;
        const scale=Math.min(1, IMG_MAX_DIM/Math.max(w,h));
        w=Math.round(w*scale); h=Math.round(h*scale);
        const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
        cv.getContext('2d').drawImage(img,0,0,w,h);
        cv.toBlob(b=>{ b?resolve({blob:b,dataUrl:cv.toDataURL('image/jpeg',IMG_QUALITY)})
                       :reject(new Error('Falha ao processar a imagem')); },'image/jpeg',IMG_QUALITY);
      };
      img.src=e.target.result;
    };
    r.readAsDataURL(file);
  });
}
function previewImg(){
  const f=$('imgFile').files[0]; if(!f)return;
  $('imgPrev').style.display='block';
  shrinkImage(f).then(({blob,dataUrl})=>{
    pendImg={blob,dataUrl};
    $('imgPrevEl').src=dataUrl;
  }).catch(err=>{
    console.error('previewImg',err);
    toast('Não consegui ler essa imagem: '+err.message,'err');
    $('imgPrev').style.display='none';
  });
}
async function confirmImg(){
  if(!pendImg){toast('Selecione uma imagem','err');return;}
  const c=$('items'), id='img_'+Date.now();
  const x=80+Math.random()*300, y=80+Math.random()*220;
  toast('Enviando imagem...');
  try{
    const supa=getSupa();
    const { data:ud }=await supa.auth.getUser();
    const uid=ud?.user?.id||U.id||'anon';
    const path=`${uid}/room-${Date.now()}.jpg`;
    const { error:upErr }=await supa.storage.from('board').upload(path,pendImg.blob,{cacheControl:'3600',upsert:true,contentType:'image/jpeg'});
    if(upErr) throw upErr;
    const { data:pub }=supa.storage.from('board').getPublicUrl(path);
    if(!pub?.publicUrl) throw new Error('não consegui gerar o link público');
    mkImg(pub.publicUrl,x,y,id,c,true);   // pelo canal vai só a URL
    toast('Imagem adicionada');
  }catch(err){
    console.error('confirmImg',err);
    toast('Erro ao enviar a imagem: '+(err.message||'desconhecido'),'err');
    return;
  }
  pendImg=null; closeModal('imageModal');
}
function clearImg(){ pendImg=null; $('imgPrev').style.display='none'; $('imgFile').value=''; }

/* ── TEMA + IDIOMA (painel Configurações) ── */
function setTheme(t){
  const b=document.body;
  b.classList.remove('light','eclipse','mono');
  if(t==='light') b.classList.add('light');
  else if(t==='eclipse') b.classList.add('eclipse');
  else if(t==='mono') b.classList.add('mono');
  localStorage.setItem('tfm_theme',t);
  const opts=[...document.querySelectorAll('.theme-opt')];
  opts.forEach(o=>o.classList.toggle('on',o.dataset.theme===t||(t==='mono'&&o.dataset.theme==='eclipse')));
  // move o realce deslizante para a opção escolhida (o modo secreto mora no mesmo lugar do eclipse)
  const idxTema = t==='mono' ? 'eclipse' : t;
  const idx=Math.max(0,opts.findIndex(o=>o.dataset.theme===idxTema));
  const gl=$('themeGlide');
  if(gl) gl.style.setProperty('--tgi','calc('+idx+' * (100% + 0px))');
}
function toggleTheme(){ // mantido por compatibilidade com atalhos antigos
  const cur=localStorage.getItem('tfm_theme')||'dark';
  setTheme(cur==='dark'?'light':cur==='light'?'eclipse':'dark');
}
function currentTheme(){ return localStorage.getItem('tfm_theme')||'dark'; }

/* ══════════════════════════════════════════════════════════════════
   MODO SECRETO — 4 toques rápidos no eclipse.
   Uma vez descoberto, fica marcado pra sempre (localStorage): o botão passa a
   mostrar o olho no lugar do eclipse, e um toque nele simplesmente ativa o
   modo, como qualquer outro tema. Antes de descobrir, o botão funciona
   normalmente — só conta os toques em silêncio, sem dar pista nenhuma.
   ══════════════════════════════════════════════════════════════════ */
let _toquesEclipse=0, _toqueEclipseTimer=null;
function segredoDesbloqueado(){ return localStorage.getItem('tfm_segredo')==='1'; }
function cliqueEclipse(){
  if(segredoDesbloqueado()){ setTheme('mono'); return; }
  _toquesEclipse++;
  clearTimeout(_toqueEclipseTimer);
  // a janela entre toques é curta de propósito — precisa ser um tamborilar
  // rápido pra contar, não quatro cliques espaçados ao longo do dia
  _toqueEclipseTimer=setTimeout(()=>{ _toquesEclipse=0; },900);
  if(_toquesEclipse>=4){
    _toquesEclipse=0; clearTimeout(_toqueEclipseTimer);
    desbloquearSegredo();
    return;
  }
  setTheme('eclipse');
}
function desbloquearSegredo(){
  localStorage.setItem('tfm_segredo','1');
  const btn=$('btnEclipse'); if(btn) btn.classList.add('virou-olho');
  setTheme('mono');
  toast('👁 encontrado.');
}
function aplicarAparenciaSegredo(){
  // roda na abertura do app: se já foi descoberto antes, o botão já nasce como olho
  if(!segredoDesbloqueado()) return;
  const btn=$('btnEclipse'); if(btn) btn.classList.add('virou-olho');
}
function openPrefs(){
  $('prefsPanel').classList.add('on');
  setTheme(currentTheme());
  setLang(currentLang(),true);
  initEscalaControle();
}
function closePrefs(){ $('prefsPanel').classList.remove('on'); }

/* Traduções: só o que aparece na interface fixa. Textos vindos do banco
   (nomes, bios, mensagens) obviamente continuam como foram escritos. */
/* Dicionário do aplicativo. Antes só as configurações estavam marcadas para
   tradução — o resto da interface continuava em português mesmo em inglês.
   Agora as telas principais, botões, campos e painéis estão cobertos. Textos
   vindos do banco (nomes, mensagens, bios) seguem como foram escritos. */
const I18N={
  pt:{
    'act.add':"Adicionar",
    'act.back':"Voltar",
    'act.cancel':"Cancelar",
    'act.clear':"Limpar",
    'act.close':"Fechar",
    'act.enter':"Entrar",
    'act.exit':"Sair",
    'act.remove':"Remover",
    'act.save':"Salvar",
    'act.search':"Buscar",
    'act.send':"Enviar",
    'auth.create':"Criar uma",
    'auth.google':"Entrar com Google",
    'auth.has':"Já tem conta?",
    'auth.signup':"Criar Conta",
    'board.connect':"Conectar",
    'board.img':"+ Imagem",
    'board.note':"+ Nota",
    'board.title':"Quadro",
    'call.join':"Entrar na chamada",
    'call.title':"Chamada de voz",
    'draw.eraser':"Borracha",
    'draw.label':"Desenho",
    'draw.title':"Desenhar",
    'draw.undo':"Desfazer",
    'f.banner':"Banner",
    'f.bio':"Biografia",
    'f.color':"Cor",
    'f.email':"Email",
    'f.name':"Nome",
    'f.pass':"Senha",
    'f.user':"Usuário",
    'img.add':"Adicionar Imagem",
    'img.crop':"Ajustar foto",
    'img.gallery':"Escolher da Galeria",
    'log.title':"Mensagens da sala",
    'mem.search':"Buscar membros",
    'music.title':"Música",
    'nav.chat':"Conversa",
    'nav.chats':"Conversas",
    'nav.friends':"Amigos",
    'nav.members':"Membros",
    'nav.profile':"Perfil",
    'opt.none':"Nenhum",
    'opt.nonef':"Nenhuma",
    'opt.soft':"Suave",
    'opt.solid':"Sólido",
    'ph.code':"Código da sala...",
    'ph.msg':"Mensagem...",
    'ph.name':"Seu nome",
    'ph.vid':"Buscar vídeos...",
    'prefs.account':"Conta",
    'prefs.lang':"Idioma",
    'prefs.logout':"Sair da conta",
    'prefs.reset':"restaurar",
    'prefs.scale':"Tamanho da interface",
    'prefs.theme':"Tema",
    'prefs.title':"Configurações",
    'prof.auto':"Automática",
    'prof.color':"Cor do perfil",
    'prof.custom':"Cor personalizada",
    'prof.frames':"Molduras",
    'prof.look':"Aparência do perfil",
    'prof.namecolor':"Cor do nome",
    'prof.open':"Abrir meu perfil",
    'prof.own':"Própria",
    'room.parts':"Participantes",
    't.gif':"GIF",
    't.image':"Imagem",
    't.loading':"Carregando...",
    'theme.dark':"Escuro",
    'theme.eclipse':"Eclipse",
    'theme.light':"Claro",
    'vid.add':"Adicionar Vídeo",
    'vid.discover':"Descobrir",
    'vid.link':"Colar link",
    'vid.scan':"Buscar na página"
  },
  en:{
    'act.add':"Add",
    'act.back':"Back",
    'act.cancel':"Cancel",
    'act.clear':"Clear",
    'act.close':"Close",
    'act.enter':"Join",
    'act.exit':"Leave",
    'act.remove':"Remove",
    'act.save':"Save",
    'act.search':"Search",
    'act.send':"Send",
    'auth.create':"Create one",
    'auth.google':"Sign in with Google",
    'auth.has':"Already have an account?",
    'auth.signup':"Create account",
    'board.connect':"Connect",
    'board.img':"+ Image",
    'board.note':"+ Note",
    'board.title':"Board",
    'call.join':"Join call",
    'call.title':"Voice call",
    'draw.eraser':"Eraser",
    'draw.label':"Drawing",
    'draw.title':"Draw",
    'draw.undo':"Undo",
    'f.banner':"Banner",
    'f.bio':"Bio",
    'f.color':"Color",
    'f.email':"Email",
    'f.name':"Name",
    'f.pass':"Password",
    'f.user':"Username",
    'img.add':"Add image",
    'img.crop':"Adjust photo",
    'img.gallery':"Choose from gallery",
    'log.title':"Room messages",
    'mem.search':"Search members",
    'music.title':"Music",
    'nav.chat':"Chat",
    'nav.chats':"Chats",
    'nav.friends':"Friends",
    'nav.members':"Members",
    'nav.profile':"Profile",
    'opt.none':"None",
    'opt.nonef':"None",
    'opt.soft':"Soft",
    'opt.solid':"Solid",
    'ph.code':"Room code...",
    'ph.msg':"Message...",
    'ph.name':"Your name",
    'ph.vid':"Search videos...",
    'prefs.account':"Account",
    'prefs.lang':"Language",
    'prefs.logout':"Sign out",
    'prefs.reset':"reset",
    'prefs.scale':"Interface size",
    'prefs.theme':"Theme",
    'prefs.title':"Settings",
    'prof.auto':"Automatic",
    'prof.color':"Profile color",
    'prof.custom':"Custom color",
    'prof.frames':"Frames",
    'prof.look':"Profile appearance",
    'prof.namecolor':"Name color",
    'prof.open':"Open my profile",
    'prof.own':"Custom",
    'room.parts':"Participants",
    't.gif':"GIF",
    't.image':"Image",
    't.loading':"Loading...",
    'theme.dark':"Dark",
    'theme.eclipse':"Eclipse",
    'theme.light':"Light",
    'vid.add':"Add video",
    'vid.discover':"Discover",
    'vid.link':"Paste link",
    'vid.scan':"Scan page"
  }
};
/* ══════════════════════════════════════════════════════════════════
   TAMANHO DA INTERFACE
   Serve para telas pequenas (onde tudo fica apertado) e grandes (onde tudo fica
   pequeno demais). Usamos "zoom", que escala TUDO — inclusive medidas fixas em
   pixels — em vez de só o tamanho da fonte, que deixaria botões e espaçamentos
   fora de proporção.
   A escolha é local e vale para todas as salas; fica guardada no aparelho. */
const ESCALA_MIN=0.75, ESCALA_MAX=1.35;
let uiEscala = 1;

function aplicarEscala(v,salvar){
  uiEscala=Math.max(ESCALA_MIN,Math.min(ESCALA_MAX,v));
  try{ document.documentElement.style.zoom=uiEscala; }catch(e){}
  const pct=Math.round(uiEscala*100);
  const val=$('escalaValor'); if(val) val.textContent=pct+'%';
  const frac=(uiEscala-ESCALA_MIN)/(ESCALA_MAX-ESCALA_MIN);
  const f=$('escalaFill'); if(f) f.style.width=(frac*100)+'%';
  const k=$('escalaKnob'); if(k) k.style.left=(frac*100)+'%';
  if(salvar!==false){ try{ localStorage.setItem('tfm_escala',String(uiEscala)); }catch(e){} }
}
function resetarEscala(){ aplicarEscala(1); toast('Tamanho restaurado'); }
function carregarEscala(){
  let v=1;
  try{ v=parseFloat(localStorage.getItem('tfm_escala')||'1')||1; }catch(e){}
  aplicarEscala(v,false);
}
function initEscalaControle(){
  const trilho=$('escalaTrilho'); if(!trilho||trilho.dataset.pronto) return;
  trilho.dataset.pronto='1';
  let arrastando=false;
  const daPosicao=e=>{
    const r=trilho.getBoundingClientRect();
    const frac=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
    aplicarEscala(ESCALA_MIN+frac*(ESCALA_MAX-ESCALA_MIN));
  };
  trilho.addEventListener('pointerdown',e=>{
    arrastando=true;
    try{ trilho.setPointerCapture(e.pointerId); }catch(_){}
    daPosicao(e); e.preventDefault();
  });
  trilho.addEventListener('pointermove',e=>{ if(arrastando) daPosicao(e); });
  const soltar=()=>{ arrastando=false; };
  trilho.addEventListener('pointerup',soltar);
  trilho.addEventListener('pointercancel',soltar);
  carregarEscala();
}
function currentLang(){ return localStorage.getItem('tfm_lang')||'pt'; }
function t(key){ const l=I18N[currentLang()]||I18N.pt; return l[key]||I18N.pt[key]||key; }
function setLang(lang,silent){
  if(!I18N[lang]) lang='pt';
  localStorage.setItem('tfm_lang',lang);
  document.documentElement.lang = lang==='en'?'en':'pt-BR';
  document.querySelectorAll('.lang-opt').forEach(o=>o.classList.toggle('on',o.dataset.lang===lang));
  applyI18n();
  if(!silent) toast(lang==='en'?'Language set to English':'Idioma alterado para Português');
}
function applyI18n(){
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const v=t(el.dataset.i18n);
    if(!v||v===el.dataset.i18n) return;      // sem tradução: mantém o original
    if(/<[a-z]/i.test(v)) el.innerHTML=v; else el.textContent=v;
  });
  // texto que aparece dentro dos campos antes de digitar
  document.querySelectorAll('[data-i18n-ph]').forEach(el=>{
    const v=t(el.dataset.i18nPh);
    if(v&&v!==el.dataset.i18nPh) el.setAttribute('placeholder',v);
  });
}
(function(){
  const th=localStorage.getItem('tfm_theme');
  if(th==='light') document.body.classList.add('light');
  else if(th==='eclipse') document.body.classList.add('eclipse');
  else if(th==='mono') document.body.classList.add('mono');
  document.addEventListener('DOMContentLoaded',()=>{ applyI18n(); aplicarAparenciaSegredo(); });
})();

/* ── UNIVERSAL VIDEO ── */
function openUniversalVideoPanel(){ if(!room){toast('Entre em uma sala primeiro','err');return;} $('univVideoPanel').classList.add('on'); setTimeout(()=>$('univVideoUrl').focus(),80); }
function closeUniversalVideoPanel(e){ if(!e||e.currentTarget===e.target||!e.type) $('univVideoPanel').classList.remove('on'); }
function extractYT(url){ const m=url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/); return m?m[1]:null; }
function extractVimeo(url){ const m=url.match(/vimeo\.com\/(?:video\/)?(\d+)/); return m?m[1]:null; }
function extractTwitch(url){
  try{
    const u=new URL(url);
    if(!/(^|\.)twitch\.tv$/.test(u.hostname))return null;
    const vod=u.pathname.match(/\/videos\/(\d+)/); if(vod)return{type:'video',id:vod[1]};
    const clip=u.pathname.match(/\/(?:[^/]+\/clip|clip)\/([A-Za-z0-9-_]+)/); if(clip)return{type:'clip',id:clip[1]};
    const chan=u.pathname.match(/^\/([A-Za-z0-9_]{2,25})\/?$/); if(chan && !['videos','directory','p','settings'].includes(chan[1].toLowerCase()))return{type:'channel',id:chan[1]};
  }catch(e){}
  return null;
}
function isDirectVideo(url){ return /\.(mp4|webm|ogg|mov|avi|mkv)(\?|$)/i.test(url); }
function isHLS(url){ return /\.m3u8(\?|$)/i.test(url); }
async function addUniversalVideo(url){
  url = (typeof url==='string' ? url : $('univVideoUrl').value).trim(); if(!url){toast('Cole uma URL','err');return;}
  if(!/^https?:\/\//i.test(url)) url='https://'+url;
  const btn=$('uvAddBtn'); if(btn) btn.classList.add('loading');
  // 1) plataformas conhecidas: entra direto como player sincronizado
  const known=matchKnown(url);
  if(known){ loadVideoUnified(known.kind,known.source); $('univVideoPanel').classList.remove('on'); if(btn)btn.classList.remove('loading'); return; }
  // 2) página qualquer: tenta descobrir o vídeo embutido nela via oEmbed
  toast('Procurando o vídeo nessa página...');
  const found=await resolveVideoUrl(url);
  if(btn) btn.classList.remove('loading');
  if(found && found.kind!=='iframe'){
    loadVideoUnified(found.kind,found.source);
    $('univVideoPanel').classList.remove('on');
    toast('Vídeo encontrado na página · SYNC');
    return;
  }
  if(found && found.kind==='iframe'){
    // achamos o player embutido: usar a URL de embed funciona muito melhor que a URL da página,
    // porque páginas normais bloqueiam iframe, mas o endereço de embed é feito justamente pra isso
    addGenericIframe(found.source);
    $('univVideoPanel').classList.remove('on');
    toast('Player da página incorporado'+(found.provider?' ('+found.provider+')':''));
    return;
  }
  // 3) nada identificado: incorpora a página como veio
  addGenericIframe(url); $('univVideoPanel').classList.remove('on');
}
/* ══════════════════════════════════════════════════════════════════════
   DESCOBRIR — substitui a antiga aba "Navegar".

   POR QUE A ABA ANTIGA NÃO TINHA COMO FUNCIONAR:
   ela era um <iframe> apontando pro site que você digitasse. Dois muros
   intransponíveis do navegador tornavam a ideia inviável:
   1) X-Frame-Options / CSP frame-ancestors: YouTube, Google e a maioria
      dos sites de vídeo PROIBEM ser abertos dentro de um iframe. Por isso
      a página nem carregava e não dava pra "deslizar" navegando.
   2) Same-origin policy: mesmo quando o site carrega, o JavaScript da
      página de fora NÃO consegue ler a URL nem o conteúdo do iframe. Ou
      seja, "detectar automaticamente o vídeo que está tocando lá dentro"
      é impossível — não é limitação de esforço, é barreira de segurança
      do navegador, igual pra qualquer site do mundo.

   O QUE FOI FEITO NO LUGAR (e entrega o mesmo objetivo, funcionando):
   • RESOLVEDOR UNIVERSAL: você cola o link da PÁGINA (não do embed) e nós
     descobrimos o vídeo que existe nela via oEmbed, transformando em player
     sincronizado. É exatamente "reconhecer o vídeo embed e virar player",
     só que feito do lado de fora, que é o único lugar onde é possível.
   • DESCOBRIR: busca real com páginas navegáveis por deslize (swipe),
     setas, teclado, categorias e resultados ricos (duração, views, canal).
   ══════════════════════════════════════════════════════════════════════ */

const DS_CATEGORIES = [
  { id:'trend',  label:'🔥 Em alta',   q:'' },
  { id:'music',  label:'🎵 Música',    q:'música' },
  { id:'live',   label:'🔴 Ao vivo',   q:'ao vivo' },
  { id:'games',  label:'🎮 Games',     q:'gameplay' },
  { id:'movies', label:'🎬 Filmes',    q:'filme completo' },
  { id:'anime',  label:'🌸 Anime',     q:'anime' },
  { id:'lofi',   label:'☕ Lofi',      q:'lofi hip hop' },
  { id:'news',   label:'📰 Notícias',  q:'notícias hoje' }
];
let dsQuery='', dsTokens=[null], dsPage=0, dsNext=null, dsLoading=false, dsCat='trend';
let dsSwipe=null, dsInited=false;

function uvSwitchTab(tab){
  const tabs={link:'uvTabLink',browse:'uvTabBrowse',scan:'uvTabScan'};
  const btns={link:'uvTabLinkBtn',browse:'uvTabBrowseBtn',scan:'uvTabScanBtn'};
  Object.keys(tabs).forEach(k=>{
    const el=$(tabs[k]); if(el) el.style.display=(k===tab)?'block':'none';
    const b=$(btns[k]);  if(b)  b.classList.toggle('active',k===tab);
  });
  if(tab==='browse') dsInit();
}
/* Lê o HTML da página informada e lista os vídeos achados, cada um com botão de embed. */
async function scanPageForVideos(){
  let url=($('scanUrl').value||'').trim();
  if(!url){ toast('Cole o endereço de uma página','err'); return; }
  if(!/^https?:\/\//i.test(url)) url='https://'+url;
  const box=$('scanResults'), btn=$('scanBtn');
  btn.classList.add('loading');
  box.innerHTML='<div class="scan-msg">Lendo a página e procurando vídeos...</div>';
  try{
    // atalho: se a própria URL já é de um provedor conhecido, nem precisa buscar
    const direct=matchKnown(url);
    let vids=[];
    if(direct) vids=[{...direct,label:direct.provider||direct.kind,url}];
    else{
      const html=await fetchPageHtml(url);
      if(!html){
        box.innerHTML='<div class="scan-msg">Não consegui ler essa página. Alguns sites bloqueiam leitura externa — nesse caso, abra o vídeo e copie o link direto dele.</div>';
        btn.classList.remove('loading'); return;
      }
      _scanTitle=getPageTitle(html);
      vids=extractVideosFromHtml(html,url);
      /* Acrescenta os palpites de /embed/ derivados do endereço. Sites que servem
         o vídeo por player próprio (caso do TokyVideo e da maioria dos sites de
         anime/filme) costumam ter essa rota, e ela toca quando o arquivo cru não
         toca. Entram como opção extra: você escolhe qual tentar. */
      guessEmbedFromPageUrl(url).forEach(g=>{
        if(!vids.some(v=>(v.source||v.url)===g))
          vids.push({ kind:'iframe', source:g, url:g, label:'Player do site (tentar)' });
      });
    }
    if(!vids.length){
      box.innerHTML='<div class="scan-msg">Nenhum vídeo encontrado no HTML dessa página. Se o vídeo só aparece depois de carregar, tente copiar o link direto dele.</div>';
      btn.classList.remove('loading'); return;
    }
    _scanFound=vids;
    box.innerHTML=vids.map((v,i)=>{
      const sync=(v.kind!=='iframe');
      return `<div class="scan-item">
        <div class="scan-info">
          <span class="scan-label">${dsEsc(v.label||v.kind)}</span>
          <span class="scan-url">${dsEsc((v.url||v.source).slice(0,70))}</span>
          <span class="scan-tag ${sync?'ok':''}">${sync?'sincronizado':'só incorporado'}</span>
        </div>
        <button class="btn bp bsm scan-embed" onclick="embedScanned(${i})">Embed</button>
      </div>`;
    }).join('');
    // Se o melhor resultado não sincroniza, procura o mesmo título onde sincroniza.
    const temSync=vids.some(v=>v.kind!=='iframe');
    if(!temSync) suggestSyncable(_scanTitle||url);
  }catch(e){
    console.error('scanPageForVideos',e);
    box.innerHTML='<div class="scan-msg">Erro ao ler a página.</div>';
  }
  btn.classList.remove('loading');
}
let _scanFound=[], _scanTitle='', _syncAlts=[];
/* Mostra versões do mesmo conteúdo que dão sincronia completa. */
async function suggestSyncable(title){
  const box=$('scanResults'); if(!box) return;
  const holder=document.createElement('div');
  holder.className='sync-alts';
  holder.innerHTML='<div class="sync-alts-h">Procurando versões que sincronizam...</div>';
  box.appendChild(holder);
  const alts=await findSyncableAlternatives(title);
  _syncAlts=alts;
  if(!alts.length){
    holder.innerHTML='<div class="sync-alts-h">Nenhuma versão sincronizável encontrada para este título.</div>';
    return;
  }
  holder.innerHTML=syncAltsHTML(alts);
}
/* Mesma lista, mas a partir de resultados já obtidos (usado pelo botão do card). */
function suggestSyncableFromList(alts){
  const box=$('scanResults'); if(!box) return;
  _syncAlts=alts;
  const holder=document.createElement('div');
  holder.className='sync-alts';
  holder.innerHTML=syncAltsHTML(alts);
  box.appendChild(holder);
}
function syncAltsHTML(alts){
  return '<div class="sync-alts-h">Estas versões tocam <b>sincronizadas</b> com seus amigos</div>'
    +alts.map((a,i)=>`<div class="sync-alt">
        ${a.thumb?`<img src="${a.thumb}" alt="">`:'<span class="sync-alt-ico">▶</span>'}
        <div class="sync-alt-info">
          <span class="sync-alt-title">${dsEsc(a.title)}</span>
          <span class="sync-alt-sub">${dsEsc(a.platform)}${a.sub?' · '+dsEsc(a.sub):''}</span>
        </div>
        <button class="btn bp bsm scan-embed" onclick="playSyncAlt(${i})">Assistir</button>
      </div>`).join('');
}
function playSyncAlt(i){
  const a=_syncAlts[i]; if(!a) return;
  if(!room){ toast('Entre em uma sala primeiro','err'); return; }
  loadVideoUnified(a.kind,a.source);
  closeUniversalVideoPanel();
  toast('Tocando versão sincronizada · '+a.platform);
}
function embedScanned(i){
  const v=_scanFound[i]; if(!v) return;
  if(!room){ toast('Entre em uma sala primeiro','err'); return; }
  if(v.kind==='iframe'){ addGenericIframe(v.source); }
  else { loadVideoUnified(v.kind,v.source); }
  closeUniversalVideoPanel();
}
function dsInit(){
  if(dsInited) return; dsInited=true;
  const chips=$('dsChips');
  chips.innerHTML=DS_CATEGORIES.map(c=>`<button class="ds-chip${c.id===dsCat?' on':''}" data-cat="${c.id}">${c.label}</button>`).join('');
  chips.addEventListener('click',e=>{
    const b=e.target.closest('.ds-chip'); if(!b) return;
    dsCat=b.dataset.cat;
    chips.querySelectorAll('.ds-chip').forEach(x=>x.classList.toggle('on',x===b));
    const cat=DS_CATEGORIES.find(c=>c.id===dsCat);
    $('dsSearchInput').value='';
    dsStart(cat?cat.q:'', dsCat==='trend');
  });
  // delegação de evento: um listener só para todos os cards (mais leve que N handlers)
  $('dsResults').addEventListener('click',e=>{
    const card=e.target.closest('.ds-card'); if(!card) return;
    const vid=card.dataset.vid; if(!vid) return;
    if(!room){ toast('Entre em uma sala primeiro','err'); return; }
    loadVideoUnified('youtube',vid);
    closeUniversalVideoPanel();
  });
  dsSetupSwipe();
  dsStart('',true);
}

/* ── paginação real, com pilha de tokens pra poder voltar ── */
function dsStart(q,trending){
  dsQuery=q||''; dsTokens=[null]; dsPage=0; dsNext=null; dsTrending=!!trending;
  dsFetch(0,'none');
}
let dsTrending=true;
function dsGoPage(delta){
  if(dsLoading) return;
  const target=dsPage+delta;
  if(target<0) return;
  if(delta>0 && !dsNext) { dsBounce('left'); return; }
  if(target<0) { dsBounce('right'); return; }
  dsFetch(target, delta>0?'next':'prev');
}
async function dsFetch(pageIdx,dir){
  if(dsLoading) return;
  dsLoading=true;
  dsRenderLoading(dir);
  try{
    let url;
    const token=dsTokens[pageIdx];
    if(dsTrending && !dsQuery){
      url=`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&chart=mostPopular&regionCode=BR&maxResults=24&key=${encodeURIComponent(YT_API_KEY)}`;
      if(token) url+=`&pageToken=${encodeURIComponent(token)}`;
    }else{
      url=`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=24&key=${encodeURIComponent(YT_API_KEY)}&q=${encodeURIComponent(dsQuery)}`;
      if(token) url+=`&pageToken=${encodeURIComponent(token)}`;
    }
    const res=await fetch(url);
    if(!res.ok){ dsRenderMsg('Não foi possível buscar agora. Verifique a conexão ou a chave da API.'); dsLoading=false; return; }
    const data=await res.json();
    let items=data.items||[];
    if(!items.length){ dsRenderMsg('Nenhum resultado encontrado.'); dsLoading=false; return; }
    dsNext=data.nextPageToken||null;
    dsPage=pageIdx;
    dsTokens[pageIdx+1]=dsNext;
    // busca (numa chamada só) duração e views quando vieram da busca, que não traz esses campos
    if(!(dsTrending && !dsQuery)){
      const ids=items.map(i=>i.id.videoId).filter(Boolean);
      const det=await dsFetchDetails(ids);
      items=items.map(i=>({ ...i, _d:det[i.id.videoId] }));
    }else{
      items=items.map(i=>({ ...i, _d:{ dur:i.contentDetails?.duration, views:i.statistics?.viewCount } }));
    }
    dsRender(items,dir);
  }catch(e){ console.error('dsFetch',e); dsRenderMsg('Erro ao buscar.'); }
  dsLoading=false;
}
async function dsFetchDetails(ids){
  const out={};
  if(!ids.length) return out;
  try{
    const url=`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${ids.join(',')}&key=${encodeURIComponent(YT_API_KEY)}`;
    const r=await fetch(url); if(!r.ok) return out;
    const d=await r.json();
    (d.items||[]).forEach(v=>{ out[v.id]={ dur:v.contentDetails?.duration, views:v.statistics?.viewCount }; });
  }catch(e){}
  return out;
}
/* ISO-8601 (PT1H4M13S) → 1:04:13 */
function dsFmtDur(iso){
  if(!iso) return '';
  const m=iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if(!m) return '';
  const h=+(m[1]||0), mi=+(m[2]||0), s=+(m[3]||0);
  return h ? `${h}:${String(mi).padStart(2,'0')}:${String(s).padStart(2,'0')}`
           : `${mi}:${String(s).padStart(2,'0')}`;
}
function dsFmtViews(v){
  if(!v) return '';
  const n=+v;
  if(n>=1e9) return (n/1e9).toFixed(1).replace('.',',')+' bi';
  if(n>=1e6) return (n/1e6).toFixed(1).replace('.',',')+' mi';
  if(n>=1e3) return Math.round(n/1e3)+' mil';
  return String(n);
}
function dsRenderLoading(dir){
  const box=$('dsResults');
  if(dir==='none'||!box.children.length){
    box.innerHTML=Array.from({length:6}).map(()=>`<div class="ds-card ds-skel"><div class="ds-thumb"></div><div class="ds-meta"><i></i><i class="s"></i></div></div>`).join('');
  }else{
    box.classList.add('ds-fading');
  }
}
function dsRenderMsg(msg){
  $('dsResults').classList.remove('ds-fading');
  $('dsResults').innerHTML=`<div class="ds-msg">${msg}</div>`;
  dsUpdatePager();
}
function dsRender(items,dir){
  const box=$('dsResults');
  box.classList.remove('ds-fading');
  box.innerHTML=items.map(it=>{
    const id=it.id?.videoId||it.id;
    const sn=it.snippet||{};
    const thumb=sn.thumbnails?.medium?.url||sn.thumbnails?.default?.url||'';
    const title=dsEsc(sn.title||'');
    const chan=dsEsc(sn.channelTitle||'');
    const dur=dsFmtDur(it._d?.dur);
    const views=dsFmtViews(it._d?.views);
    return `<div class="ds-card" data-vid="${id}" title="${title}">
      <div class="ds-thumb"><img src="${thumb}" loading="lazy" alt="">
        ${dur?`<span class="ds-dur">${dur}</span>`:''}
        <span class="ds-play"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="6,4 20,12 6,20"/></svg></span>
      </div>
      <div class="ds-meta"><span class="ds-title">${title}</span>
        <span class="ds-sub">${chan}${views?' · '+views+' views':''}</span></div>
    </div>`;
  }).join('');
  // animação de entrada conforme a direção do deslize
  box.classList.remove('ds-in-l','ds-in-r');
  void box.offsetWidth; // força reflow pra reiniciar a animação
  if(dir==='next') box.classList.add('ds-in-r');
  else if(dir==='prev') box.classList.add('ds-in-l');
  dsUpdatePager();
  box.scrollTop=0;
}
function dsEsc(s){ return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function dsUpdatePager(){
  const lbl=$('dsPageLbl'); if(lbl) lbl.textContent='Página '+(dsPage+1);
  const prev=$('dsPrev'), next=$('dsNext');
  if(prev) prev.disabled=dsPage===0;
  if(next) next.disabled=!dsNext;
}
function dsBounce(side){
  const box=$('dsResults');
  box.classList.remove('ds-bounce-l','ds-bounce-r');
  void box.offsetWidth;
  box.classList.add(side==='left'?'ds-bounce-l':'ds-bounce-r');
}
/* deslizar entre páginas: arrastar na área de resultados (toque ou mouse) */
function dsSetupSwipe(){
  const box=$('dsResults');
  box.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0) return;
    dsSwipe={ x:e.clientX, y:e.clientY, dx:0, active:false, id:e.pointerId };
  });
  box.addEventListener('pointermove',e=>{
    if(!dsSwipe||e.pointerId!==dsSwipe.id) return;
    const dx=e.clientX-dsSwipe.x, dy=e.clientY-dsSwipe.y;
    // só assume o gesto se for claramente horizontal — senão deixa a rolagem vertical em paz
    if(!dsSwipe.active && Math.abs(dx)>14 && Math.abs(dx)>Math.abs(dy)*1.4) dsSwipe.active=true;
    if(dsSwipe.active){
      dsSwipe.dx=dx;
      const damp=(dx>0&&dsPage===0)||(dx<0&&!dsNext) ? .28 : .55; // resistência quando não há pra onde ir
      box.style.transform=`translateX(${dx*damp}px)`;
      box.style.transition='none';
    }
  });
  const finish=e=>{
    if(!dsSwipe) return;
    const dx=dsSwipe.dx, was=dsSwipe.active;
    dsSwipe=null;
    box.style.transition=''; box.style.transform='';
    if(!was) return;
    if(dx<-70) dsGoPage(1);
    else if(dx>70) dsGoPage(-1);
  };
  box.addEventListener('pointerup',finish);
  box.addEventListener('pointercancel',finish);
  box.addEventListener('pointerleave',finish);
  // teclado
  document.addEventListener('keydown',e=>{
    if(!$('univVideoPanel').classList.contains('on')) return;
    if($('uvTabBrowse').style.display==='none') return;
    if(document.activeElement&&document.activeElement.tagName==='INPUT') return;
    if(e.key==='ArrowRight') dsGoPage(1);
    if(e.key==='ArrowLeft') dsGoPage(-1);
  });
}
function dsSearchNow(){
  const q=$('dsSearchInput').value.trim();
  $('dsChips').querySelectorAll('.ds-chip').forEach(x=>x.classList.remove('on'));
  dsStart(q,!q);
}

/* ══════════════════════════════════════════════════════════════════
   RESOLVEDOR UNIVERSAL DE LINKS
   Recebe a URL de uma PÁGINA qualquer e descobre o vídeo dentro dela.
   Ordem de tentativa:
   1) Extratores diretos (YouTube/Vimeo/Twitch/arquivo) — instantâneo.
   2) oEmbed via noembed.com: padrão aberto que centenas de sites publicam;
      devolve o HTML do player, de onde tiramos a URL real do embed.
   3) Se o embed resolvido for de uma plataforma conhecida, vira player
      SINCRONIZADO; senão entra como iframe (posição sincronizada).
   É esta etapa que entrega, na prática, "reconhecer o vídeo da página e
   transformar em player" — feito de fora, que é onde o navegador permite.
   ══════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════
   RESOLVEDOR DE VÍDEO — versão ampliada.

   Sobre a "navegação de navegador": ela não foi removida por escolha, e sim
   porque é impossível. Sites como YouTube, Netflix e Google enviam o cabeçalho
   X-Frame-Options/CSP que PROÍBE serem abertos dentro de um iframe, e a política
   de mesma origem impede ler a URL ou o conteúdo de um iframe de outro domínio.
   Nenhum site do mundo consegue contornar isso pelo navegador.

   O que dá pra fazer — e é o que está aqui — é LER O HTML da página por fora e
   descobrir os vídeos dentro dela. É exatamente "reconhecer o HTML e achar o
   vídeo presente no site", só que feito do lado de fora, que é onde o navegador
   permite. O resultado vira uma lista com botão de embed para cada vídeo achado.
   ══════════════════════════════════════════════════════════════════ */

/* ── HOSPEDEIROS DE EMBED ──
   Sites de vídeo (principalmente de anime/filmes, como o TokyVideo) quase nunca
   servem o arquivo direto: eles usam hospedeiros que têm uma página /embed/
   própria. Tentar tocar o .mp4/.m3u8 cru desses sites quase sempre falha, porque
   o CDN checa de qual domínio veio a requisição (proteção de hotlink) e recusa
   quando não é o site original — o player fica preto mesmo o vídeo "existindo".
   A saída é usar a página de embed do próprio hospedeiro, que roda no domínio
   dele e portanto passa por essa checagem. */
const EMBED_HOSTS=[
  [/streamtape\.com\/v\/([a-z0-9]+)/i,        m=>'https://streamtape.com/e/'+m[1],                 'Streamtape'],
  [/(?:dood|d0o0d|dooood|ds2play)\.[a-z]+\/[ed]\/([a-z0-9]+)/i, m=>'https://dood.to/e/'+m[1],      'DoodStream'],
  [/voe\.sx\/(?:e\/)?([a-z0-9]+)/i,           m=>'https://voe.sx/e/'+m[1],                         'VOE'],
  [/mp4upload\.com\/(?:embed-)?([a-z0-9]+)/i, m=>'https://mp4upload.com/embed-'+m[1]+'.html',      'Mp4Upload'],
  [/filemoon\.[a-z]+\/[ed]\/([a-z0-9]+)/i,    m=>'https://filemoon.sx/e/'+m[1],                    'Filemoon'],
  [/vidoza\.net\/(?:embed-)?([a-z0-9]+)/i,    m=>'https://vidoza.net/embed-'+m[1]+'.html',         'Vidoza'],
  [/streamwish\.[a-z]+\/[ed]?\/?([a-z0-9]+)/i,m=>'https://streamwish.to/e/'+m[1],                  'StreamWish'],
  [/vidhide\.[a-z]+\/[ed]\/([a-z0-9]+)/i,     m=>'https://vidhide.com/e/'+m[1],                    'VidHide'],
  [/ok\.ru\/video\/(\d+)/i,                   m=>'https://ok.ru/videoembed/'+m[1],                 'OK.ru'],
  [/rutube\.ru\/video\/([a-z0-9]+)/i,         m=>'https://rutube.ru/play/embed/'+m[1],             'Rutube'],
  [/vk\.com\/video(-?\d+)_(\d+)/i,            m=>'https://vk.com/video_ext.php?oid='+m[1]+'&id='+m[2],'VK'],
  [/nicovideo\.jp\/watch\/([a-z0-9]+)/i,      m=>'https://embed.nicovideo.jp/watch/'+m[1],         'Niconico'],
  [/fast\.wistia\.(?:net|com)\/embed\/iframe\/([a-z0-9]+)/i, m=>'https://fast.wistia.net/embed/iframe/'+m[1],'Wistia'],
  [/bandcamp\.com\/track\/([^/?#]+)/i,        m=>null,                                             'Bandcamp'],
  [/mixcloud\.com\/([^/]+\/[^/?#]+)/i,        m=>'https://www.mixcloud.com/widget/iframe/?feed=%2F'+encodeURIComponent(m[1])+'%2F','Mixcloud'],
  [/facebook\.com\/.+\/videos\/(\d+)/i,       m=>'https://www.facebook.com/plugins/video.php?href='+encodeURIComponent(m[0]),'Facebook'],
  // TokyVideo: a página usa nome ("/br/video/o-macaco") mas o embed usa ID
  // numérico ("/br/embed/710869"). Só a rota de embed já pronta casa aqui; o
  // caminho a partir da página é resolvido lendo o ID do HTML (ver extração).
  [/tokyvideo\.com\/([a-z]{2}\/)?embed\/(\d+)/i, m=>'https://www.tokyvideo.com/'+(m[1]||'')+'embed/'+m[2], 'TokyVideo']
];
function matchEmbedHost(url){
  for(const [re,build,name] of EMBED_HOSTS){
    const m=String(url||'').match(re);
    if(m){
      const src=build(m);
      if(src) return { kind:'iframe', source:src, provider:name };
    }
  }
  return null;
}
/* Muitos sites seguem o padrão /video/algo -> /embed/algo. Não é garantido, mas
   quando existe é a forma que REALMENTE toca (roda no domínio deles). Geramos
   como candidato adicional, deixando o usuário escolher. */
function guessEmbedFromPageUrl(url){
  try{
    const p=new URL(url);
    const guesses=[];
    const path=p.pathname;
    const m=path.match(/\/(?:video|watch|v|media|player)\/([^/?#]+)/i);
    if(m){
      guesses.push(p.origin+'/embed/'+m[1]);
      guesses.push(p.origin+'/e/'+m[1]);
    }
    return guesses;
  }catch(e){ return []; }
}
/* Provedores reconhecidos direto pela URL, sem precisar buscar a página. */
function matchKnown(url){
  // sempre em https: o site roda em https e um embed http é bloqueado sem aviso
  const u=String(url||'').replace(/^http:\/\//i,'https://');
  const yt=extractYT(u);            if(yt) return { kind:'youtube', source:yt };
  const vm=extractVimeo(u);         if(vm) return { kind:'vimeo',   source:vm };
  const tw=extractTwitch(u);        if(tw) return { kind:'twitch',  source:tw.type+':'+tw.id };
  if(isHLS(u)||isDirectVideo(u))    return { kind:'html5',  source:u };

  // ── provedores adicionais, todos via iframe de embed oficial ──
  let m;
  if((m=u.match(/dailymotion\.com\/video\/([a-z0-9]+)/i)))
    return { kind:'iframe', source:'https://www.dailymotion.com/embed/video/'+m[1], provider:'Dailymotion' };
  if((m=u.match(/streamable\.com\/([a-z0-9]+)/i)))
    return { kind:'iframe', source:'https://streamable.com/e/'+m[1], provider:'Streamable' };
  if((m=u.match(/(?:kick\.com)\/([a-zA-Z0-9_-]+)$/i)))
    return { kind:'iframe', source:'https://player.kick.com/'+m[1], provider:'Kick' };
  if((m=u.match(/odysee\.com\/([^?]+)/i)))
    return { kind:'iframe', source:'https://odysee.com/$/embed/'+m[1].replace(/^@/,'@'), provider:'Odysee' };
  if((m=u.match(/rumble\.com\/embed\/([a-z0-9]+)/i)))
    return { kind:'iframe', source:'https://rumble.com/embed/'+m[1]+'/', provider:'Rumble' };
  if((m=u.match(/archive\.org\/details\/([^/?#]+)/i)))
    return { kind:'iframe', source:'https://archive.org/embed/'+m[1], provider:'Internet Archive' };
  if((m=u.match(/drive\.google\.com\/file\/d\/([^/]+)/i)))
    return { kind:'iframe', source:'https://drive.google.com/file/d/'+m[1]+'/preview', provider:'Google Drive' };
  if((m=u.match(/loom\.com\/share\/([a-z0-9]+)/i)))
    return { kind:'iframe', source:'https://www.loom.com/embed/'+m[1], provider:'Loom' };
  if((m=u.match(/soundcloud\.com\/[^/]+\/[^/?#]+/i)))
    return { kind:'iframe', source:'https://w.soundcloud.com/player/?url='+encodeURIComponent(u), provider:'SoundCloud' };
  if((m=u.match(/open\.spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/i)))
    return { kind:'iframe', source:'https://open.spotify.com/embed/'+m[1]+'/'+m[2], provider:'Spotify' };
  if((m=u.match(/(?:tiktok\.com)\/@[^/]+\/video\/(\d+)/i)))
    return { kind:'iframe', source:'https://www.tiktok.com/embed/v2/'+m[1], provider:'TikTok' };
  if((m=u.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i)))
    return { kind:'iframe', source:'https://player.bilibili.com/player.html?bvid='+m[1], provider:'Bilibili' };
  if((m=u.match(/dropbox\.com\/s\/([^?]+)/i)))
    return { kind:'html5',  source:u.replace(/\?dl=\d/,'')+'?raw=1' };
  if(/\.(mp3|m4a|ogg|wav|aac|flac)(\?|$)/i.test(u))
    return { kind:'html5', source:u };
  const host=matchEmbedHost(u);
  if(host) return host;
  return null;
}

/* Lê o HTML da página e extrai TODOS os vídeos que encontrar.
   Precisa de um intermediário porque o navegador bloqueia ler o conteúdo de
   outro domínio direto (mesma política que impede a navegação por iframe).
   Tentamos mais de um intermediário: se um estiver fora do ar, cai no próximo. */
const PAGE_PROXIES=[
  u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u),
  u=>'https://corsproxy.io/?'+encodeURIComponent(u),
  u=>'https://r.jina.ai/'+u
];
async function fetchPageHtml(url){
  for(const build of PAGE_PROXIES){
    try{
      const r=await fetch(build(url),{headers:{'Accept':'text/html,*/*'}});
      if(r.ok){
        const t=await r.text();
        if(t && t.length>50) return t;
      }
    }catch(e){ /* tenta o próximo */ }
  }
  return null;
}
/* Varre o HTML procurando vídeo em todos os lugares onde ele costuma aparecer. */
function extractVideosFromHtml(html,baseUrl){
  const found=[], seen=new Set();
  const push=(src,label)=>{
    if(!src) return;
    let u=src.trim();
    if(u.startsWith('//')) u='https:'+u;
    if(u.startsWith('/')){ try{ u=new URL(u,baseUrl).href; }catch(e){ return; } }
    if(!/^https?:/i.test(u)) return;
    u=u.replace(/^http:\/\//i,'https://');   // evita bloqueio de conteúdo misto
    if(seen.has(u)) return; seen.add(u);
    const known=matchKnown(u);
    found.push(known ? {...known, label:label||known.provider||known.kind, url:u}
                     : { kind:'iframe', source:u, label:label||'Player', url:u });
  };
  let doc=null;
  try{ doc=new DOMParser().parseFromString(html,'text/html'); }catch(e){}
  if(doc){
    // metatags padrão de compartilhamento — o jeito mais confiável
    ['meta[property="og:video:secure_url"]','meta[property="og:video:url"]','meta[property="og:video"]',
     'meta[name="twitter:player"]','meta[itemprop="contentUrl"]','meta[itemprop="embedUrl"]']
      .forEach(sel=>doc.querySelectorAll(sel).forEach(el=>push(el.getAttribute('content'),'Vídeo da página')));
    // players já incorporados na página
    doc.querySelectorAll('iframe[src]').forEach(el=>{
      const s=el.getAttribute('src')||'';
      if(/youtube|youtu\.be|vimeo|twitch|dailymotion|streamable|soundcloud|spotify|bilibili|rumble|odysee|archive\.org|loom|tiktok|kick/i.test(s))
        push(s,'Player incorporado');
    });
    // tags de vídeo nativas
    doc.querySelectorAll('video[src]').forEach(el=>push(el.getAttribute('src'),'Vídeo direto'));
    doc.querySelectorAll('video source[src]').forEach(el=>push(el.getAttribute('src'),'Vídeo direto'));
    // dados estruturados (JSON-LD) usados por muitos sites de vídeo
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(el=>{
      try{
        const j=JSON.parse(el.textContent);
        JSON.stringify(j).match(/"(?:contentUrl|embedUrl)":"([^"]+)"/g)?.forEach(s=>{
          const mm=s.match(/:"([^"]+)"/); if(mm) push(mm[1].replace(/\\\//g,'/'),'Vídeo da página');
        });
      }catch(e){}
    });
  }
  // arquivos soltos no meio dos scripts (players montados por JavaScript)
  (html.match(/https?:\\?\/\\?\/[^"'\s\\]+\.(?:m3u8|mp4|webm)(?:\?[^"'\s\\]*)?/gi)||[])
    .slice(0,8).forEach(u=>push(u.replace(/\\/g,''),'Arquivo de vídeo'));

  /* ROTAS DE EMBED ESCONDIDAS NO HTML.
     Muitos sites (TokyVideo entre eles) usam um NOME na URL da página
     ("/br/video/o-macaco") mas um ID NUMÉRICO na rota de embed
     ("/br/embed/710869"). Não dá pra derivar um do outro — o número só
     aparece dentro do HTML. Então varremos o HTML atrás de qualquer caminho
     de embed do próprio site e o oferecemos como player.
     É essa rota que toca de verdade, porque roda no domínio do site e passa
     pela proteção de hotlink que barra o arquivo cru. */
  try{
    const host=new URL(baseUrl).hostname.replace(/^www\./,'');
    const esc=host.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re=new RegExp('(?:https?:)?//(?:www\\.)?'+esc+'/(?:[a-z]{2}/)?(?:embed|e|player)/[A-Za-z0-9_-]+','gi');
    (html.match(re)||[]).slice(0,6).forEach(u=>push(u,'Player do site'));
    // caminho relativo, sem domínio ("/br/embed/710869")
    const re2=/["'(]((?:\/[a-z]{2})?\/(?:embed|e|player)\/[A-Za-z0-9_-]+)["')]/gi;
    let mm, n=0;
    while((mm=re2.exec(html)) && n<6){ push(mm[1],'Player do site'); n++; }
  }catch(e){}

  /* ORDENAÇÃO — este é o ponto que resolve o "reconhece mas não toca".
     Arquivos .mp4/.m3u8 crus de sites de vídeo quase sempre estão atrás de
     proteção de hotlink: o CDN vê que a requisição não veio do site original e
     recusa, deixando o player preto. O player do PRÓPRIO site (iframe de embed)
     não tem esse problema, porque roda no domínio dele.
     Antes o arquivo cru costumava vir primeiro na lista e era o escolhido
     automaticamente. Agora players vêm primeiro e os arquivos por último. */
  const rank=v=>{
    if(v.kind==='iframe')  return 0;   // player do próprio site: mais confiável
    if(v.kind==='youtube'||v.kind==='vimeo'||v.kind==='twitch') return 1;
    return 2;                          // arquivo cru: última opção
  };
  found.sort((a,b)=>rank(a)-rank(b));
  return found;
}
/* ══════════════════════════════════════════════════════════════════
   VERSÕES SINCRONIZÁVEIS
   Sites como o TokyVideo entram só como iframe: o player deles não oferece
   API de controle, então play/pause não pode ser sincronizado entre vocês.
   Em vez de deixar isso como um beco sem saída, procuramos o MESMO conteúdo
   em plataformas que sincronizam de verdade aqui no app:
     • YouTube  — API de player completa, sincroniza tudo.
     • Archive.org — entrega o arquivo direto (.mp4), que vira player nativo
       e também sincroniza por completo.
   Dailymotion, Streamable e afins ficam de fora de propósito: eles só
   funcionam como iframe aqui, ou seja, não resolveriam o problema.
   ══════════════════════════════════════════════════════════════════ */
function getPageTitle(html){
  try{
    let m=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if(m) return decodeHtmlEntities(m[1]);
    m=html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if(m) return decodeHtmlEntities(m[1]);
  }catch(e){}
  return '';
}
function decodeHtmlEntities(s){
  return String(s||'')
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').trim();
}
/* Limpa o título: tira o nome do site, separadores e sufixos que atrapalham a busca. */
function cleanTitleForSearch(title){
  return String(title||'')
    .replace(/\s*[|\-–—]\s*(tokyvideo|dailymotion|vimeo|youtube)[^|]*$/i,'')
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/,'')
    .replace(/\s*(?:completo|dublado|legendado|online|hd|1080p|720p|assistir)\s*/gi,' ')
    .replace(/\s+/g,' ').trim();
}
async function findSyncableAlternatives(title){
  const q=cleanTitleForSearch(title);
  if(!q) return [];
  const out=[];
  // ── YouTube ──
  try{
    const url=`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5`
      +`&key=${encodeURIComponent(YT_API_KEY)}&q=${encodeURIComponent(q)}`;
    const r=await fetch(url);
    if(r.ok){
      const d=await r.json();
      (d.items||[]).forEach(it=>{
        if(!it.id?.videoId) return;
        out.push({
          kind:'youtube', source:it.id.videoId, platform:'YouTube',
          title:decodeHtmlEntities(it.snippet?.title||''),
          sub:decodeHtmlEntities(it.snippet?.channelTitle||''),
          thumb:it.snippet?.thumbnails?.default?.url||''
        });
      });
    }
  }catch(e){}
  // ── Archive.org (arquivo direto = sincronia completa) ──
  try{
    const aq=encodeURIComponent(`title:(${q}) AND mediatype:(movies)`);
    const url=`https://archive.org/advancedsearch.php?q=${aq}&fl%5B%5D=identifier&fl%5B%5D=title&rows=3&output=json`;
    const r=await fetch(url);
    if(r.ok){
      const d=await r.json();
      const docs=d?.response?.docs||[];
      for(const doc of docs.slice(0,3)){
        try{
          const mr=await fetch('https://archive.org/metadata/'+encodeURIComponent(doc.identifier));
          if(!mr.ok) continue;
          const md=await mr.json();
          const file=(md.files||[]).find(f=>/\.(mp4|webm)$/i.test(f.name||''));
          if(file){
            out.push({
              kind:'html5',
              source:'https://archive.org/download/'+doc.identifier+'/'+encodeURIComponent(file.name),
              platform:'Archive.org', title:doc.title||doc.identifier, sub:'arquivo direto', thumb:''
            });
          }
        }catch(e){}
      }
    }
  }catch(e){}
  return out;
}
/* Fluxo completo: URL conhecida -> oEmbed -> ler o HTML da página. */
async function resolveVideoUrl(url){
  const direct=matchKnown(url);
  if(direct) return direct;
  // 1) oEmbed (rápido e confiável quando o site publica)
  try{
    const r=await fetch('https://noembed.com/embed?url='+encodeURIComponent(url));
    if(r.ok){
      const d=await r.json();
      if(d && !d.error && d.html){
        const m=d.html.match(/src=["']([^"']+)["']/i);
        if(m){
          let src=m[1];
          if(src.startsWith('//')) src='https:'+src;
          const known=matchKnown(src);
          if(known) return known;
          return { kind:'iframe', source:src, title:d.title||'', provider:d.provider_name||'' };
        }
      }
    }
  }catch(e){}
  // 2) ler o HTML e procurar o vídeo dentro dele
  try{
    const html=await fetchPageHtml(url);
    if(html){
      const vids=extractVideosFromHtml(html,url);
      if(vids.length) return vids[0];
    }
  }catch(e){}
  return null;
}


/* ══════════════════════════════════════════════════════════════════
   VOLUME UNIVERSAL DE MÍDIA (sincronizado)
   Um controle só, sempre visível na lateral da sala, que rege TODOS os
   players ao mesmo tempo: YouTube, Vimeo, Twitch, arquivo direto/HLS e o
   card de música. Cada plataforma usa uma escala diferente (o YouTube vai
   de 0 a 100, os demais de 0 a 1), então cada proxy converte internamente
   e aqui trabalhamos sempre com 0..1.
   Serve principalmente pra quem está em chamada: dá pra abaixar o vídeo
   sem mexer no volume da voz das pessoas, que passa por outro caminho de
   áudio (WebRTC) e não é afetado por este controle.
   O valor é sincronizado entre todos na sala, então "abaixar pra todo mundo"
   funciona de verdade — quem entrar depois também recebe o valor atual. */
let mediaVolume = 0.7;      // 0..1
let mediaMuted  = false;
let _volPrev    = 0.7;      // volume guardado antes de silenciar

function applyVolumeToPlayer(uid){
  const p=ytPlrs[uid]; if(!p) return;
  const v=mediaMuted?0:mediaVolume;
  try{
    if(typeof p.setVolumeUnified==='function') p.setVolumeUnified(v); // YouTube (0..100)
    else if(typeof p.setVolume==='function')   p.setVolume(v);        // demais (0..1)
  }catch(e){}
}
function applyVolumeAll(){
  Object.keys(ytPlrs).forEach(applyVolumeToPlayer);
  updateVolumeUI();
}
function setMediaVolume(v,broadcastIt){
  mediaVolume=Math.max(0,Math.min(1,v));
  if(mediaVolume>0) mediaMuted=false;
  applyVolumeAll();
  if(broadcastIt!==false) broadcast({type:'MEDIA_VOL',v:mediaVolume,muted:mediaMuted});
}
function toggleMediaMute(){
  if(mediaMuted){ mediaMuted=false; if(mediaVolume<=0) mediaVolume=_volPrev||0.7; }
  else { _volPrev=mediaVolume; mediaMuted=true; }
  applyVolumeAll();
  broadcast({type:'MEDIA_VOL',v:mediaVolume,muted:mediaMuted});
}
function applyMediaVolumeRemote(v,muted){
  mediaVolume=Math.max(0,Math.min(1,typeof v==='number'?v:mediaVolume));
  mediaMuted=!!muted;
  applyVolumeAll();
}
function volIconHTML(){
  const v=mediaMuted?0:mediaVolume;
  if(v<=0)  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';
  if(v<0.5) return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 010 7"/></svg>';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg>';
}
function updateVolumeUI(){
  const fill=$('volFill'), ico=$('volIcon'), lbl=$('volPct');
  const v=mediaMuted?0:mediaVolume;
  if(fill) fill.style.height=Math.round(v*100)+'%';
  if(ico)  ico.innerHTML=volIconHTML();
  if(lbl)  lbl.textContent=Math.round(v*100);
  const bar=$('volBar'); if(bar) bar.classList.toggle('muted',mediaMuted||v<=0);
}
/* arrastar no trilho vertical (o zero fica embaixo, como qualquer mixer) */
/* Mostrar/ocultar o controle de volume. Começa SEMPRE recolhido ao entrar na
   sala, e a escolha é local: esconder na sua tela não esconde na dos outros. */
let _volAberto=false;
function toggleVolumeBar(){
  _volAberto=!_volAberto;
  const w=$('volWrap'); if(w) w.classList.toggle('on',_volAberto);
}
function resetVolumeBar(){
  _volAberto=false;
  const w=$('volWrap'); if(w) w.classList.remove('on');
}
function initVolumeControl(){
  resetVolumeBar();                     // toda sala começa com o volume recolhido
  const track=$('volTrack'); if(!track||track.dataset.ready) return;
  track.dataset.ready='1';
  let dragging=false, _volRAF=null, _volPendingY=null;
  const setFromEvent=e=>{
    const r=track.getBoundingClientRect();
    const ratio=1-((e.clientY-r.top)/r.height);
    setMediaVolume(ratio);
  };
  track.addEventListener('pointerdown',e=>{ dragging=true; try{track.setPointerCapture(e.pointerId);}catch(_){ } setFromEvent(e); e.preventDefault(); });
  // OTIMIZADO: antes cada pixel arrastado disparava um broadcast de rede + ajuste
  // em todos os players imediatamente — dezenas de vezes por segundo. Agora fica
  // no máximo 1 atualização por frame, arrastar continua instantâneo pro olho.
  track.addEventListener('pointermove',e=>{
    if(!dragging) return;
    _volPendingY=e;
    if(_volRAF) return;
    _volRAF=requestAnimationFrame(()=>{ _volRAF=null; if(_volPendingY) setFromEvent(_volPendingY); });
  });
  const stop=()=>{ dragging=false; };
  track.addEventListener('pointerup',stop);
  track.addEventListener('pointercancel',stop);
  // roda do mouse também ajusta
  track.addEventListener('wheel',e=>{ e.preventDefault(); setMediaVolume(mediaVolume+(e.deltaY<0?0.05:-0.05)); },{passive:false});
  updateVolumeUI();
}
