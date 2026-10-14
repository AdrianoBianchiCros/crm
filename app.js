const STAGES=[
  {id:'novo',label:'Novo'},{id:'contatado',label:'Contatado'},{id:'respondeu',label:'Respondeu'},
  {id:'reuniao',label:'Reunião'},{id:'proposta',label:'Proposta'},{id:'fechado',label:'Fechado'},{id:'perdido',label:'Perdido'}];
const STAGE_LABEL=Object.fromEntries(STAGES.map(s=>[s.id,s.label]));
const TYPES={
  sem_site:{label:'Sem site',tpl:"Olá, {primeiro}! Tudo bem? Encontrei vocês no Google: {avaliacoesTxt} Reparei que ainda não há um site próprio. Hoje, quem procura massagem em Guarulhos compara pelo Google e acaba agendando com quem tem uma página clara, com serviços, valores e botão de WhatsApp. Eu crio sites que transformam visitas em clientes. Posso te mostrar em 2 minutos como ficaria o seu?"},
  link_quebrado:{label:'Link quebrado',tpl:"Olá, {primeiro}! Tudo bem? Estava pesquisando massoterapia em Guarulhos e vi a ficha de vocês no Google. {avaliacoesTxt} Só que o link de site que aparece ali leva para uma página que não funciona (ou que não é de vocês). Quem clica cai num erro e pode desistir de agendar. Eu crio sites que transformam visitas em clientes e resolvo isso rápido. Posso te mandar uma ideia de como ficaria?"},
  so_social:{label:'Só redes sociais',tpl:"Olá, {primeiro}! Tudo bem? Vi o trabalho de vocês no Google e no Instagram. {avaliacoesTxt} Hoje o link da ficha leva só para a rede social. Funciona para quem já segue, mas quem busca no Google quer ver serviços, valores e agendar em um clique. Eu crio sites que transformam visitas em clientes. Posso te mostrar um modelo pensado para massoterapia?"},
  site_gratuito:{label:'Site gratuito',tpl:"Olá, {primeiro}! Tudo bem? Vi a ficha de vocês no Google. {avaliacoesTxt} Notei que o site está em um endereço gratuito (Wix, Canva, Google Sites ou parecido). Um domínio próprio passa mais confiança e aparece melhor nas buscas. Eu crio sites que transformam visitas em clientes. Posso te mostrar como ficaria com o nome de vocês?"},
  site_fraco:{label:'Site com problemas',tpl:"Olá, {primeiro}! Tudo bem? Dei uma olhada no site de vocês depois de ver a ficha no Google. {avaliacoesTxt} Notei alguns detalhes que podem estar custando agendamentos, como textos de exemplo esquecidos, links que não abrem e falta de depoimentos.\n\nTrabalho com criação de sites e landing pages profissionais para empresas que desejam aumentar sua visibilidade no Google e transformar visitantes em potenciais clientes.\n\nVi uma oportunidade de ajudar empresas como a sua a fortalecer sua presença digital.\n\nPosso te enviar uma ideia de como poderíamos fazer isso sem compromisso?\n\n🌐 https://abianchitech.com/"}
};
const HIST_TYPES=['WhatsApp','Ligação','E-mail','Reunião','Nota'];

const PAGE_SIZE=20;
let funilPage=1, importDup=0;
let db=null, downloads=null, leads=new Map(), loaded=false, view='funil', openId=null, pendingImport=null, waPendingId=null;
const writeQ=new Map();
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digits=s=>String(s||'').replace(/\D/g,'');
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const fmtDate=s=>{if(!s)return'';const [y,m,d]=s.slice(0,10).split('-');return d+'/'+m+(y!==String(new Date().getFullYear())?'/'+y:'')};
const fmtWhen=iso=>{try{return new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch(e){return iso}};
function toast(t){const el=$('#toast');el.textContent=t;el.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>el.hidden=true,2600)}
function getLS(k,d){try{return localStorage.getItem(k)??d}catch(e){return d}}
function setLS(k,v){try{localStorage.setItem(k,v)}catch(e){}}

function leadType(l){
  const o=(l.obs||'')+' '+(l.site||'');
  if(/link quebrado|inexistente|provavelmente morto|outra empresa|loja de cosm|erro ao carregar/i.test(o))return'link_quebrado';
  const s=(l.site||'').toLowerCase();
  if(!s||s.includes('wa.me'))return'sem_site';
  if(/instagram|facebook|linktr|linktree/.test(s))return'so_social';
  if(/wixsite|canva\.site|sites\.google|lovable\.app|netlify|meuairgo|itig\.com|negocio\.site/.test(s))return'site_gratuito';
  return'site_fraco';
}
const isHot=l=>(l.avaliacoes||0)>=100;
const dueState=l=>{if(!l.followup||['fechado','perdido'].includes(l.etapa))return null;const t=today();return l.followup<t?'atrasado':l.followup===t?'hoje':null};

function msgFor(l,type){
  const first=(l.nome||'').split(/[\s|–-]+/)[0];
  const av=l.avaliacoes?`${l.avaliacoes} avaliações${l.nota?' com nota '+String(l.nota).replace('.',','):''}, parabéns pelo trabalho!`:'';
  const sig=getLS('crm_sig','');
  return TYPES[type].tpl.replace('{primeiro}',first).replace('{avaliacoesTxt} ',av?av+' ':'').replace('{avaliacoesTxt}',av)+(sig?`\n\n${sig}`:'');
}

/* ---------- writes ---------- */
function writeDoc(id,patch){
  const prev=writeQ.get(id)||Promise.resolve();
  const p=prev.catch(()=>{}).then(()=>db.doc('leads/'+id).update(patch)).catch(e=>{toast(e.code==='invalid_argument'?'Você não tem permissão para editar este funil.':'Não foi possível salvar. Tente de novo.');throw e});
  writeQ.set(id,p);return p;
}
function addHist(id,tipo,texto,extra={}){
  const l=leads.get(id);if(!l)return;
  const historico=[...(l.historico||[]),{t:new Date().toISOString(),tipo,texto}];
  return writeDoc(id,{historico,...extra});
}
function setStage(id,etapa){
  const l=leads.get(id);if(!l||l.etapa===etapa)return;
  return addHist(id,'Etapa',`${STAGE_LABEL[l.etapa]||'—'} → ${STAGE_LABEL[etapa]}`,{etapa});
}

/* ---------- render ---------- */
function filtered(){
  const q=$('#q').value.trim().toLowerCase(), t=$('#fType').value, qd=digits(q);
  return [...leads.entries()].map(([id,l])=>({id,...l})).filter(l=>{
    if(t&&leadType(l)!==t)return false;
    if(!q)return true;
    return [l.nome,l.bairro,l.categoria,l.instagram,l.email].join(' ').toLowerCase().includes(q)||(qd.length>=4&&digits(l.telefone).includes(qd));
  }).sort((a,b)=>(b.canais||0)-(a.canais||0)||(b.avaliacoes||0)-(a.avaliacoes||0));
}
function renderStats(){
  const all=[...leads.values()];
  const by=s=>all.filter(l=>l.etapa===s).length;
  const due=all.filter(l=>dueState(l)).length;
  const late=all.filter(l=>dueState(l)==='atrasado').length;
  const active=all.filter(l=>['respondeu','reuniao','proposta'].includes(l.etapa)).length;
  $('#dueCount').textContent=due;
  $('#stats').innerHTML=[
    ['Leads',all.length],['Ainda não contatados',by('novo')],['Em conversa',active],
    ['Follow-ups para hoje',due,late?'alert':''],['Fechados',by('fechado')]
  ].map(([k,v,c])=>`<div class="stat ${c||''}"><b>${v}</b><span>${k}${k.startsWith('Follow')&&late?` · ${late} atrasado${late>1?'s':''}`:''}</span></div>`).join('');
}
function cardHtml(l){
  const ty=leadType(l), d=dueState(l);
  return `<div class="card" tabindex="0" draggable="true" data-id="${esc(l.id)}">
    <div class="name">${esc(l.nome)}</div>
    <div class="meta">${esc(l.bairro||'')}${l.avaliacoes?` · <span class="num">${l.avaliacoes}</span> aval.`:''}${l.seguidores?` · <span class="num">${Number(l.seguidores).toLocaleString('pt-BR')}</span> seg.`:''}</div>
    <div class="meta"><span class="chip acc">${TYPES[ty].label}</span>${isHot(l)?'<span class="chip hot">Quente</span>':''}${d?`<span class="chip due">${d==='atrasado'?'Atrasado':'Hoje'}</span>`:l.followup&&!['fechado','perdido'].includes(l.etapa)?`<span class="chip">Retorno ${fmtDate(l.followup)}</span>`:''}</div>
  </div>`;
}
function emptyHtml(){
  if(!loaded)return `<div class="empty"><h2>Carregando seus leads…</h2></div>`;
  if(!leads.size)return `<div class="empty"><h2>Nenhum lead no funil ainda</h2><p>Importe um CSV de prospecção (o mesmo formato da planilha do Apify) e cada lead entra na coluna <b>Novo</b>.</p><label class="btn primary" for="csvInput" style="flex-direction:row;font-size:14px;color:var(--accent-fg)">Importar CSV</label></div>`;
  return `<div class="empty"><h2>Nada encontrado</h2><p>Nenhum lead combina com a busca ou o filtro atual.</p></div>`;
}
function renderMain(){
  const list=filtered(), m=$('#main');
  if(!list.length&&view!=='hoje'){m.innerHTML=emptyHtml();return}
  if(view==='funil'){
    // 20 cards por coluna em cada página; o total no cabeçalho continua mostrando todos
    const cols=STAGES.map(s=>({s,items:list.filter(l=>(l.etapa||'novo')===s.id)}));
    const pages=Math.max(1,Math.ceil(Math.max(...cols.map(c=>c.items.length))/PAGE_SIZE));
    funilPage=Math.min(Math.max(1,funilPage),pages);
    const from=(funilPage-1)*PAGE_SIZE;
    m.innerHTML=`<div class="board">${cols.map(({s,items})=>
      `<section class="col" data-stage="${s.id}" aria-label="${s.label}"><h3>${s.label}<span class="n">${items.length}</span></h3>${items.slice(from,from+PAGE_SIZE).map(cardHtml).join('')}</section>`).join('')}</div>${pagerHtml(pages)}`;
    bindBoard();
    m.querySelectorAll('.pager [data-page]').forEach(b=>b.onclick=()=>{funilPage=Number(b.dataset.page);renderMain();m.scrollIntoView({block:'start',behavior:'smooth'})});
  }else if(view==='lista'){
    m.innerHTML=`<div class="tablewrap"><table><thead><tr><th>Lead</th><th>Etapa</th><th>Abordagem</th><th>Telefone</th><th>Instagram</th><th>Aval.</th><th>Retorno</th><th>Bairro</th></tr></thead><tbody>${list.map(l=>`<tr data-id="${esc(l.id)}" tabindex="0"><td><b>${esc(l.nome)}</b></td><td>${STAGE_LABEL[l.etapa]||'Novo'}</td><td><span class="chip acc">${TYPES[leadType(l)].label}</span></td><td class="num">${esc(l.telefone)}</td><td>${esc(l.instagram||'')}</td><td class="num">${l.avaliacoes??''}</td><td>${l.followup?`<span class="chip ${dueState(l)?'due':''}">${fmtDate(l.followup)}</span>`:''}</td><td>${esc(l.bairro||'')}</td></tr>`).join('')}</tbody></table></div>`;
    m.querySelectorAll('tr[data-id]').forEach(r=>{r.onclick=()=>openDrawer(r.dataset.id);r.onkeydown=e=>{if(e.key==='Enter')openDrawer(r.dataset.id)}});
  }else{
    const due=list.filter(l=>dueState(l)).sort((a,b)=>a.followup.localeCompare(b.followup));
    const next=list.filter(l=>l.followup&&!dueState(l)&&!['fechado','perdido'].includes(l.etapa)).sort((a,b)=>a.followup.localeCompare(b.followup)).slice(0,12);
    m.innerHTML=due.length||next.length?`<div style="display:flex;flex-direction:column;gap:14px">
      <h2 style="font-size:16px">Para hoje e atrasados (${due.length})</h2>
      ${due.length?`<div class="board" style="grid-auto-flow:row;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))">${due.map(cardHtml).join('')}</div>`:'<p class="sub">Nenhum retorno vencido. Bom trabalho.</p>'}
      ${next.length?`<h2 style="font-size:16px">Próximos retornos</h2><div class="board" style="grid-auto-flow:row;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))">${next.map(cardHtml).join('')}</div>`:''}
    </div>`:`<div class="empty"><h2>Nenhum follow-up agendado</h2><p>Abra um lead e defina a data de retorno. Ele aparece aqui no dia.</p></div>`;
    bindCards(m);
  }
}
function pagerHtml(pages){
  if(pages<2)return'';
  const nums=[...Array(pages)].map((_,i)=>i+1).filter(n=>n===1||n===pages||Math.abs(n-funilPage)<=2);
  let out='',prev=0;
  for(const n of nums){if(n-prev>1)out+='<span class="sub">…</span>';out+=`<button data-page="${n}" ${n===funilPage?'class="primary" aria-current="page"':''}>${n}</button>`;prev=n}
  return `<nav class="pager" aria-label="Páginas do funil"><button data-page="${funilPage-1}" ${funilPage===1?'disabled':''}>Anterior</button>${out}<button data-page="${funilPage+1}" ${funilPage===pages?'disabled':''}>Próxima</button></nav>`;
}
function bindCards(root){root.querySelectorAll('.card').forEach(c=>{c.onclick=()=>openDrawer(c.dataset.id);c.onkeydown=e=>{if(e.key==='Enter')openDrawer(c.dataset.id)}})}
function bindBoard(){
  const m=$('#main');bindCards(m);
  m.querySelectorAll('.card').forEach(c=>c.ondragstart=e=>{e.dataTransfer.setData('text/plain',c.dataset.id);e.dataTransfer.effectAllowed='move'});
  m.querySelectorAll('.col').forEach(col=>{
    col.ondragover=e=>{e.preventDefault();col.classList.add('drop')};
    col.ondragleave=()=>col.classList.remove('drop');
    col.ondrop=e=>{e.preventDefault();col.classList.remove('drop');const id=e.dataTransfer.getData('text/plain');if(id)setStage(id,col.dataset.stage)};
  });
}
function render(){renderStats();renderMain();if(openId)renderDrawer()}

/* ---------- drawer ---------- */
function openDrawer(id){openId=id;waPendingId=null;renderDrawer(true)}
function closeDrawer(){openId=null;$('#drawerRoot').innerHTML=''}
function renderDrawer(fresh){
  const l=leads.get(openId);if(!l){closeDrawer();return}
  const root=$('#drawerRoot');
  const keep=fresh?{}:{type:$('#msgType')?.value,msg:$('#msgText')?.value,note:$('#noteText')?.value,noteType:$('#noteType')?.value,scroll:root.querySelector('.drawer')?.scrollTop};
  const ty=keep.type||leadType(l), wa=digits(l.whatsapp||l.telefone), isCell=wa.length===13&&wa[4]==='9';
  const msg=keep.msg??msgFor(l,ty);
  const hist=[...(l.historico||[])].reverse();
  root.innerHTML=`<div class="scrim" id="scrim"></div><aside class="drawer" role="dialog" aria-label="${esc(l.nome)}">
    <header><div><h2>${esc(l.nome)}</h2><p class="sub">${esc(l.categoria||'')} · ${esc(l.bairro||'')}, ${esc(l.cidade||'')}</p></div><button id="closeD" aria-label="Fechar">Fechar</button></header>
    <div class="grid2">
      <label>Etapa<select id="dStage">${STAGES.map(s=>`<option value="${s.id}" ${s.id===(l.etapa||'novo')?'selected':''}>${s.label}</option>`).join('')}</select></label>
      <label>Próximo retorno<input type="date" id="dFollow" value="${esc(l.followup||'')}"></label>
    </div>
    ${l.obs?`<div class="argument"><b>Argumento de venda:</b> ${esc(l.obs)}</div>`:''}
    <div class="box"><h3>Contato</h3><dl>
      <dt>Telefone</dt><dd class="num">${esc(l.telefone||'—')} ${l.telefone?`<button class="ghost" data-copy="${esc(l.telefone)}" style="padding:2px 8px;font-size:12px">Copiar</button>`:''}</dd>
      <dt>WhatsApp</dt><dd>${isCell?`<span class="num">${esc(l.whatsapp||l.telefone)}</span> <span class="chip ${/confirm/i.test(l.waStatus||'')?'ok':''}">${esc(l.waStatus||'Provável (celular)')}</span>`:'Telefone fixo, sem WhatsApp provável'}</dd>
      <dt>E-mail</dt><dd>${l.email?esc(l.email)+` <button class="ghost" data-copy="${esc(l.email)}" style="padding:2px 8px;font-size:12px">Copiar</button>`:'—'}</dd>
      <dt>Instagram</dt><dd>${l.instagram?`<a href="https://instagram.com/${esc(l.instagram.replace('@',''))}" target="_blank" rel="noopener">${esc(l.instagram)}</a>${l.seguidores?` · <span class="num">${Number(l.seguidores).toLocaleString('pt-BR')}</span> seguidores`:''}`:'—'}</dd>
      <dt>Site</dt><dd>${l.site?(/^\(/.test(l.site)?esc(l.site):`<a href="https://${esc(l.site.replace(/^https?:\/\//,'').split(' ')[0])}" target="_blank" rel="noopener">${esc(l.site)}</a>`):'Não tem'}</dd>
      <dt>Google</dt><dd>${l.avaliacoes?`<span class="num">${l.avaliacoes}</span> avaliações · nota <span class="num">${String(l.nota??'').replace('.',',')}</span>`:'Sem avaliações'}</dd>
      <dt>Atividade</dt><dd>${esc(l.atividade||'—')}</dd>
    </dl></div>
    <div class="box"><h3>Mensagem de WhatsApp</h3>
      <label>Abordagem<select id="msgType">${Object.entries(TYPES).map(([k,v])=>`<option value="${k}" ${k===ty?'selected':''}>${v.label}${k===leadType(l)?' (sugerida)':''}</option>`).join('')}</select></label>
      <textarea id="msgText" rows="7" aria-label="Mensagem">${esc(msg)}</textarea>
      <div class="row">
        ${isCell?`<a class="btn primary" id="waOpen" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Abrir no WhatsApp</a>`:''}
        <button id="copyMsg">Copiar mensagem</button>
      </div>
      <div id="waConfirm" class="banner" ${waPendingId===openId?'':'hidden'}><span>Enviou a mensagem?</span><button class="primary" id="waLog">Registrar envio${(l.etapa||'novo')==='novo'?' e mover para Contatado':''}</button></div>
    </div>
    <div class="box"><h3>Histórico</h3>
      <div class="grid2"><label>Tipo<select id="noteType">${HIST_TYPES.map(t=>`<option ${t===(keep.noteType||'Nota')?'selected':''}>${t}</option>`).join('')}</select></label><span></span></div>
      <textarea id="noteText" rows="3" placeholder="O que aconteceu neste contato?" aria-label="Registro">${esc(keep.note||'')}</textarea>
      <div class="row"><button class="primary" id="addNote">Adicionar registro</button></div>
      ${hist.length?`<ul class="hist">${hist.map(h=>`<li><div class="when">${fmtWhen(h.t)} · ${esc(h.tipo)}</div><div>${esc(h.texto)}</div></li>`).join('')}</ul>`:'<p class="sub">Nenhum contato registrado ainda.</p>'}
    </div>
    <button id="delLead" class="ghost" style="align-self:flex-start;color:var(--bad)">Remover lead</button>
    <div id="delConfirm" class="notice" hidden>Remover este lead e todo o histórico? <div class="row" style="margin-top:8px"><button id="delYes" style="color:var(--bad)">Remover</button><button id="delNo">Cancelar</button></div></div>
  </aside>`;
  const dr=root.querySelector('.drawer'); if(keep.scroll)dr.scrollTop=keep.scroll;
  $('#scrim').onclick=closeDrawer;$('#closeD').onclick=closeDrawer;
  $('#dStage').onchange=e=>setStage(openId,e.target.value);
  $('#dFollow').onchange=e=>{const v=e.target.value;addHist(openId,'Retorno',v?`Retorno agendado para ${fmtDate(v)}`:'Retorno removido',{followup:v})};
  $('#msgType').onchange=e=>{$('#msgText').value=msgFor(l,e.target.value);syncWa()};
  $('#msgText').oninput=syncWa;
  function syncWa(){const a=$('#waOpen');if(a)a.href=`https://wa.me/${wa}?text=${encodeURIComponent($('#msgText').value)}`}
  const wo=$('#waOpen');if(wo)wo.onclick=()=>{waPendingId=openId;$('#waConfirm').hidden=false};
  $('#waLog').onclick=async()=>{const id=openId, cur=leads.get(id);waPendingId=null;
    await addHist(id,'WhatsApp',`Mensagem enviada (${TYPES[$('#msgType').value].label})`,(cur.etapa||'novo')==='novo'?{etapa:'contatado'}:{});toast('Envio registrado')};
  $('#copyMsg').onclick=()=>copy($('#msgText').value,$('#msgText'));
  dr.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>copy(b.dataset.copy));
  $('#addNote').onclick=async()=>{const t=$('#noteText').value.trim();if(!t){$('#noteText').focus();return}
    const tp=$('#noteType').value;$('#noteText').value='';await addHist(openId,tp,t);toast('Registro adicionado')};
  $('#delLead').onclick=()=>{$('#delConfirm').hidden=false};
  $('#delNo').onclick=()=>{$('#delConfirm').hidden=true};
  $('#delYes').onclick=async()=>{const id=openId;closeDrawer();try{await db.doc('leads/'+id).delete();toast('Lead removido')}catch(e){toast('Não foi possível remover.')}};
}
async function copy(text,selEl){
  try{await navigator.clipboard.writeText(text);toast('Copiado')}
  catch(e){if(selEl){selEl.focus();selEl.select()}toast('Selecione o texto e copie manualmente')}
}

/* ---------- CSV import ---------- */
function parseCSV(text){
  text=text.replace(/^﻿/,'');
  const first=text.split(/\r?\n/)[0]; const delim=(first.split(';').length>first.split(',').length)?';':',';
  const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"')q=true;
    else if(c===delim){row.push(f);f=''}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(f);rows.push(row);row=[];f=''}
    else f+=c}
  if(f||row.length){row.push(f);rows.push(row)}
  return rows.filter(r=>r.some(x=>x.trim()));
}
const norm=s=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
const MAP={nome:['nome do negocio / profissional','nome','name','title','empresa'],categoria:['nicho / categoria (google)','categoria','nicho','categoryname'],
  telefone:['telefone','phone','fone','celular'],whatsapp:['whatsapp'],waStatus:['status whatsapp'],email:['e-mail','email','emails'],instagram:['instagram'],
  site:['site / landing page','site','website'],cidade:['cidade / estado','cidade','city'],bairro:['bairro','neighborhood'],atividade:['tempo de atividade estimado','atividade'],
  seguidores:['seguidores (instagram)','seguidores','followerscount'],avaliacoes:['avaliacoes (google)','avaliacoes','reviewscount'],nota:['nota media (google)','nota','totalscore'],
  canais:['canais de contato'],obs:['observacao (argumento de venda)','observacao','obs','observacoes']};
function num(v){if(v==null||v==='')return null;const n=parseFloat(String(v).replace(',','.'));return isNaN(n)?null:n}
// Chave de duplicidade: nome + Instagram; sem Instagram, nome + site; sem os dois, nome + telefone.
function dupKey(l){
  const nome=norm(l.nome||'').replace(/[^a-z0-9]+/g,' ').trim();
  const ig=String(l.instagram||'').toLowerCase().replace(/^https?:\/\/(www\.)?instagram\.com\//,'').replace(/^@/,'').replace(/[/?#].*$/,'').trim();
  if(ig)return nome+'|ig:'+ig;
  const site=String(l.site||'').toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/[?#].*$/,'').replace(/\/+$/,'').trim();
  if(site)return nome+'|site:'+site;
  let tel=digits(l.telefone||l.whatsapp);if(tel.length>=12&&tel.startsWith('55'))tel=tel.slice(2);
  return nome+'|tel:'+tel;
}
function prepImport(text){
  const rows=parseCSV(text);if(rows.length<2)return{error:'O arquivo não tem linhas de dados.'};
  const head=rows[0].map(norm), idx={};
  for(const [k,names] of Object.entries(MAP)){const i=head.findIndex(h=>names.includes(h));if(i>=0)idx[k]=i}
  if(idx.nome==null)return{error:'Não encontrei a coluna de nome. Use um cabeçalho como "Nome" ou "Nome do negócio / profissional".'};
  const fresh=[],dup=[],bad=[];const seen=new Set([...leads.values()].map(dupKey)), ids=new Set();
  for(const r of rows.slice(1)){
    const g=k=>idx[k]!=null?(r[idx[k]]||'').trim():'';
    const nome=g('nome');if(!nome){bad.push(r);continue}
    const tel=g('telefone');
    let ig=g('instagram');if(ig&&!ig.startsWith('@'))ig='@'+ig.replace(/^https?:\/\/(www\.)?instagram\.com\//,'').replace(/\/.*$/,'');
    const l={nome,categoria:g('categoria'),telefone:tel,whatsapp:g('whatsapp'),waStatus:g('waStatus'),email:g('email'),instagram:ig,site:g('site'),
      cidade:g('cidade')||'Guarulhos / SP',bairro:g('bairro'),atividade:g('atividade'),seguidores:num(g('seguidores')),avaliacoes:num(g('avaliacoes')),nota:num(g('nota')),
      obs:g('obs'),etapa:'novo',followup:'',historico:[{t:new Date().toISOString(),tipo:'Importação',texto:'Lead importado de CSV'}],criadoEm:new Date().toISOString()};
    const key=dupKey(l);if(seen.has(key)){dup.push(nome);continue}seen.add(key);
    // mesmo telefone com outro nome é lead diferente: garante um id que não sobrescreve ninguém
    const base=digits(tel)||('n-'+norm(nome).replace(/[^a-z0-9]+/g,'-').slice(0,60));let id=base,n=2;
    while(leads.has(id)||ids.has(id))id=base+'-'+n++;ids.add(id);
    l.canais=num(g('canais'))??[l.telefone,l.email,l.instagram,l.whatsapp].filter(Boolean).length;
    fresh.push({id,l});
  }
  return{fresh,dup,bad};
}
$('#csvInput').onchange=e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  if(!db){toast('O funil ainda não conectou ao armazenamento.');return}
  const fr=new FileReader();
  fr.onload=()=>{const r=prepImport(String(fr.result));const b=$('#importBanner');b.hidden=false;
    if(r.error){b.innerHTML=`<span>${esc(r.error)}</span><button id="impClose">Fechar</button>`;$('#impClose').onclick=()=>b.hidden=true;return}
    if(!r.fresh.length&&r.dup.length){b.innerHTML=`<span>Identificado${r.dup.length===1?'':'s'} <b>${r.dup.length}</b> lead${r.dup.length===1?'':'s'} já importado${r.dup.length===1?'':'s'}. Foram importados <b class="num">0/${r.dup.length}</b>.</span><button id="impClose">Fechar</button>`;$('#impClose').onclick=()=>b.hidden=true;return}
    pendingImport=r.fresh;importDup=r.dup.length;
    b.innerHTML=`<span><b>${esc(file.name)}</b>: ${r.fresh.length} lead${r.fresh.length===1?'':'s'} novo${r.fresh.length===1?'':'s'}${r.dup.length?`, ${r.dup.length} já importado${r.dup.length===1?'':'s'} (serão ignorados)`:''}${r.bad.length?`, ${r.bad.length} linha(s) sem nome`:''}.</span>
      <span class="row">${r.fresh.length?`<button class="primary" id="impGo">Importar ${r.fresh.length}</button>`:''}<button id="impClose">Cancelar</button></span>`;
    $('#impClose').onclick=()=>{b.hidden=true;pendingImport=null};
    const go=$('#impGo');if(go)go.onclick=runImport;
  };
  fr.readAsText(file,'utf-8');
};
async function runImport(){
  const items=pendingImport||[];pendingImport=null;const b=$('#importBanner');let ok=0,fail=0;
  for(const {id,l} of items){b.innerHTML=`<span>Importando ${ok+fail+1} de ${items.length}…</span>`;
    try{await db.doc('leads/'+id).set(l);ok++}catch(e){fail++;if(e.code==='quota_exceeded'){b.innerHTML=`<span>O armazenamento do funil está cheio. Remova leads antigos e tente de novo.</span>`;return}}}
  const total=items.length+importDup;
  b.innerHTML=`<span>${importDup?`Identificado${importDup===1?'':'s'} <b>${importDup}</b> lead${importDup===1?'':'s'} já importado${importDup===1?'':'s'}. `:''}Foram importados <b class="num">${ok}/${total}</b>${fail?`, ${fail} com erro`:''}.</span><button id="impClose">Fechar</button>`;
  $('#impClose').onclick=()=>b.hidden=true;
}

/* ---------- export ---------- */
$('#exportBtn').onclick=async()=>{
  const cols=['nome','categoria','etapa','followup','telefone','whatsapp','email','instagram','site','bairro','cidade','avaliacoes','nota','seguidores','obs','ultimo_registro'];
  const q=v=>{const s=String(v??'');return /[;"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
  const lines=[cols.join(';')].concat([...leads.values()].map(l=>{const h=(l.historico||[]).slice(-1)[0];
    return cols.map(c=>c==='etapa'?STAGE_LABEL[l.etapa]||'':c==='ultimo_registro'?(h?fmtWhen(h.t)+' '+h.tipo+': '+h.texto:''):l[c]).map(q).join(';')}));
  try{await downloads.save({filename:'funil-prospeccao-'+today()+'.csv',data:'﻿'+lines.join('\n')});toast('Arquivo salvo')}
  catch(e){if(e.code!=='declined')toast('Não foi possível gerar o arquivo aqui.')}
};

/* ---------- settings ---------- */
$('#settingsBtn').onclick=()=>{
  const b=$('#importBanner');b.hidden=false;
  b.innerHTML=`<label style="flex:1;min-width:240px">Assinatura no fim das mensagens<input id="sigIn" value="${esc(getLS('crm_sig',''))}" placeholder="Ex.: Ana · TV1 Software House · tv1.com.br"></label><span class="row"><button class="primary" id="sigSave">Salvar</button><button id="sigClose">Fechar</button></span>`;
  $('#sigSave').onclick=()=>{setLS('crm_sig',$('#sigIn').value.trim());b.hidden=true;toast('Assinatura salva neste navegador');if(openId)renderDrawer(true)};
  $('#sigClose').onclick=()=>b.hidden=true;
};

/* ---------- boot ---------- */
Object.entries(TYPES).forEach(([k,v])=>$('#fType').insertAdjacentHTML('beforeend',`<option value="${k}">${v.label}</option>`));
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{view=t.dataset.view;document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected',x===t));renderMain()});
$('#q').oninput=$('#fType').onchange=()=>{funilPage=1;renderMain()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&openId)closeDrawer()});
render();
/* ---------- backend PHP/MySQL ---------- */
async function api(a,body){
  const r=await fetch('api.php?a='+a,{method:body?'POST':'GET',credentials:'same-origin',
    headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));
  if(r.status===401&&!['login','setup'].includes(a))showLogin(false);
  if(!r.ok){const e=new Error(j.error||'Erro');e.code=r.status;throw e}
  return j;
}
async function refresh(){
  const j=await api('list');
  leads=new Map(j.leads.map(({id,...l})=>[id,{...l,etapa:l.etapa||'novo'}]));loaded=true;render();
}
const localDb={
  doc(path){const id=path.replace(/^leads\//,'');return{
    set:d=>api('set',{id,data:d}).then(()=>{leads.set(id,{...d});render()}),
    update:p=>api('update',{id,data:p}).then(()=>{const l=leads.get(id);if(l)leads.set(id,{...l,...p});render()}),
    delete:()=>api('delete',{id}).then(()=>{leads.delete(id);render()})
  }}
};
downloads={save:async({filename,data})=>{
  const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}};
/* ---------- login ---------- */
let me=null;
function showLogin(setup,msg){
  db=null;me=null;leads=new Map();closeDrawer();
  document.body.classList.add('locked');
  $('#authRoot').innerHTML=`<div class="auth"><form class="authbox" id="authForm" novalidate>
    <div><h1>Funil de Prospecção</h1>
    <p class="sub">${setup?'Primeiro acesso: crie o usuário administrador.':'Entre com seu usuário e senha.'}</p></div>
    ${setup?'<label>Seu nome<input id="aNome" autocomplete="name" required></label>':''}
    <label>Usuário<input id="aUser" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
    <label>Senha<span class="pwrow"><input type="password" id="aPass" autocomplete="${setup?'new-password':'current-password'}" required><button type="button" class="ghost" id="aShow" aria-label="Mostrar senha">Mostrar</button></span></label>
    ${setup?'<label>Confirmar senha<input type="password" id="aPass2" autocomplete="new-password" required></label><p class="sub" style="margin:0">Mínimo de 8 caracteres.</p>':''}
    <div id="aErr" class="notice" role="alert" ${msg?'':'hidden'}>${esc(msg||'')}</div>
    <button class="primary" type="submit" id="aGo">${setup?'Criar e entrar':'Entrar'}</button>
  </form></div>`;
  (setup?$('#aNome'):$('#aUser')).focus();
  $('#aShow').onclick=()=>{const p=$('#aPass'),s=p.type==='password';p.type=s?'text':'password';$('#aShow').textContent=s?'Ocultar':'Mostrar'};
  $('#authForm').onsubmit=async e=>{e.preventDefault();
    const err=t=>{$('#aErr').textContent=t;$('#aErr').hidden=false};
    const usuario=$('#aUser').value.trim(), senha=$('#aPass').value;
    if(setup&&!$('#aNome').value.trim())return err('Informe seu nome.');
    if(!usuario||!senha)return err('Preencha usuário e senha.');
    if(setup&&senha!==$('#aPass2').value)return err('As senhas não conferem.');
    const go=$('#aGo');go.disabled=true;go.textContent='Entrando…';
    try{const j=await api(setup?'setup':'login',setup?{nome:$('#aNome').value.trim(),usuario,senha}:{usuario,senha});enter(j.user)}
    catch(x){go.disabled=false;go.textContent=setup?'Criar e entrar':'Entrar';err(x.message);$('#aPass').select()}
  };
}
async function enter(user){
  me=user;$('#authRoot').innerHTML='';document.body.classList.remove('locked');
  $('#userName').textContent=me.nome;
  try{await refresh();db=localDb}
  catch(e){if(e.code!==401){loaded=true;$('#notice').hidden=false;$('#notice').textContent=e.message||'Não foi possível carregar os leads.';render()}}
}
async function start(){
  try{const j=await api('me');j.user?enter(j.user):showLogin(j.setup)}
  catch(e){if(e.code!==401){document.body.classList.remove('locked');$('#notice').hidden=false;$('#notice').textContent=e.message||'Não foi possível conectar ao servidor.'}}
}
$('#logoutBtn').onclick=async()=>{await api('logout',{}).catch(()=>{});showLogin(false)};
$('#usersBtn').onclick=()=>{
  const b=$('#importBanner');b.hidden=false;
  b.innerHTML=`<div style="display:flex;flex-direction:column;gap:12px;flex:1">
    <form id="nuForm" class="row" style="align-items:flex-end"><b style="width:100%">Novo usuário</b>
      <label style="flex:1;min-width:150px">Nome<input id="nuNome" required></label>
      <label style="flex:1;min-width:130px">Usuário<input id="nuUser" autocapitalize="none" required></label>
      <label style="flex:1;min-width:130px">Senha (mín. 8)<input type="password" id="nuPass" autocomplete="new-password" required></label>
      <button class="primary">Criar</button></form>
    <form id="pwForm" class="row" style="align-items:flex-end"><b style="width:100%">Trocar minha senha (${esc(me.usuario)})</b>
      <label style="flex:1;min-width:150px">Senha atual<input type="password" id="pwOld" autocomplete="current-password" required></label>
      <label style="flex:1;min-width:150px">Nova senha<input type="password" id="pwNew" autocomplete="new-password" required></label>
      <button>Trocar senha</button><button type="button" id="usClose" class="ghost">Fechar</button></form></div>`;
  $('#usClose').onclick=()=>b.hidden=true;
  $('#nuForm').onsubmit=async e=>{e.preventDefault();
    try{const j=await api('add_user',{nome:$('#nuNome').value.trim(),usuario:$('#nuUser').value.trim(),senha:$('#nuPass').value});
      toast(`Usuário ${j.user.usuario} criado`);e.target.reset()}catch(x){toast(x.message)}};
  $('#pwForm').onsubmit=async e=>{e.preventDefault();
    try{await api('change_password',{atual:$('#pwOld').value,nova:$('#pwNew').value});toast('Senha alterada');e.target.reset()}catch(x){toast(x.message)}};
};
/* ---------- prompts salvos ---------- */
let prompts=[], promptSel=null;
async function openPrompts(selId){
  closeDrawer();
  try{prompts=(await api('prompts')).prompts}catch(x){toast(x.message);return}
  promptSel=selId!==undefined?selId:(prompts.find(p=>p.id===promptSel)?promptSel:prompts[0]?.id??null);
  renderPrompts();
}
function renderPrompts(){
  const p=prompts.find(x=>x.id===promptSel)||{id:null,titulo:'',texto:''};
  $('#drawerRoot').innerHTML=`<div class="scrim" id="scrim"></div><aside class="drawer" role="dialog" aria-label="Prompts">
    <header><div><h2>Prompts</h2><p class="sub">Salvos no servidor, disponíveis para todos os usuários.</p></div><button id="closeD">Fechar</button></header>
    <div class="row"><select id="pSel" aria-label="Prompt salvo" style="flex:1;min-width:180px">
      ${prompts.map(x=>`<option value="${x.id}" ${x.id===p.id?'selected':''}>${esc(x.titulo)}</option>`).join('')}
      ${p.id?'':'<option selected>(novo prompt)</option>'}</select><button id="pNew">Novo prompt</button></div>
    <div class="box">
      <label>Título<input id="pTitle" value="${esc(p.titulo)}" placeholder="Ex.: Prospecção com Apify"></label>
      <label>Prompt<textarea id="pText" style="min-height:50vh;font-family:var(--f-mono);font-size:12px">${esc(p.texto)}</textarea></label>
      <div class="row"><button class="primary" id="pCopy">Copiar</button><button id="pSave">Salvar</button>
        ${p.id?'<button id="pDel" class="ghost" style="margin-left:auto;color:var(--bad)">Excluir</button>':''}</div>
      ${p.atualizado_em?`<p class="sub" style="margin:0">Atualizado em ${fmtWhen(p.atualizado_em)}</p>`:''}
    </div></aside>`;
  const close=()=>$('#drawerRoot').innerHTML='';
  $('#scrim').onclick=close;$('#closeD').onclick=close;
  $('#pSel').onchange=e=>{promptSel=Number(e.target.value)||null;renderPrompts()};
  $('#pNew').onclick=()=>{promptSel=null;renderPrompts();$('#pTitle').focus()};
  $('#pCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('#pText').value);toast('Prompt copiado')}
    catch(e){$('#pText').select();toast('Use Ctrl+C para copiar')}};
  $('#pSave').onclick=async()=>{
    try{const j=await api('prompt_save',{id:p.id,titulo:$('#pTitle').value,texto:$('#pText').value});toast('Prompt salvo');openPrompts(j.id)}
    catch(x){toast(x.message)}};
  if(p.id)$('#pDel').onclick=async()=>{
    if(!confirm(`Excluir o prompt "${p.titulo}"?`))return;
    try{await api('prompt_delete',{id:p.id});toast('Prompt excluído');promptSel=null;openPrompts()}catch(x){toast(x.message)}};
}
$('#promptsBtn').onclick=()=>openPrompts();
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!openId&&$('#pText'))$('#drawerRoot').innerHTML=''});
setInterval(()=>{if(db&&!document.hidden&&!pendingImport)refresh().catch(()=>{})},20000);
start();
