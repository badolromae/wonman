// 네오달구리 가계부 — 부부 공용 웹 가계부 (Firebase RTDB + 익명로그인 + 커플코드)
import { firebaseConfig } from './firebase-config.js';

const $ = (id)=>document.getElementById(id);
const won = (n)=> (Math.round(n||0)).toLocaleString('ko-KR')+'원';
const todayISO = ()=>{ const d=new Date(); const z=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; };
const ymNow = ()=> todayISO().slice(0,7).replace('-','');
const ymTitle = (ym)=> `${ym.slice(0,4)}년 ${parseInt(ym.slice(4),10)}월`;
const ymOfDate = (iso)=> iso.slice(0,7).replace('-','');
const esc = (s)=> String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// 금액: 천원단위 콤마 표시 / 입력값에서 숫자만 뽑기 / 입력칸 콤마 자동
const fmtInt = (n)=> (Math.round(+n||0)).toLocaleString('ko-KR');
const digits = (s)=>{ const m=String(s==null?'':s).replace(/[^0-9-]/g,''); const n=parseInt(m,10); return isNaN(n)?0:n; };
function wireMoney(el){ if(!el || el._money) return; el._money=true;
  el.addEventListener('input',()=>{ const raw=el.value.replace(/[^0-9-]/g,''); const neg=raw.startsWith('-'); const d=raw.replace(/-/g,''); el.value=(neg?'-':'')+(d?(+d).toLocaleString('ko-KR'):''); });
}
const nextDayLabel = (iso)=>{ const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+1); const z=n=>String(n).padStart(2,'0'); return `${z(d.getMonth()+1)}-${z(d.getDate())}`; };

const DEF_CATS = ['간식','식대','소모품','선물비','가구','의류','경조사비','공과금','교통비','헌금','건강의료','이미용','교육비','여행/여가'];
const DEF_PAYS = ['현금','신세계상품권','온누리상품권','은주카드','종진카드'];
const LIVING_PAYS = ['현금','종진카드','은주카드'];  // 생활비 계좌에서 나가는 결제수단
const LIVING_KEY = '생활비';                          // 생활비 계좌 잔고 저장 키

// 계좌번호 찾기 (이름|항목, 띄어쓰기 무시)
let _ACCTN=null;
function acctOf(who,name){
  if(!_ACCTN){ _ACCTN={}; const m=window.ACCT||{}; for(const k in m){ _ACCTN[k.replace(/\s+/g,'')]=m[k]; } }
  return _ACCTN[(String(who||'')+'|'+String(name||'')).replace(/\s+/g,'')] || '';
}
const norm = (s)=> String(s==null?'':s).replace(/\s+/g,'');
const fxKey = (who,name)=> norm(who)+'|'+norm(name);
// 항목에 직접 적은 계좌번호가 있으면 그걸, 없으면 accounts.js 표에서 찾기
const acctFor = (i)=> (i && i.acct!=null) ? String(i.acct) : acctOf(i&&i.who, i&&i.name);
// 이번 달·다음 달 월고정을 고치면 고정지출(기준)도 같이 바뀜 (지난 달은 기준에 영향 없음)
const canSync = (ym)=> ym >= ymNow();
const fmtDT = (ts)=>{ if(!ts) return ''; const d=new Date(ts); const z=n=>String(n).padStart(2,'0'); return `${d.getMonth()+1}/${d.getDate()} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const signWon = (n)=> (n>0?'+':'')+won(n);
const dcls = (d)=> d==null?'zero':(d>0?'up':(d<0?'down':'zero'));

const S = {
  uid:null, code: localStorage.getItem('dg_code')||'',
  entries:{}, income:{}, fixed:{}, assets:{}, monthlyFixed:{}, meta:{}, balances:{},
  assetHistory:{}, incomeHistory:{},
  lYM: ymNow(), fYM: ymNow(), master:'income', ahOpen:'', ihOpen:'',
};
const cats = ()=> (S.meta.categories && S.meta.categories.length)? S.meta.categories : DEF_CATS;
const pays = ()=> (S.meta.payments && S.meta.payments.length)? S.meta.payments : DEF_PAYS;

function toast(msg,ms=2200){ const b=$('status'); b.textContent=msg; b.hidden=false; clearTimeout(b._t); b._t=setTimeout(()=>b.hidden=true,ms); }

// ---------------- Firebase ----------------
let db=null, auth=null, ready=false;
try{
  firebase.initializeApp(firebaseConfig);
  auth=firebase.auth(); db=firebase.database();
  auth.signInAnonymously().catch(e=>console.warn('anon',e));
  auth.onAuthStateChanged(u=>{ if(u){ S.uid=u.uid; ready=true; if(S.code) attach(); } });
}catch(e){ console.warn('firebase init failed', e); }

function base(){ return `ledgers/${S.code}`; }
let attached=false;
function attach(){
  if(!db || !S.code || attached) return; attached=true;
  const bind=(node,key,isNested)=>{
    db.ref(`${base()}/${node}`).on('value', snap=>{
      S[key] = snap.val()||{}; renderAll();
    });
  };
  bind('entries','entries'); bind('income','income'); bind('fixed','fixed'); bind('assets','assets'); bind('balances','balances');
  bind('assetHistory','assetHistory'); bind('incomeHistory','incomeHistory');
  db.ref(`${base()}/monthlyFixed`).on('value', s=>{ S.monthlyFixed=s.val()||{}; renderAll(); });
  db.ref(`${base()}/meta`).on('value', s=>{ S.meta=s.val()||{}; fillSelects(); renderAll(); });
}
function detach(){ if(db&&S.code){ ['entries','income','fixed','assets','balances','monthlyFixed','meta','assetHistory','incomeHistory'].forEach(n=>db.ref(`${base()}/${n}`).off()); } attached=false; }

// ---------------- helpers for data ----------------
const list = (obj)=> Object.entries(obj||{}).map(([id,v])=>({id,...v}));
function entriesOfMonth(ym){ return list(S.entries).filter(e=>e.date && ymOfDate(e.date)===ym).sort((a,b)=> (a.date<b.date?-1:a.date>b.date?1:(a.ts||0)-(b.ts||0))); }
function entriesOfYear(y){ return list(S.entries).filter(e=>e.date && e.date.slice(0,4)===String(y)).sort((a,b)=> a.date<b.date?-1:1); }

// 생활비 계좌 순사용액: 반영일 '다음날부터' (지출 − 입금)
// 지출(현금·종진카드·은주카드)은 +, 입금은 − → 잔고 = 반영액 − 순사용액
function livingUsed(){
  const b=(S.balances||{})[LIVING_KEY]; if(!b || b.amount==null) return 0;
  return list(S.entries).reduce((s,e)=>{
    if(!e.date || e.date<=(b.asOf||'')) return s;
    if(e.kind==='in') return s - (+e.amount||0);              // 입금 → 잔고 증가
    if(LIVING_PAYS.includes(e.pay)) return s + (+e.amount||0); // 지출 → 잔고 감소
    return s;
  },0);
}
function livingBalance(){
  const b=(S.balances||{})[LIVING_KEY]; if(!b || b.amount==null) return null;
  return (+b.amount||0) - livingUsed();
}
const isIn = (e)=> e && e.kind==='in';

// ---------------- selects ----------------
function opts(arr, sel){ return arr.map(c=>`<option ${c===sel?'selected':''}>${esc(c)}</option>`).join(''); }
function fillSelects(){
  const c=cats(), p=pays();
  ['qCat','eCat','edCat'].forEach(id=>{ const el=$(id); if(el) el.innerHTML=opts(c, el.value); });
  ['qPay','ePay','edPay'].forEach(id=>{ const el=$(id); if(el) el.innerHTML=opts(p, el.value); });
}

// ---------------- tabs ----------------
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
  t.classList.add('on');
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  $('page-'+t.dataset.tab).classList.add('on');
  renderAll();
});

// ---------------- render ----------------
function renderAll(){
  $('codeChip').textContent = S.code? ('코드: '+S.code) : '코드 없음';
  renderHome(); renderLedger(); renderFixedM(); renderMaster(); fillReportSelectors();
}

// ===== HOME =====
function renderHome(){
  const ym=ymNow();
  const es=entriesOfMonth(ym);
  const outEs=es.filter(e=>!isIn(e));
  const total=outEs.reduce((s,e)=>s+(+e.amount||0),0);
  $('homeMonthTotal').textContent=won(total);
  $('homeMonthLabel').textContent=`${ymTitle(ym)} 지출 · ${outEs.length}건`;
  // top categories
  const byc={}; outEs.forEach(e=>{ byc[e.cat||'(미분류)']=(byc[e.cat||'(미분류)']||0)+(+e.amount||0); });
  const top=Object.entries(byc).sort((a,b)=>b[1]-a[1]).slice(0,4);
  $('homeTopCats').innerHTML = top.map(([k,v])=>`<span>${esc(k)} ${won(v)}</span>`).join('') || '<span class="hint">내역 없음</span>';
  // assets
  const as=list(S.assets); const atot=as.reduce((s,a)=>s+(+a.amount||0),0);
  $('homeAssetTotal').textContent=won(atot);
  const g={}; as.forEach(a=>{ g[a.group||'기타']=(g[a.group||'기타']||0)+(+a.amount||0); });
  {
    const past=hMonths('asset').filter(m=>m<ymNow()); const pv=past[past.length-1];
    $('homeAssetDiff').innerHTML = pv ? `${+pv.slice(4)}월 기록 대비 <b class="df ${dcls(atot-hTotal(S.assetHistory[pv]))}">${signWon(atot-hTotal(S.assetHistory[pv]))}</b>` : '';
  }
  $('homeAssetBreak').innerHTML = Object.entries(g).map(([k,v])=>`<div><span>${esc(k)}</span><b>${won(v)}</b></div>`).join('') || '<div class="hint">자산을 입력해 보세요</div>';
  // 생활비 계좌 잔고
  {
    const b=(S.balances||{})[LIVING_KEY]; const cur=livingBalance();
    let html;
    if(cur==null) html=`<div class="bal-card" data-m="${LIVING_KEY}"><div class="bk">💳 생활비 계좌</div><div class="bv unset">잔고 설정하기 ＋</div></div>`;
    else { const used=livingUsed(); html=`<div class="bal-card" data-m="${LIVING_KEY}"><div class="bk">💳 생활비 계좌 <span class="edit">✏️</span></div><div class="bv ${cur<0?'low':''}">${won(cur)}</div><div class="bsub">${b.asOf?esc(b.asOf.slice(5))+' 반영 · 다음날부터 ':''}사용 ${won(used)}</div></div>`; }
    $('homeBalances').innerHTML=html;
    $('homeBalances').querySelectorAll('.bal-card').forEach(c=> c.onclick=()=>openBal(c.dataset.m));
  }
  // recent
  const rec=list(S.entries).filter(e=>e.date).sort((a,b)=> a.date<b.date?1:a.date>b.date?-1:(b.ts||0)-(a.ts||0)).slice(0,6);
  $('homeRecent').innerHTML = rec.map(e=>`<div class="mrow"><span class="l">${esc(e.date.slice(5))} ${esc(e.desc||'')} <span class="tag${isIn(e)?' in':''}">${isIn(e)?'입금':esc(e.cat||'')}</span></span><span class="r${isIn(e)?' in':''}">${isIn(e)?'＋':''}${won(e.amount)}</span></div>`).join('') || '<div class="hint">아직 내역이 없어요</div>';
}

// ===== LEDGER =====
function renderLedger(){
  $('lMonthTitle').textContent=ymTitle(S.lYM);
  // 잔고 띠
  const strip=$('ledgerBalStrip');
  if(strip){
    const cur=livingBalance();
    strip.innerHTML = (cur==null) ? '' : `<div class="bchip" data-m="${LIVING_KEY}">생활비 잔고<b class="${cur<0?'low':''}">${won(cur)}</b></div>`;
    strip.querySelectorAll('.bchip').forEach(c=> c.onclick=()=>openBal(c.dataset.m));
  }
  const es=entriesOfMonth(S.lYM);
  const outSum=es.filter(e=>!isIn(e)).reduce((s,e)=>s+(+e.amount||0),0);
  const inSum=es.filter(e=>isIn(e)).reduce((s,e)=>s+(+e.amount||0),0);
  $('lCount').textContent=es.length; $('lSum').textContent=won(outSum);
  $('lInSum').textContent = inSum>0 ? `· 입금 ＋${won(inSum)}` : '';
  $('ledgerEmpty').hidden = es.length>0;
  $('ledgerList').innerHTML = es.map(e=>{
    const inn=isIn(e);
    return `<div class="erow" data-id="${e.id}">
      <div class="d"><b>${e.date.slice(8)}</b>${e.date.slice(5,7)}월</div>
      <div class="body"><div class="t">${esc(e.desc||'(내용없음)')}</div>
      <div class="meta">${inn?'<span class="tag in">입금</span>':`<span class="tag">${esc(e.cat||'')}</span><span class="tag pay">${esc(e.pay||'')}</span>`}${e.author?('· '+esc(e.author)):''}</div></div>
      <div class="amt ${inn?'in':''}">${inn?'＋':''}${won(e.amount)}</div></div>`;
  }).join('');
  $('ledgerList').querySelectorAll('.erow').forEach(r=> r.onclick=()=>openEdit(r.dataset.id));
}

// ===== FIXED MONTHLY =====
function renderFixedM(){
  $('fMonthTitle').textContent=ymTitle(S.fYM);
  $('fTitleLabel').textContent=ymTitle(S.fYM);
  $('fSyncHint').textContent = canSync(S.fYM)
    ? '🔗 이 달 금액·항목·계좌를 고치면 「고정지출(기준)」도 같이 바뀌어요'
    : '지난 달이라 여기서 고쳐도 「고정지출(기준)」은 그대로예요';
  const items=list(S.monthlyFixed[S.fYM]||{});
  // inherit hint
  if(items.length===0){
    const prev=prevYM(S.fYM);
    const hasPrev = S.monthlyFixed[prev] && Object.keys(S.monthlyFixed[prev]).length;
    const hasBase = list(S.fixed).length>0;
    let h='이 달 내용이 없어요. ';
    if(hasPrev) h+=`<button id="fInheritBtn" class="link pinklink">⬅️ ${ymTitle(prev)} 값 불러오기</button> `;
    if(hasBase) h+=`<button id="fBaseBtn" class="link pinklink">🧾 고정지출(기준) 불러오기</button>`;
    if(!hasPrev && !hasBase) h+='아래에서 추가하세요.';
    $('fInherit').innerHTML=h;
    const b=$('fInheritBtn'); if(b) b.onclick=()=>inheritMonth(prev,S.fYM);
    const bb=$('fBaseBtn'); if(bb) bb.onclick=()=>inheritBase(S.fYM);
  } else $('fInherit').textContent='';
  const sum=items.reduce((s,i)=>s+(+i.amount||0),0);
  $('fSum').textContent=won(sum);
  // group by who
  items.sort((a,b)=> (a.who||'').localeCompare(b.who||''));
  $('fixedmList').innerHTML = items.map(i=>kvRow('fm',i.id,i.who,esc(i.name)+(i.special?' <small>특수</small>':''),i.amount,false,acctFor(i),true,!!i.paid)).join('') || '';
  // 이체 확인 체크박스 (부부가 함께 보는 확인용)
  const paidN=items.filter(i=>i.paid).length, leftAmt=items.filter(i=>!i.paid).reduce((s,i)=>s+(+i.amount||0),0);
  $('fPaid').innerHTML = items.length ? (paidN===items.length ? `✅ 이체 모두 완료 (${paidN}/${items.length})` : `이체 완료 <b>${paidN}</b>/${items.length} · 남은 금액 <b>${won(leftAmt)}</b>`) : '';
  $('fixedmList').querySelectorAll('.kv').forEach(row=>{ const c=row.querySelector('.paid'); if(!c) return;
    c.onchange=()=>{ const ym=S.fYM, id=row.dataset.id; row.classList.toggle('done',c.checked);
      db.ref(`${base()}/monthlyFixed/${ym}/${id}`).update(c.checked ? {paid:true, paidAt:Date.now(), paidBy:S.myName||''} : {paid:null, paidAt:null, paidBy:null});
      toast(c.checked?'✅ 이체 완료 체크':'체크 해제'); };
  });
  wireKV('fixedmList', (id,amt)=>{
      const i=(S.monthlyFixed[S.fYM]||{})[id];
      db.ref(`${base()}/monthlyFixed/${S.fYM}/${id}/amount`).set(amt);
      if(i && !i.special && canSync(S.fYM)){
        const had=!!findBaseFixed(i.who,i.name);
        syncBaseFixed(i.who,i.name,{amount:amt},{...i,amount:amt});
        return had?'저장됨 · 고정지출(기준)도 변경':'저장됨 · 고정지출(기준)에도 추가';
      }
      return '저장됨';
    },
    (id)=> delMonthly(S.fYM,id),
    (id)=> openFi('fm',id));
  // search months select
  const sel=$('fSearchMonth');
  if(sel.options.length<=1){ Object.keys(S.monthlyFixed).sort().forEach(ym=>{ const o=document.createElement('option'); o.value=ym;o.textContent=ymTitle(ym); sel.appendChild(o);}); }
  renderFixedSearch();
}
function renderFixedSearch(){
  const q=($('fSearch').value||'').trim(); const mo=$('fSearchMonth').value;
  if(!q && !mo){ $('fSearchResult').innerHTML=''; return; }
  let rows=[];
  Object.keys(S.monthlyFixed).forEach(ym=>{ if(mo&&ym!==mo) return;
    list(S.monthlyFixed[ym]).forEach(i=>{ if(!q || (i.name||'').includes(q)) rows.push({ym,...i}); });
  });
  rows.sort((a,b)=> a.ym<b.ym?1:-1);
  $('fSearchResult').innerHTML = rows.map(r=>{ const a=acctFor(r);
    return `<div class="erow"><div class="d"><b>${r.ym.slice(4)}</b>${r.ym.slice(0,4)}</div><div class="body"><div class="t">${esc(r.name)}</div><div class="meta"><span class="tag">${esc(r.who||'')}</span>${a?`<span class="tag acct-tag">🏦 ${esc(a)}</span>`:''}</div></div><div class="amt">${won(r.amount)}</div></div>`; }).join('') || '<div class="empty">검색 결과 없음</div>';
}
// 고정지출(기준)에서 같은 사람·같은 항목 찾기 (띄어쓰기 무시)
function findBaseFixed(who,name){ const k=fxKey(who,name); return list(S.fixed).find(f=>fxKey(f.who,f.name)===k); }
// 월고정 변경 → 고정지출(기준)에 반영. 기준에 없으면 새로 추가
function syncBaseFixed(oldWho,oldName,patch,full){
  const hit=findBaseFixed(oldWho,oldName);
  if(hit) return db.ref(`${base()}/fixed/${hit.id}`).update(patch).then(()=>'upd');
  const r=full||patch; const o={who:r.who||'',name:r.name||'',amount:+r.amount||0};
  if(r.acct!=null && r.acct!=='') o.acct=r.acct;
  // 같은 항목이 동시에 두 번 추가되지 않도록 (빠른 연속 입력 대비)
  const pk=fxKey(oldWho,oldName);
  if(_pendingAdd[pk]) return db.ref(`${base()}/fixed/${_pendingAdd[pk]}`).update(o).then(()=>'add');
  const ref=db.ref(`${base()}/fixed`).push(); _pendingAdd[pk]=ref.key; setTimeout(()=>{ delete _pendingAdd[pk]; },4000);
  return ref.set(o).then(()=>'add');
}
const _pendingAdd={};
function delMonthly(ym,id){
  const i=(S.monthlyFixed[ym]||{})[id]; if(!i) return false;
  if(!confirm(`「${i.name}」 항목을 ${ymTitle(ym)} 월고정에서 삭제할까요?`)) return false;
  db.ref(`${base()}/monthlyFixed/${ym}/${id}`).remove();
  const hit=(!i.special && canSync(ym)) ? findBaseFixed(i.who,i.name) : null;
  if(hit && confirm('고정지출(기준)에서도 같은 항목을 삭제할까요?')){ db.ref(`${base()}/fixed/${hit.id}`).remove(); toast('삭제됨 · 고정지출(기준)에서도 삭제'); }
  else toast('삭제됨');
  return true;
}
function prevYM(ym){ let y=+ym.slice(0,4),m=+ym.slice(4); m--; if(m<1){m=12;y--;} return `${y}${String(m).padStart(2,'0')}`; }
function nextYM(ym){ let y=+ym.slice(0,4),m=+ym.slice(4); m++; if(m>12){m=1;y++;} return `${y}${String(m).padStart(2,'0')}`; }
function inheritMonth(from,to){
  const src=S.monthlyFixed[from]; if(!src){ toast('가져올 달이 없어요'); return; }
  const upd={};
  list(src).forEach(i=>{ if(i.special) return; const k=db.ref(`${base()}/monthlyFixed/${to}`).push().key; upd[k]={who:i.who||'',name:i.name,amount:+i.amount||0}; if(i.acct!=null) upd[k].acct=i.acct; });
  db.ref(`${base()}/monthlyFixed/${to}`).update(upd).then(()=>toast(`${ymTitle(from)} 값을 불러왔어요`));
}
function inheritBase(to){
  const src=list(S.fixed); if(!src.length){ toast('고정지출(기준)이 비어 있어요'); return; }
  const upd={};
  src.forEach(i=>{ const k=db.ref(`${base()}/monthlyFixed/${to}`).push().key; upd[k]={who:i.who||'',name:i.name||'',amount:+i.amount||0}; if(i.acct!=null) upd[k].acct=i.acct; });
  db.ref(`${base()}/monthlyFixed/${to}`).update(upd).then(()=>toast('고정지출(기준) 값을 불러왔어요'));
}

// ===== MASTER (income/fixed/assets) =====
function renderMaster(){
  // income
  const inc=list(S.income); $('incSum').textContent=won(inc.reduce((s,i)=>s+(+i.amount||0),0));
  $('incList').innerHTML=inc.map(i=>kvRow('inc',i.id,i.who,i.name+(i.note?` <small>${esc(i.note)}</small>`:''),i.amount,true)).join('');
  wireKV('incList',(id,amt)=>db.ref(`${base()}/income/${id}/amount`).set(amt),confirmDel((id)=>db.ref(`${base()}/income/${id}`).remove()));
  // fixed
  const fx=list(S.fixed); $('fxSum').textContent=won(fx.reduce((s,i)=>s+(+i.amount||0),0));
  $('fxList').innerHTML=fx.map(i=>kvRow('fx',i.id,i.who,esc(i.name),i.amount,false,acctFor(i),true)).join('');
  wireKV('fxList',(id,amt)=>db.ref(`${base()}/fixed/${id}/amount`).set(amt),confirmDel((id)=>db.ref(`${base()}/fixed/${id}`).remove()),(id)=>openFi('fx',id));
  // assets grouped
  const as=list(S.assets); $('asSum').textContent=won(as.reduce((s,i)=>s+(+i.amount||0),0));
  const order=['동산','부동산','종진계좌','은주계좌']; const groups={};
  as.forEach(a=>{ (groups[a.group||'기타']=groups[a.group||'기타']||[]).push(a); });
  let html='';
  const gkeys=Object.keys(groups).sort((a,b)=>{const x=order.indexOf(a),y=order.indexOf(b);return (x<0?9:x)-(y<0?9:y);});
  gkeys.forEach(g=>{ const sub=groups[g].reduce((s,a)=>s+(+a.amount||0),0);
    html+=`<div class="group-h">${esc(g)} · ${won(sub)}</div>`;
    html+=groups[g].map(a=>kvRow('as',a.id,'',a.name+(a.note?` <small>${esc(a.note)}</small>`:''),a.amount,true)).join('');
  });
  $('asList').innerHTML=html;
  wireKV('asList',(id,amt)=>db.ref(`${base()}/assets/${id}/amount`).set(amt),confirmDel((id)=>db.ref(`${base()}/assets/${id}`).remove()));
  fillLivingPick();
  renderHist('income'); renderHist('asset');
}
function kvRow(pfx,id,who,name,amt,noWho,acct,editable,paid){
  const ed = editable? ' ed' : '';
  const ck = (paid===undefined)? '' : `<label class="paidck" title="이체했으면 체크"><input type="checkbox" class="paid"${paid?' checked':''}><span></span></label>`;
  const a = acct? `<span class="acct${ed}">🏦 ${esc(acct)}</span>` : (editable? `<span class="acct none ed">🏦 계좌 추가</span>` : '');
  const nm = `<span class="nm${ed}"${editable?' title="눌러서 항목·계좌번호 수정"':''}>${name}${editable?' <span class="pen">✏️</span>':''}</span>`;
  return `<div class="kv${paid?' done':''}" data-id="${id}">${ck}${noWho?'':`<span class="who">${esc(who||'')}</span>`}${nm}${a}<input class="vv" type="text" inputmode="numeric" value="${fmtInt(amt)}"><button class="del">✕</button></div>`;
}
function wireKV(containerId,onAmt,onDel,onEdit){
  const box=$(containerId); if(!box) return;
  box.querySelectorAll('.kv').forEach(row=>{
    const id=row.dataset.id;
    const inp=row.querySelector('.vv');
    if(inp){ wireMoney(inp); inp.onchange=()=>{ const r=onAmt(id, digits(inp.value)); toast(typeof r==='string'?r:'저장됨'); }; }
    const del=row.querySelector('.del'); if(del && onDel) del.onclick=()=>onDel(id);
    if(onEdit) row.querySelectorAll('.ed').forEach(e=> e.onclick=()=>onEdit(id));
  });
}
const confirmDel = (fn)=> (id)=>{ if(confirm('이 항목을 삭제할까요?')) fn(id); };
// 생활비 계좌로 쓸 자산 선택 목록 채우기
function autoLivingId(as){ const hit=as.find(a=>/생활/.test(a.note||'')||/생활/.test(a.name||'')); return hit?hit.id:(as[0]?as[0].id:''); }
function fillLivingPick(){
  const sel=$('livingPick'); if(!sel) return;
  const as=list(S.assets);
  const want = sel.value || (S.meta&&S.meta.livingAssetId) || autoLivingId(as);
  sel.innerHTML = as.map(a=>`<option value="${a.id}">[${esc(a.group||'')}] ${esc(a.name||'')}${a.note?' ('+esc(a.note)+')':''} · ${won(a.amount)}</option>`).join('');
  if(want && S.assets[want]) sel.value=want;
}

// ---------------- writes (add) ----------------
function addEntry(dateEl,amtEl,catEl,payEl,descEl,msgEl,kindEl){
  if(!S.code){ toast('먼저 커플 코드를 설정하세요'); openShare(); return; }
  const kind=(kindEl && kindEl.value==='in')?'in':'out';
  const date=dateEl.value||todayISO();
  const amount=digits(amtEl.value);
  const desc=(descEl.value||'').trim();
  if(!amount && !desc){ if(msgEl) msgEl.textContent='금액이나 내용을 입력하세요'; return; }
  const rec = kind==='in'
    ? {date,amount,kind:'in',cat:'',pay:'',desc,author:S.myName||'',ts:Date.now()}
    : {date,amount,cat:catEl.value||'',pay:payEl.value||'',desc,author:S.myName||'',ts:Date.now()};
  const lb=(S.balances||{})[LIVING_KEY];
  const affects = lb && lb.amount!=null && rec.date>(lb.asOf||'') && (kind==='in' || LIVING_PAYS.includes(rec.pay));
  const preBal=(lb && lb.amount!=null)?livingBalance():null;
  db.ref(`${base()}/entries`).push(rec).then(()=>{ amtEl.value=''; descEl.value=''; if(msgEl) msgEl.textContent=(kind==='in'?'✅ 입금 추가됨':'✅ 추가됨');
    if(preBal!=null && affects){ const nw=preBal+(kind==='in'?rec.amount:-rec.amount); toast(`${kind==='in'?'입금':'추가'}됨 · 생활비 잔고 ${won(nw)}`); }
    else toast(kind==='in'?'입금 추가됨':'추가됨');
  });
}
$('qAdd').onclick=()=>addEntry($('qDate'),$('qAmount'),$('qCat'),$('qPay'),$('qDesc'),$('qMsg'),$('qKind'));
$('eAdd').onclick=()=>addEntry($('eDate'),$('eAmount'),$('eCat'),$('ePay'),$('eDesc'),null,$('eKind'));
function syncKind(kindEl,catEl,payEl){ const inn=kindEl.value==='in'; if(catEl)catEl.style.display=inn?'none':''; if(payEl)payEl.style.display=inn?'none':''; }
$('qKind').onchange=()=>syncKind($('qKind'),$('qCat'),$('qPay'));
$('eKind').onchange=()=>syncKind($('eKind'),$('eCat'),$('ePay'));

$('incAdd').onclick=()=>{ if(!chk())return; db.ref(`${base()}/income`).push({who:$('incWho').value,name:$('incName').value.trim(),note:$('incNote').value.trim(),amount:digits($('incAmt').value)}); $('incName').value='';$('incNote').value='';$('incAmt').value=''; };
$('fxAdd').onclick=()=>{ if(!chk())return; const name=$('fxName').value.trim(); if(!name){ toast('항목 이름을 입력하세요'); return; }
  const rec={who:$('fxWho').value,name,amount:digits($('fxAmt').value)}; const acct=$('fxAcct').value.trim(); if(acct) rec.acct=acct;
  db.ref(`${base()}/fixed`).push(rec); $('fxName').value='';$('fxAcct').value='';$('fxAmt').value=''; toast('추가됨'); };
$('asAdd').onclick=()=>{ if(!chk())return; db.ref(`${base()}/assets`).push({group:$('asGroup').value,name:$('asName').value.trim(),amount:digits($('asAmt').value),note:$('asNote').value.trim()}); $('asName').value='';$('asAmt').value='';$('asNote').value=''; };
$('fAdd').onclick=()=>{ if(!chk())return; const name=$('fName').value.trim(); if(!name){ toast('항목 이름을 입력하세요'); return; }
  const ym=S.fYM; const rec={who:$('fWho').value,name,amount:digits($('fAmt').value)}; const acct=$('fAcct').value.trim(); if(acct) rec.acct=acct;
  db.ref(`${base()}/monthlyFixed/${ym}`).push(rec).then(()=>{
    if(canSync(ym)){ const had=!!findBaseFixed(rec.who,rec.name); syncBaseFixed(rec.who,rec.name,rec).then(()=>toast(had?'추가됨 · 고정지출(기준)도 변경':'추가됨 · 고정지출(기준)에도 추가')); }
    else toast('추가됨');
  });
  $('fName').value='';$('fAcct').value='';$('fAmt').value=''; };
$('applyLiving').onclick=()=>{ if(!chk())return;
  const id=$('livingPick').value; const a=(S.assets||{})[id];
  if(!a){ toast('생활비 계좌로 쓸 자산을 먼저 선택하세요'); return; }
  const today=todayISO();
  db.ref(base()).update({ 'meta/livingAssetId': id, [`balances/${LIVING_KEY}`]: { amount: Math.round(+a.amount||0), asOf: today, src:'asset' } })
    .then(()=>saveHist('asset',ymNow(),true))
    .then(()=>{ $('applyMsg').textContent=`✅ ${won(a.amount)} 반영됨 · ${nextDayLabel(today)}부터 차감 시작 · ${ymTitle(ymNow())} 자산 기록도 저장됨`; toast('홈 생활비 잔고에 반영됨'); });
};
function chk(){ if(!S.code){ toast('먼저 커플 코드를 설정하세요'); openShare(); return false;} return true; }

// month nav
$('lPrev').onclick=()=>{S.lYM=prevYM(S.lYM);renderLedger();};
$('lNext').onclick=()=>{S.lYM=nextYM(S.lYM);renderLedger();};
$('lToday').onclick=()=>{S.lYM=ymNow();renderLedger();};
$('fPrev').onclick=()=>{S.fYM=prevYM(S.fYM);renderFixedM();};
$('fNext').onclick=()=>{S.fYM=nextYM(S.fYM);renderFixedM();};
$('fToday').onclick=()=>{S.fYM=ymNow();renderFixedM();};
$('fSearch').oninput=renderFixedSearch; $('fSearchMonth').onchange=renderFixedSearch;

// master segment
document.querySelectorAll('#masterSeg button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#masterSeg button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
  ['income','fixed','assets'].forEach(m=>$('msub-'+m).hidden=(m!==b.dataset.m));
});

// ---------------- edit modal ----------------
let editId=null;
function openEdit(id){ const e=S.entries[id]; if(!e)return; editId=id;
  $('edDate').value=e.date; $('edAmount').value=fmtInt(e.amount); $('edDesc').value=e.desc||'';
  $('edCat').innerHTML=opts(cats(),e.cat); $('edPay').innerHTML=opts(pays(),e.pay);
  $('edKind').value=isIn(e)?'in':'out'; $('edOutFields').style.display=isIn(e)?'none':'';
  $('editModal').hidden=false;
}
$('edKind').onchange=()=>{ $('edOutFields').style.display=($('edKind').value==='in')?'none':''; };
$('edClose').onclick=()=>$('editModal').hidden=true;
$('edSave').onclick=()=>{ if(!editId)return;
  const kind=($('edKind').value==='in')?'in':'out';
  const upd = kind==='in'
    ? {date:$('edDate').value,amount:digits($('edAmount').value),kind:'in',cat:'',pay:'',desc:$('edDesc').value.trim()}
    : {date:$('edDate').value,amount:digits($('edAmount').value),kind:'out',cat:$('edCat').value,pay:$('edPay').value,desc:$('edDesc').value.trim()};
  db.ref(`${base()}/entries/${editId}`).update(upd);
  $('editModal').hidden=true; toast('수정됨');
};
$('edDelete').onclick=()=>{ if(!editId)return; if(confirm('이 내역을 삭제할까요?')){ db.ref(`${base()}/entries/${editId}`).remove(); $('editModal').hidden=true; toast('삭제됨'); } };

// ---------------- balance modal ----------------
let balMethod=null;
function defaultSettleDate(){ const d=new Date(); let y=d.getFullYear(),mo=d.getMonth()+1; if(d.getDate()<10){ mo--; if(mo<1){mo=12;y--;} } return `${y}-${String(mo).padStart(2,'0')}-10`; }
function openBal(m){ if(!S.code){ toast('먼저 커플 코드를 설정하세요'); openShare(); return; }
  balMethod=m; $('balWho').textContent=(m===LIVING_KEY?'생활비 계좌':m); const b=(S.balances||{})[m]||{};
  $('balAmount').value=(b.amount!=null?fmtInt(b.amount):''); $('balDate').value=b.asOf||defaultSettleDate();
  $('balModal').hidden=false; setTimeout(()=>$('balAmount').focus(),50);
}
$('balClose').onclick=()=>$('balModal').hidden=true;
$('balSave').onclick=()=>{ if(!balMethod)return;
  const amt=digits($('balAmount').value); const asOf=$('balDate').value||todayISO();
  db.ref(`${base()}/balances/${balMethod}`).set({amount:amt,asOf}); $('balModal').hidden=true; toast(balMethod+' 잔고 저장됨'); };
$('balClear').onclick=()=>{ if(!balMethod)return; if(confirm(balMethod+' 잔고를 지울까요?')){ db.ref(`${base()}/balances/${balMethod}`).remove(); $('balModal').hidden=true; toast('잔고 지움'); } };

// ---------------- share / code / seed ----------------
function openShare(){ $('shCur').textContent=S.code||'(없음)'; $('shCode').value=S.code||''; $('shareModal').hidden=false; }
$('btnShare').onclick=openShare;
$('shClose').onclick=()=>$('shareModal').hidden=true;
$('shUse').onclick=()=>{ const c=($('shCode').value||'').trim().toUpperCase(); if(!c){toast('코드를 입력하세요');return;} setCode(c); };
$('shNew').onclick=()=>{ const c='DG-'+Math.random().toString(36).slice(2,7).toUpperCase(); $('shCode').value=c; toast('새 코드: '+c+' (상대도 같은 코드로!)'); };
$('shLeave').onclick=()=>{ detach(); localStorage.removeItem('dg_code'); S.code=''; location.reload(); };
function setCode(c){ detach(); S.code=c; localStorage.setItem('dg_code',c); $('shCur').textContent=c; attached=false; if(ready) attach(); $('shareModal').hidden=true; renderAll(); toast('코드 설정: '+c); }

$('shSeed').onclick=()=>{
  if(!S.code){ toast('먼저 코드를 설정하세요'); return; }
  if(!window.SEED){ toast('seed 데이터가 없습니다'); return; }
  if(S.meta && S.meta.seeded){ if(!confirm('이미 가져온 것 같아요. 또 가져오면 내역이 중복됩니다. 그래도 진행할까요?')) return; }
  else if(!confirm('엑셀(2026년) 데이터를 이 코드의 클라우드로 가져옵니다. 진행할까요?')) return;
  const sd=window.SEED, upd={};
  const push=(node)=> db.ref(`${base()}/${node}`).push().key;
  (sd.income||[]).forEach(i=>upd[`income/${push('income')}`]=i);
  (sd.fixed||[]).forEach(i=>upd[`fixed/${push('fixed')}`]=i);
  (sd.assets||[]).forEach(i=>upd[`assets/${push('assets')}`]=i);
  Object.entries(sd.monthlyFixed||{}).forEach(([ym,arr])=> arr.forEach(i=>upd[`monthlyFixed/${ym}/${db.ref(`${base()}/monthlyFixed/${ym}`).push().key}`]=i));
  (sd.entries||[]).forEach(e=>{ const k=push('entries'); upd[`entries/${k}`]={...e, ts: Date.parse(e.date)||Date.now()}; });
  upd['meta/categories']=sd.categories||DEF_CATS;
  upd['meta/payments']=sd.payments||DEF_PAYS;
  upd['meta/seeded']=true;
  $('shSeedMsg').textContent='가져오는 중…';
  db.ref(base()).update(upd).then(()=>{ $('shSeedMsg').textContent='✅ 완료! 가계부/월고정/자산에서 확인하세요.'; toast('엑셀 데이터 가져오기 완료'); })
    .catch(e=>{ $('shSeedMsg').textContent='실패: '+e.message; });
};

// ---------------- report ----------------
function fillReportSelectors(){
  const ySel=$('rpYear'), mSel=$('rpMonth');
  if(ySel.options.length===0){
    const years=new Set([new Date().getFullYear()]); list(S.entries).forEach(e=>{if(e.date)years.add(+e.date.slice(0,4));});
    [...years].sort().forEach(y=>{const o=document.createElement('option');o.value=y;o.textContent=y+'년';ySel.appendChild(o);});
    ySel.value=new Date().getFullYear();
  }
  if(mSel.options.length===0){ for(let m=1;m<=12;m++){const o=document.createElement('option');o.value=m;o.textContent=m+'월';mSel.appendChild(o);} mSel.value=new Date().getMonth()+1; }
}
$('rpMake').onclick=makeReport;
$('rpPrint').onclick=()=>{ if(!$('reportOut').innerHTML.trim()){ makeReport(); } const k=$('rpKind').value; printHTML($('reportOut').innerHTML, k==='asset-hist'||k==='inc-hist'); };
$('rpExcel').onclick=()=>{ if(!$('reportOut').innerHTML.trim()){ makeReport(); }
  const sel=$('rpKind'); const name=sel.options[sel.selectedIndex].text.replace(/\s+/g,'');
  const k=sel.value, y=$('rpYear').value, m=String($('rpMonth').value).padStart(2,'0');
  const when = k.startsWith('m-') ? `${y}-${m}` : y;
  downloadXLSX(`네오달구리_${name}_${when}.xlsx`, tablesToSheets($('reportOut'))); };
function makeReport(){
  const kind=$('rpKind').value, y=+$('rpYear').value, m=+$('rpMonth').value;
  const ym=`${y}${String(m).padStart(2,'0')}`;
  const out=$('reportOut');
  if(kind==='m-detail') out.innerHTML=repMonthDetail(ym);
  else if(kind==='m-summary') out.innerHTML=repMonthSummary(ym);
  else if(kind==='y-detail') out.innerHTML=repYearDetail(y);
  else if(kind==='asset-hist') out.innerHTML=repHist('asset', hMonths('asset').filter(x=>x.startsWith(String(y))), `${y}년 `);
  else if(kind==='inc-hist') out.innerHTML=repHist('income', hMonths('income').filter(x=>x.startsWith(String(y))), `${y}년 `);
  else out.innerHTML=repYearSummary(y);
}
function sumBy(arr,key){ const o={}; arr.forEach(e=>{const k=e[key]||'(미분류)'; o[k]=(o[k]||0)+(+e.amount||0);}); return o; }
function tableRows(obj){ return Object.entries(obj).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="n">${won(v)}</td></tr>`).join(''); }
function repMonthDetail(ym){
  const es=entriesOfMonth(ym).filter(e=>!isIn(e)); const sum=es.reduce((s,e)=>s+(+e.amount||0),0);
  const rows=es.map(e=>`<tr><td>${e.date.slice(5)}</td><td>${esc(e.desc)}</td><td>${esc(e.cat)}</td><td class="n">${won(e.amount)}</td><td>${esc(e.pay)}</td></tr>`).join('');
  return `<div class="rsec"><h2>${ymTitle(ym)} 내역 (${es.length}건)</h2>
    <table class="rtable"><thead><tr><th>날짜</th><th>내용</th><th>용도</th><th class="n">금액</th><th>지불</th></tr></thead>
    <tbody>${rows||'<tr><td colspan=5>내역 없음</td></tr>'}</tbody>
    <tfoot><tr><td colspan=3>지출합계</td><td class="n">${won(sum)}</td><td></td></tr></tfoot></table></div>`;
}
function repMonthSummary(ym){
  const es=entriesOfMonth(ym).filter(e=>!isIn(e)); const sum=es.reduce((s,e)=>s+(+e.amount||0),0);
  return `<div class="rsec"><h2>${ymTitle(ym)} 요약</h2>
    <div class="sumcards"><div class="sumcard"><div class="k">지출합계</div><div class="v">${won(sum)}</div></div>
    <div class="sumcard"><div class="k">건수</div><div class="v">${es.length}건</div></div></div>
    <h2>지출분류</h2><table class="rtable"><thead><tr><th>용도</th><th class="n">금액</th></tr></thead><tbody>${tableRows(sumBy(es,'cat'))||'<tr><td colspan=2>없음</td></tr>'}</tbody></table>
    <h2 style="margin-top:16px">지불분류</h2><table class="rtable"><thead><tr><th>지불</th><th class="n">금액</th></tr></thead><tbody>${tableRows(sumBy(es,'pay'))||'<tr><td colspan=2>없음</td></tr>'}</tbody></table></div>`;
}
function repYearDetail(y){
  const es=entriesOfYear(y).filter(e=>!isIn(e)); const sum=es.reduce((s,e)=>s+(+e.amount||0),0);
  const rows=es.map(e=>`<tr><td>${e.date}</td><td>${esc(e.desc)}</td><td>${esc(e.cat)}</td><td class="n">${won(e.amount)}</td><td>${esc(e.pay)}</td></tr>`).join('');
  return `<div class="rsec"><h2>${y}년 전체 내역 (${es.length}건)</h2>
    <table class="rtable"><thead><tr><th>날짜</th><th>내용</th><th>용도</th><th class="n">금액</th><th>지불</th></tr></thead>
    <tbody>${rows||'<tr><td colspan=5>내역 없음</td></tr>'}</tbody>
    <tfoot><tr><td colspan=3>연간 지출합계</td><td class="n">${won(sum)}</td><td></td></tr></tfoot></table></div>`;
}
function repYearSummary(y){
  const es=entriesOfYear(y).filter(e=>!isIn(e)); const sum=es.reduce((s,e)=>s+(+e.amount||0),0);
  const byMonth={}; for(let m=1;m<=12;m++) byMonth[m]=0;
  es.forEach(e=>{ byMonth[+e.date.slice(5,7)]+=(+e.amount||0); });
  const mrows=Object.entries(byMonth).map(([m,v])=>`<tr><td>${m}월</td><td class="n">${won(v)}</td></tr>`).join('');
  return `<div class="rsec"><h2>${y}년 요약</h2>
    <div class="sumcards"><div class="sumcard"><div class="k">연간 지출합계</div><div class="v">${won(sum)}</div></div>
    <div class="sumcard"><div class="k">월 평균</div><div class="v">${won(sum/12)}</div></div>
    <div class="sumcard"><div class="k">건수</div><div class="v">${es.length}건</div></div></div>
    <h2>월별 지출</h2><table class="rtable"><thead><tr><th>월</th><th class="n">지출합계</th></tr></thead><tbody>${mrows}</tbody>
    <tfoot><tr><td>합계</td><td class="n">${won(sum)}</td></tr></tfoot></table>
    <h2 style="margin-top:16px">연간 지출분류</h2><table class="rtable"><thead><tr><th>용도</th><th class="n">금액</th></tr></thead><tbody>${tableRows(sumBy(es,'cat'))}</tbody></table>
    <h2 style="margin-top:16px">연간 지불분류</h2><table class="rtable"><thead><tr><th>지불</th><th class="n">금액</th></tr></thead><tbody>${tableRows(sumBy(es,'pay'))}</tbody></table></div>`;
}

// ---------------- 고정지출 항목 수정 (담당·항목·계좌번호·금액) ----------------
let fiCtx=null;
function openFi(kind,id){
  if(!S.code){ toast('먼저 커플 코드를 설정하세요'); openShare(); return; }
  const ym=S.fYM;
  const src = kind==='fm' ? (S.monthlyFixed[ym]||{})[id] : (S.fixed||{})[id];
  if(!src) return;
  fiCtx={kind,id,ym,orig:{...src}};
  $('fiTitle').textContent = kind==='fm' ? `✏️ ${ymTitle(ym)} 월고정 수정` : '✏️ 고정지출(기준) 수정';
  const w=$('fiWho');
  if(![...w.options].some(o=>o.value===(src.who||''))){ const o=document.createElement('option'); o.value=src.who||''; o.textContent=src.who||'(없음)'; w.appendChild(o); }
  w.value=src.who||'';
  $('fiName').value=src.name||''; $('fiAcct').value=acctFor(src); $('fiAmt').value=fmtInt(src.amount);
  const showSync = kind==='fm' && !src.special;
  $('fiSyncRow').hidden=!showSync; $('fiSync').checked = showSync && canSync(ym);
  $('fiModal').hidden=false;
}
$('fiClose').onclick=()=>$('fiModal').hidden=true;
$('fiSave').onclick=()=>{ if(!fiCtx) return;
  const {kind,id,ym,orig}=fiCtx;
  const name=$('fiName').value.trim(); if(!name){ toast('항목 이름을 입력하세요'); return; }
  const upd={who:$('fiWho').value, name, acct:$('fiAcct').value.trim(), amount:digits($('fiAmt').value)};
  const path = kind==='fm' ? `monthlyFixed/${ym}/${id}` : `fixed/${id}`;
  const sync = kind==='fm' && !$('fiSyncRow').hidden && $('fiSync').checked;
  db.ref(`${base()}/${path}`).update(upd).then(()=>{
    if(sync) return syncBaseFixed(orig.who,orig.name,upd).then(r=>toast(r==='add'?'저장됨 · 고정지출(기준)에 새로 추가':'저장됨 · 고정지출(기준)도 변경'));
    toast('저장됨');
  });
  $('fiModal').hidden=true;
};
$('fiDelete').onclick=()=>{ if(!fiCtx) return;
  const {kind,id,ym}=fiCtx;
  if(kind==='fm'){ if(delMonthly(ym,id)) $('fiModal').hidden=true; return; }
  if(confirm('이 항목을 삭제할까요?')){ db.ref(`${base()}/fixed/${id}`).remove(); $('fiModal').hidden=true; toast('삭제됨'); }
};

// ---------------- 월별 기록 (자산·수입) ----------------
// 저장 위치: assetHistory/{YYYYMM}, incomeHistory/{YYYYMM} = { savedAt, items:[...] }
const HIST={
  asset:{ node:'assetHistory', label:'자산', grp:'group', grpName:'구분', order:['동산','부동산','종진계좌','은주계좌'],
          open:'ahOpen', sel:'ahMonth', listId:'ahList', statusId:'ahStatus',
          snap:()=>list(S.assets).map(a=>({aid:a.id, group:a.group||'', name:a.name||'', note:a.note||'', amount:Math.round(+a.amount||0)})) },
  income:{ node:'incomeHistory', label:'수입', grp:'who', grpName:'담당', order:['종진','은주','공동'],
          open:'ihOpen', sel:'ihMonth', listId:'ihList', statusId:'ihStatus',
          snap:()=>list(S.income).map(i=>({aid:i.id, who:i.who||'', name:i.name||'', note:i.note||'', amount:Math.round(+i.amount||0)})) },
};
const H = (t)=> S[HIST[t].node]||{};
const hMonths = (t)=> Object.keys(H(t)).filter(k=>/^\d{6}$/.test(k)).sort();
const hItems = (rec)=> (rec && rec.items) ? Object.entries(rec.items).filter(([,v])=>v).map(([idx,v])=>({idx,...v})) : [];
const hTotal = (rec)=> hItems(rec).reduce((s,i)=>s+(+i.amount||0),0);
const hKey = (t,i)=> i.aid || (norm(i[HIST[t].grp])+'|'+norm(i.name)+'|'+norm(i.note));
function hPrev(t,ym){ const ms=hMonths(t).filter(m=>m<ym); return ms.length?ms[ms.length-1]:''; }
function sortGroups(order,keys){ return keys.sort((a,b)=>{ const x=order.indexOf(a),y=order.indexOf(b); return (x<0?99:x)-(y<0?99:y) || a.localeCompare(b); }); }
function hGroupSums(t,items){ const g={}; items.forEach(i=>{ const k=i[HIST[t].grp]||'기타'; g[k]=(g[k]||0)+(+i.amount||0); }); return sortGroups(HIST[t].order,Object.keys(g)).map(k=>[k,g[k]]); }

function saveHist(t,ym,silent){
  if(!chk()) return Promise.resolve(false);
  const cfg=HIST[t]; const items=cfg.snap();
  if(!items.length){ toast(`${cfg.label} 항목이 없어요`); return Promise.resolve(false); }
  if(!silent && H(t)[ym] && !confirm(`${ymTitle(ym)} ${cfg.label} 기록이 이미 있어요.\n지금 ${cfg.label} 금액으로 덮어쓸까요?`)) return Promise.resolve(false);
  return db.ref(`${base()}/${cfg.node}/${ym}`).set({savedAt:Date.now(), items}).then(()=>{ if(!silent) toast(`${ymTitle(ym)} ${cfg.label} 기록 저장됨`); return true; });
}
function fillHistMonthSel(t){
  const sel=$(HIST[t].sel); const cur=sel.value || ymNow();
  const have=new Set(hMonths(t));
  let start=ymNow(); for(let k=0;k<11;k++) start=prevYM(start);
  if(have.size){ const first=[...have].sort()[0]; if(first<start) start=first; }
  const arr=[]; for(let m=start; m<=nextYM(ymNow()); m=nextYM(m)) arr.push(m);
  sel.innerHTML = arr.reverse().map(m=>`<option value="${m}">${ymTitle(m)}${have.has(m)?' ✅':''}</option>`).join('');
  sel.value=cur;
}
function renderHist(t){
  const cfg=HIST[t]; const box=$(cfg.listId); if(!box) return;
  fillHistMonthSel(t);
  const ymSel=$(cfg.sel).value; const rec=H(t)[ymSel];
  $(cfg.statusId).innerHTML = rec
    ? `✅ ${ymTitle(ymSel)} 기록 있음 (${fmtDT(rec.savedAt)} 저장) · 다시 저장하면 지금 금액으로 덮어써요`
    : `${ymTitle(ymSel)} 기록이 아직 없어요. 위 ${cfg.label} 금액을 다 맞춘 뒤 저장하세요.`;
  const ms=hMonths(t).reverse();
  if(!ms.length){ box.innerHTML='<div class="empty">아직 저장된 기록이 없어요 🧸</div>'; return; }
  box.innerHTML = ms.map(ym=>{
    const r=H(t)[ym], tot=hTotal(r), pv=hPrev(t,ym), d = pv ? tot-hTotal(H(t)[pv]) : null;
    const grp=hGroupSums(t,hItems(r)).map(([k,v])=>`${esc(k)} ${won(v)}`).join(' · ');
    const open=S[cfg.open]===ym;
    return `<div class="erow hrow${open?' open':''}" data-ym="${ym}"><div class="d"><b>${+ym.slice(4)}월</b>${ym.slice(0,4)}</div>
      <div class="body"><div class="t">${won(tot)}</div><div class="meta">${grp}</div></div>
      <div class="diff ${dcls(d)}">${d==null?'첫 기록':signWon(d)}<small>${open?'접기 ▲':'자세히 ▼'}</small></div></div>` + (open? histDetail(t,ym) : '');
  }).join('');
  box.querySelectorAll('.hrow').forEach(r=> r.onclick=()=>{ S[cfg.open] = (S[cfg.open]===r.dataset.ym)?'':r.dataset.ym; renderHist(t); });
  const det=box.querySelector('.hdetail');
  if(det){ const ym=det.dataset.ym;
    det.querySelectorAll('.kv').forEach(row=>{ const inp=row.querySelector('.vv'); wireMoney(inp);
      inp.onchange=()=>{ db.ref(`${base()}/${cfg.node}/${ym}/items/${row.dataset.id}/amount`).set(digits(inp.value)); toast(`${ymTitle(ym)} 기록 수정됨`); }; });
    det.querySelector('[data-act=print1]').onclick=()=>printHTML(repHistMonth(t,ym));
    det.querySelector('[data-act=excel1]').onclick=()=>{ const tmp=document.createElement('div'); tmp.innerHTML=repHistMonth(t,ym); downloadXLSX(`네오달구리_${cfg.label}기록_${ym.slice(0,4)}-${ym.slice(4)}.xlsx`, tablesToSheets(tmp)); };
    det.querySelector('[data-act=del]').onclick=()=>{ if(confirm(`${ymTitle(ym)} ${cfg.label} 기록을 삭제할까요?\n(현재 ${cfg.label} 금액은 그대로예요)`)){ db.ref(`${base()}/${cfg.node}/${ym}`).remove(); S[cfg.open]=''; toast('기록 삭제됨'); } };
  }
}
function histDetail(t,ym){
  const cfg=HIST[t], pv=hPrev(t,ym);
  const prevMap={}; if(pv) hItems(H(t)[pv]).forEach(i=>{ prevMap[hKey(t,i)]=+i.amount||0; });
  const groups={}; hItems(H(t)[ym]).forEach(i=>{ const g=i[cfg.grp]||'기타'; (groups[g]=groups[g]||[]).push(i); });
  let html=`<div class="hdetail" data-ym="${ym}">`;
  sortGroups(cfg.order,Object.keys(groups)).forEach(g=>{
    const sub=groups[g].reduce((s,i)=>s+(+i.amount||0),0);
    html+=`<div class="group-h">${esc(g)} · ${won(sub)}</div>`;
    html+=groups[g].map(i=>{ const k=hKey(t,i); const isNew = pv && !(k in prevMap); const d = (pv && !isNew) ? (+i.amount||0)-prevMap[k] : null;
      const dtxt = !pv ? '' : (isNew ? '새 항목' : (d ? signWon(d) : '–'));
      return `<div class="kv" data-id="${i.idx}"><span class="nm">${esc(i.name)}${i.note?` <small>${esc(i.note)}</small>`:''}</span><span class="df ${isNew?'up':dcls(d)}">${dtxt}</span><input class="vv" type="text" inputmode="numeric" value="${fmtInt(i.amount)}"></div>`;
    }).join('');
  });
  html+=`<div class="hint" style="margin-top:8px">${pv?`오른쪽 초록/빨강 숫자는 ${ymTitle(pv)} 기록과 비교한 값이에요. `:''}여기서 금액을 고치면 <b>이 달 기록만</b> 바뀌어요.</div>
    <div class="btnrow"><button class="btn soft" data-act="excel1">📊 엑셀</button><button class="btn soft" data-act="print1">🖨️ 출력</button><button class="btn danger" data-act="del">🗑️ 기록 삭제</button></div></div>`;
  return html;
}
// 리포트: 여러 달 (월별 합계표 + 항목별 추이표)
function repHist(t, months, prefix){
  const cfg=HIST[t]; prefix=prefix||'';
  if(!months.length) return `<div class="rsec"><h2>${prefix}${cfg.label} 월별 기록</h2><p class="hint">저장된 기록이 없어요. 「수입·지출·자산 → ${cfg.label}」에서 월별 기록을 저장하세요.</p></div>`;
  const gset=new Set(); months.forEach(ym=>hItems(H(t)[ym]).forEach(i=>gset.add(i[cfg.grp]||'기타')));
  const gs=sortGroups(cfg.order,[...gset]);
  let prevTot = hPrev(t,months[0]) ? hTotal(H(t)[hPrev(t,months[0])]) : null;
  const srows=months.map(ym=>{ const items=hItems(H(t)[ym]); const sums=Object.fromEntries(hGroupSums(t,items)); const tot=hTotal(H(t)[ym]);
    const d = prevTot==null ? null : tot-prevTot; prevTot=tot;
    return `<tr><td>${ymTitle(ym)}</td>${gs.map(g=>`<td class="n">${sums[g]!=null?won(sums[g]):''}</td>`).join('')}<td class="n"><b>${won(tot)}</b></td><td class="n ${dcls(d)}">${d==null?'':signWon(d)}</td></tr>`; }).join('');
  // 항목별 추이
  const rowsMap=new Map();
  months.forEach(ym=>hItems(H(t)[ym]).forEach(i=>{ const k=hKey(t,i); if(!rowsMap.has(k)) rowsMap.set(k,{g:i[cfg.grp]||'기타',name:i.name,note:i.note,vals:{}}); const r=rowsMap.get(k); r.name=i.name; r.note=i.note; r.vals[ym]=(r.vals[ym]||0)+(+i.amount||0); }));
  const prows=[...rowsMap.values()].sort((a,b)=>{ const x=cfg.order.indexOf(a.g),y=cfg.order.indexOf(b.g); return (x<0?99:x)-(y<0?99:y); })
    .map(r=>`<tr><td>${esc(r.g)}</td><td>${esc(r.name)}</td><td>${esc(r.note||'')}</td>${months.map(ym=>`<td class="n">${r.vals[ym]!=null?won(r.vals[ym]):''}</td>`).join('')}</tr>`).join('');
  const mh=months.map(ym=>`<th class="n">${ym.slice(2,4)}.${ym.slice(4)}</th>`).join('');
  return `<div class="rsec"><h2>${prefix}${cfg.label} 월별 합계</h2>
    <div class="tscroll"><table class="rtable pivot"><thead><tr><th>월</th>${gs.map(g=>`<th class="n">${esc(g)}</th>`).join('')}<th class="n">합계</th><th class="n">전월대비</th></tr></thead><tbody>${srows}</tbody></table></div>
    <h2 style="margin-top:18px">${prefix}${cfg.label} 항목별 추이</h2>
    <div class="tscroll"><table class="rtable pivot"><thead><tr><th>${cfg.grpName}</th><th>항목</th><th>메모</th>${mh}</tr></thead><tbody>${prows}</tbody>
    <tfoot><tr><td colspan="3">합계</td>${months.map(ym=>`<td class="n">${won(hTotal(H(t)[ym]))}</td>`).join('')}</tr></tfoot></table></div></div>`;
}
// 리포트: 한 달 상세
function repHistMonth(t,ym){
  const cfg=HIST[t], pv=hPrev(t,ym);
  const prevMap={}; if(pv) hItems(H(t)[pv]).forEach(i=>{ prevMap[hKey(t,i)]=+i.amount||0; });
  const items=hItems(H(t)[ym]).sort((a,b)=>{ const x=cfg.order.indexOf(a[cfg.grp]),y=cfg.order.indexOf(b[cfg.grp]); return (x<0?99:x)-(y<0?99:y); });
  const tot=hTotal(H(t)[ym]); const dTot = pv ? tot-hTotal(H(t)[pv]) : null;
  const rows=items.map(i=>{ const k=hKey(t,i); const d = (pv && (k in prevMap)) ? (+i.amount||0)-prevMap[k] : null;
    return `<tr><td>${esc(i[cfg.grp]||'')}</td><td>${esc(i.name)}</td><td>${esc(i.note||'')}</td><td class="n">${won(i.amount)}</td><td class="n ${dcls(d)}">${pv?((k in prevMap)?(d?signWon(d):'0원'):'새 항목'):''}</td></tr>`; }).join('');
  const sums=hGroupSums(t,items).map(([g,v])=>`<div class="sumcard"><div class="k">${esc(g)}</div><div class="v">${won(v)}</div></div>`).join('');
  return `<div class="rsec"><h2>${ymTitle(ym)} ${cfg.label} 기록</h2>
    <div class="sumcards"><div class="sumcard"><div class="k">${cfg.label} 합계</div><div class="v">${won(tot)}</div></div>${sums}</div>
    <table class="rtable"><thead><tr><th>${cfg.grpName}</th><th>항목</th><th>메모</th><th class="n">금액</th><th class="n">${pv?`${+pv.slice(4)}월 대비`:'전월대비'}</th></tr></thead>
    <tbody>${rows||'<tr><td colspan=5>기록 없음</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">합계</td><td class="n">${won(tot)}</td><td class="n">${dTot==null?'':signWon(dTot)}</td></tr></tfoot></table></div>`;
}
['asset','income'].forEach(t=>{
  const cfg=HIST[t], pre = t==='asset'?'ah':'ih';
  $(pre+'Month').onchange=()=>renderHist(t);
  $(pre+'Save').onclick=()=>saveHist(t,$(pre+'Month').value,false);
  $(pre+'Excel').onclick=()=>{ const ms=hMonths(t); if(!ms.length){ toast('저장된 기록이 없어요'); return; }
    const tmp=document.createElement('div'); tmp.innerHTML=repHist(t,ms);
    downloadXLSX(`네오달구리_${cfg.label}월별기록_${ms[0]}-${ms[ms.length-1]}.xlsx`, tablesToSheets(tmp)); };
  $(pre+'Print').onclick=()=>{ const ms=hMonths(t); if(!ms.length){ toast('저장된 기록이 없어요'); return; } printHTML(repHist(t,ms), ms.length>4); };
});
$('homeAssetHist').onclick=()=>goMaster('assets');
function goMaster(m){
  document.querySelector('.tab[data-tab="master"]').click();
  const b=document.querySelector(`#masterSeg button[data-m="${m}"]`); if(b) b.click();
  setTimeout(()=>{ const el=$(m==='assets'?'ahList':'ihList'); if(el) el.closest('.card').scrollIntoView({behavior:'smooth',block:'start'}); },60);
}

// ---------------- 출력 · 엑셀 ----------------
// 출력: 화면 대신 #printArea 만 인쇄 (가로 인쇄 옵션)
function printHTML(html, landscape){
  $('printArea').innerHTML=`<div class="report">${html}</div>`;
  let st=$('pageStyle'); if(!st){ st=document.createElement('style'); st.id='pageStyle'; document.head.appendChild(st); }
  st.textContent = landscape ? '@page{size:A4 landscape;margin:10mm}' : '@page{size:A4 portrait;margin:12mm}';
  setTimeout(()=>window.print(),80);
}
// 리포트 표(.rtable) → 엑셀 시트 데이터 (금액 칸은 숫자로)
function tablesToSheets(container){
  const sheets=[]; let title='시트';
  container.querySelectorAll('h2, table.rtable').forEach(el=>{
    if(el.tagName==='H2'){ title=el.textContent.trim(); return; }
    const rows=[];
    el.querySelectorAll('tr').forEach(tr=>{ const r=[];
      tr.querySelectorAll('th,td').forEach(c=>{ const txt=c.textContent.trim();
        const num = c.tagName==='TD' && c.classList.contains('n') && /\d/.test(txt) && /^[+\-−]?[\d,]+원?$/.test(txt.replace(/\s/g,''));
        r.push(num ? digits(txt.replace('−','-')) : txt);
        const span=+c.getAttribute('colspan')||1; for(let k=1;k<span;k++) r.push('');
      });
      rows.push(r); });
    sheets.push({name:title, rows});
  });
  return sheets;
}
let _xlsxP=null;
function loadXLSX(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  if(!_xlsxP) _xlsxP=new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload=()=>window.XLSX?res(window.XLSX):rej(new Error('xlsx')); s.onerror=()=>{ _xlsxP=null; rej(new Error('xlsx load')); }; document.head.appendChild(s); });
  return _xlsxP;
}
const strW = (s)=> [...String(s==null?'':s)].reduce((w,ch)=> w + (/[ㄱ-ㅎ가-힣\u3000-\u9fff\uff00-\uffef]/.test(ch)?2:1), 0);
async function downloadXLSX(filename, sheets){
  sheets=(sheets||[]).filter(s=>s.rows && s.rows.length);
  if(!sheets.length){ toast('내보낼 표가 없어요. 먼저 「보기」를 눌러주세요'); return; }
  toast('엑셀 파일 만드는 중…');
  try{
    const X=await loadXLSX(); const wb=X.utils.book_new(); const used=new Set();
    sheets.forEach(sh=>{
      const ws=X.utils.aoa_to_sheet(sh.rows);
      const rg=X.utils.decode_range(ws['!ref']);
      for(let R=rg.s.r;R<=rg.e.r;R++) for(let C=rg.s.c;C<=rg.e.c;C++){ const c=ws[X.utils.encode_cell({r:R,c:C})]; if(c && c.t==='n') c.z='#,##0'; }
      const ncol=Math.max(...sh.rows.map(r=>r.length));
      ws['!cols']=Array.from({length:ncol},(_,i)=>({wch: Math.min(40, Math.max(6, ...sh.rows.map(r=> typeof r[i]==='number' ? fmtInt(r[i]).length+2 : strW(r[i])+2)))}));
      let nm=String(sh.name||'시트').replace(/[\[\]\*\?\/\\:]/g,' ').slice(0,28).trim()||'시트'; let k=2, base0=nm; while(used.has(nm)) nm=`${base0}(${k++})`; used.add(nm);
      X.utils.book_append_sheet(wb,ws,nm);
    });
    X.writeFile(wb, filename);
    toast('📊 엑셀 저장됨');
  }catch(e){
    console.warn('xlsx 실패 → CSV',e);
    const rows=[]; sheets.forEach((sh,i)=>{ if(i) rows.push([]); rows.push([sh.name]); sh.rows.forEach(r=>rows.push(r)); });
    const csv=rows.map(r=>r.map(v=>{ const s=String(v==null?'':v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(',')).join('\r\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
    a.download=filename.replace(/\.xlsx$/,'.csv'); document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1500);
    toast('인터넷 문제로 엑셀 대신 CSV로 저장했어요 (엑셀에서 열려요)',3500);
  }
}

// ---------------- init ----------------
function init(){
  $('qDate').value=todayISO(); $('eDate').value=todayISO();
  ['qAmount','eAmount','fAmt','incAmt','fxAmt','asAmt','edAmount','balAmount','fiAmt'].forEach(id=>wireMoney($(id)));
  syncKind($('qKind'),$('qCat'),$('qPay')); syncKind($('eKind'),$('eCat'),$('ePay'));
  fillSelects();
  renderAll();
  if(!S.code) openShare();
}
init();
