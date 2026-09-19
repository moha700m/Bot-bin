import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownLeft, ArrowUpRight, Check, CircleDollarSign,
  LogOut, PauseCircle, Play, RefreshCcw, Shield, ShieldCheck, SlidersHorizontal,
  Target, Wallet, X, Zap
} from 'lucide-react';

type Mode='OFF'|'MANAGE_ONLY'|'APPROVAL'|'FULL_AUTO';
interface State {
  now:number;
  settings:{mode:Mode;maxRiskPerTradePct:number;maxDailyLossPct:number;maxOpenPositions:number;maxAutoLeverage:number;maxNotionalPctOfEquity:number;tp1ClosePct:number;tp2ClosePct:number;minQuoteVolume24h:number};
  execution:{dryRun:boolean;allowLiveTrading:boolean;liveTradingEnabled:boolean};
  connection:{configured:boolean;error?:string};
  account:null|{totalWalletBalance:string;totalMarginBalance:string;availableBalance:string;totalUnrealizedProfit:string};
  positions:Array<{symbol:string;positionAmt:string;entryPrice:string;breakEvenPrice?:string;markPrice:string;unRealizedProfit:string;liquidationPrice:string;leverage:string;marginType:string;positionSide:string}>;
  plans:Array<{symbol:string;side:'LONG'|'SHORT';entry:number;stop:number;tp1:number;tp2:number;tp3:number;tp1Done:boolean;tp2Done:boolean;status:string;source:string;updatedAt:number}>;
  signals:Array<{id:string;symbol:string;side:'LONG'|'SHORT';status:string;score:number;entry:number;stop:number;tp1:number;tp2:number;tp3:number;leverage:number;reason:string;createdAt:number;expiresAt:number}>;
  audit:Array<{id:number;ts:number;level:string;event:string;symbol?:string;details:any}>;
}

async function api<T>(path:string, init?:RequestInit):Promise<T>{
  const res=await fetch(path,{credentials:'include',headers:{'Content-Type':'application/json','X-Trading-Console':'1',...(init?.headers||{})},...init});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.message||data.error||`HTTP ${res.status}`);
  return data as T;
}

function money(v:string|number|undefined, digits=2){
  const n=Number(v??0); return Number.isFinite(n)?new Intl.NumberFormat('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n):'—';
}
function price(v:string|number|undefined){
  const n=Number(v??0); if(!Number.isFinite(n))return '—';
  const d=n>=100?2:n>=1?4:n>=0.1?5:7;return n.toFixed(d);
}
function pnlPct(pos:State['positions'][number]){
  const entry=Number(pos.entryPrice), mark=Number(pos.markPrice), lev=Number(pos.leverage), amt=Number(pos.positionAmt);
  if(!entry)return 0;return ((mark-entry)/entry)*(amt>=0?1:-1)*lev*100;
}

export function App(){
  const [auth,setAuth]=useState<boolean|null>(null);
  const [password,setPassword]=useState('');
  const [state,setState]=useState<State|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState('');
  const [tab,setTab]=useState<'positions'|'signals'|'settings'|'audit'>('positions');

  useEffect(()=>{api<{authenticated:boolean}>('/api/auth/me').then(x=>setAuth(x.authenticated)).catch(()=>setAuth(false));},[]);
  useEffect(()=>{
    if(!auth)return;
    let active=true;
    const load=()=>api<State>('/api/state').then(s=>{if(active){setState(s);setError('');}}).catch(e=>{if(active)setError(e.message);});
    void load();const id=setInterval(load,3000);return()=>{active=false;clearInterval(id);};
  },[auth]);

  async function login(e:React.FormEvent){
    e.preventDefault();setBusy('login');setError('');
    try{await api('/api/auth/login',{method:'POST',body:JSON.stringify({password})});setAuth(true);setPassword('');}
    catch(e){setError((e as Error).message);}finally{setBusy('');}
  }
  async function logout(){await api('/api/auth/logout',{method:'POST'}).catch(()=>undefined);setAuth(false);setState(null);}
  async function action(key:string,fn:()=>Promise<any>){setBusy(key);setError('');try{await fn();setState(await api<State>('/api/state'));}catch(e){setError((e as Error).message);}finally{setBusy('');}}

  if(auth===null)return <div className="center"><div className="loader" /></div>;
  if(!auth)return <Login password={password} setPassword={setPassword} login={login} error={error} busy={busy==='login'} />;
  if(!state)return <div className="center"><div className="loader" /><p>جاري تحميل مركز التداول...</p></div>;

  const unreal=Number(state.account?.totalUnrealizedProfit||0);
  const open=state.positions.length;
  return <div className="shell">
    <header className="topbar">
      <div className="brand"><div className="brandmark"><Zap size={18}/></div><div><strong>Futures Command Center</strong><span>Binance USD-M</span></div></div>
      <div className="top-actions">
        <StatusPill live={state.execution.liveTradingEnabled} dry={state.execution.dryRun} configured={state.connection.configured}/>
        <button className="iconbtn" onClick={()=>action('refresh',async()=>undefined)} aria-label="تحديث"><RefreshCcw size={18} className={busy==='refresh'?'spin':''}/></button>
        <button className="iconbtn" onClick={logout} aria-label="تسجيل الخروج"><LogOut size={18}/></button>
      </div>
    </header>

    <main>
      {!state.connection.configured && <Banner tone="warn" title="مفاتيح Binance غير مضبوطة">الواجهة تعمل، لكن قراءة حسابك وتنفيذ الأوامر متوقفة حتى تضيف BINANCE_API_KEY وBINANCE_API_SECRET إلى متغيرات البيئة.</Banner>}
      {state.connection.error && <Banner tone="danger" title="خطأ اتصال Binance">{state.connection.error}</Banner>}
      {state.execution.dryRun && <Banner tone="info" title="وضع المحاكاة مفعل">لن يرسل النظام أي أمر حقيقي إلى Binance حتى تجعل DRY_RUN=false وALLOW_LIVE_TRADING=true معًا.</Banner>}
      {error && <Banner tone="danger" title="تعذر تنفيذ العملية">{error}</Banner>}

      <section className="hero-grid">
        <Metric icon={<Wallet/>} label="رصيد الهامش" value={`${money(state.account?.totalMarginBalance)} USDT`} sub={`المتاح ${money(state.account?.availableBalance)} USDT`}/>
        <Metric icon={<CircleDollarSign/>} label="الربح غير المحقق" value={`${unreal>=0?'+':''}${money(unreal)} USDT`} positive={unreal>=0} negative={unreal<0} sub={`${open} مراكز مفتوحة`}/>
        <Metric icon={<ShieldCheck/>} label="وضع التشغيل" value={modeLabel(state.settings.mode)} sub={`حد المخاطرة ${state.settings.maxRiskPerTradePct}%`}/>
        <Metric icon={<Activity/>} label="حالة التنفيذ" value={state.execution.liveTradingEnabled?'LIVE':'SAFE'} positive={state.execution.liveTradingEnabled} sub={state.execution.liveTradingEnabled?'الأوامر الحقيقية مفعلة':'لا توجد أوامر تلقائية حقيقية'}/>
      </section>

      <section className="toolbar">
        <nav className="tabs" aria-label="أقسام النظام">
          <button className={tab==='positions'?'active':''} onClick={()=>setTab('positions')}>المراكز <b>{state.positions.length}</b></button>
          <button className={tab==='signals'?'active':''} onClick={()=>setTab('signals')}>الإشارات <b>{state.signals.filter(s=>s.status==='PENDING').length}</b></button>
          <button className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}>التحكم</button>
          <button className={tab==='audit'?'active':''} onClick={()=>setTab('audit')}>السجل</button>
        </nav>
        <div className="toolbar-actions">
          <button className="btn secondary" disabled={!!busy} onClick={()=>action('scan',()=>api('/api/scan',{method:'POST'}))}><RefreshCcw size={16}/> فحص السوق</button>
          <button className="btn danger-ghost" disabled={!!busy||state.settings.mode==='OFF'} onClick={()=>action('kill',()=>api('/api/kill-switch',{method:'POST'}))}><PauseCircle size={16}/> إيقاف آلي</button>
        </div>
      </section>

      {tab==='positions' && <Positions state={state} action={action} busy={busy}/>} 
      {tab==='signals' && <Signals state={state} action={action} busy={busy}/>} 
      {tab==='settings' && <Settings state={state} action={action} busy={busy}/>} 
      {tab==='audit' && <Audit rows={state.audit}/>} 
    </main>
  </div>;
}

function Login({password,setPassword,login,error,busy}:{password:string;setPassword:(x:string)=>void;login:(e:React.FormEvent)=>void;error:string;busy:boolean}){
  return <div className="login-wrap"><div className="login-card">
    <div className="brandmark large"><Shield size={26}/></div>
    <p className="eyebrow">PRIVATE TRADING CONSOLE</p><h1>مركز أوامر الفيوتشر</h1>
    <p className="muted">لوحة خاصة لإدارة مراكز Binance Futures، الوقف، جني الأرباح، والإشارات الآلية.</p>
    <form onSubmit={login}><label>كلمة مرور لوحة التحكم<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} autoFocus /></label>
      {error&&<div className="form-error">{error}</div>}<button className="btn primary wide" disabled={busy}>{busy?'جاري التحقق...':'دخول آمن'}</button></form>
  </div></div>;
}

function StatusPill({live,dry,configured}:{live:boolean;dry:boolean;configured:boolean}){
  const label=!configured?'غير متصل':live?'LIVE':dry?'DRY RUN':'مقفل';return <span className={`status ${live?'live':!configured?'down':'safe'}`}><i/>{label}</span>;
}
function Banner({tone,title,children}:{tone:'warn'|'danger'|'info';title:string;children:any}){return <div className={`banner ${tone}`}><AlertTriangle size={18}/><div><strong>{title}</strong><span>{children}</span></div></div>}
function Metric({icon,label,value,sub,positive,negative}:{icon:any;label:string;value:string;sub:string;positive?:boolean;negative?:boolean}){return <article className="metric"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong className={positive?'good':negative?'bad':''}>{value}</strong><small>{sub}</small></div></article>}
function modeLabel(m:Mode){return ({OFF:'متوقف',MANAGE_ONLY:'إدارة فقط',APPROVAL:'موافقة يدوية',FULL_AUTO:'تلقائي كامل'})[m]}

function Positions({state,action,busy}:{state:State;action:(k:string,fn:()=>Promise<any>)=>Promise<void>;busy:string}){
  const plans=useMemo(()=>new Map(state.plans.map(p=>[p.symbol,p])),[state.plans]);
  const [manualOpen,setManualOpen]=useState(false);
  return <section className="content-section">
    <div className="section-head"><div><p className="eyebrow">OPEN POSITIONS</p><h2>المراكز المفتوحة</h2></div><button className="btn primary" onClick={()=>setManualOpen(v=>!v)}><Play size={16}/> صفقة يدوية</button></div>
    {manualOpen&&<ManualEntry action={action} busy={busy}/>} 
    {!state.positions.length?<Empty text="لا توجد مراكز مفتوحة في الحساب."/>:<div className="position-grid">{state.positions.map(p=><PositionCard key={p.symbol} p={p} plan={plans.get(p.symbol)} action={action} busy={busy}/>)}</div>}
  </section>;
}

function PositionCard({p,plan,action,busy}:{p:State['positions'][number];plan:State['plans'][number]|undefined;action:any;busy:string}){
  const [edit,setEdit]=useState(false);const [form,setForm]=useState({stop:plan?.stop||0,tp1:plan?.tp1||0,tp2:plan?.tp2||0,tp3:plan?.tp3||0});
  const long=Number(p.positionAmt)>0;const pnl=Number(p.unRealizedProfit);const roi=pnlPct(p);const key=`pos-${p.symbol}`;
  async function suggest(){const s=await api<any>(`/api/positions/${p.symbol}/suggest`);setForm({stop:s.stop,tp1:s.tp1,tp2:s.tp2,tp3:s.tp3});setEdit(true);}
  return <article className="position-card">
    <div className="position-top"><div><div className="symbol-row"><strong>{p.symbol.replace('USDT','')}</strong><span>USDT</span><span className={`direction ${long?'long':'short'}`}>{long?<ArrowUpRight size={13}/>:<ArrowDownLeft size={13}/>} {long?'LONG':'SHORT'} {p.leverage}x</span></div><small>{p.marginType?.toUpperCase()}</small></div><div className={`pnl ${pnl>=0?'good':'bad'}`}><strong>{pnl>=0?'+':''}{money(pnl)} USDT</strong><span>{roi>=0?'+':''}{roi.toFixed(2)}% ROI</span></div></div>
    <div className="position-stats"><Data label="الدخول" value={price(p.entryPrice)}/><Data label="Mark" value={price(p.markPrice)}/><Data label="الكمية" value={money(Math.abs(Number(p.positionAmt)),4)}/><Data label="التصفية" value={Number(p.liquidationPrice)>0?price(p.liquidationPrice):'—'}/></div>
    {plan?<div className="plan-strip"><span><ShieldCheck size={14}/> حماية نشطة</span><b>SL {price(plan.stop)}</b><b className={plan.tp1Done?'done':''}>TP1 {price(plan.tp1)}</b><b className={plan.tp2Done?'done':''}>TP2 {price(plan.tp2)}</b><b>TP3 {price(plan.tp3)}</b></div>:<div className="plan-strip unprotected"><span><AlertTriangle size={14}/> بلا خطة حماية مسجلة</span></div>}
    <div className="card-actions">
      <button disabled={!!busy} onClick={()=>action(`${key}-25`,()=>api(`/api/positions/${p.symbol}/close`,{method:'POST',body:JSON.stringify({fraction:.25})}))}>إغلاق 25%</button>
      <button disabled={!!busy} onClick={()=>action(`${key}-50`,()=>api(`/api/positions/${p.symbol}/close`,{method:'POST',body:JSON.stringify({fraction:.5})}))}>إغلاق 50%</button>
      <button className="danger-ghost" disabled={!!busy} onClick={()=>confirm(`إغلاق ${p.symbol} بالكامل؟`)&&action(`${key}-100`,()=>api(`/api/positions/${p.symbol}/close`,{method:'POST',body:JSON.stringify({fraction:1})}))}>إغلاق كامل</button>
      {plan&&<button disabled={!!busy} onClick={()=>action(`${key}-be`,()=>api(`/api/positions/${p.symbol}/breakeven`,{method:'POST'}))}>وقف عند الدخول</button>}
      <button onClick={()=>setEdit(v=>!v)}>SL/TP</button>
      {!plan&&<button onClick={()=>action(`${key}-suggest`,suggest)}>اقتراح حماية</button>}
    </div>
    {edit&&<ProtectForm symbol={p.symbol} form={form} setForm={setForm} action={action} busy={busy} onDone={()=>setEdit(false)}/>} 
  </article>;
}

function ProtectForm({symbol,form,setForm,action,busy,onDone}:{symbol:string;form:any;setForm:any;action:any;busy:string;onDone:()=>void}){
  return <div className="inline-form"><div className="four"><Num label="وقف الخسارة" value={form.stop} set={v=>setForm({...form,stop:v})}/><Num label="TP1" value={form.tp1} set={v=>setForm({...form,tp1:v})}/><Num label="TP2" value={form.tp2} set={v=>setForm({...form,tp2:v})}/><Num label="TP3" value={form.tp3} set={v=>setForm({...form,tp3:v})}/></div><button className="btn primary" disabled={!!busy||!form.stop||!form.tp1} onClick={()=>action(`protect-${symbol}`,()=>api(`/api/positions/${symbol}/protect`,{method:'POST',body:JSON.stringify(form)}).then(()=>onDone()))}><ShieldCheck size={16}/> تثبيت الحماية</button></div>
}

function ManualEntry({action,busy}:{action:any;busy:string}){
  const [f,setF]=useState({symbol:'',side:'LONG',leverage:5,stop:0,tp1:0,tp2:0,tp3:0});
  return <div className="manual-panel"><div className="form-grid"><label>الرمز<input placeholder="ENAUSDT" value={f.symbol} onChange={e=>setF({...f,symbol:e.target.value.toUpperCase()})}/></label><label>الاتجاه<select value={f.side} onChange={e=>setF({...f,side:e.target.value})}><option>LONG</option><option>SHORT</option></select></label><Num label="الرافعة" value={f.leverage} set={v=>setF({...f,leverage:v})}/><Num label="SL" value={f.stop} set={v=>setF({...f,stop:v})}/><Num label="TP1" value={f.tp1} set={v=>setF({...f,tp1:v})}/><Num label="TP2" value={f.tp2} set={v=>setF({...f,tp2:v})}/><Num label="TP3" value={f.tp3} set={v=>setF({...f,tp3:v})}/></div><div className="manual-note">الكمية لا تدخل يدويًا. محرك المخاطر يحسبها من رصيد الحساب، مسافة الوقف، وحد المخاطرة المحدد.</div><button className="btn primary" disabled={!!busy||!f.symbol||!f.stop||!f.tp1} onClick={()=>action('manual',()=>api('/api/manual-entry',{method:'POST',body:JSON.stringify({...f,side:f.side as 'LONG'|'SHORT'})}))}><Play size={16}/> إرسال الصفقة للمحرك</button></div>
}

function Signals({state,action,busy}:{state:State;action:any;busy:string}){
  const pending=state.signals.filter(s=>s.status==='PENDING');return <section className="content-section"><div className="section-head"><div><p className="eyebrow">SIGNAL ENGINE</p><h2>الإشارات</h2></div><button className="btn secondary" disabled={!!busy} onClick={()=>action('scan',()=>api('/api/scan',{method:'POST'}))}><RefreshCcw size={16}/> فحص الآن</button></div>
  {!pending.length?<Empty text="لا توجد إشارة مستوفية للشروط الآن. المحرك لا يعرض الحالات القريبة فقط."/>:<div className="signal-list">{pending.map(s=><article className="signal-card" key={s.id}><div className="signal-main"><div className={`signal-arrow ${s.side==='LONG'?'long':'short'}`}>{s.side==='LONG'?<ArrowUpRight/>:<ArrowDownLeft/>}</div><div><strong>{s.symbol}</strong><span>{s.reason}</span></div></div><div className="score">{s.score}<small>/100</small></div><div className="signal-levels"><Data label="Entry" value={price(s.entry)}/><Data label="SL" value={price(s.stop)}/><Data label="TP1" value={price(s.tp1)}/><Data label="TP2" value={price(s.tp2)}/><Data label="TP3" value={price(s.tp3)}/></div><div className="signal-actions"><button className="btn primary" disabled={!!busy} onClick={()=>action(`approve-${s.id}`,()=>api(`/api/signals/${s.id}/approve`,{method:'POST'}))}><Check size={16}/> اعتماد</button><button className="btn secondary" disabled={!!busy} onClick={()=>action(`reject-${s.id}`,()=>api(`/api/signals/${s.id}/reject`,{method:'POST'}))}><X size={16}/> رفض</button></div></article>)}</div>}
  </section>;
}

function Settings({state,action,busy}:{state:State;action:any;busy:string}){
  const [f,setF]=useState(state.settings);useEffect(()=>setF(state.settings),[state.settings]);
  const save=()=>action('settings',()=>api('/api/settings',{method:'PATCH',body:JSON.stringify(f)}));
  return <section className="content-section"><div className="section-head"><div><p className="eyebrow">RISK & AUTOMATION</p><h2>التحكم والمخاطر</h2></div><button className="btn primary" disabled={!!busy} onClick={save}><SlidersHorizontal size={16}/> حفظ</button></div>
    <div className="settings-grid"><div className="settings-card"><h3>وضع التشغيل</h3><div className="mode-grid">{(['OFF','MANAGE_ONLY','APPROVAL','FULL_AUTO'] as Mode[]).map(m=><button key={m} className={f.mode===m?'selected':''} onClick={()=>setF({...f,mode:m})}><span>{m==='OFF'?<PauseCircle/>:m==='FULL_AUTO'?<Zap/>:<Shield/>}</span><strong>{modeLabel(m)}</strong><small>{modeDesc(m)}</small></button>)}</div>{f.mode==='FULL_AUTO'&&!state.execution.allowLiveTrading&&<div className="form-error">FULL_AUTO محجوب من السيرفر حتى تضبط ALLOW_LIVE_TRADING=true.</div>}</div>
      <div className="settings-card"><h3>حدود المخاطر</h3><div className="form-grid two"><Num label="المخاطرة لكل صفقة %" value={f.maxRiskPerTradePct} set={v=>setF({...f,maxRiskPerTradePct:v})}/><Num label="حد الخسارة اليومية %" value={f.maxDailyLossPct} set={v=>setF({...f,maxDailyLossPct:v})}/><Num label="أقصى مراكز" value={f.maxOpenPositions} set={v=>setF({...f,maxOpenPositions:v})}/><Num label="أقصى رافعة آلية" value={f.maxAutoLeverage} set={v=>setF({...f,maxAutoLeverage:v})}/><Num label="أقصى Notional من Equity %" value={f.maxNotionalPctOfEquity} set={v=>setF({...f,maxNotionalPctOfEquity:v})}/><Num label="أدنى سيولة 24h USDT" value={f.minQuoteVolume24h} set={v=>setF({...f,minQuoteVolume24h:v})}/></div></div>
      <div className="settings-card"><h3>إدارة الأرباح</h3><div className="form-grid two"><Num label="إغلاق عند TP1 %" value={f.tp1ClosePct} set={v=>setF({...f,tp1ClosePct:v})}/><Num label="إغلاق عند TP2 %" value={f.tp2ClosePct} set={v=>setF({...f,tp2ClosePct:v})}/></div><p className="muted compact">بعد TP1 ينقل النظام الوقف إلى سعر الدخول. بعد TP2 ينقله إلى TP1. TP3 يملك أمر إغلاق كامل على Binance عند تفعيل التداول الحقيقي.</p></div>
      <DangerZone action={action} busy={busy}/>
    </div>
  </section>;
}
function modeDesc(m:Mode){return ({OFF:'لا إدارة ولا دخول',MANAGE_ONLY:'يدير الخطط فقط',APPROVAL:'يولد إشارات وتوافق أنت',FULL_AUTO:'يفحص وينفذ ضمن حدود المخاطر'})[m]}
function DangerZone({action,busy}:{action:any;busy:string}){return <div className="settings-card danger-zone"><h3>منطقة الطوارئ</h3><p>الإيقاف الآلي يمنع الصفقات الجديدة والإدارة التلقائية. الإغلاق الشامل يغلق كل المراكز ويلغي الأوامر ثم يوقف النظام.</p><div><button className="btn danger-ghost" disabled={!!busy} onClick={()=>action('kill',()=>api('/api/kill-switch',{method:'POST'}))}>إيقاف الأتمتة</button><button className="btn danger" disabled={!!busy} onClick={()=>confirm('تأكيد إغلاق جميع مراكز الفيوتشر؟ هذا إجراء فعلي عند تفعيل LIVE.')&&action('panic',()=>api('/api/panic-close-all',{method:'POST',body:JSON.stringify({confirm:'CLOSE_ALL'})}))}>إغلاق الكل وإيقاف</button></div></div>}

function Audit({rows}:{rows:State['audit']}){return <section className="content-section"><div className="section-head"><div><p className="eyebrow">AUDIT TRAIL</p><h2>سجل القرارات والتنفيذ</h2></div></div><div className="audit-list">{rows.map(r=><div key={r.id} className={`audit-row ${r.level.toLowerCase()}`}><time>{new Date(r.ts).toLocaleString('ar-SA')}</time><span className="audit-level">{r.level}</span><strong>{r.event}</strong><b>{r.symbol||''}</b><code>{brief(r.details)}</code></div>)}</div></section>}
function brief(v:any){const s=typeof v==='string'?v:JSON.stringify(v);return s.length>140?s.slice(0,137)+'...':s}
function Data({label,value}:{label:string;value:string}){return <div className="data"><span>{label}</span><strong>{value}</strong></div>}
function Num({label,value,set}:{label:string;value:number;set:(n:number)=>void}){return <label>{label}<input inputMode="decimal" type="number" step="any" value={value||''} onChange={e=>set(Number(e.target.value))}/></label>}
function Empty({text}:{text:string}){return <div className="empty"><Target size={30}/><p>{text}</p></div>}
