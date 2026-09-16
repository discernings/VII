function goAuth(){ setScene('authScene'); $('msgbar').classList.remove('show'); $('ytPanel').classList.remove('on'); hideChatFab(); hideBoardFab(); }
function goLanding(){ setScene('landingScene'); $('msgbar').classList.remove('show'); $('ytPanel').classList.remove('on'); if(U.id){ subscribeIncomingDMs(); showChatFab(); showBoardFab(); } }
function goRoom(){ setScene('roomScene'); initVolumeControl(); $('msgbar').classList.add('show'); hideChatFab(); hideBoardFab(); }
function setScene(id){
  document.querySelectorAll('.scene').forEach(s=>s.classList.remove('active'));
  $(id).classList.add('active');
  // marca no <body> qual cena está ativa — usado pelo CSS pra mostrar/ocultar
  // elementos fixos (ex.: o controle de volume só existe dentro da sala)
  document.body.classList.toggle('in-room',id==='roomScene');

  /* REDE DE SEGURANÇA: a janela do navegador embutido é NATIVA, fica por cima de
     tudo e não some ao trocar de tela no aplicativo. Sair da sala pelo botão já
     a fecha, mas existem outros caminhos (sessão expirada, sair da conta, voltar
     pelo botão do aparelho). Aqui garantimos que, ao deixar a sala por QUALQUER
     motivo, ela seja fechada — senão o vídeo fica tocando por cima do menu. */
  if(id!=='roomScene'){
    try{ if(typeof fecharTheaterLocal==='function') fecharTheaterLocal(); }catch(e){}
  }
}
function toSignup(){ $('loginForm').style.display='none'; $('signupForm').style.display='flex'; }
function toLogin(){ $('signupForm').style.display='none'; $('loginForm').style.display='flex'; }
function saveU(){ localStorage.setItem('tfm_u',JSON.stringify(U)); }

/* Checa sessão do Supabase primeiro; cai para localStorage se não houver conta */
function checkAuth(){
  try{
    const supa=getSupa();
    supa.auth.getSession().then(({data})=>{
      if(data?.session){
        const uid=data.session.user.id, authUser=data.session.user;
        supa.from('profiles').select('*').eq('id',uid).maybeSingle().then(async r=>{
          if(r.data){ U={...U,...r.data}; saveU(); goLanding(); }
          else{
            // sessão válida mas sem linha em profiles ainda: cria em vez de jogar pro login
            const nm=authUser.user_metadata?.full_name||(authUser.email?authUser.email.split('@')[0]:'User');
            let photoUrl=null;
            if(pendingAvatarFile){ const path=`${uid}/avatar-${Date.now()}.png`; photoUrl=await uploadProfileFile(pendingAvatarFile,path); pendingAvatarFile=null; }
            const basic={ id:uid, name:nm, username:genUsername(nm), email:authUser.email, color:U.color||'#c45c5c', photo:photoUrl };
            const up=await supa.from('profiles').upsert(basic,{onConflict:'id'});
            if(up.error){ toast('Erro ao criar perfil: '+up.error.message,'err'); console.error('checkAuth upsert error',up.error); }
            U={...U,...basic}; saveU(); goLanding();
          }
        });
      } else {
        const s=localStorage.getItem('tfm_u'); if(s){ U=JSON.parse(s); goLanding(); } else goAuth();
      }
    }).catch(()=>{ const s=localStorage.getItem('tfm_u'); if(s){U=JSON.parse(s);goLanding();}else goAuth(); });
  }catch{ goAuth(); }
}

/* Gera um @usuario a partir do nome/email, garantindo que nunca fique null.
   Ex: "João Silva" -> "joao.silva7k2" */
function genUsername(base){
  const slug=(base||'user').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'').slice(0,20)||'user';
  const suffix=Math.random().toString(36).slice(2,7);
  return `${slug}${suffix}`;
}

/* Observador de auth: mantém o perfil sincronizado com o Supabase */
async function initProfileSystem(){
  const supa=getSupa();
  supa.auth.onAuthStateChange(async (event,session)=>{
    const user=session?.user;
    if(user){
      const { data, error }=await supa.from('profiles').select('*').eq('id',user.id).maybeSingle();
      if(error){ toast('Erro ao ler perfil: '+error.message,'err'); console.error('profile load error',error); }
      if(data){ U={...U,...data}; U.id=user.id; U.email=user.email; saveU(); }
      else{
        const nm=user.user_metadata?.full_name||(user.email?user.email.split('@')[0]:'User');
        let photoUrl=null;
        if(pendingAvatarFile){ const path=`${user.id}/avatar-${Date.now()}.png`; photoUrl=await uploadProfileFile(pendingAvatarFile,path); pendingAvatarFile=null; }
        const basic={ id:user.id, name:nm, username:genUsername(nm), email:user.email, color:U.color||'#c45c5c', photo:photoUrl };
        const up=await supa.from('profiles').upsert(basic,{onConflict:'id'});
        if(up.error){ toast('Erro ao criar perfil: '+up.error.message,'err'); console.error('initProfileSystem upsert error',up.error); }
        U={...U,...basic}; saveU();
      }
    }
  });
}

async function doSignupAuth(){
  const n=$('sName').value.trim(), e=$('sEmail').value.trim(), p=$('sPass').value;
  if(!n||!e||!p){toast('Preencha todos os campos','err');return;}
  if(p.length<6){toast('Senha mínimo 6 caracteres','err');return;}
  const supa=getSupa();
  const res=await supa.auth.signUp({ email:e, password:p, options:{ data:{ full_name:n } } });
  if(res.error){ toast('Erro no cadastro: '+res.error.message,'err'); return; }
  // fallback local imediato (útil enquanto confirmação de email não chega)
  U.name=n; U.email=e; if(res.data?.user) U.id=res.data.user.id; saveU();
  toast('Conta criada, '+n,'ok'); goLanding();
}
async function doLoginAuth(){
  const e=$('lEmail').value.trim(), p=$('lPass').value;
  if(!e||!p){toast('Preencha email e senha','err');return;}
  const supa=getSupa();
  const res=await supa.auth.signInWithPassword({ email:e, password:p });
  if(res.error){ toast('Erro ao autenticar: '+res.error.message,'err'); return; }
  const uid=res.data.user.id;
  const { data }=await supa.from('profiles').select('*').eq('id',uid).maybeSingle();
  if(data){ U={...U,...data}; } else { U.email=e; U.id=uid; if(!U.name) U.name=e.split('@')[0]; }
  saveU(); toast('Bem-vindo, '+(U.name||''),'ok'); goLanding();
}
async function doLogoutAuth(){
  if(!await customConfirm('Sair da conta?',{okLabel:'Sair',danger:true}))return;
  try{ await getSupa().auth.signOut(); }catch(e){}
  localStorage.removeItem('tfm_u'); location.reload();
}

/* ── SETTINGS ── */
function openSettings(){
  pendingAvatarFile=null; pendingBannerFile=null; // evita reenviar um arquivo antigo de uma edição cancelada anteriormente
  loadFramePresets().then(buildFramePresets); // refaz a busca sempre que abre — molduras novas aparecem sem precisar recarregar a página
  initBordas();                               // bordas do card + pré-visualização
  initFrameGesto();                           // arrastar/beliscar na moldura, sem barras
  $('sNm').value=U.name||''; $('sEm').value=U.email||'';
  if($('sUname')) $('sUname').value=U.username||'';
  if($('sBio')) $('sBio').value=U.bio||'';
  // as barras da moldura foram removidas: quem mostra o valor agora é o
  // próprio updateFramePreview(), chamado logo abaixo por initFrameGesto().
  const sp=$('sphoto');
  sp.innerHTML=U.photo?`<img src="${U.photo}"><input type="file" id="spFile" accept="image/*" onchange="handleSPhoto(this)">`:`<span class="sinit">${(U.name||'A').charAt(0).toUpperCase()}</span><input type="file" id="spFile" accept="image/*" onchange="handleSPhoto(this)">`;
  const sb=$('sbanner');
  if(sb) sb.innerHTML=U.banner?`<img src="${U.banner}"><input type="file" id="spBannerFile" accept="image/*" onchange="handleSBanner(this)">`:`<span class="sb-ph">Banner</span><input type="file" id="spBannerFile" accept="image/*" onchange="handleSBanner(this)">`;
  initProfilePreview();
  initNameColorUI();
  applyProfileColor(normHex(U.color)||'#c45c5c');
  setCardTint(tintMode(U.card_tint));
  if(U.name_color) applyNameColor(normHex(U.name_color)||'#ffffff');
  setNameColorMode(U.name_mode==='custom'?'custom':'auto');
  // a prévia acompanha o que você digita, em tempo real
  ['sNm','sUname','sBio'].forEach(id=>{ const el=$(id); if(el&&!el.dataset.pvBound){ el.dataset.pvBound='1'; el.addEventListener('input',renderProfilePreview); } });
  updateFramePreview(); $('settingsPanel').classList.add('on');
}
/* ══════════════════════════════════════════════════════════════════
   PRÉ-VISUALIZAÇÃO DO PERFIL + COR LIVRE
   A cor não fica presa a uma paleta: o seletor nativo dá o espectro
   completo e o campo hexadecimal aceita qualquer valor. As paletas
   sugeridas existem só como atalho.
   "Tingir o card inteiro" aplica a cor como fundo do card do perfil
   (guardado junto do perfil, então todo mundo vê como você escolheu).
   ══════════════════════════════════════════════════════════════════ */
/* Paleta fixa no estilo do Discord: atalhos rápidos + um seletor completo
   (área de saturação/brilho, trilha de matiz e campo hexadecimal) para qualquer cor. */
const PV_SUGGEST=['#c45c5c','#e0733c','#e0a35c','#d8c47a','#7fc8a9','#4ade80','#3ba55d','#6db5c9',
                  '#5865f2','#8ab4f5','#b79ae0','#9b59b6','#e08fb0','#eb459e','#9aa4b0','#4f5660'];
let _cpickH=0,_cpickS=1,_cpickV=1,_cpickOpen=false;

function initProfilePreview(){
  const sw=$('pvSwatches');
  if(sw&&!sw.dataset.ready){
    sw.dataset.ready='1';
    sw.innerHTML=PV_SUGGEST.map(c=>`<i data-c="${c}" style="background:${c}" title="${c}"></i>`).join('');
    sw.addEventListener('click',e=>{ const i=e.target.closest('i'); if(i) applyProfileColor(i.dataset.c); });
  }
  initColorPicker();
}
function normHex(v){
  v=String(v||'').trim();
  if(!v.startsWith('#')) v='#'+v;
  if(/^#[0-9a-f]{3}$/i.test(v)) v='#'+v[1]+v[1]+v[2]+v[2]+v[3]+v[3];
  return /^#[0-9a-f]{6}$/i.test(v)?v.toLowerCase():null;
}
/* ── conversões HSV <-> HEX (o seletor trabalha em HSV, o resto do app em hex) ── */
function hsvToRgb(h,s,v){
  const i=Math.floor(h*6), f=h*6-i, p=v*(1-s), q=v*(1-f*s), t=v*(1-(1-f)*s);
  let r,g,b;
  switch(i%6){case 0:r=v;g=t;b=p;break;case 1:r=q;g=v;b=p;break;case 2:r=p;g=v;b=t;break;
              case 3:r=p;g=q;b=v;break;case 4:r=t;g=p;b=v;break;default:r=v;g=p;b=q;}
  return [Math.round(r*255),Math.round(g*255),Math.round(b*255)];
}
function rgbToHsv(r,g,b){
  r/=255;g/=255;b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
  let h=0;
  if(d){ if(mx===r)h=((g-b)/d+(g<b?6:0))/6; else if(mx===g)h=((b-r)/d+2)/6; else h=((r-g)/d+4)/6; }
  return [h, mx?d/mx:0, mx];
}
function rgbToHex(r,g,b){ return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function hsvHex(){ const [r,g,b]=hsvToRgb(_cpickH,_cpickS,_cpickV); return rgbToHex(r,g,b); }

function toggleColorPicker(){
  _cpickOpen=!_cpickOpen;
  const el=$('cpick'); if(el) el.classList.toggle('on',_cpickOpen);
  const b=$('pvCustomBtn'); if(b) b.classList.toggle('on',_cpickOpen);
  if(_cpickOpen) syncPickerFromColor(U.color||'#c45c5c');
}
function syncPickerFromColor(hex){
  const h=normHex(hex)||'#c45c5c';
  const [r,g,b]=hexToRgb(h);
  [_cpickH,_cpickS,_cpickV]=rgbToHsv(r,g,b);
  updatePickerUI();
}
function updatePickerUI(){
  const sv=$('cpickSV'); if(sv) sv.style.setProperty('--hue',Math.round(_cpickH*360));
  const cur=$('cpickCursor');
  if(cur){ cur.style.left=(_cpickS*100)+'%'; cur.style.top=((1-_cpickV)*100)+'%'; cur.style.background=hsvHex(); }
  const hc=$('cpickHueCursor'); if(hc) hc.style.left=(_cpickH*100)+'%';
  const pv=$('cpickPrev'); if(pv) pv.style.background=hsvHex();
}
function initColorPicker(){
  const sv=$('cpickSV'), hue=$('cpickHue');
  if(sv&&!sv.dataset.ready){
    sv.dataset.ready='1';
    const pick=e=>{
      const r=sv.getBoundingClientRect();
      _cpickS=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
      _cpickV=Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height));
      updatePickerUI(); applyProfileColor(hsvHex(),true);
    };
    let d=false;
    sv.addEventListener('pointerdown',e=>{d=true;try{sv.setPointerCapture(e.pointerId);}catch(_){}pick(e);e.preventDefault();});
    sv.addEventListener('pointermove',e=>{if(d)pick(e);});
    sv.addEventListener('pointerup',()=>d=false);
    sv.addEventListener('pointercancel',()=>d=false);
  }
  if(hue&&!hue.dataset.ready){
    hue.dataset.ready='1';
    const pick=e=>{
      const r=hue.getBoundingClientRect();
      _cpickH=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
      updatePickerUI(); applyProfileColor(hsvHex(),true);
    };
    let d=false;
    hue.addEventListener('pointerdown',e=>{d=true;try{hue.setPointerCapture(e.pointerId);}catch(_){}pick(e);e.preventDefault();});
    hue.addEventListener('pointermove',e=>{if(d)pick(e);});
    hue.addEventListener('pointerup',()=>d=false);
    hue.addEventListener('pointercancel',()=>d=false);
  }
}
function onHexTyped(v,force){
  const hex=normHex(v);
  if(!hex){ if(force) toast('Cor inválida — use algo como #7fc8a9','err'); return; }
  applyProfileColor(hex);
  syncPickerFromColor(hex);
}
/* fonte única de verdade da cor escolhida */
function applyProfileColor(hex,fromPicker){
  const c=normHex(hex); if(!c) return;
  U.color=c;
  const hx=$('profColorHex'); if(hx&&document.activeElement!==hx) hx.value=c;
  const dot=$('pvCustomDot'); if(dot) dot.style.background=c;
  const lbl=$('pvCustomHex'); if(lbl) lbl.textContent=c;
  document.querySelectorAll('#pvSwatches i').forEach(i=>i.classList.toggle('on',i.dataset.c===c));
  if(!fromPicker) syncPickerFromColor(c);
  renderProfilePreview();
}
/* ══════════════════════════════════════════════════════════════════
   COR DO NOME — independente da cor do card.
   "Automática" escolhe sozinha um tom legível sobre o fundo escolhido;
   "Própria" libera qualquer cor, e nesse caso avisamos quando o contraste
   contra o card ficar baixo demais (o nome sumiria no fundo).
   ══════════════════════════════════════════════════════════════════ */
let _ncH=0,_ncS=0,_ncV=1,_ncOpen=false;
function initNameColorUI(){
  const sw=$('pvNameSwatches');
  if(sw&&!sw.dataset.ready){
    sw.dataset.ready='1';
    const pal=['#ffffff','#f2e6c8','#ffd579','#f5a8c8','#ff8f6b','#7fc8a9','#4ade80','#8ab4f5',
               '#b79ae0','#eb459e','#e0a35c','#9aa4b0'];
    sw.innerHTML=pal.map(c=>`<i data-c="${c}" style="background:${c}" title="${c}"></i>`).join('');
    sw.addEventListener('click',e=>{ const i=e.target.closest('i'); if(i) applyNameColor(i.dataset.c); });
  }
  const sv=$('ncpickSV'), hue=$('ncpickHue');
  if(sv&&!sv.dataset.ready){
    sv.dataset.ready='1';
    const pick=e=>{ const r=sv.getBoundingClientRect();
      _ncS=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
      _ncV=Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height));
      updateNamePickerUI(); applyNameColor(ncHex(),true); };
    let d=false;
    sv.addEventListener('pointerdown',e=>{d=true;try{sv.setPointerCapture(e.pointerId);}catch(_){}pick(e);e.preventDefault();});
    sv.addEventListener('pointermove',e=>{if(d)pick(e);});
    sv.addEventListener('pointerup',()=>d=false); sv.addEventListener('pointercancel',()=>d=false);
  }
  if(hue&&!hue.dataset.ready){
    hue.dataset.ready='1';
    const pick=e=>{ const r=hue.getBoundingClientRect();
      _ncH=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
      updateNamePickerUI(); applyNameColor(ncHex(),true); };
    let d=false;
    hue.addEventListener('pointerdown',e=>{d=true;try{hue.setPointerCapture(e.pointerId);}catch(_){}pick(e);e.preventDefault();});
    hue.addEventListener('pointermove',e=>{if(d)pick(e);});
    hue.addEventListener('pointerup',()=>d=false); hue.addEventListener('pointercancel',()=>d=false);
  }
}
function ncHex(){ const [r,g,b]=hsvToRgb(_ncH,_ncS,_ncV); return rgbToHex(r,g,b); }
function toggleNameColorPicker(){
  _ncOpen=!_ncOpen;
  const el=$('ncpick'); if(el) el.classList.toggle('on',_ncOpen);
  const b=$('pvNameCustomBtn'); if(b) b.classList.toggle('on',_ncOpen);
  if(_ncOpen) syncNamePicker(U.name_color||'#ffffff');
}
function syncNamePicker(hex){
  const h=normHex(hex)||'#ffffff';
  const [r,g,b]=hexToRgb(h);
  [_ncH,_ncS,_ncV]=rgbToHsv(r,g,b);
  updateNamePickerUI();
}
function updateNamePickerUI(){
  const sv=$('ncpickSV'); if(sv) sv.style.setProperty('--hue',Math.round(_ncH*360));
  const cur=$('ncpickCursor');
  if(cur){ cur.style.left=(_ncS*100)+'%'; cur.style.top=((1-_ncV)*100)+'%'; cur.style.background=ncHex(); }
  const hc=$('ncpickHueCursor'); if(hc) hc.style.left=(_ncH*100)+'%';
  const pv=$('ncpickPrev'); if(pv) pv.style.background=ncHex();
}
function onNameHexTyped(v,force){
  const hex=normHex(v);
  if(!hex){ if(force) toast('Cor inválida — use algo como #ffd579','err'); return; }
  applyNameColor(hex); syncNamePicker(hex);
}
function applyNameColor(hex,fromPicker){
  const c=normHex(hex); if(!c) return;
  U.name_color=c;
  const hx=$('nameColorHex'); if(hx&&document.activeElement!==hx) hx.value=c;
  const dot=$('pvNameDot'); if(dot) dot.style.background=c;
  const lbl=$('pvNameHex'); if(lbl) lbl.textContent=c;
  document.querySelectorAll('#pvNameSwatches i').forEach(i=>i.classList.toggle('on',i.dataset.c===c));
  if(!fromPicker) syncNamePicker(c);
  renderProfilePreview();
}
function setNameColorMode(mode){
  U.name_mode=mode;
  document.querySelectorAll('#nameSeg .tint-opt').forEach(o=>o.classList.toggle('on',o.dataset.nc===mode));
  document.querySelectorAll('.nc-only').forEach(el=>el.style.display=(mode==='custom')?'':'none');
  if(mode==='custom' && !U.name_color) applyNameColor(autoNameColor());
  renderProfilePreview();
}
/* luminância relativa (WCAG) — base para medir contraste de verdade */
function luminance(r,g,b){
  const f=v=>{ v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); };
  return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);
}
function contrastRatio(c1,c2){
  const L1=luminance(...hexToRgb(c1)), L2=luminance(...hexToRgb(c2));
  const a=Math.max(L1,L2), b=Math.min(L1,L2);
  return (a+0.05)/(b+0.05);
}
/* cor de fundo efetiva do card, para calcular contraste do nome */
function effectiveCardBg(){
  const mode=tintMode(U.card_tint), c=normHex(U.color)||'#c45c5c';
  if(mode==='solid') return c;
  if(mode==='soft'){ // mistura ~30% da cor sobre o fundo escuro do app
    const [r,g,b]=hexToRgb(c);
    return rgbToHex(Math.round(r*.3+10*.7),Math.round(g*.3+12*.7),Math.round(b*.3+11*.7));
  }
  return '#0b0d0c';
}
/* escolhe automaticamente um tom legível sobre o card */
function autoNameColor(){
  const bg=effectiveCardBg();
  return contrastRatio('#ffffff',bg) >= contrastRatio('#12140f',bg) ? '#f5f0e6' : '#12140f';
}
function currentNameColor(){
  return (U.name_mode==='custom' && normHex(U.name_color)) ? normHex(U.name_color) : autoNameColor();
}
/* avisa quando a cor escolhida some no fundo — em vez de bloquear, informa */
function updateNameContrastWarning(){
  const w=$('ncWarn'); if(!w) return;
  if(U.name_mode!=='custom'){ w.textContent=''; w.classList.remove('on'); return; }
  const ratio=contrastRatio(currentNameColor(),effectiveCardBg());
  if(ratio<2.2){ w.textContent='Contraste muito baixo — o nome quase some no card.'; w.classList.add('on','bad'); }
  else if(ratio<3.5){ w.textContent='Contraste baixo; considere um tom mais claro ou escuro.'; w.classList.add('on'); w.classList.remove('bad'); }
  else { w.textContent=''; w.classList.remove('on','bad'); }
}
function setCardTint(mode){
  U.card_tint=mode;
  document.querySelectorAll('.tint-opt').forEach(o=>o.classList.toggle('on',o.dataset.tint===mode));
  renderProfilePreview();
}
/* Converte o valor guardado (que já foi booleano) para os três modos atuais. */
function tintMode(v){
  if(v===true) return 'soft';
  if(v===false||v==null) return 'none';
  return ['none','soft','solid'].includes(v)?v:'none';
}
/* Monta o fundo do card conforme o modo — usado tanto na prévia quanto no perfil real. */
function tintBackground(mode,r,g,b){
  if(mode==='solid') return `linear-gradient(165deg,rgb(${r},${g},${b}),rgb(${Math.round(r*.55)},${Math.round(g*.55)},${Math.round(b*.55)}))`;
  if(mode==='soft')  return `linear-gradient(160deg,rgba(${r},${g},${b},.30),rgba(${r},${g},${b},.10) 55%,rgba(10,12,11,.96))`;
  return 'linear-gradient(160deg,rgba(255,255,255,.045),rgba(10,12,11,.96))';
}
function renderProfilePreview(){
  const card=$('pvCard'); if(!card) return;
  const color=normHex(U.color)||'#c45c5c';
  const [r,g,b]=hexToRgb(color);
  const mode=tintMode(U.card_tint);
  card.style.background=tintBackground(mode,r,g,b);
  card.style.borderColor=`rgba(${r},${g},${b},.45)`;
  card.style.boxShadow=`0 12px 34px rgba(0,0,0,.5),0 0 0 1px rgba(${r},${g},${b},.18)`;
  const glow=$('pvGlow');
  if(glow) glow.style.background = mode==='solid' ? 'none'
    : `radial-gradient(circle at 22% 0%,rgba(${r},${g},${b},.35),transparent 62%)`;
  const bn=$('pvBanner');
  if(bn) bn.style.background=U.banner?`url('${U.banner}') center/cover`
    :`linear-gradient(100deg,rgba(${r},${g},${b},.75),rgba(${r},${g},${b},.25))`;
  const av=$('pvAv'); if(av) av.innerHTML=avatarHTML(U);
  const nm=$('pvName');
  if(nm){ nm.textContent=($('sNm')&&$('sNm').value.trim())||U.name||'Seu nome'; nm.style.color=currentNameColor(); }
  updateNameContrastWarning();
  const un=$('pvUname'); const uv=($('sUname')&&$('sUname').value.trim())||U.username||'';
  if(un) un.textContent=uv?('@'+uv):'';
  const bio=$('pvBio'); if(bio) bio.textContent=($('sBio')&&$('sBio').value.trim())||U.bio||'';
}
function closeSettings(){ $('settingsPanel').classList.remove('on'); }
function handleSPhoto(input){
  const f=input.files[0]; if(!f)return;
  const r=new FileReader(); r.onload=e=>openCropModal(e.target.result,f.type||'image/png','settings'); r.readAsDataURL(f);
  input.value='';
}
function handleSBanner(input){
  const f=input.files[0]; if(!f)return;
  const r=new FileReader(); r.onload=e=>openCropModal(e.target.result,f.type||'image/png','banner','rect'); r.readAsDataURL(f);
  input.value='';
}
