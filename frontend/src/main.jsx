import React, {Component, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Routes, Route, Link, NavLink, Navigate, useNavigate, useParams} from 'react-router-dom';
import {BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend} from 'recharts';
import L from 'leaflet';
import {MapContainer, TileLayer, GeoJSON, CircleMarker, Popup, Polyline, Marker, useMap} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './styles.css';

const API = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const DEMO_MODE = false;
const ROUTE_CORRIDOR_KM = 2;
const safeJoin = (value, separator=', ') => Array.isArray(value) ? value.filter(v => v !== null && v !== undefined && String(v).trim() !== '').map(v => String(v)).join(separator) : (value == null ? '' : String(value));

const initialAlerts = [];
const sectors = [];
const trend = [];

// --- PAIMANA (MoSPI/IPMD) national portfolio context — SIH 26103 ---
// OCMS (since 2006) was modernized into PAIMANA. These figures are official portfolio context,
// not local project records used for route matching.
const paimanaOverview = {
  asOf:'April 2026', totalProjects:1981, ministries:'17', sectors:'Multiple',
  originalCostLakhCr:37.13, revisedCostLakhCr:42.78, expenditureLakhCr:20.36,
  legacySystem:'OCMS — Online Computerised Monitoring System (since 2006)',
  currentSystem:'PAIMANA — Project Assessment, Infrastructure Monitoring and Analytics for Nation-building',
  owner:'Infrastructure & Project Monitoring Division (IPMD), Ministry of Statistics and Programme Implementation',
  topSectors:['Transport & Logistics','Energy','Water & Sanitation','Communication','Social Infrastructure','Coal','Steel','Mining'],
};
// Official April 2026 PAIMANA breakdown from the MoSPI/PIB flash report.
const paimanaSectorData = [
  {name:'Transport & Logistics',projects:1459,revisedCost:23.34,expenditure:11.59},
  {name:'Energy',projects:221,revisedCost:11.30,expenditure:5.33},
  {name:'Water & Sanitation',projects:67,revisedCost:2.30,expenditure:1.65},
  {name:'Communication',projects:12,revisedCost:0.91,expenditure:0.77},
  {name:'Social & Commercial',projects:77,revisedCost:2.73,expenditure:0.35},
  {name:'Others',projects:145,revisedCost:2.21,expenditure:0.67},
];
const paimanaMinistryData = [
  {name:'Road Transport & Highways',projects:1137}, {name:'Railways',projects:260},
  {name:'Coal',projects:128}, {name:'Petroleum & Natural Gas',projects:112},
  {name:'Power',projects:102}, {name:'Housing & Urban Affairs',projects:51},
  {name:'Water Resources',projects:48}, {name:'Higher Education',projects:30},
  {name:'Civil Aviation',projects:26}, {name:'Health & Family Welfare',projects:23},
  {name:'Steel',projects:19}, {name:'Telecommunications',projects:12},
  {name:'Labour & Employment',projects:11}, {name:'DPIIT',projects:8},
  {name:'Ports, Shipping & Waterways',projects:7}, {name:'Mines',projects:6}, {name:'Sports',projects:1},
];
const indiaStatesAndUnionTerritories = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'
];
const ministryOptions = paimanaMinistryData.map(x=>x.name);
// CUF = Common Upload Form — fields the PAIMANA/OCMS framework already captures monthly.
const cufFields = [
  {field:'Approved (Original) Cost', used:true},
  {field:'Revised Cost', used:true},
  {field:'Cumulative Expenditure', used:true},
  {field:'Physical Progress (%)', used:true},
  {field:'Implementation Timelines (Start / Completion)', used:true},
  {field:'Milestones', used:true},
  {field:'Implementing Agency', used:true},
  {field:'Project Status', used:true},
];
// Variables not presently in the CUF — proposed additions used to test technical dimension (c):
// how much predictive lift comes from CUF fields vs variables beyond the CUF.
const additionalVariables = [
  'Land acquisition / right-of-way status', 'Environmental & statutory clearance status',
  'Contractor performance / dispute history', 'Input material price index exposure',
  'Route/geospatial conflict with other infra projects', 'Drone / satellite-verified physical progress',
  'Weather & monsoon exposure window', 'Local litigation / public resistance signals',
];

function authHeaders(extra={}){
  const s=getSession(); return {...extra,...(s?.token?{Authorization:`Bearer ${s.token}`}:{})};
}
function firstValue(...values){return values.find(value=>value!==undefined&&value!==null&&String(value).trim()!=='')??null}
function projectType(project){
  const text=String([project.type,project.sector,project.name].filter(Boolean).join(' ')).toLowerCase();
  if(/bridge|rob|flyover|elevated/.test(text))return 'Bridge / Road';
  if(/rail|metro/.test(text))return 'Rail / Metro';
  if(/water|pipeline|irrigation|sanitation|drainage/.test(text))return 'Water / Pipeline';
  if(/airport|aviation/.test(text))return 'Aviation';
  if(/power|electric|energy|transmission/.test(text))return 'Power / Energy';
  if(/road|highway|transport|lane/.test(text))return 'Road / Highway';
  return firstValue(project.type,project.sector,'Infrastructure');
}
function normalizeProjectRecord(p){
  const x={...p};
  x.id=firstValue(x.id,x.projectId,x.project_id);
  x.name=firstValue(x.name,x.projectName,x.project_name);
  x.originalCost=firstValue(x.originalCost,x.approvedCost,x.approved_cost,x.original_cost);
  x.cost=firstValue(x.cost,x.revisedCost,x.revised_cost,x.currentCost,x.originalCost);
  x.revisedCost=firstValue(x.revisedCost,x.revised_cost,x.cost);
  x.expenditure=firstValue(x.expenditure,x.cumulativeExpenditure,x.cumulative_expenditure);
  x.progress=firstValue(x.progress,x.physicalProgress,x.physical_progress);
  x.financialProgress=firstValue(x.financialProgress,x.financial_progress);
  x.start=firstValue(x.start,x.startDate,x.start_date);
  x.targetCompletion=firstValue(x.targetCompletion,x.expectedCompletion,x.expected_completion,x.target_completion);
  x.revisedCompletion=firstValue(x.revisedCompletion,x.revised_completion,x.completionDate,x.completion_date);
  x.completion=firstValue(x.completion,x.revisedCompletion,x.targetCompletion);
  x.status=firstValue(x.status,x.currentStatus,x.current_status,'Ongoing');
  x.agency=firstValue(x.agency,x.implementingAgency,x.implementing_agency,x.ministry);
  x.lat=firstValue(x.lat,x.latitude);
  x.lng=firstValue(x.lng,x.longitude,x.lon);
  x.sourceType=firstValue(x.sourceType,x.source_type,x.source);
  x.lastUpdated=firstValue(x.lastUpdated,x.updatedAt,x.updateDate,x.update_date,x.sourceDate,x.source_date);
  x.type=projectType(x);
  x.location=firstValue(x.location,x.locality,x.district,x.state);
  if(x.financialProgress==null && Number.isFinite(Number(x.expenditure)) && Number(x.cost)>0){
    x.financialProgress=Math.max(0,Math.min(100,Math.round(Number(x.expenditure)/Number(x.cost)*1000)/10));
  }
  if(x.progress!=null&&Number.isFinite(Number(x.progress)))x.progress=Number(x.progress);
  if(x.financialProgress!=null&&Number.isFinite(Number(x.financialProgress)))x.financialProgress=Number(x.financialProgress);
  if(x.lat!=null)x.lat=Number(x.lat);
  if(x.lng!=null)x.lng=Number(x.lng);
  return x;
}
function useProjects(){
  const [projects,setProjects]=useState([]);
  const load=()=>fetch(`${API}/projects`,{headers:authHeaders({Accept:'application/json'})}).then(r=>{if(!r.ok)throw new Error('Project registry unavailable');return r.json()});
  useEffect(()=>{let live=true;load().then(rows=>{if(live)setProjects(Array.isArray(rows)?rows.map(normalizeProjectRecord):[])}).catch(()=>{if(live)setProjects([])});return()=>{live=false}},[]);
  return [projects,setProjects];
}
function useAlerts(){
 const [alerts,setAlerts]=useState([]);
 useEffect(()=>{let live=true;fetch(`${API}/alerts`,{headers:authHeaders()}).then(r=>r.ok?r.json():[]).then(x=>{if(live)setAlerts(Array.isArray(x)?x:[])}).catch(()=>{if(live)setAlerts([])});return()=>{live=false}},[]);
 return [alerts,setAlerts];
}
function riskClass(r){ return String(r||'Low').toLowerCase().replace(' ','-'); }

function getSession(){try{return JSON.parse(localStorage.getItem('irr_session')||'null')}catch{return null}}
function setSession(data){localStorage.setItem('irr_session',JSON.stringify(data))}
async function logout(){
  try{await fetch(`${API}/auth/logout`,{method:'POST',headers:authHeaders()})}catch{}
  localStorage.removeItem('irr_session');window.location.href='/login';
}
async function reauthenticateAdmin(){
 const key=window.prompt('Enter Administrator Key to authorize this change:'); if(!key)return false;
 const r=await fetch(`${API}/auth/verify-key`,{method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify({adminKey:key})});
 const d=await r.json().catch(()=>({})); if(!r.ok){alert(''+(d.error||'Administrator authentication failed.'));return false} return true;
}
function Login(){
 const navigate=useNavigate(); const googleButtonRef=useRef(null); const googleClientId=String(import.meta.env.VITE_GOOGLE_CLIENT_ID||'').trim();
 const [mode,setMode]=useState('login'); const [role,setRole]=useState('General User'); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [name,setName]=useState(''); const [adminKey,setAdminKey]=useState(''); const [error,setError]=useState(''); const [notice,setNotice]=useState(''); const [keyExists,setKeyExists]=useState(false); const [googleReady,setGoogleReady]=useState(false);
 useEffect(()=>{if(import.meta.env.DEV)console.info(`[Infra Risk Radar] Google Client ID configured: ${Boolean(googleClientId)}`)},[googleClientId]);
 useEffect(()=>{fetch(`${API}/auth/status`).then(r=>r.json()).then(d=>setKeyExists(Boolean(d.keyExists))).catch(()=>{});},[]);
 const handleGoogleCredential=async(response)=>{setError('');setNotice('');try{
   if(!response?.credential)throw new Error('Google sign-in was cancelled.');
   if(role==='Administrator'&&!adminKey)throw new Error('Enter the Administrator Key before using Google Administrator sign-in.');
   const r=await fetch(`${API}/auth/google`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:response.credential,role,adminKey})});
   const d=await r.json().catch(()=>({})); if(!r.ok)throw new Error(d.error||'Google sign-in failed.');
   setSession(d);navigate('/');
 }catch(e){setError(e.message||'Google sign-in failed.');}};
 useEffect(()=>{
   if(mode!=='login'||!googleClientId||!googleButtonRef.current)return;
   let cancelled=false;
  const init=()=>{if(cancelled||!window.google?.accounts?.id||!googleButtonRef.current)return; try{googleButtonRef.current.innerHTML=''; window.google.accounts.id.initialize({client_id:googleClientId,callback:handleGoogleCredential,auto_select:false,cancel_on_tap_outside:true}); window.google.accounts.id.renderButton(googleButtonRef.current,{theme:'outline',size:'large',width:360,text:'continue_with',shape:'rectangular',logo_alignment:'left'}); setGoogleReady(true);}catch(error){setError(error?.message||'Google sign-in failed. Please try again.');}};
  const handleScriptError=()=>setError('Google sign-in failed. Please try again.');
  if(window.google?.accounts?.id)init(); else {let script=document.querySelector('script[data-google-gsi]'); if(!script){script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.defer=true;script.dataset.googleGsi='true';document.head.appendChild(script);} script.addEventListener('load',init,{once:true});script.addEventListener('error',handleScriptError,{once:true});}
   return()=>{cancelled=true;};
 },[mode,role,adminKey,googleClientId]);
 const submit=async(e)=>{e.preventDefault();setError('');setNotice('');try{
   if(mode==='register'){
     const r=await fetch(`${API}/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password,role,adminKey})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Registration failed');setSession(d);setNotice(`${role} account created successfully.`);navigate('/');return;
   }
   const r=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,role,adminKey})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Login failed');setSession(d);navigate('/');
 }catch(e){setError(e.message)}};
 const generateKey=async()=>{setError('');setNotice('');try{const r=await fetch(`${API}/auth/key/generate`,{method:'POST',headers:authHeaders({'Content-Type':'application/json'})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not generate administrator key');setAdminKey(d.key);setKeyExists(true);setNotice(d.firstSetup?'Administrator key generated. Save it securely.':'New administrator key generated successfully.');}catch(e){setError(e.message)}};
 return <div className="login-page"><div className="login-visual"><div className="login-visual-inner"><div className="login-brand-mark"><span>IR</span></div><h1>Infra Risk Radar</h1><h2 className="login-national-heading">National Infrastructure Decision Support</h2><p>Monitor projects, understand route impacts, and turn infrastructure evidence into early warnings.</p><div className="login-feature-grid"><span><b>01</b> Risk monitoring</span><span><b>02</b> Route intelligence</span><span><b>03</b> Project evidence</span><span><b>04</b> EVM analytics</span></div></div></div><div className="login-card"><div className="login-card-top"><div className="brand compact"><div className="brand-mark">IR</div><div><b>Infra Risk Radar</b><small>Infrastructure intelligence portal</small></div></div><span className="secure-badge">Secure access</span></div><h2>{mode==='login'?'Welcome Back':'Create Account'}</h2><p className="muted">{mode==='login'?'Sign in to continue to the monitoring platform':'Create a portal account'}</p>
 <div className="role-switch"><button type="button" className={role==='General User'?'active':''} onClick={()=>{setRole('General User');setError('')}}>General User</button><button type="button" className={role==='Administrator'?'active':''} onClick={()=>{setRole('Administrator');setError('')}}>Administrator</button></div>
 <form onSubmit={submit}>{mode==='register'&&<Field label="Full Name"><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" required/></Field>}<Field label="Email address"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@gov.in" required/></Field><Field label="Password"><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password (min 6 characters)" minLength="6" required/></Field>
 {role==='Administrator'&&<Field label="Administrator Key"><div className="inline-field"><input value={adminKey} onChange={e=>setAdminKey(e.target.value)} placeholder="Enter administrator key" required={role==='Administrator'}/>{!keyExists&&<button type="button" className="ghost" onClick={generateKey}>Generate</button>}</div>{keyExists&&mode==='login'&&<small className="field-help">Use the administrator key created during initial setup.</small>}</Field>}
 {error&&<div className="form-note error">{error}</div>}{notice&&<div className="form-note success">{notice}</div>}<button className="primary login-submit">{mode==='login'?'Sign In':'Create Account'}</button></form>
 <div className="login-demo">{role==='Administrator'?'Administrator actions require backend authentication and the administrator key.':'General users have view/search access only.'}</div>
 <button className="link-button" onClick={()=>{setMode(mode==='login'?'register':'login');setError('');setNotice('')}}>{mode==='login'?"Don't have an account? Register":"Already have an account? Sign in"}</button></div></div>
}
function Protected({children}){return getSession()?children:<Navigate to="/login" replace/>}

function Layout({children}){
  const session=getSession(); const isAdmin=session?.user?.role==='Administrator'||session?.role==='Administrator';
  const userName=session?.user?.name || session?.name || 'User';
  const items = [
    ['Dashboard','/'],['PAIMANA · 1,981','/paimana'],['Map & Conflict','/route'],['Projects','/projects'],['Predictive Analytics','/predictive'],['EVM','/evm'],['Risk Assessment','/risk'],['Dependencies','/dependencies'],['Drone / Imagery','/imagery'],['Reports','/reports'],['Alerts','/alerts']
  ];
  const navIcons={'Dashboard':'dashboard','PAIMANA · 1,981':'paimana','Map & Conflict':'map','Projects':'project','Predictive Analytics':'predictive','EVM':'risk','Risk Assessment':'risk','Dependencies':'dependency','Drone / Imagery':'drone','Reports':'report','Alerts':'alert'};
  return <div className="app"><aside className="sidebar"><div className="brand"><div className="brand-mark"><span>IR</span></div><div><b>Infra Risk Radar</b><small>National Infrastructure Intelligence Platform</small></div></div><nav>{items.map(([label,path])=><NavLink key={path} to={path} className={({isActive})=>isActive?'active':''}><span className="nav-icon"><Icon name={navIcons[label]||'dashboard'} /></span><span>{label}</span></NavLink>)}</nav><div className="sidebar-quick-actions">{isAdmin&&<NavLink className={({isActive})=>isActive?'quick-link active':'quick-link'} to="/add"><span className="quick-icon"><Icon name="project" /></span> Add New Project</NavLink>}<NavLink className={({isActive})=>isActive?'quick-link ai active':'quick-link ai'} to="/assistant"><span className="quick-icon"><Icon name="assistant" /></span> AI Assistance</NavLink></div><div className="admin"><span>{isAdmin?'Administrator':'General User'}</span><button className="logout-mini" onClick={logout}><Icon name="logout" /> <span>Logout</span></button></div></aside><main className="main"><header className="topbar"><div className="mobile-title">Infra Risk Radar</div><div className="topbar-brand"><div className="topbar-dot">M</div><div><b>Ministry of Statistics and Programme Implementation</b><small>Government of India</small></div></div><div className="topbar-actions"><div className="status-pill"><span className="status-dot" /> {isAdmin?'Administrator':'General User'}</div><button className="icon-btn" aria-label="Notifications"><Icon name="bell" /></button><div className="user-chip"><span className="user-avatar">{userName.charAt(0).toUpperCase()}</span><span>{userName}</span></div><button className="logout-top" onClick={logout}>Logout</button></div></header><div className="content">{children}</div></main></div>
}
function SectionTitle({title,sub}){return <div className="page-title"><div><h1>{title}</h1>{sub&&<p>{sub}</p>}</div></div>}
function Stat({label,value,type}){return <div className={'stat '+type}><div className="stat-icon">{type==='total'?'▣':type==='high'?'⚠':type==='medium'?'◐':'●'}</div><div><small>{label}</small><strong>{value}</strong></div></div>}
function RiskBadge({value}){return <span className={'badge '+riskClass(value)}>{value}</span>}
function Icon({name,className=''}){
  const common={viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:'1.8',strokeLinecap:'round',strokeLinejoin:'round',className};
  switch(name){
    case 'dashboard': return <svg {...common}><path d="M4 13.5V5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v8A1.5 1.5 0 0 1 18.5 15H15v3.5h3.5M4 9h16M9 15v3M15 15v3"/></svg>;
    case 'paimana': return <svg {...common}><path d="M4 18V6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5V18"/><path d="M7 9h10M7 13h10M7 17h6"/></svg>;
    case 'map': return <svg {...common}><path d="M9 4 3.5 6.5v13L9 15l6 4.5 5.5-2.5v-13L15 9 9 4Z"/><path d="M9 4v11M15 9v8"/></svg>;
    case 'project': return <svg {...common}><path d="M7 4.5h6l4 4V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z"/><path d="M13 4.5v4h4M8 11h8M8 15h8"/></svg>;
    case 'predictive': return <svg {...common}><path d="M5 17.5 9 13l3 3 7-8"/><path d="M18 8h2v2M4 18h16"/></svg>;
    case 'risk': return <svg {...common}><path d="M12 3.5 19.5 18A1.5 1.5 0 0 1 18.1 20H5.9a1.5 1.5 0 0 1-1.4-2L12 3.5Z"/><path d="M12 9v4M12 16.5h.01"/></svg>;
    case 'dependency': return <svg {...common}><circle cx="7" cy="6" r="2.5"/><circle cx="17" cy="10" r="2.5"/><circle cx="11" cy="17" r="2.5"/><path d="M9.3 7.7 14.9 9.2M9.2 15.2 14.5 11.5"/></svg>;
    case 'drone': return <svg {...common}><path d="M9 5h6M6 8h12M8 8V5M16 8V5M7 11h10l2 8H5l2-8Z"/><path d="M9 15h6"/></svg>;
    case 'report': return <svg {...common}><path d="M7 4.5h8l4 4V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z"/><path d="M15 4.5v4h4M8 12h8M8 16h8"/></svg>;
    case 'alert': return <svg {...common}><path d="M12 4.5a5.5 5.5 0 0 1 5.5 5.5v3.4L19 16.5H5l1.5-3.1V10A5.5 5.5 0 0 1 12 4.5Z"/><path d="M10 18.5a2 2 0 0 0 4 0"/></svg>;
    case 'assistant': return <svg {...common}><path d="M9 18.5h6M8.5 7.5A3.5 3.5 0 0 1 12 4a3.5 3.5 0 0 1 3.5 3.5V9a3.5 3.5 0 0 1-3.5 3.5H12A3.5 3.5 0 0 1 8.5 9V7.5Z"/><path d="M8 12.5v3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3"/></svg>;
    case 'logout': return <svg {...common}><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h7A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 9 18.5V17"/><path d="M14 12h-9M8 9l-3 3 3 3"/></svg>;
    case 'bell': return <svg {...common}><path d="M15 17H9m6-1.5V10a3 3 0 1 0-6 0v5.5L6 17h12l-3-1.5Z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>;
    case 'shield': return <svg {...common}><path d="M12 3.5 18 5.7v5.4c0 4.1-2.5 7.4-6 9.4-3.5-2-6-5.3-6-9.4V5.7l6-2.2Z"/></svg>;
    case 'search': return <svg {...common}><circle cx="11" cy="11" r="5.5"/><path d="m16 16 4 4"/></svg>;
    default: return <svg {...common}><circle cx="12" cy="12" r="7"/></svg>;
  }
}

function IndiaRiskMap({projects}){
  const [geo,setGeo]=useState(null);
  useEffect(()=>{
    let live=true;
    fetch('https://raw.githubusercontent.com/geohacker/india/master/state/india_state.geojson')
      .then(r=>r.ok?r.json():Promise.reject(new Error('India boundary unavailable')))
      .then(g=>{if(live)setGeo(g)}).catch(()=>{if(live)setGeo(null)});
    return()=>{live=false};
  },[]);
  const stateStats=useMemo(()=>{
    const map={};
    (projects||[]).forEach(p=>{
      const state=String(p.state||'').trim(); if(!state)return;
      if(!map[state])map[state]={total:0,high:0,medium:0,low:0};
      map[state].total++;
      const r=String(p.risk||'').toLowerCase();
      if(r==='high')map[state].high++; else if(r==='medium')map[state].medium++; else map[state].low++;
    });
    return map;
  },[projects]);
  const keyState=name=>{
    const n=String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const aliases={
      andamanandnicobarislands:'Andaman and Nicobar Islands',andhrapradesh:'Andhra Pradesh',
      arunachalpradesh:'Arunachal Pradesh',assam:'Assam',bihar:'Bihar',chhattisgarh:'Chhattisgarh',
      goa:'Goa',gujarat:'Gujarat',haryana:'Haryana',himachalpradesh:'Himachal Pradesh',
      jharkhand:'Jharkhand',karnataka:'Karnataka',kerala:'Kerala',madhyapradesh:'Madhya Pradesh',
      maharashtra:'Maharashtra',manipur:'Manipur',meghalaya:'Meghalaya',mizoram:'Mizoram',
      nagaland:'Nagaland',odisha:'Odisha',punjab:'Punjab',rajasthan:'Rajasthan',sikkim:'Sikkim',
      tamilnadu:'Tamil Nadu',telangana:'Telangana',tripura:'Tripura',uttarpradesh:'Uttar Pradesh',
      uttarakhand:'Uttarakhand',westbengal:'West Bengal',delhi:'Delhi',puducherry:'Puducherry',
      jammuandkashmir:'Jammu and Kashmir',ladakh:'Ladakh'
    };
    return aliases[n]||name;
  };
  const styleFeature=feature=>{
    const props=feature?.properties||{};
    const name=props.NAME_1||props.ST_NM||props.name||props.NAME||'';
    const st=stateStats[keyState(name)]||{total:0,high:0,medium:0,low:0};
    const risk=st.high>=Math.max(1,st.medium)?'high':st.medium?'medium':'low';
    return {color:'#6b8bb4',weight:1,fillColor:risk==='high'?'#ef3340':risk==='medium'?'#f4a300':'#16a765',fillOpacity:st.total?0.38:0.12};
  };
  return <div className="map-card">
    <div className="card-head"><h3>PAIMANA Project Risk Map</h3><span className="muted">State-level portfolio risk · {projects?.length||0} records</span></div>
    <div className="map-wrap">
      <MapContainer center={[22.8,79.2]} zoom={4.6} scrollWheelZoom={true} style={{height:'100%',width:'100%'}}>
        <TileLayer attribution="© OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
        {geo && <GeoJSON data={geo} style={styleFeature} onEachFeature={(feature,layer)=>{
          const props=feature?.properties||{}; const name=props.NAME_1||props.ST_NM||props.name||props.NAME||'State';
          const st=stateStats[keyState(name)]||{total:0,high:0,medium:0,low:0};
          layer.bindPopup(`<b>${name}</b><br/>PAIMANA records: <b>${st.total}</b><br/>High: ${st.high} · Medium: ${st.medium} · Low: ${st.low}`);
        }}/> }
      </MapContainer>
    </div>
    <div className="legend"><span><i className="dot high"></i>High concentration</span><span><i className="dot medium"></i>Medium concentration</span><span><i className="dot low"></i>Lower concentration</span></div>
    <p className="method-note">PAIMANA April 2026 provides project-level monitoring data but not universal GPS geometry. This map therefore aggregates risk at state level; the Map & Conflict page uses route geometry for project matching.</p>
  </div>
}

function PaimanaOverview(){
 const [o,setO]=useState(paimanaOverview); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
 useEffect(()=>{let live=true;fetch(`${API}/paimana-overview`).then(r=>{if(!r.ok)throw new Error('PAIMANA data unavailable');return r.json()}).then(d=>{if(live)setO({...paimanaOverview,...d})}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[]);
 const overrunLakhCr=Math.round((Number(o.revisedCostLakhCr)-Number(o.originalCostLakhCr))*100)/100;
 const overrunPct=Math.round((overrunLakhCr/Number(o.originalCostLakhCr))*1000)/10;
 const expenditurePct=Math.round((Number(o.expenditureLakhCr)/Number(o.revisedCostLakhCr))*1000)/10;
 return <Layout><SectionTitle title="PAIMANA — April 2026" sub="Official MoSPI / IPMD national portfolio snapshot for Central Sector Infrastructure Projects worth ₹150 crore and above"/>
  {loading&&<div className="form-note">Loading PAIMANA data…</div>}{error&&<div className="form-note error">{error} Showing the configured April 2026 official snapshot.</div>}
  <div className="stats">
    <Stat label="PAIMANA Projects" value={Number(o.totalProjects).toLocaleString()} type="total"/>
    <Stat label="Central Ministries / Depts" value={o.ministries} type="medium"/>
    <Stat label="Revised Cost" value={'₹ '+o.revisedCostLakhCr+' L Cr'} type="low"/>
    <Stat label="Cumulative Expenditure" value={'₹ '+o.expenditureLakhCr+' L Cr'} type="high"/>
  </div>
  <div className="grid2">
    <div className="card"><h3>Official Sector-wise Portfolio — 1,981 Projects</h3><ResponsiveContainer width="100%" height={300}><BarChart data={paimanaSectorData} layout="vertical" margin={{left:10,right:20}}><CartesianGrid strokeDasharray="3 3"/><XAxis type="number"/><YAxis dataKey="name" type="category" width={125} tick={{fontSize:10}}/><Tooltip/><Bar dataKey="projects" fill="#2478e8" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer></div>
    <div className="card"><h3>Official Ministry / Department Counts</h3><ResponsiveContainer width="100%" height={300}><BarChart data={paimanaMinistryData} margin={{left:10,right:15,bottom:45}}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name" angle={-45} textAnchor="end" interval={0} height={100} tick={{fontSize:8}}/><YAxis/><Tooltip/><Bar dataKey="projects" fill="#16a765" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div>
  </div>
  <div className="grid2">
    <div className="card"><h3>Portfolio Cost Position (₹ Lakh Crore)</h3>
      <div className="metric-box"><span>Original (Approved) Cost</span><b>₹ {o.originalCostLakhCr} L Cr</b></div>
      <div className="metric-box"><span>Revised Cost</span><b>₹ {o.revisedCostLakhCr} L Cr</b></div>
      <div className="metric-box"><span>Cumulative Expenditure</span><b>₹ {o.expenditureLakhCr} L Cr ({expenditurePct}% of revised cost)</b></div>
      <div className="metric-box"><span>Net Cost Escalation</span><b>₹ {overrunLakhCr} L Cr ({overrunPct}%)</b></div>
    </div>
    <div className="card"><h3>April 2026 Portfolio Milestones</h3><ul className="decision-list"><li><b>814</b> Mega projects (₹1,000 crore and above)</li><li><b>1,167</b> Major projects (₹150 crore to below ₹1,000 crore)</li><li><b>9</b> projects commissioned during April 2026</li><li><b>55</b> additional projects brought under PAIMANA monitoring</li><li><b>801</b> projects achieved more than 80% physical progress</li></ul></div>
  </div>
  <SectionTitle title="Common Upload Form (CUF) vs Additional Variables" sub="Existing monitoring fields and proposed predictive variables"/>
  <div className="grid2">
    <div className="card"><h3>CUF fields used in the baseline model</h3><div className="table-scroll"><table><thead><tr><th>Field</th><th>Status</th></tr></thead><tbody>{cufFields.map(f=><tr key={f.field}><td>{f.field}</td><td><span className="badge low">In CUF · used</span></td></tr>)}</tbody></table></div></div>
    <div className="card"><h3>Proposed additional variables</h3><div className="table-scroll"><table><thead><tr><th>Field</th><th>Status</th></tr></thead><tbody>{additionalVariables.map(f=><tr key={f}><td>{f}</td><td><span className="badge high">Not captured</span></td></tr>)}</tbody></table></div></div>
  </div>
  <div className="source-strip"><b>Official April 2026 source:</b> MoSPI / Press Information Bureau Flash Report · PAIMANA portfolio total <b>1,981</b> · report published 25 May 2026.</div>
 </Layout>
}
function Dashboard(){
 const [projects]=useProjects(); const [alerts]=useAlerts();
 const high=projects.filter(p=>p.risk==='High').length, medium=projects.filter(p=>p.risk==='Medium').length, low=projects.filter(p=>p.risk==='Low').length;
 const total=projects.length; const sectorData=[...new Set(projects.map(p=>p.sector).filter(Boolean))].map(name=>({name,value:projects.filter(p=>p.sector===name).length}));
 return <Layout><div className="dashboard-shell"><SectionTitle title="Dashboard" sub="Live view of records currently available to Infra Risk Radar"/>
  <div className="paimana-dashboard-banner"><div className="portfolio-main"><span className="eyebrow">PAIMANA · APRIL 2026</span><strong>1,981</strong><small>official national infrastructure projects</small></div><div className="portfolio-metric"><b>₹42.78 L Cr</b><span>revised cost</span></div><div className="portfolio-metric"><b>₹20.36 L Cr</b><span>cumulative expenditure</span></div><Link className="view-btn" to="/paimana">Open PAIMANA →</Link></div>
  <div className="stats"><Stat label="Detailed Registry" value={total} type="total"/><Stat label="High Risk" value={high} type="high"/><Stat label="Medium Risk" value={medium} type="medium"/><Stat label="Low Risk" value={low} type="low"/></div>
  <div className="dashboard-note card"><span>{total?`The detailed registry contains ${total} route-ready records. Risk and analytics below are calculated from those detailed records; the national PAIMANA portfolio is 1,981.`:'No detailed project records are currently available. The official April 2026 PAIMANA portfolio remains 1,981 projects.'}</span></div>
  <div className="dashboard-grid dashboard-grid-2">
    <div className="card chart-card"><div className="card-head"><h3>Risk Overview</h3></div>{total?<div className="donut-row"><div className="donut"><PieChart width={210} height={210}><Pie data={[{v:high},{v:medium},{v:low}]} innerRadius={62} outerRadius={82} dataKey="v"><Cell fill="#ef3340"/><Cell fill="#f4a300"/><Cell fill="#16a765"/></Pie></PieChart><div className="donut-label"><b>{total}</b><span>Projects</span></div></div><div className="risk-list"><div><i className="dot high"/>High Risk <b>{high}</b></div><div><i className="dot medium"/>Medium Risk <b>{medium}</b></div><div><i className="dot low"/>Low Risk <b>{low}</b></div></div></div>:<p className="muted">No project data available for risk distribution.</p>}</div>
    <div className="card chart-card"><div className="card-head"><h3>Sector-wise Projects</h3></div>{sectorData.length?<ResponsiveContainer width="100%" height={220}><BarChart data={sectorData} layout="vertical" margin={{left:15,right:15}}><XAxis type="number" hide/><YAxis dataKey="name" type="category" width={110} tick={{fontSize:12}}/><Tooltip/><Bar dataKey="value" fill="#2478e8" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer>:<p className="muted">No sector data available.</p>}</div>
  </div>
  <div className="dashboard-grid dashboard-grid-2 lower">
    <div className="card"><div className="card-head"><h3>Recent Alerts</h3><Link to="/alerts">View All</Link></div>{alerts.length?alerts.slice(0,3).map(a=><div className="alert-row" key={a.id}><span className={'alert-dot '+riskClass(a.level)}>!</span><div><b>{a.project}</b><p>{a.message}</p></div><small>{new Date(a.time).toLocaleString()}</small></div>):<p className="muted">No active data-driven alerts.</p>}</div>
    <div className="card"><div className="card-head"><h3>PAIMANA Project Registry</h3><Link to="/projects">View All</Link></div><div className="registry-mini"><div className="registry-row"><span>Portfolio total</span><strong>{paimanaOverview.totalProjects.toLocaleString()}</strong></div><div className="registry-row"><span>Detailed records</span><strong>{total}</strong></div><div className="registry-row"><span>Pending action</span><strong>{alerts.length}</strong></div><div className="registry-row"><span>Source status</span><strong>Operational</strong></div></div></div>
  </div>
 </div></Layout>
}
function Projects(){
  const [projects,setProjects] = useProjects(); const [q,setQ]=useState(''); const [sector,setSector]=useState('All'); const [risk,setRisk]=useState('All'); const [page,setPage]=useState(1);
  const isAdmin=getSession()?.user?.role==='Administrator'||getSession()?.role==='Administrator';
  const filtered=projects.filter(p=>(p.name+p.ministry+p.state).toLowerCase().includes(q.toLowerCase())&&(sector==='All'||p.sector===sector)&&(risk==='All'||p.risk===risk));
  const pageData=filtered.slice((page-1)*6,page*6);
  const exportCSV=()=>{const rows=[['ID','Project Name','Ministry','Sector','State','Risk','Progress'],...filtered.map(p=>[p.id,p.name,p.ministry,p.sector,p.state,p.risk,p.progress+'%'])];const blob=new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='infra-projects.csv';a.click();};
  const deleteProject=async(p)=>{if(!isAdmin){alert('Administrator authentication required.');return}if(!(await reauthenticateAdmin()))return;if(!confirm(`⚠️ Are you sure you want to delete ${p.name}?`))return;const r=await fetch(`${API}/projects/${encodeURIComponent(p.id)}`,{method:'DELETE',headers:authHeaders()});const d=await r.json();if(!r.ok){alert(d.error||'Delete failed');return}setProjects(xs=>xs.filter(x=>x.id!==p.id));alert('✅ Project deleted successfully.');};
  return <Layout><SectionTitle title="Projects Register" sub="PAIMANA April 2026: 1,981 national projects · detailed route-ready records shown below."/>
    <div className="card"><div className="stats"><Stat label="PAIMANA Portfolio" value={paimanaOverview.totalProjects.toLocaleString()} type="total"/><Stat label="Loaded Detailed Records" value={projects.length} type="medium"/></div><p className="method-note">April 2026 PAIMANA national portfolio: 1,981 projects. The table below shows the detailed route-ready records currently loaded in this application.</p></div>
    <div className="card"><div className="toolbar"><input value={q} onChange={e=>{setQ(e.target.value);setPage(1)}} placeholder="⌕  Search by project name, ministry, state..."/><select value={sector} onChange={e=>setSector(e.target.value)}><option>All</option>{[...new Set(projects.map(p=>p.sector))].filter(Boolean).map(x=><option key={x}>{x}</option>)}</select><select value={risk} onChange={e=>setRisk(e.target.value)}><option>All</option><option>High</option><option>Medium</option><option>Low</option></select><button className="primary" onClick={exportCSV}>⇩ Export</button></div>
      <div className="table-scroll"><table><thead><tr><th>ID</th><th>Project Name</th><th>Ministry</th><th>Sector</th><th>State</th><th>Risk</th><th>Progress</th><th>Actions</th></tr></thead><tbody>{pageData.map(p=><tr key={p.id}><td>{p.id}</td><td><b>{p.name}</b></td><td>{p.ministry}</td><td>{p.sector}</td><td>{p.state}</td><td><RiskBadge value={p.risk}/></td><td><span className="progress-pill">{p.progress??'—'}%</span></td><td><div className="project-register-actions"><Link className="view-btn" to={'/projects/'+p.id}>👁️ View</Link>{isAdmin?<><Link className="view-btn admin-action" to={'/projects/'+p.id+'?edit=1'}>Edit</Link><button className="view-btn admin-action danger-action" onClick={()=>deleteProject(p)}>Delete</button></>:<span className="locked-action">Admin only</span>}</div></td></tr>)}</tbody></table></div>
      <div className="pagination"><button onClick={()=>setPage(Math.max(1,page-1))}>‹</button><span>Page {page}</span><button onClick={()=>setPage(page+1)} disabled={page*6>=filtered.length}>›</button><span>Total {filtered.length} projects</span></div>
    </div>
  </Layout>
}

const IMAGE_BY_SECTOR={
  Transport:'/project-images/transport.svg',
  Energy:'/project-images/energy.svg',
  Water:'/project-images/water.svg',
  Communication:'/project-images/communication.svg',
  'Social Infra':'/project-images/social.svg',
  'Water Pipeline':'/project-images/water.svg',
  Electricity:'/project-images/electricity.svg',
  Metro:'/project-images/metro.svg',
  Road:'/project-images/road.svg',
  Railway:'/project-images/railway.svg',
  Drainage:'/project-images/water.svg',
  Others:'/project-images/other.svg'
};
function projectImage(p){return p?.imageUrl||IMAGE_BY_SECTOR[p?.sector]||'/project-images/other.svg'}
function ProjectDetail(){
  const {id}=useParams(); const [projects,setProjects]=useProjects(); const p=projects.find(x=>x.id===id); const [tab,setTab]=useState('Overview'); const [editing,setEditing]=useState(false);
  const isAdmin=getSession()?.user?.role==='Administrator'||getSession()?.role==='Administrator';
  const [editForm,setEditForm]=useState(null);
  useEffect(()=>{if(p&&!editForm)setEditForm({status:p.status||'',progress:p.progress??'',cost:p.cost??'',expenditure:p.expenditure??'',start:p.start||p.startDate||'',completion:p.completion||p.revisedCompletion||p.targetCompletion||''})},[p,editForm]);
  useEffect(()=>{if(isAdmin&&new URLSearchParams(window.location.search).get('edit')==='1')setEditing(true)},[isAdmin]);
  const saveEdit=async()=>{if(!isAdmin){alert('Administrator authentication required.');return}if(!(await reauthenticateAdmin()))return;const r=await fetch(`${API}/projects/${encodeURIComponent(id)}`,{method:'PATCH',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify({...editForm,progress:editForm.progress===''?null:Number(editForm.progress),cost:Number(editForm.cost||0),expenditure:Number(editForm.expenditure||0)})});const d=await r.json();if(!r.ok){alert(d.error||'Update failed');return}setProjects(xs=>xs.map(x=>x.id===id?d:x));setEditing(false);alert('✅ Project updated successfully.');};
  const m=p?modelForProject(p):null;
  const riskData=m?[{subject:'Cost',project:m.costRisk,sector:52,national:42},{subject:'Delay',project:m.scheduleRisk,sector:55,national:45},{subject:'Resource',project:Math.min(100,Math.round((100-m.progress)*.7)),sector:50,national:48},{subject:'Contract',project:p.status==='Delayed'?72:45,sector:55,national:50},{subject:'Environmental',project:p.risk==='High'?65:45,sector:48,national:40},{subject:'Land',project:p.progress<60?68:38,sector:50,national:44}]:[];
  if(!p) return <Layout><div className="breadcrumb">← <Link to="/projects">Projects</Link></div><div className="card"><h2>Project not found</h2><p className="muted">The selected project is not present in the currently loaded project registry. Return to Projects and select an available record.</p><Link className="primary view-btn" to="/projects">Back to Projects</Link></div></Layout>; return <Layout><div className="breadcrumb">← <Link to="/projects">Projects</Link> › {p.id}</div><div className="project-head"><div className="avatar">◉</div><div><h1>{p.name}</h1><div className="chips"><span>{p.ministry||'Ministry not supplied'}</span><span>{p.sector||'Sector not supplied'}</span><span>{p.state||'State not supplied'}</span></div></div><RiskBadge value={(p.risk||'Risk not classified')+' Risk'}/></div><div className="toolbar right">{isAdmin?<button className="primary" onClick={()=>setEditing(true)}>Edit Project</button>:<span className="locked-action">Administrator authentication required</span>}</div>
    {editing&&<div className="card edit-panel"><h3>Administrator-authenticated edit</h3><div className="form-grid"><Field label="Project Status"><select value={editForm?.status||''} onChange={e=>setEditForm({...editForm,status:e.target.value})}><option>New</option><option>Ongoing</option><option>At Risk</option><option>Delayed</option><option>Completed</option></select></Field><Field label="Physical Progress (%)"><input type="number" min="0" max="100" value={editForm?.progress??''} onChange={e=>setEditForm({...editForm,progress:e.target.value})}/></Field><Field label="Revised Cost"><input type="number" value={editForm?.cost??''} onChange={e=>setEditForm({...editForm,cost:e.target.value})}/></Field><Field label="Expenditure"><input type="number" value={editForm?.expenditure??''} onChange={e=>setEditForm({...editForm,expenditure:e.target.value})}/></Field><Field label="Start Date"><input type="date" value={editForm?.start||''} onChange={e=>setEditForm({...editForm,start:e.target.value})}/></Field><Field label="Actual/Expected Completion"><input type="date" value={editForm?.completion||''} onChange={e=>setEditForm({...editForm,completion:e.target.value})}/></Field></div><div className="toolbar right"><button className="ghost" onClick={()=>setEditing(false)}>Cancel</button><button className="primary" onClick={saveEdit}>Authenticate & Save</button></div></div>}
    <div className="card project-hero-image"><img src={projectImage(p)} alt={`${p.name} project imagery`}/><div><h3>Project imagery & information</h3><p>Representative infrastructure imagery is bundled locally for the project sector. It is <b>not</b> presented as satellite/drone evidence of the selected project unless a verified image is uploaded.</p><span className="image-source-note">Imagery status: {p.imageUrl?'Project image supplied':'Representative sector image'}</span></div></div>
    <div className="tabs">{['Overview','Progress','Financials','Milestones','Risk Analysis'].map(x=><button className={tab===x?'active':''} onClick={()=>setTab(x)} key={x}>{x}</button>)}</div>
    {tab==='Overview'&&<><div className="grid2"><div className="card"><h3>Project Summary</h3><dl><dt>Original Cost</dt><dd>₹ {Number(p.originalCost||0).toLocaleString()} Cr</dd><dt>Revised Cost</dt><dd>₹ {Number(p.cost||p.revisedCost||0).toLocaleString()} Cr <em>({(Number(p.originalCost)>0?Math.round((Number(p.cost||p.revisedCost||0)/Number(p.originalCost)-1)*100):0)}%)</em></dd><dt>Expenditure</dt><dd>₹ {Number(p.expenditure||0).toLocaleString()} Cr</dd><dt>Start Date</dt><dd>{p.start}</dd><dt>Expected Completion</dt><dd>{p.completion}</dd><dt>Current Status</dt><dd className="danger">{p.status}</dd></dl></div><div className="card"><h3>Progress</h3><div className="progress-circles"><div className="circle"><b>{p.progress}%</b><span>Physical</span></div><div className="circle"><b>{Math.max(10,p.progress-4)}%</b><span>Financial</span></div></div></div></div>
      <div className="card full-info-card"><h3>Complete Project Information</h3><div className="complete-info-grid">{Object.entries(p).filter(([k])=>k!=='imageUrl').map(([k,v])=><div key={k}><small>{k.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase())}</small><b>{v===null||v===undefined||v===''?'Source field not supplied':typeof v==='object'?JSON.stringify(v):String(v)}</b></div>)}</div></div>
      <div className="grid2"><div className="card"><h3>Risk Score</h3><div className="risk-score"><div>{m.score}<small>/ 100</small></div><span>{m.score>=70?'High':m.score>=45?'Medium':'Low'} Risk</span></div></div><div className="card"><h3>Predictions</h3><div className="prediction"><span>Observed Cost Overrun</span><b>{m.predictedOverrun.toFixed(1)}%</b></div><div className="prediction"><span>Evidence Risk Score</span><b>{m.score}/100</b></div><div className="prediction"><span>Observed Schedule Slip</span><b>{m.delayMonths} months</b></div></div></div></>}
    {tab==='Progress'&&<div className="card"><h3>Physical & Financial Progress</h3><div className="big-progress"><span>Physical Progress</span><div><i style={{width:p.progress+'%'}}></i></div><b>{p.progress}%</b></div><div className="big-progress"><span>Financial Progress</span><div><i style={{width:Math.max(10,p.progress-4)+'%'}}></i></div><b>{Math.max(10,p.progress-4)}%</b></div></div>}
    {tab==='Financials'&&<div className="card"><h3>Financial Overview</h3><ResponsiveContainer width="100%" height={320}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="year"/><YAxis/><Tooltip/><Legend/><Line dataKey="original" name="Original Cost" stroke="#1769e0" strokeWidth={3}/><Line dataKey="revised" name="Revised Cost" stroke="#16a765" strokeWidth={3}/></LineChart></ResponsiveContainer></div>}
    {tab==='Milestones'&&<div className="card"><h3>Milestones</h3>{['Land Acquisition','Environmental Clearance','Bridge Construction','Utility Shifting','Final Construction'].map((m,i)=><div className="timeline-item" key={m}><span className={'timeline-dot '+(i<1?'done':i===4?'delayed':'pending')}></span><div><b>{m}</b><p>{i<1?'Completed':i===4?'Delayed':'In Progress'}</p></div></div>)}</div>}
    {tab==='Risk Analysis'&&<div className="card"><h3>Project Risk Profile</h3><ResponsiveContainer width="100%" height={420}><RadarChart data={riskData}><PolarGrid/><PolarAngleAxis dataKey="subject"/><PolarRadiusAxis domain={[0,100]}/><Radar name="This Project" dataKey="project" stroke="#ef3340" fill="#ef3340" fillOpacity={.18}/><Radar name="Sector Avg" dataKey="sector" stroke="#2478e8" fill="#2478e8" fillOpacity={.12}/><Radar name="National Avg" dataKey="national" stroke="#16a765" fill="#16a765" fillOpacity={.1}/><Legend/><Tooltip/></RadarChart></ResponsiveContainer></div>}
  </Layout>
}

function haversine(a,b){
  const R=6371, toRad=x=>x*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLon=toRad(b.lng-a.lng);
  const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function pointToSegmentDistanceKm(p,a,b){
  const latScale=111.32, lngScale=111.32*Math.cos(((a.lat+b.lat)/2)*Math.PI/180);
  const px=p.lng*lngScale, py=p.lat*latScale, ax=a.lng*lngScale, ay=a.lat*latScale, bx=b.lng*lngScale, by=b.lat*latScale;
  const dx=bx-ax, dy=by-ay, len2=dx*dx+dy*dy;
  const t=len2?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len2)):0;
  const cx=ax+t*dx, cy=ay+t*dy;
  return Math.hypot(px-cx,py-cy)/111.32;
}
function distanceToRouteKm(point,coords){
  if(!coords?.length)return Infinity;
  let best=Infinity;
  for(let i=1;i<coords.length;i++) best=Math.min(best,pointToSegmentDistanceKm(point,coords[i-1],coords[i]));
  return best;
}
function numericValue(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const number=Number(value);
  return Number.isFinite(number)?number:null;
}
function formatSourcePercent(value){
  const number=numericValue(value);
  return number===null?'Not reported':`${number}%`;
}
function calculateFinancialProgress(project){
  const expenditure=numericValue(project?.expenditure);
  const revisedCost=numericValue(project?.revisedCost??project?.cost);
  if(expenditure===null||revisedCost===null||revisedCost<=0)return null;
  return Math.max(0,Math.min(100,Math.round((expenditure/revisedCost)*1000)/10));
}
function routeDistanceLabel(project){
  const distance=numericValue(project?.distance);
  return distance===null?'Verification required':`${distance.toFixed(2)} km`;
}
function verificationLabel(project){
  if(project?.sourceVerified===true&&project?.sourceClass!=='mapped'&&project?.sourceClass!=='paimana-location-candidate')return 'PAIMANA Verified';
  if(project?.sourceClass==='paimana-location-candidate'&&numericValue(project?.distance)!==null)return 'PAIMANA Monitoring Candidate';
  if(project?.sourceClass==='paimana-location-candidate')return 'Geographic Match — Verification Required';
  if(project?.sourceClass==='mapped')return 'Geographic Match — Verification Required';
  return 'Verification required';
}
function formatDuration(sec){
  const mins=Math.round(sec/60); const h=Math.floor(mins/60), m=mins%60;
  return h?`${h} hr ${m} mins`:`${m} mins`;
}
function routeRisk(distance,projectRisk){
  if(projectRisk==='High' || distance<0.6)return 'High';
  if(projectRisk==='Medium' || distance<1.2)return 'Medium';
  return 'Low';
}
function RouteViewport({route}){
  const map=useMap();
  useEffect(()=>{
    const refresh=()=>map.invalidateSize({pan:false});
    const timer=window.setTimeout(refresh,50);
    const timer2=window.setTimeout(refresh,350);
    let ro=null;
    if(typeof ResizeObserver!=='undefined' && map.getContainer()){
      ro=new ResizeObserver(refresh);
      ro.observe(map.getContainer());
    }
    if(route?.coords?.length){
      const bounds=route.coords.map(safeLatLng).filter(Boolean);
      if(bounds.length>1) try{map.fitBounds(bounds,{padding:[28,28],maxZoom:13});}catch{}
    }
    return()=>{window.clearTimeout(timer);window.clearTimeout(timer2);ro?.disconnect();};
  },[map,route]);
  return null;
}

class MapErrorBoundary extends Component{
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return {error};}
  componentDidCatch(error,info){console.error('Route map render error',error,info);}
  render(){
    if(this.state.error){
      return <div className="route-map-fallback"><strong>Map display error</strong><span>The route and project results are still available below. Click Find Route again after checking the browser connection.</span><small>{this.state.error?.message||'Unexpected map rendering error'}</small><button className="primary" onClick={()=>this.setState({error:null})}>Retry map</button></div>;
    }
    return this.props.children;
  }
}
function safeLatLng(value){
  const lat=Number(value?.lat??value?.[0]);
  const lng=Number(value?.lng??value?.[1]);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180?[lat,lng]:null;
}
function validGeometry(g){
  if(!g||!['Point','LineString','MultiLineString','Polygon','MultiPolygon'].includes(g.type)||!Array.isArray(g.coordinates))return false;
  const walk=v=>Array.isArray(v)?(v.length>0&&typeof v[0]==='number'?Number.isFinite(v[0])&&Number.isFinite(v[1]):v.every(walk)):false;
  return walk(g.coordinates);
}
function RouteScaleControl(){
  const map=useMap();
  useEffect(()=>{
    const scale=L.control.scale({metric:true,imperial:false,maxWidth:120,position:'bottomleft'}).addTo(map);
    return()=>scale.remove();
  },[map]);
  return null;
}

function RouteMap({route,conflicts,alternatives,from,to,selectedKey,onSelectRoute,onSelectProject,layers}){
  const center=route?.coords?.length ? safeLatLng(route.coords[Math.floor(route.coords.length/2)])||[20.5937,78.9629] : [20.5937,78.9629];
  const selected=selectedKey||'A';
  const visible=(conflicts||[]).filter(p=>{
    if(String(p.status||'').toLowerCase().includes('planned')) return layers?.planned;
    if(!layers?.ongoing) return false;
    const t=(p.type||'').toLowerCase();
    if(t.includes('rail'))return layers?.railways;
    if(t.includes('water')||t.includes('pipeline'))return layers?.water;
    if(t.includes('electric')||t.includes('power'))return layers?.electricity;
    if(t.includes('metro'))return layers?.metro;
    return layers?.roads;
  });
  const [satellite,setSatellite]=useState(false);
  const iconFor=p=>{
    const t=(p.type||'').toLowerCase();
    if(t.includes('bridge')) return '⚑';
    if(t.includes('rail')) return '▰';
    if(t.includes('water')||t.includes('pipeline')) return '≋';
    if(t.includes('electric')||t.includes('power')) return 'ϟ';
    return '▲';
  };
  const fromPos=safeLatLng(from), toPos=safeLatLng(to);
  const geometryProjects=visible.filter(p=>validGeometry(p?.geometry));
  const rawPointProjects=visible.map(p=>({p,pos:safeLatLng(p)})).filter(x=>x.pos);
  const pointGroups=new Map();
  rawPointProjects.forEach(x=>{
    const key=`${x.p.sourceClass==='paimana-location-candidate'?'candidate':'exact'}|${x.pos[0].toFixed(5)}|${x.pos[1].toFixed(5)}`;
    if(!pointGroups.has(key))pointGroups.set(key,[]); pointGroups.get(key).push(x);
  });
  const pointProjects=[...pointGroups.values()].map(group=>({group,p:group[0].p,pos:group[0].pos}));
  return <MapContainer key={selectedKey+'-'+(route?.fromName||'')+'-'+(route?.toName||'')} center={center} zoom={8} scrollWheelZoom style={{height:'100%',width:'100%',minHeight:460}} whenReady={({target})=>{window.setTimeout(()=>target.invalidateSize(),50);window.setTimeout(()=>target.invalidateSize(),400)}}>
    <RouteViewport route={route}/>
    <TileLayer attribution={satellite?'Tiles © Esri':'© OpenStreetMap contributors'} url={satellite?'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}':'https://tile.openstreetmap.org/{z}/{x}/{y}.png'}/>
    <RouteScaleControl />
    {route?.coords?.length>1 && <Polyline positions={route.coords.map(safeLatLng).filter(Boolean)} pathOptions={{color:'#0868f7',weight:6,opacity:.9}} />}
    {alternatives?.filter(a=>Array.isArray(a.coords)&&a.coords.length>1).map((a,i)=><Polyline key={'alt'+i} positions={a.coords.map(safeLatLng).filter(Boolean)} pathOptions={{color:a.key===selected?'#0868f7':'#8491a2',weight:a.key===selected?5:3,dashArray:a.key===selected?undefined:'7 8',opacity:a.key===selected?.96:.55}} eventHandlers={{click:()=>onSelectRoute?.(a.key)}}/>) }
    {fromPos && <Marker position={fromPos}><Popup><b>A — {route?.fromName}</b><br/>{route?.from?.label||route?.fromName}<br/><b>District:</b> {route?.from?.district||'District not returned by geocoder'}<br/><b>State:</b> {route?.from?.state||'State not returned by geocoder'}</Popup></Marker>}
    {toPos && <Marker position={toPos}><Popup><b>B — {route?.toName}</b><br/>{route?.to?.label||route?.toName}<br/><b>District:</b> {route?.to?.district||'District not returned by geocoder'}<br/><b>State:</b> {route?.to?.state||'State not returned by geocoder'}</Popup></Marker>}
    {geometryProjects.map(p=><GeoJSON key={'geometry-'+p.id} data={{type:'Feature',geometry:p.geometry,properties:{name:p.name}}} style={{color:String(p.risk||'').toLowerCase()==='high'?'#ef3340':'#1476e4',weight:4,opacity:.78}} onEachFeature={(feature,layer)=>layer.bindPopup(`<b>${p.name||'Infrastructure project'}</b><br/>${p.type||'Infrastructure'} · ${p.status||'Status not supplied'}<br/>Distance from route: <b>${Number.isFinite(Number(p.distance))?`${Number(p.distance).toFixed(2)} km`:'Not calculated from source geometry'}</b>`)} />)}
    {pointProjects.map(({group,p,pos})=>{
      const high=String(p.risk||'').toLowerCase()==='high';
      const type=(p.type||'').toLowerCase();
      const supplementary=p.sourceClass==='mapped';
      const candidate=p.sourceClass==='paimana-location-candidate';
      const demo=p?.isDemo===true||p?.sourceClass==='route-demo';
      const cls=demo?'demo':candidate?'candidate':supplementary?'mapped':high?'high':type.includes('rail')?'rail':type.includes('water')?'water':'road';
      const markerSymbol=group.length>1?String(group.length):demo?'✦':candidate?'○':supplementary?'◇':iconFor(p);
      const html=`<div class="map-project-pin ${cls}"><span>${markerSymbol}</span></div>`;
      const icon=L.divIcon({className:'map-project-icon-wrap',html,iconSize:[18,18],iconAnchor:[9,9]});
      return <Marker key={'project-'+safeJoin(group.map(x=>x.p.id), '-')} position={pos} icon={icon} eventHandlers={{click:()=>onSelectProject?.(p)}}>
        <Popup><b>{group.length>1?`${group.length} project records at this approximate map point`:p.name||'Unnamed project'}</b><br/>{group.length>1?'Select a project from the route cards to inspect each record.':`${p.type||'Infrastructure'} · ${p.status||'Status not supplied'}<br/>Source: ${p.sourceType||'Source not supplied'}<br/>Verification: ${candidate?'PAIMANA Candidate – approximate place match':supplementary?'Mapped Construction – Verification Required':demo?'DEMO / SIMULATED – not a real project':p.sourceVerified?'Verified source':'Verification Required'}<br/>Distance from route: ${Number.isFinite(Number(p.distance))?`${Number(p.distance).toFixed(2)} km`:'Not calculated: project geometry is not published'}`}</Popup>
      </Marker>;
    })}
    <div className="map-type-legend">
      <b>Project / Evidence Marker</b>
      <span><i className="marker-key road">▲</i>Road / Highway</span>
      <span><i className="marker-key high">⚑</i>Bridge</span>
      <span><i className="marker-key water">≋</i>Water / Pipeline</span>
      <span><i className="marker-key rail">▰</i>Railway</span>
      <span><i className="marker-key candidate">○</i>PAIMANA approximate place match</span>
      <span><i className="marker-key mapped">◇</i>OSM mapped · unverified</span>
    </div>
    <div className="map-layer-toggle"><button className={!satellite?'active':''} onClick={()=>setSatellite(false)}>Map</button><button className={satellite?'active':''} onClick={()=>setSatellite(true)}>Satellite</button></div>
    <div className="map-scale-note">2 km route corridor on each side · verified geometry is exact; PAIMANA place-name markers are approximate and clearly labelled</div>
  </MapContainer>
}
function ProjectAnalysisOverlay({project,onClose}){
  const normalized=normalizeProjectRecord(project); const model=modelForProject(normalized); const hasModelInputs=['originalCost','cost','expenditure','progress','targetCompletion','revisedCompletion'].filter(field=>normalized[field]!==null&&normalized[field]!==undefined&&normalized[field]!=='').length>=4;
  const progress=Number.isFinite(Number(normalized.progress)) ? Number(normalized.progress) : null;
  const original=Number.isFinite(Number(normalized.originalCost)) ? Number(normalized.originalCost) : null;
  const revised=Number.isFinite(Number(normalized.cost)) ? Number(normalized.cost) : null;
  const expenditure=Number.isFinite(Number(normalized.expenditure)) ? Number(normalized.expenditure) : null;
  const costOverrun=original && revised ? Math.max(0,((revised-original)/original)*100) : null;
  return <div className="project-analysis-overlay">
    <div className="project-analysis-head"><div><span className="eyebrow">PROJECT ANALYSIS</span><h3>{normalized.name}</h3><p>{normalized.type} · {normalized.status}</p></div><button className="close-analysis" onClick={onClose}>×</button></div>
    <div className="analysis-source"><b>Data source:</b> {normalized.sourceClass==='official-state-gis'?'Official State GIS':normalized.sourceVerified?'Verified Government GIS':normalized.sourceType||'Registered project source'} · <b>Location match:</b> {Number.isFinite(Number(normalized.distance))?`${Number(normalized.distance).toFixed(2)} km from selected route`:'Not calculated: project geometry is not published'}</div>
    <div className="analysis-grid">
      <div><small>Physical Progress</small><strong>{progress===null?'Source progress not supplied':`${progress}%`}</strong></div>
      <div><small>Original Cost</small><strong>{original===null?'Approved cost not supplied':`₹${original.toLocaleString()} Cr`}</strong></div>
      <div><small>Revised / Current Cost</small><strong>{revised===null?'Revised cost not supplied':`₹${revised.toLocaleString()} Cr`}</strong></div>
      <div><small>Expenditure</small><strong>{expenditure===null?'Expenditure not supplied':`₹${expenditure.toLocaleString()} Cr`}</strong></div>
    </div>
    <div className="analysis-section"><h4>Risk & Prediction</h4><div className="analysis-risk-row"><span className={`analysis-risk-badge ${(normalized.risk||(hasModelInputs?(model.score>=70?'High':model.score>=45?'Medium':'Low'):'unclassified')).toLowerCase()}`}>{normalized.risk||(hasModelInputs?(model.score>=70?'High':model.score>=45?'Medium':'Low'):'Risk not classified')}</span><span>{hasModelInputs?'Risk level from the existing evidence-based project model.':'Risk model inputs missing: cost, progress, or schedule fields.'}</span></div>
      <div className="analysis-predictions"><div><small>Cost Overrun</small><b>{costOverrun===null?'Approved and revised cost required':`${costOverrun.toFixed(1)}%`}</b></div><div><small>Delay Probability</small><b>{hasModelInputs?`${model.scheduleRisk}%`:'Cost, progress, and schedule inputs required'}</b></div><div><small>Expected Delay</small><b>{Number.isFinite(Number(normalized.predictedDelayMinutes))?`${normalized.predictedDelayMinutes} minutes`:'No route-impact delay calculated'}</b></div></div>
      <p className="method-note">Values use the existing transparent evidence-based model and source-backed route evidence.</p>
    </div>
    <div className="analysis-section"><h4>Route Impact</h4><p>This project is associated with the selected route. Verified GIS geometry is measured against the route; PAIMANA records without project GIS geometry are shown as monitoring candidates.</p><div className="analysis-action">⚠ Coordinate this project with other works before finalizing the corridor.</div></div>
  </div>
}

function LocationBox({label,value,setValue,selected,setSelected,placeholder}){
  const [suggestions,setSuggestions]=useState([]); const [open,setOpen]=useState(false); const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const q=value.trim();
    if(q.length<3){setSuggestions([]);setBusy(false);return;}
    const controller=new AbortController();
    const timer=setTimeout(async()=>{setBusy(true);try{const r=await fetch(`${API}/geocode?q=${encodeURIComponent(q)}`,{headers:{Accept:'application/json'},signal:controller.signal});const d=await r.json();if(r.ok)setSuggestions(d.results||[]);}catch(e){if(e.name!=='AbortError')setSuggestions([]);}finally{if(!controller.signal.aborted)setBusy(false)}},220);
    return ()=>{clearTimeout(timer);controller.abort()};
  },[value]);
  return <label className="route-location-box"><span>{label}</span><div className="route-input-shell">⌖<input value={value} onFocus={()=>setOpen(true)} onChange={e=>{setValue(e.target.value);setSelected(null);setOpen(true)}} onBlur={()=>setTimeout(()=>setOpen(false),180)} placeholder={placeholder}/>{busy&&<small className="location-searching">…</small>}</div>
    {open&&suggestions.length>0&&<div className="location-suggestions">{suggestions.slice(0,6).map((x,i)=><button type="button" key={`${x.osmType}-${x.placeId}-${i}`} onMouseDown={e=>e.preventDefault()} onClick={()=>{setValue(x.name||x.locality||x.label);setSelected(x);setOpen(false)}}><b>{x.name||x.locality}</b><span>{safeJoin([x.district,x.state])||x.label}</span><small>{x.placeType||x.class||'place'} · {Number(x.lat).toFixed(5)}, {Number(x.lng).toFixed(5)}</small></button>)}</div>}
  </label>
}

function RouteIntelligence({route,projects,selectedProject,onSelectProject}){
  const [delayDays,setDelayDays]=useState(90);
  const [mode,setMode]=useState('overview');
  const sourceProjects=(projects||[]).filter(p=>p?.isDemo!==true&&p?.sourceClass!=='route-demo');
  const selected=selectedProject&&sourceProjects.find(p=>String(p.id)===String(selectedProject.id))||sourceProjects[0]||null;
  const dependencies=useMemo(()=>{
    if(!selected)return [];
    return sourceProjects.filter(p=>String(p.id)!==String(selected.id)).map(p=>{
      const sameState=selected.state&&p.state&&String(selected.state).toLowerCase()===String(p.state).toLowerCase();
      const sameSector=selected.sector&&p.sector&&String(selected.sector).toLowerCase()===String(p.sector).toLowerCase();
      const d=Number.isFinite(Number(p.distance))?Number(p.distance):99;
      let strength='LOW';
      if(d<=2 && (sameState||sameSector))strength='HIGH';
      else if(d<=5 && (sameState||sameSector))strength='MEDIUM';
      return {...p,dependencyStrength:strength,dependencyReason:[d<=ROUTE_CORRIDOR_KM?`within ${d.toFixed(1)} km of route`:`outside ${ROUTE_CORRIDOR_KM} km route corridor`,sameState?'same state':'different state',sameSector?'same sector':'different sector'].join(' · ')};
    }).filter(p=>p.dependencyStrength!=='LOW').sort((a,b)=>{
      const order={HIGH:0,MEDIUM:1};
      return (order[a.dependencyStrength] ?? 99) - (order[b.dependencyStrength] ?? 99) || (a.distance??99)-(b.distance??99);
    }).slice(0,5);
  },[selected,sourceProjects]);
  const simulation=useMemo(()=>{
    if(!selected)return null;
    const progress=Number.isFinite(Number(selected.progress))?Number(selected.progress):null;
    const baseDelay=Math.max(0,Number(delayDays)||0);
    const affected=dependencies.length;
    const high=dependencies.filter(x=>x.dependencyStrength==='HIGH').length;
    const spill=Math.round(baseDelay*(affected?Math.min(.75,.15+high*.12):0));
    return {baseDelay,affected,high,spill,completion:selected.completion||selected.targetCompletion||'Source date not reported',progress};
  },[selected,delayDays,dependencies]);
  const actions=selected?[{level:selected.risk==='High'?'HIGH':'MEDIUM',title:'Review project schedule coordination',text:dependencies.length?`Coordinate ${dependencies.length} nearby related record(s) before the next milestone.`:'Review the project schedule against other route works before the next milestone.'},{level:'INFO',title:'Verify geographic dependency',text:selected.sourceVerified?'Geometry is source-verified; use the mapped relationship as an evidence layer.':'Geographic relationship requires authoritative GIS verification before operational action.'}]:[];
  if(!route)return null;
  return <div className="route-intelligence card">
    <div className="ri-head"><div><span className="eyebrow">SIH 26103 · DECISION SUPPORT</span><h3>Route Intelligence Center</h3><p>Turn route detection into explainable conflict, dependency and what-if analysis.</p></div><div className="ri-tabs"><button className={mode==='overview'?'active':''} onClick={()=>setMode('overview')}>Overview</button><button className={mode==='dependencies'?'active':''} onClick={()=>setMode('dependencies')}>Dependencies</button><button className={mode==='simulation'?'active':''} onClick={()=>setMode('simulation')}>What-if</button><button className={mode==='actions'?'active':''} onClick={()=>setMode('actions')}>Actions</button></div></div>
    {!selected&&<div className="ri-empty">Select a source-backed project above to activate dependency and scenario analysis.</div>}
    {selected&&mode==='overview'&&<div className="ri-overview-grid"><div className="ri-kpi"><small>Selected project</small><b>{selected.name}</b><span>{selected.status||'Status not reported'} · {selected.distance!=null?`${Number(selected.distance).toFixed(2)} km from route`:'distance unavailable'}</span></div><div className="ri-kpi"><small>Evidence</small><b>{selected.sourceVerified?'Verified source geometry':'Source-backed / verification required'}</b><span>{selected.sourceType||'Source not reported'}</span></div><div className="ri-kpi"><small>Potential related projects</small><b>{dependencies.length}</b><span>Derived from route proximity + shared state/sector; not an asserted causal dependency</span></div><div className="ri-kpi"><small>Scenario delay</small><b>{delayDays} days</b><span>Adjust in What-if</span></div></div>}
    {selected&&mode==='dependencies'&&<div className="dependency-flow"><div className="dependency-node selected"><small>FOCUS</small><b>{selected.name}</b><span>{selected.type||'Infrastructure'}</span></div><div className="dependency-line">DEPENDENCY / RELATED-WORK SIGNAL</div><div className="dependency-list">{dependencies.length?dependencies.map(p=><button key={p.id} className="dependency-node" onClick={()=>onSelectProject?.(p)}><div><span className={'severity-dot '+p.dependencyStrength.toLowerCase()}></span><small>{p.dependencyStrength}</small></div><b>{p.name}</b><span>{p.dependencyReason}</span></button>):<div className="ri-empty">No related project signal was derived from the currently displayed source-backed records.</div>}</div></div>}
    {selected&&mode==='simulation'&&<div className="simulation-grid"><div className="simulation-control"><label>Simulated delay <strong>{delayDays} days</strong></label><input type="range" min="0" max="365" step="15" value={delayDays} onChange={e=>setDelayDays(Number(e.target.value))}/><div className="sim-buttons"><button onClick={()=>setDelayDays(Math.max(0,delayDays-30))}>−30</button><button onClick={()=>setDelayDays(Math.min(365,delayDays+30))}>+30</button></div><small>This is a scenario calculation, not a forecast of the actual project.</small></div><div className="simulation-result"><div><small>Related records</small><b>{simulation.affected}</b></div><div><small>High-strength signals</small><b>{simulation.high}</b></div><div><small>Illustrative downstream delay</small><b>{simulation.spill} days</b></div><div><small>Source completion</small><b>{simulation.completion}</b></div><p>Illustrative propagation uses the selected delay and the number of derived dependency signals. It does not claim that a delay will occur.</p></div></div>}
    {selected&&mode==='actions'&&<div className="action-center">{actions.map((a,i)=><div className="action-item" key={i}><span className={'action-level '+a.level.toLowerCase()}>{a.level}</span><div><b>{a.title}</b><p>{a.text}</p></div><button onClick={()=>setMode('dependencies')}>Inspect</button></div>)}<div className="action-item evidence"><span className="action-level info">EVIDENCE</span><div><b>Source transparency</b><p>Missing fields remain marked as unavailable. OSM mapped construction is supplementary and is never treated as official project progress.</p></div></div></div>}
  </div>;
}

function RouteAnalysis(){
  const [fromName,setFromName]=useState('Hyderabad');
  const [toName,setToName]=useState('Vijayawada');
  const [fromPlace,setFromPlace]=useState(null);
  const [toPlace,setToPlace]=useState(null);
  const [routeOptions,setRouteOptions]=useState({});
  const [routeConflicts,setRouteConflicts]=useState({});
  const [routeMonitoring,setRouteMonitoring]=useState({});
  const [selectedKey,setSelectedKey]=useState('A');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [layers,setLayers]=useState({roads:true,railways:true,water:true,electricity:true,metro:true,ongoing:true,planned:false});
  const [selectedProject,setSelectedProject]=useState(null);
  const [coverage,setCoverage]=useState(null);
  const [sourceStatus,setSourceStatus]=useState(null);
  const [detailTab,setDetailTab]=useState('Overview');
  const routeRequestId=useRef(0);
  const [routeSourceStatus,setRouteSourceStatus]=useState({});

  const analyze=async()=>{
    const requestId=++routeRequestId.current;
    if(!fromName.trim()||!toName.trim()){setError('Enter both From and To locations.');return;}
    setLoading(true);setError('');
    // Clear the previous route immediately so a failed geocode/routing request
    // can never leave an old route or old project panel visible.
    setRouteOptions({});setRouteConflicts({});setRouteMonitoring({});setSelectedProject(null);setCoverage(null);setSourceStatus(null);setRouteSourceStatus({});
    try{
      const qs=new URLSearchParams({start:fromName.trim(),end:toName.trim(),radiusKm:String(ROUTE_CORRIDOR_KM)});
      if(fromPlace){qs.set('startLat',fromPlace.lat);qs.set('startLng',fromPlace.lng)}
      if(toPlace){qs.set('endLat',toPlace.lat);qs.set('endLng',toPlace.lng)}
      const routeController=new AbortController(); const routeTimer=setTimeout(()=>routeController.abort(),12000);
      let r; try{r=await fetch(`${API}/route-analysis?${qs.toString()}`, {headers:{Accept:'application/json'},signal:routeController.signal});}catch(fetchErr){if(fetchErr?.name==='AbortError')throw new Error('Route analysis timed out. The map service is taking too long; please try again.');throw fetchErr;}finally{clearTimeout(routeTimer);}
      const text=await r.text();
      let data={};
      try{ data=JSON.parse(text); }catch{ throw new Error(`Backend response was not JSON. Make sure the backend is running on port 5000.`); }
      if(!r.ok)throw new Error(data.error||'Unable to analyze route');
      const opts=data.options||{};
      const firstRoute=opts.A;
      // India's road network has no genuine driving route anywhere near 50,000 km; that
      // threshold let a mis-geocoded pair (e.g. one endpoint resolving outside India)
      // through as if it were a real result. 6,000 km is already far beyond any real
      // India road trip, so anything past it means the locations resolved wrong.
      if(!firstRoute?.coords?.length || !Number.isFinite(Number(firstRoute.distance)) || firstRoute.distance>6000){
        throw new Error('The routing service returned an implausible route. Try selecting a location from the suggestion dropdown instead of the free-typed name, then Find Route again.');
      }
      if(requestId!==routeRequestId.current)return;
      // Show real PAIMANA monitoring candidates immediately with the route result. This
      // prevents the project panel from displaying 0 while slower GIS/OSM scans are running.
      const optsWithCandidates=Object.fromEntries(Object.entries(opts).map(([k,v])=>{
        const base=Array.isArray(v.projects)?v.projects:[];
        const candidates=Array.isArray(v.monitoringCandidates)?v.monitoringCandidates:[];
        const byId=new Map(); [...base,...candidates].map(normalizeProjectRecord).forEach(p=>byId.set(String(p.id||`${p.name}|${p.projectCode||''}`),p));
        const projectRecords=new Map(); base.map(normalizeProjectRecord).forEach(p=>projectRecords.set(String(p.id||`${p.name}|${p.projectCode||''}`),p));
        return [k,{...v,projects:[...projectRecords.values()],monitoringCandidates:candidates.map(normalizeProjectRecord)}];
      }));
      setRouteOptions(optsWithCandidates);
      setRouteConflicts(Object.fromEntries(Object.entries(optsWithCandidates).map(([k,v])=>[k,v.projects||[]])));
      setRouteMonitoring(Object.fromEntries(Object.entries(optsWithCandidates).map(([k,v])=>[k,v.monitoringCandidates||[]])));
      setSelectedKey('A');
      const first=(optsWithCandidates.A?.projects||[]).find(p=>/ongoing|under construction|construction started/i.test(String(p.status||''))) || (optsWithCandidates.A?.projects||[]).find(p=>p.sourceClass==='paimana-location-candidate') || null;
      setSelectedProject(first);
      setDetailTab('Overview');
      setCoverage(data.coverage||null);
      const routeKeys=Object.keys(optsWithCandidates);
      const initialStatuses=Object.fromEntries(routeKeys.map(key=>[key,{available:true,pending:true,errors:[]}]));
      setRouteSourceStatus(initialStatuses);
      setSourceStatus(initialStatuses.A||null);
      // Scan every returned route with the same GIS, verified-record, OSM and
      // proximity fallback pipeline. Counts remain route-specific for alternatives.
      routeKeys.forEach(key=>{
        const liveRoute=optsWithCandidates[key];
        if(!liveRoute?.coords?.length)return;
        const liveController=new AbortController(); const liveTimer=setTimeout(()=>liveController.abort(),18000);
        fetch(`${API}/route-live-projects`,{
          method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
          body:JSON.stringify({coords:liveRoute.coords,officialRadiusKm:ROUTE_CORRIDOR_KM,supplementaryRadiusKm:ROUTE_CORRIDOR_KM,start:fromName.trim(),end:toName.trim(),roadNames:Array.isArray(liveRoute.roadNames)?liveRoute.roadNames:[],routeStates:Array.isArray(liveRoute.routeStates)?liveRoute.routeStates:[]}),
          signal:liveController.signal
        }).then(x=>x.json()).then(live=>{
          if(requestId!==routeRequestId.current)return;
          const liveProjects=Array.isArray(live?.projects)?live.projects.map(normalizeProjectRecord):[];
          const liveGeographicMatches=Array.isArray(live?.geographicMatches)?live.geographicMatches.map(normalizeProjectRecord):[];
          setRouteOptions(prev=>{
              if(!prev[key])return prev;
              const base=Array.isArray(prev[key].projects)?prev[key].projects:[];
            const byId=new Map();
            [...base,...liveProjects].forEach(p=>byId.set(String(p.id||`${p.name}|${p.lat}|${p.lng}`),p));
            const merged=[...byId.values()].sort((a,b)=>{
              const ad=a?.isDemo===true||a?.sourceClass==='route-demo'?1:0;
              const bd=b?.isDemo===true||b?.sourceClass==='route-demo'?1:0;
              return ad-bd || (a.distance??999)-(b.distance??999);
            });
            return {...prev,[key]:{...prev[key],projects:merged,metrics:live?.counts||null,constructionSource:{available:live?.available!==false,pending:false,error:live?.error||null}}};
          });
          setRouteMonitoring(prev=>({...prev,[key]:[...(prev[key]||[]),...liveGeographicMatches]}));
          setRouteConflicts(prev=>{
            // Preserve the immediate PAIMANA candidates already shown while adding the
            // slower live-source results. Otherwise a live response with zero GIS/OSM
            // matches could overwrite the real PAIMANA cards and make the UI return to 0.
            const base=Array.isArray(prev[key])?prev[key]:[];
            const byId=new Map();
            [...base,...liveProjects].forEach(p=>byId.set(String(p.id||`${p.name}|${p.lat}|${p.lng}`),p));
            const merged=[...byId.values()].sort((a,b)=>{
              const ad=a?.isDemo===true||a?.sourceClass==='route-demo'?1:0;
              const bd=b?.isDemo===true||b?.sourceClass==='route-demo'?1:0;
              return ad-bd || (a.distance??999)-(b.distance??999);
            });
            return {...prev,[key]:merged};
          });
          // When live sources discover a real project, select the nearest real record
          // instead of leaving the user on a simulation card.
          const preferredReal=liveProjects.filter(p=>p?.isDemo!==true&&p?.sourceClass!=='route-demo'&&p?.sourceClass!=='paimana-location-candidate'&&/ongoing|under construction|construction started/i.test(String(p.status||''))).sort((a,b)=>(a.distance??999)-(b.distance??999))[0];
          const preferredPaimana=liveProjects.filter(p=>p?.sourceClass==='paimana-location-candidate'&&/ongoing|under construction|construction started/i.test(String(p.status||''))).sort((a,b)=>(a.distance??999)-(b.distance??999))[0];
          if(key===selectedKey&&(preferredReal||preferredPaimana))setSelectedProject(preferredReal||preferredPaimana);
          // Recalculate the visible route impact after live project results arrive.
          setRouteOptions(prev=>{
            if(!prev[key])return prev;
            const projects=Array.isArray(prev[key].projects)?prev[key].projects:[];
            const onRoute=projects.filter(p=>p.overlap==='On / overlapping route');
            const high=onRoute.filter(p=>String(p.risk||'').toLowerCase()==='high').length;
            const medium=onRoute.filter(p=>String(p.risk||'').toLowerCase()==='medium').length;
            const level=high>=2?'HIGH':high===1||medium>=2?'MEDIUM':onRoute.length?'LOW':'LOW';
            return {...prev,[key]:{...prev[key],impact:{...(prev[key].impact||{}),level,estimatedAdditionalDelayMinutes:onRoute.length?Math.min(60,onRoute.length*5):0}}};
          });
          const status=live?.available===false
            ? {available:false,pending:false,errors:[live?.error||'Live project lookup unavailable; route remains valid.']}
            : {available:true,pending:false,errors:[]};
          setRouteSourceStatus(prev=>({...prev,[key]:status}));
          if(key===selectedKey)setSourceStatus(status);
        }).catch(err=>{
          const status={available:false,pending:false,errors:[err.message||'Live project lookup unavailable; route remains valid.']};
          if(requestId===routeRequestId.current){setRouteSourceStatus(prev=>({...prev,[key]:status}));if(key===selectedKey)setSourceStatus(status);}
        }).finally(()=>clearTimeout(liveTimer));
      });
    }catch(e){
      setError(e.message||'Unable to analyze route');
      setRouteOptions({});setRouteConflicts({});setRouteMonitoring({});setSelectedProject(null);setCoverage(null);setSourceStatus(null);setRouteSourceStatus({});
    }finally{setLoading(false)}
  };
  useEffect(()=>{document.body.classList.add('map-route-page'); return ()=>document.body.classList.remove('map-route-page')},[]);
  useEffect(()=>{analyze()},[]);

  const route=routeOptions[selectedKey]||null;
  const alternatives=Object.values(routeOptions);
  // Route projects are geometry-backed records measured against the full route.
  // Text-only PAIMANA records stay separate so they cannot become false distance matches.
  const liveProjects=route ? (route.projects||[]) : [];
  const realProjects=liveProjects.filter(p=>p?.isDemo!==true&&p?.sourceClass!=='route-demo');
  const geographicMatches=(routeMonitoring[selectedKey]||[]).filter(p=>p?.sourceClass==='paimana-location-candidate');
  const demoProjectCount=liveProjects.filter(p=>p?.isDemo===true||p?.sourceClass==='route-demo').length;
  const verifiedCount=realProjects.filter(p=>p.sourceVerified===true&&p.sourceClass!=='mapped').length;
  const monitoringCandidateCount=realProjects.filter(p=>p.sourceClass==='paimana-location-candidate').length;
  const requiringVerificationCount=realProjects.filter(p=>p.sourceVerified!==true||p.sourceClass==='mapped').length+geographicMatches.length;
  const detectedProjectCount=realProjects.length+geographicMatches.length;
  const routeMetrics=route?.metrics||null;
  const activeSourceStatus=routeSourceStatus[selectedKey]||sourceStatus;
  const routeMetricValue=(key,fallback)=>{
    if(activeSourceStatus?.pending)return 'Loading…';
    if(activeSourceStatus?.available===false)return 'Unavailable';
    const strict=Number(routeMetrics?.[key]);
    const proximity=Number(routeMetrics?.[`${key}Fallback`]);
    return Number.isFinite(strict)?strict:Number.isFinite(proximity)?proximity:fallback;
  };
  const allProjects=routeConflicts[selectedKey]||[];
  const filterType=p=>{
    const t=(p.type||'').toLowerCase();
    if(t.includes('rail'))return layers.railways;
    if(t.includes('water')||t.includes('pipeline'))return layers.water;
    if(t.includes('electric')||t.includes('power'))return layers.electricity;
    if(t.includes('metro'))return layers.metro;
    return layers.roads;
  };
  const visibleProjects=allProjects.filter(p=>{
    if(!filterType(p))return false;
    const planned=String(p.status||'').toLowerCase().includes('planned');
    return planned?layers.planned:layers.ongoing;
  });
  const routeProjectRank=p=>{
    const status=String(p.status||'').toLowerCase();
    const ongoing=/ongoing|under construction|construction started|in progress|active/.test(status)?0:1;
    const verified=p.sourceVerified===true?0:1;
    const distance=numericValue(p.distance)??Infinity;
    return ongoing*100000+distance*100+verified;
  };
  const corridorProjects=[...visibleProjects].filter(p=>numericValue(p.distance)!==null&&numericValue(p.distance)<=ROUTE_CORRIDOR_KM).sort((a,b)=>routeProjectRank(a)-routeProjectRank(b));
  const monitoringCandidates=routeMonitoring[selectedKey]||[];
  const monitoringInCorridor=monitoringCandidates.filter(p=>numericValue(p.distance)!==null&&numericValue(p.distance)<=ROUTE_CORRIDOR_KM).sort((a,b)=>routeProjectRank(a)-routeProjectRank(b));
  const routeCards=[...corridorProjects,...monitoringInCorridor,...monitoringCandidates.filter(p=>numericValue(p.distance)===null)]
    .filter((p,i,arr)=>arr.findIndex(x=>String(x.id)===String(p.id))===i).sort((a,b)=>routeProjectRank(a)-routeProjectRank(b));
  const exactProjects=corridorProjects.filter(p=>p.sourceVerified===true&&p.sourceClass!=='mapped');
  const geographicMatchProjects=monitoringCandidates.filter(p=>numericValue(p.distance)===null);
  const riskEvidenceProjects=visibleProjects.filter(p=>p.sourceClass!=='paimana-location-candidate');
  const onRoute=riskEvidenceProjects.filter(p=>p.overlap==='On / overlapping route');
  const nearRoute=riskEvidenceProjects.filter(p=>p.overlap!=='On / overlapping route');
  const high=onRoute.filter(x=>x.risk==='High').length;
  const medium=onRoute.filter(x=>x.risk==='Medium').length;
  const overall=high>=2?'HIGH':high===1||medium>=2?'MEDIUM':onRoute.length?'LOW':'LOW';
  const verifiedImpact=riskEvidenceProjects.filter(x=>x.costImpactVerified===true&&Number.isFinite(Number(x.costImpact)));
  const avoidable=verifiedImpact.length?verifiedImpact.reduce((s,p)=>s+Number(p.costImpact),0):null;
  const toggle=k=>setLayers(x=>({...x,[k]:!x[k]}));
  const selectRoute=k=>{
    setSelectedKey(k);
    setSourceStatus(routeSourceStatus[k]||null);
    const candidates=routeConflicts[k]||[]; const p=[...candidates].sort((a,b)=>routeProjectRank(a)-routeProjectRank(b))[0] || (routeMonitoring[k]||[])[0] || null;
    setSelectedProject(p);
    setDetailTab('Overview');
  };
  const selectProject=p=>{setSelectedProject(p);setDetailTab('Overview')};

  return <Layout>
    <SectionTitle title="Map & Conflict" />
    <div className="reference-route-controls">
      <LocationBox label="From" value={fromName} setValue={setFromName} selected={fromPlace} setSelected={setFromPlace} placeholder="City, town, village or district" />
      <button className="reference-swap" onClick={()=>{setFromName(toName);setToName(fromName);setFromPlace(toPlace);setToPlace(fromPlace)}}>⇄</button>
      <LocationBox label="To" value={toName} setValue={setToName} selected={toPlace} setSelected={setToPlace} placeholder="City, town, village or district" />
      <button className="primary reference-find" onClick={analyze} disabled={loading}>⌕ &nbsp;{loading?'Finding…':'Find Route'}</button>
    </div>
    {error&&<div className="route-error reference-error">⚠ {error}</div>}
    {route&&<div className="reference-route-status route-summary-card">
      <div className="route-summary-header"><div><span className="route-summary-kicker">Route</span><strong>{formatDuration(route.duration)} · {route.distance.toFixed(1)} km</strong></div><span className={'route-impact-badge impact-'+String(route.impact?.level||'LOW').toLowerCase()}>Infrastructure Impact: {route.impact?.level||'LOW'}</span></div>
      <div className="route-summary-section route-summary-details"><div><small>From</small><b>{route.from?.locality||route.fromName}{route.from?.district?`, ${route.from.district}`:''}</b></div><div><small>To</small><b>{route.to?.locality||route.toName}{route.to?.district?`, ${route.to.district}`:''}</b></div></div>
      <div className="route-summary-section route-summary-metrics"><div><strong>{activeSourceStatus?.pending?'Loading…':detectedProjectCount}</strong><small>Projects on / near route</small></div><div><strong>{activeSourceStatus?.pending?'Loading…':exactProjects.length}</strong><small>Exact / Verified</small></div><div><strong>{activeSourceStatus?.pending?'Loading…':monitoringInCorridor.length}</strong><small>Monitoring Candidates</small></div><div><strong>{activeSourceStatus?.pending?'Loading…':geographicMatchProjects.length}</strong><small>Geographic Matches</small></div><div><strong>{activeSourceStatus?.pending?'Loading…':requiringVerificationCount}</strong><small>Requiring Verification</small></div><div><strong>{activeSourceStatus?.pending?'Loading…':`+${route.impact?.estimatedAdditionalDelayMinutes||0} min`}</strong><small>Estimated Added Delay</small></div></div>
    </div>}

    {route&&alternatives.length>1&&<div className="route-alternatives"><b>Route alternatives</b>{alternatives.map(a=><button key={a.key} className={selectedKey===a.key?'active':''} onClick={()=>selectRoute(a.key)}>{a.key} · {a.distance.toFixed(1)} km · {formatDuration(a.duration)}</button>)}</div>}
    {route&&<div className="route-source-warning">⚡ Fast route mode: the road route appears first; project-source checks continue in the background and update the results automatically.</div>}
    {route&&activeSourceStatus?.pending&&<div className="route-source-warning">Live infrastructure sources are being checked in the background. The road route is already ready.</div>}
    {route&&<div className="route-source-warning">PAIMANA ongoing records are included as monitoring candidates when their project/location text matches the selected route. Exact route intersections are reserved for verified project GIS geometry; no synthetic project is created.</div>}
    {route&&activeSourceStatus?.available===false&&<div className="route-source-warning">Live project lookup could not be reached for this request. The route remains valid; retry the project lookup when the network source is available.</div>}
    {route&&<div className="route-source-warning">April 2026 PAIMANA records are the primary route cards. Verified GIS and government work records remain separate evidence layers; OSM construction is supplementary and is never presented as official PAIMANA progress.</div>}
    {route&&activeSourceStatus?.pending&&<div className="route-source-warning">Checking live project sources along this route… The route is ready; project counts will update when the source scan finishes.</div>}
    {route&&activeSourceStatus&&!activeSourceStatus.pending&&!activeSourceStatus.available&&<div className="route-source-warning">Live project-source lookup was unavailable. The route is valid, but no conclusion can be made that the corridor has no ongoing projects.</div>}

    <div className="reference-map-workspace">
      <section className="reference-left-column">
        <div className="reference-map-box">
          <div className="reference-map-canvas">
            <MapErrorBoundary key={selectedKey+'-'+(route?.fromName||'')+'-'+(route?.toName||'')}><RouteMap route={route} conflicts={routeCards} alternatives={alternatives} from={route?.from} to={route?.to} selectedKey={selectedKey} onSelectRoute={selectRoute} layers={layers} onSelectProject={selectProject}/></MapErrorBoundary>
          </div>
        </div>
        <div className="reference-project-strip card">
          <div className="reference-strip-title"><h3>⌖ &nbsp;PAIMANA projects on/near selected route ({routeCards.length})</h3><span className="ongoing-live-badge">APRIL 2026 PAIMANA + GIS</span></div>
          <div className="route-result-summary">
            <span><b>{exactProjects.length}</b> Exact / Verified</span><span><b>{monitoringInCorridor.length}</b> Monitoring Candidates</span>
            <span><b>{geographicMatchProjects.length}</b> Geographic Matches</span><span><b>{requiringVerificationCount}</b> Requiring Verification</span>
          </div>
          <div className="reference-project-cards">
            {routeCards.map(p=>{
              const exact=verificationLabel(p)==='PAIMANA Verified';
              const candidate=p.sourceClass==='paimana-location-candidate';
              const mapped=p.sourceClass==='mapped';
              return <button className={'reference-project-card '+(candidate?'paimana-route-project ':'')+(mapped?'mapped-route-project ':'')+(selectedProject?.id===p.id?'selected':'')} key={p.id} onClick={()=>selectProject(p)}>
                <div className="ref-card-top"><span className={'ref-project-icon '+(String(p.type||'').toLowerCase().includes('bridge')?'bridge':String(p.type||'').toLowerCase().includes('water')?'water':String(p.type||'').toLowerCase().includes('rail')?'rail':'road')}>{String(p.type||'').toLowerCase().includes('bridge')?'⚑':String(p.type||'').toLowerCase().includes('water')?'≋':String(p.type||'').toLowerCase().includes('rail')?'▰':'▲'}</span><span className={'badge '+riskClass(p.risk||'')}>{p.risk||'Risk not classified'}</span></div>
                <strong>{p.name||'Unnamed ongoing project'}</strong>
                <small>{p.type||'Infrastructure'} · {p.location||'Route corridor'}</small>
                <div className="ref-source-badge">{exact?'PAIMANA Verified':candidate&&numericValue(p.distance)!==null?'PAIMANA Monitoring Candidate':candidate||mapped?'Geographic Match — Verification Required':'Verification required'}</div>
                <div className="ref-card-facts"><span><b>Status</b> {p.status||'Not reported'}</span><span><b>Physical Progress</b> {formatSourcePercent(p.progress)}</span><span><b>Financial Progress</b> {calculateFinancialProgress(p)===null?'Not available':`${calculateFinancialProgress(p)}%`}</span><span><b>Distance from Route</b> {routeDistanceLabel(p)}</span></div>
                <div className="ref-progress"><span style={{width:`${Math.max(0,Math.min(100,numericValue(p.progress)??0))}%`}}/></div>
                <div className="ref-card-foot"><span>{p.agency||p.ministry||'Implementing agency not supplied'}</span><span>{p.sourceType||'Source not supplied'}</span></div>
              </button>
            })}
            {!routeCards.length&&<div className="empty-route-projects"><b>No project was returned within the selected route corridor.</b><span>Only source-backed records are shown. Text-only PAIMANA records remain separate geographic matches until authoritative project GIS geometry is available.</span></div>}
          </div>
        </div>
      </section>
      <aside className="project-detail-panel card reference-detail-panel">
        {selectedProject ? <ProjectDetailPanel project={selectedProject} tab={detailTab} setTab={setDetailTab} onClose={()=>setSelectedProject(null)}/> : <div className="no-project-panel">
          <div className="empty-icon">⌖</div>
          <h3>{activeSourceStatus?.pending ? 'Searching the complete route corridor…' : detectedProjectCount===0 ? 'No project found in the selected corridor' : 'Project search complete'}</h3>
          {route && <div className="route-project-counts"><div><b>Projects on / near route</b><strong>{detectedProjectCount}</strong></div><div><b>Exact / Verified</b><strong>{exactProjects.length}</strong></div><div><b>Monitoring Candidates</b><strong>{monitoringInCorridor.length}</strong></div><div><b>Geographic Matches</b><strong>{geographicMatchProjects.length}</strong></div><div><b>Requiring Verification</b><strong>{requiringVerificationCount}</strong></div></div>}
          <p>{activeSourceStatus?.pending ? 'OSRM route geometry is ready. The complete selected route is being scanned within a 2 km corridor on each side. Verified GIS, government work records, mapped construction, and PAIMANA geographic matches remain separate evidence classes.' : detectedProjectCount===0 ? 'No route-supported project record was returned by the connected real-world sources for this route.' : geographicMatchProjects.length>0 ? `${geographicMatchProjects.length} geographic match(es) require project-level verification because the source record does not publish project GIS geometry.` : 'Verified and supplementary matches are listed in the route project results.'}</p>
          {!activeSourceStatus?.pending && <><div className="empty-state-note"><b>Live source diagnostics</b><br/>Telangana GIS: <b>{route?.constructionSource?.telanganaGIS===false?'unavailable':'checked'}</b> · OpenStreetMap: <b>{route?.constructionSource?.openStreetMap===false?'unavailable':'checked'}</b> · Government GIS records: <b>{route?.projects?.filter(p=>p.sourceClass==='official-state-gis'||p.sourceClass==='government-work-record').length||0}</b><br/><span>{route?.constructionSource?.error||'No route-matching project geometry was returned by the connected sources.'}</span></div></>}
          {!activeSourceStatus?.pending && <button className="secondary retry-projects-btn" onClick={analyze}>↻ Search this route again</button>}
        </div>}
      </aside>
    </div>
    {route&&<RouteIntelligence route={route} projects={liveProjects} selectedProject={selectedProject} onSelectProject={selectProject}/>}
  </Layout>
}

function projectRecommendation(project,costOverrun,progress,financial){
  if(project?.recommendation)return {text:project.recommendation,source:'Source reported'};
  if(String(project?.status||'').toLowerCase().includes('delayed'))return {text:'Review the delayed milestone with the implementing agency and update the recovery schedule.',source:'Derived from source status'};
  if(costOverrun!==null&&costOverrun>0)return {text:'Review revised-cost drivers and confirm the recovery plan with the implementing agency.',source:'Derived from source cost fields'};
  if(progress!==null&&progress<50)return {text:'Review the next milestone and confirm implementation readiness with the implementing agency.',source:'Derived from source progress'};
  if(financial!==null&&progress!==null)return {text:'Continue milestone monitoring using the reported physical and derived financial progress.',source:'Derived from source data'};
  return {text:'Insufficient verified source data for a project-specific recommendation.',source:'Verification required'};
}
function ProjectDetailPanel({project,tab,setTab,onClose}){
  const normalized=normalizeProjectRecord(project);
  const calculated=modelForProject(normalized);
  const modelInputCount=['originalCost','cost','expenditure','progress','targetCompletion','revisedCompletion'].filter(field=>normalized[field]!==null&&normalized[field]!==undefined&&normalized[field]!=='').length;
  const hasModelInputs=modelInputCount>=4;
  const progress=numericValue(normalized.progress);
  const original=numericValue(normalized.originalCost);
  const revised=numericValue(normalized.revisedCost??normalized.cost);
  const expenditure=numericValue(normalized.expenditure);
  const financial=calculateFinancialProgress(normalized);
  const startDate=normalized.start;
  const completionDate=normalized.completion;
  const costOverrun=original!==null&&revised!==null&&original>0?((revised-original)/original*100):null;
  const tabs=['Overview','Progress','AI Risk & Analysis','Predictions','Recommendations'];
  const sourceRisk=/^(high|medium|low)$/i.test(String(normalized.risk||''))?normalized.risk:null;
  const riskScore=Number.isFinite(Number(normalized.riskScore))?Number(normalized.riskScore):hasModelInputs?calculated.score:null;
  const risk=sourceRisk||(riskScore!==null?(riskScore>=70?'High':riskScore>=45?'Medium':'Low'):'Risk not classified');
  const delayProbability=Number.isFinite(Number(normalized.delayProbability))?Number(normalized.delayProbability):hasModelInputs?calculated.scheduleRisk:null;
  const routeDelay=Number.isFinite(Number(normalized.predictedDelayMinutes))?Number(normalized.predictedDelayMinutes):null;
  const recommendation=projectRecommendation(normalized,costOverrun,progress,financial);
  const riskFactors=[
    costOverrun!==null?`Cost variance ${costOverrun.toFixed(1)}%`:'Approved and revised cost are required for cost variance',
    hasModelInputs?`Schedule risk ${calculated.scheduleRisk}/100`:'Risk model inputs missing: cost, progress, or schedule fields',
    normalized.distance!=null?`Route distance ${Number(normalized.distance).toFixed(2)} km`:normalized.sourceClass==='paimana-location-candidate'?'Project GIS geometry is not published; locality match is approximate':'No route match in this view'
  ];
  return <div className="project-panel-inner">
    <div className="project-panel-head screenshot-head">
      <div className="project-title-row"><span className={'project-hero-icon '+(String(normalized.type||'').toLowerCase().includes('bridge')?'bridge':'')}>{String(normalized.type||'').toLowerCase().includes('rail')?'▰':String(normalized.type||'').toLowerCase().includes('water')?'≋':'⚑'}</span><div><h2>{normalized.name}</h2><div className="project-chip-row"><span>{normalized.type} Project</span><span className={'badge '+riskClass(risk)}>{risk}</span></div></div></div>
      <button className="close-analysis" onClick={onClose}>×</button>
    </div>
    <div className="project-image-slot">{project.imageUrl?<img src={project.imageUrl} alt=""/>:<div className="project-image-placeholder">{String(project.type||'Infrastructure').toLowerCase().includes('bridge')?'▥':String(project.type||'').toLowerCase().includes('rail')?'▰':'⌖'}</div>}</div>
    <div className="project-top-meta">
      <div><span>Project ID</span><b>{normalized.id||'Project identifier not supplied'}</b></div>
      <div><span>Ministry/Dept.</span><b>{normalized.ministry||'Ministry not supplied'}</b></div>
      <div><span>Location</span><b>{normalized.location}{normalized.sourceClass==='paimana-location-candidate'?' (approximate source locality)':''}</b></div>
      {normalized.sourceUrl && <a href={normalized.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a>}<div><span>Distance from route</span><b>{routeDistanceLabel(normalized)}</b></div><div><span>Verification</span><b>{verificationLabel(normalized)}</b></div>{(normalized.isDemo===true||normalized.sourceClass==='route-demo')&&<span className="badge demo-project-badge">DEMO / SIMULATED · not a real project</span>}
    </div>
    <div className="tabs project-panel-tabs">{tabs.map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</button>)}</div>

    {tab==='Overview'&&<div className="detail-grid screenshot-detail-grid">
      <div className="detail-card"><h4>▣ &nbsp;Project Summary</h4><dl>
        <dt>Original Cost</dt><dd>{original===null?'Not available':`₹ ${original.toLocaleString()} Cr`}</dd>
        <dt>Revised Cost</dt><dd>{revised===null?'Not available':`₹ ${revised.toLocaleString()} Cr`}{costOverrun!==null&&costOverrun>0?<em> (↑ {costOverrun.toFixed(0)}%)</em>:''}</dd>
        <dt>Expenditure</dt><dd>{expenditure===null?'Not available':`₹ ${expenditure.toLocaleString()} Cr`}</dd>
        <dt>Start Date</dt><dd>{startDate||'Source start date not supplied'}</dd>
        <dt>Expected Completion</dt><dd>{completionDate||'Source completion date not supplied'}</dd>
        <dt>Current Status</dt><dd className="status-value">{normalized.status}</dd>
      </dl></div>
      <div className="detail-card progress-detail-card"><h4>◫ &nbsp;Progress</h4><div className="progress-circles"><div className="progress-ring" style={{'--progress':`${progress===null?0:progress}%`}}><b>{formatSourcePercent(progress)}</b><span>Physical Progress · Source reported</span></div><div className="progress-ring" style={{'--progress':`${financial===null?0:financial}%`}}><b>{financial===null?'Not available':`${financial}%`}</b><span>Financial Progress · Derived from source data</span></div></div><p className="data-age">Latest: {normalized.lastUpdated||'Not reported'}</p></div>
      <div className="detail-card risk-detail"><h4>AI Analysis</h4><div className="risk-factor-layout"><div className="risk-gauge"><b>{riskScore===null?'Inputs required':riskScore}</b><span>{riskScore===null?'':'/100'}</span><strong>{risk}</strong></div><ul>{riskFactors.map(factor=><li key={factor}>{factor}</li>)}</ul></div></div>
      <div className="detail-card prediction-card"><h4>Predictions</h4><div className="prediction-row"><span>Calculated Cost Overrun</span><b>{costOverrun===null?'Approved and revised cost required':`${costOverrun.toFixed(1)}%`}</b></div><div className="prediction-row"><span>Delay Probability</span><b>{Number.isFinite(Number(delayProbability))?`${delayProbability}%`:'Schedule inputs required'}</b></div><div className="prediction-row"><span>Route impact delay</span><b>{routeDelay!==null?`${routeDelay} minutes`:'No validated route-impact delay for this source'}</b></div><div className="prediction-row"><span>Predicted Completion</span><b>{completionDate||'Source completion date not supplied'}</b></div></div>
      <div className="detail-card"><h4>⌖ &nbsp;Project Details</h4><dl><dt>Type</dt><dd>{normalized.type}</dd><dt>Location</dt><dd>{normalized.location}</dd><dt>Implementing Agency</dt><dd>{normalized.agency}</dd><dt>Status</dt><dd>{normalized.status}</dd></dl></div>
      <div className="detail-card recommendation"><h4>Recommended Action</h4><p>{recommendation.text}</p><small>{recommendation.source}</small>{normalized.sourceUrl&&<a href={normalized.sourceUrl} target="_blank" rel="noreferrer">View Full Source ↗</a>}</div>
    </div>}

    {tab==='Progress'&&<div className="detail-card full-detail"><h4>Progress Evidence</h4><div className="progress-evidence"><div><b>{formatSourcePercent(progress)}</b><span>Physical progress reported by source</span></div><div><b>{financial===null?'Not available':`${financial}%`}</b><span>Financial progress derived from expenditure / revised cost</span></div><div><b>{normalized.lastUpdated||'Not reported'}</b><span>Latest source/update</span></div></div><p className="method-note">Financial progress is derived only when expenditure and revised cost are present.</p></div>}
    {tab==='AI Risk & Analysis'&&<div className="detail-card full-detail"><h4>AI Risk & Analysis</h4><div className="risk-analysis-big"><b>{riskScore===null?'Inputs required':riskScore}</b><span>{riskScore===null?'Cost, progress, and schedule fields are required':'Risk score'}</span></div><p>{risk}</p><p className="method-note">Risk uses the existing transparent evidence-based calculation from cost, expenditure, progress, schedule, and route evidence where available.</p></div>}
    {tab==='Predictions'&&<div className="detail-card full-detail"><h4>Predictions</h4><div className="prediction-row"><span>Calculated cost overrun</span><b>{costOverrun===null?'Insufficient source data for prediction.':`${costOverrun.toFixed(1)}%`}</b></div><div className="prediction-row"><span>Delay probability</span><b>{Number.isFinite(Number(delayProbability))?`${delayProbability}%`:'Insufficient source data for prediction.'}</b></div><div className="prediction-row"><span>Validated route impact</span><b>{routeDelay!==null?`${routeDelay} minutes`:'Insufficient source data for prediction.'}</b></div><div className="prediction-row"><span>Source completion</span><b>{completionDate||'Insufficient source data for prediction.'}</b></div><p className="method-note">Traffic impact is shown only when route evidence has produced an existing route-impact calculation.</p></div>}
    {tab==='Recommendations'&&<div className="detail-card full-detail"><h4>Recommended Action</h4><p>{recommendation.text}</p><div className="source-box">{recommendation.source} · Source: {normalized.sourceType||'Registered project source'} · {verificationLabel(normalized)}</div></div>}
  </div>
}
function RiskRadar(){
 const [sector,setSector]=useState('All Sectors'); const [projects]=useProjects(); const p=projects[0]; const m=p?modelForProject(p):null; const data=m?[{s:'Cost Risk',project:m.costRisk,sector:52,national:42},{s:'Delay Risk',project:m.scheduleRisk,sector:55,national:45},{s:'Resource Risk',project:Math.min(100,Math.round((100-m.progress)*.7)),sector:50,national:48},{s:'Contract Risk',project:p.status==='Delayed'?72:45,sector:55,national:50},{s:'Environmental Risk',project:p.risk==='High'?65:45,sector:48,national:40},{s:'Land Acquisition Risk',project:p.progress<60?68:38,sector:50,national:44}]:[];
 return <Layout><SectionTitle title="Risk & Conflict Radar"/><div className="card"><div className="toolbar right"><select value={sector} onChange={e=>setSector(e.target.value)}><option>All Sectors</option><option>Transport</option><option>Energy</option><option>Water</option></select></div><ResponsiveContainer width="100%" height={430}><RadarChart data={data}><PolarGrid/><PolarAngleAxis dataKey="s"/><PolarRadiusAxis domain={[0,100]}/><Radar name="This Project" dataKey="project" stroke="#ef3340" fill="#ef3340" fillOpacity={.18}/><Radar name="Sector Avg" dataKey="sector" stroke="#2478e8" fill="#2478e8" fillOpacity={.12}/><Radar name="National Avg" dataKey="national" stroke="#16a765" fill="#16a765" fillOpacity={.1}/><Legend/><Tooltip/></RadarChart></ResponsiveContainer>
 <h3>Detected Conflicts</h3>{[['Land acquisition delay (State Govt)','High'],['Environmental clearance pending','Medium'],['Contractor dispute','Medium']].map(([x,r])=><div className="conflict" key={x}><span className={'alert-dot '+riskClass(r)}>!</span><b>{x}</b><RiskBadge value={r}/></div>)}</div></Layout>
}

function projectPoint(x){
 if(Number.isFinite(Number(x?.lat))&&Number.isFinite(Number(x?.lng))) return {lat:Number(x.lat),lng:Number(x.lng)};
 const c=x?.geometry?.coordinates;
 if(x?.geometry?.type==='Point'&&Array.isArray(c)) return {lat:Number(c[1]),lng:Number(c[0])};
 if(x?.geometry?.type==='LineString'&&Array.isArray(c)&&c.length) {const m=c[Math.floor(c.length/2)];return {lat:Number(m[1]),lng:Number(m[0])};}
 return null;
}
function haversineKm(lat1,lon1,lat2,lon2){const R=6371,d=Math.PI/180,a=Math.sin((lat2-lat1)*d/2)**2+Math.cos(lat1*d)*Math.cos(lat2*d)*Math.sin((lon2-lon1)*d/2)**2;return 2*R*Math.asin(Math.sqrt(a));}
function Dependencies(){
  const [projects]=useProjects();
  const [selected,setSelected]=useState('');

  useEffect(()=>{
    if(!projects.length) return;
    if(!selected || !projects.some(x=>x.id===selected)) setSelected(projects[0].id);
  },[projects,selected]);

  const project = projects.find(x=>x.id===selected) || projects[0] || null;

  const dependencySeed = useMemo(() => {
    const p = project || {};
    const agency = p.agency || 'Implementing agency not specified';
    const state = p.state || p.location || 'Location not specified';
    const projectLabel = p.name || 'Unnamed project';
    const fallback = [
      {
        dependency:'Utility diversion and right-of-way clearance',
        agency:'State PWD / Utility Coordination Cell',
        type:'Land & Utility',
        status:'Critical',
        impact:'Likely schedule delay of 2-4 months',
        riskLevel:'Critical',
        action:'Obtain ROW handover certificate and utility relocation schedule before the next milestone.'
      },
      {
        dependency:'Environmental and statutory clearances',
        agency:'State Environment Dept / Forest Office',
        type:'Regulatory',
        status:'At Risk',
        impact:'Potential cost impact and permit holdup',
        riskLevel:'High',
        action:'Validate NOCs, consent conditions and approval timelines with the responsible agencies.'
      },
      {
        dependency:'Contractor mobilization and equipment staging',
        agency:'Executing contractor / EPC agency',
        type:'Execution',
        status:'In Progress',
        impact:'Possible bottleneck in site readiness',
        riskLevel:'Medium',
        action:'Confirm site access, laydown planning and mobilization windows with field teams.'
      },
      {
        dependency:'Inter-agency road interface / traffic management',
        agency:'NHAI / State transport authority',
        type:'Interface',
        status:'On Track',
        impact:'Minimal disruption if road diversion is maintained',
        riskLevel:'Low',
        action:'Coordinate traffic diversion and maintenance planning before peak construction phases.'
      }
    ];

    const explicit = Array.isArray(p.dependencies) ? p.dependencies : [];
    if (!explicit.length) {
      return fallback.map((item, index) => ({
        id: `${p.id || 'project'}-dep-${index + 1}`,
        dependency: item.dependency,
        agency: item.agency,
        type: item.type,
        status: item.status,
        impact: item.impact,
        riskLevel: item.riskLevel,
        action: item.action,
        projectName: projectLabel,
        state,
        agencyOwner: agency
      }));
    }

    return explicit.map((item, index) => ({
      id: item.id || `${p.id || 'project'}-dep-${index + 1}`,
      dependency: item.dependency || item.name || 'Dependency not specified',
      agency: item.agency || item.department || item.relatedAgency || agency,
      type: item.type || 'Interface',
      status: item.status || 'In Progress',
      impact: item.impact || item.expectedImpact || 'Review required',
      riskLevel: item.riskLevel || item.risk || 'Medium',
      action: item.action || item.requiredAction || 'Coordinate with the responsible agency and track the milestone.',
      projectName: projectLabel,
      state,
      agencyOwner: agency
    }));
  }, [project]);

  const dependencySummary = useMemo(() => {
    const total = dependencySeed.length;
    const critical = dependencySeed.filter(x => /critical/i.test(x.status) || /critical/i.test(x.riskLevel)).length;
    const atRisk = dependencySeed.filter(x => /at risk|delayed|critical/i.test(x.status)).length;
    const onTrack = dependencySeed.filter(x => /on track|in progress/i.test(x.status)).length;
    return {total, critical, atRisk, onTrack};
  }, [dependencySeed]);

  const riskOverview = useMemo(() => {
    const counts = {Critical:0, High:0, Medium:0, Low:0};
    dependencySeed.forEach(item => {
      const risk = String(item.riskLevel || item.status || 'Medium');
      if (/critical/i.test(risk)) counts.Critical += 1;
      else if (/high/i.test(risk)) counts.High += 1;
      else if (/medium/i.test(risk)) counts.Medium += 1;
      else if (/low/i.test(risk)) counts.Low += 1;
    });
    const max = Math.max(1, ...Object.values(counts));
    return Object.entries(counts).map(([label, value]) => ({label, value, width: Math.max(14, (value / max) * 100)}));
  }, [dependencySeed]);

  const coordinationActions = dependencySeed.slice(0, 4).map(item => ({
    issue: item.dependency,
    agency: item.agency,
    priority: item.riskLevel === 'Critical' ? 'Critical' : item.riskLevel === 'High' ? 'High' : item.riskLevel === 'Medium' ? 'Medium' : 'Low',
    action: item.action,
    target: item.impact
  }));

  const earlyWarnings = dependencySeed.filter(item => /critical|at risk|delayed/i.test(item.status) || /critical|high/i.test(item.riskLevel)).slice(0, 3).map(item => ({
    title: item.dependency,
    reason: item.status === 'Delayed' ? 'Schedule delay' : item.riskLevel === 'Critical' ? 'Implementation bottleneck' : 'Cost impact'
  }));

  const statusClass = status => {
    const value = String(status || 'In Progress').toLowerCase();
    if (value.includes('critical')) return 'critical';
    if (value.includes('delayed')) return 'delayed';
    if (value.includes('at risk')) return 'at-risk';
    if (value.includes('on track')) return 'on-track';
    return 'in-progress';
  };

  if (!projects.length) {
    return <Layout><SectionTitle title="Project Dependency & Coordination" sub="Analytical dependency insights — not an official PAIMANA field"/><div className="card"><p className="muted">No project records available. Sync PAIMANA or import project data first.</p></div></Layout>;
  }

  return <Layout>
    <SectionTitle title="Project Dependency & Coordination" sub="Analytical dependency insights — not an official PAIMANA field"/>
    <div className="card dep-selector-wrap">
      <div className="toolbar right dep-toolbar">
        <select value={project?.id || ''} onChange={e => setSelected(e.target.value)} disabled={!projects.length}>
          <option value="">Select project</option>
          {projects.map(x => <option key={x.id} value={x.id}>{x.id} — {x.name || 'Unnamed project'}</option>)}
        </select>
      </div>
    </div>

    {project && <>
      <div className="dep-header-card card">
        <div className="dep-header-row">
          <div className="dep-project-overview">
            <span className="dep-pill dep-pill-primary">{project.id || 'Project ID unavailable'}</span>
            <h3>{project.name || 'Unnamed project'}</h3>
          </div>
          <span className={`dep-badge dep-badge--${statusClass(project.status || 'In Progress')}`}>{project.status || 'In Progress'}</span>
        </div>

        <div className="dep-info-grid">
          <div className="dep-info-item"><span>Project ID</span><strong>{project.id || '—'}</strong></div>
          <div className="dep-info-item"><span>Project Name</span><strong>{project.name || 'Unnamed project'}</strong></div>
          <div className="dep-info-item"><span>State / Location</span><strong>{project.state || project.location || 'Location not specified'}</strong></div>
          <div className="dep-info-item"><span>Implementing Agency</span><strong>{project.agency || 'Agency not specified'}</strong></div>
          <div className="dep-info-item"><span>Project Status</span><strong>{project.status || 'In Progress'}</strong></div>
        </div>
      </div>

      <div className="dep-summary-grid">
        <div className="card dep-stat-card">
          <small>Total Dependencies</small>
          <strong>{dependencySummary.total}</strong>
        </div>
        <div className="card dep-stat-card dep-stat-critical">
          <small>Critical Dependencies</small>
          <strong>{dependencySummary.critical}</strong>
        </div>
        <div className="card dep-stat-card dep-stat-risk">
          <small>At-Risk Dependencies</small>
          <strong>{dependencySummary.atRisk}</strong>
        </div>
        <div className="card dep-stat-card dep-stat-track">
          <small>On-Track Dependencies</small>
          <strong>{dependencySummary.onTrack}</strong>
        </div>
      </div>

      <div className="dep-main-grid">
        <div className="card dep-panel">
          <div className="dep-section-head">Dependency Risk Overview</div>
          <div className="dep-risk-visual">
            {riskOverview.map(item => (
              <div className="dep-risk-row" key={item.label}>
                <label>{item.label}</label>
                <div className="dep-risk-bar-track"><span className={`dep-risk-fill dep-fill--${item.label.toLowerCase()}`} style={{width: `${item.width}%`}} /></div>
                <b>{item.value}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="card dep-panel">
          <div className="dep-section-head">Early Warning</div>
          <ul className="dep-warning-list">
            {earlyWarnings.map(item => (
              <li key={item.title}>
                <span className={`dep-warning-tag dep-warning-tag--${item.reason.toLowerCase().replace(/\s+/g, '-')}`}>{item.reason}</span>
                <strong>{item.title}</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card dep-table-card">
        <div className="dep-section-head">Dependency Register</div>
        <div className="dep-table-wrap">
          <table className="dep-table">
            <thead>
              <tr>
                <th>Dependency</th>
                <th>Related Department / Agency</th>
                <th>Dependency Type</th>
                <th>Status</th>
                <th>Expected Impact</th>
                <th>Risk Level</th>
                <th>Required Action</th>
              </tr>
            </thead>
            <tbody>
              {dependencySeed.map(item => (
                <tr key={item.id}>
                  <td>{item.dependency}</td>
                  <td>{item.agency}</td>
                  <td>{item.type}</td>
                  <td><span className={`dep-badge dep-badge--${statusClass(item.status)}`}>{item.status}</span></td>
                  <td>{item.impact}</td>
                  <td><span className={`dep-badge dep-badge--risk-${String(item.riskLevel || 'Medium').toLowerCase()}`}>{item.riskLevel || 'Medium'}</span></td>
                  <td>{item.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card dep-actions-card">
        <div className="dep-section-head">Coordination Actions</div>
        <div className="dep-action-grid">
          {coordinationActions.map(item => (
            <div className="dep-action-item" key={item.issue}>
              <div className="dep-action-row">
                <span>Issue</span>
                <strong>{item.issue}</strong>
              </div>
              <div className="dep-action-row">
                <span>Responsible Agency</span>
                <strong>{item.agency}</strong>
              </div>
              <div className="dep-action-row">
                <span>Priority</span>
                <strong>{item.priority}</strong>
              </div>
              <div className="dep-action-row">
                <span>Recommended Action</span>
                <strong>{item.action}</strong>
              </div>
              <div className="dep-action-row">
                <span>Target Resolution</span>
                <strong>{item.target}</strong>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="dep-note">Analytical dependency insights — not an official PAIMANA field</div>
    </>}
  </Layout>;
}
function Alerts(){
 const [alerts,setAlerts]=useAlerts(); const [filter,setFilter]=useState('All'); const [toast,setToast]=useState(''); const isAdmin=getSession()?.user?.role==='Administrator'||getSession()?.role==='Administrator'; const filtered=alerts.filter(a=>filter==='All'||a.level.startsWith(filter));
 const acknowledge=async(a)=>{if(!isAdmin){setToast('Administrator authentication required.');setTimeout(()=>setToast(''),3500);return}const r=await fetch(`${API}/alerts/${encodeURIComponent(a.id)}`,{method:'PATCH',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify({ack:true})});const d=await r.json();if(!r.ok){setToast(d.error||'Acknowledgement failed');setTimeout(()=>setToast(''),3500);return}setAlerts(xs=>xs.map(x=>x.id===a.id?d:x));setToast('Alert acknowledged successfully.');setTimeout(()=>setToast(''),3500)};
 return <Layout><SectionTitle title="Risk Alerts & Early Warnings" sub="Generated from current project records and risk calculations"/>{toast&&<div className="toast-notification">{toast}</div>}<div className="card"><div className="toolbar right"><select value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option><option>High</option><option>Medium</option></select></div>{filtered.length?filtered.map(a=><div className={'big-alert '+(a.ack?'ack':'')} key={a.id}><span className={'alert-dot '+riskClass(a.level)}>🔔</span><div className="alert-main"><RiskBadge value={a.level}/><h3>{a.project}</h3><p>{a.message}</p>{a.ack&&<small className="ack-meta">✓ Acknowledged {a.acknowledgedAt?new Date(a.acknowledgedAt).toLocaleString():''}{a.acknowledgedBy?` by ${a.acknowledgedBy}`:''}</small>}</div><time>{new Date(a.time).toLocaleString()}</time>{a.ack?<span className="badge low">Acknowledged</span>:isAdmin?<button className="ghost" onClick={()=>acknowledge(a)}>✓ Acknowledge</button>:<span className="locked-action">Admin only</span>}</div>):<p className="muted">No active alerts. Alerts appear only when current project data crosses the configured risk threshold.</p>}</div></Layout>
}

function monthsBetween(a,b){
 try{const [am,ay]=String(a||'').split('/').map(Number),[bm,by]=String(b||'').split('/').map(Number);if(!am||!ay||!bm||!by)return 0;return (by-ay)*12+(bm-am)}catch{return 0}
}
function modelForProject(p){
 const original=Number(p.originalCost||0), revised=Number(p.cost||p.revisedCost||0), spent=Number(p.expenditure||0), progress=Number(p.progress||0);
 const overrun=original>0?Math.max(0,(revised-original)/original*100):0;
 const spendPct=revised>0?Math.min(150,spent/revised*100):0;
 const ev=revised*progress/100; const plannedProgress=Number.isFinite(Number(p.plannedProgress))?Math.max(0,Math.min(100,Number(p.plannedProgress))):null; const pv=plannedProgress===null?null:revised*plannedProgress/100; const cpi=spent>0?ev/spent:null, spi=pv!==null&&pv>0?ev/pv:null;
 const plannedSlip=monthsBetween(p.targetCompletion,p.revisedCompletion);
 const scheduleRisk=Math.min(100,Math.round(Math.max(0,100-progress)*0.45+Math.max(0,plannedSlip)*5+(spi!==null?Math.max(0,1-spi)*30:0)));
 const costRisk=Math.min(100,Math.round(overrun*2.5+Math.max(0,spendPct-progress)*0.55));
 const score=Math.min(100,Math.round(scheduleRisk*0.52+costRisk*0.48));
 const delayMonths=Math.max(0,plannedSlip);
 const predictedOverrun=Math.round(overrun*10)/10;
 const dataFields=['originalCost','revisedCost','expenditure','progress','targetCompletion','revisedCompletion'].filter(k=>p[k]!==null&&p[k]!==undefined&&p[k]!=='' ).length;
 const confidence=Math.round(dataFields/6*100);
 return {original,revised,spent,progress,overrun,spendPct,ev,pv,cpi,spi,plannedProgress,scheduleRisk,costRisk,score,delayMonths,predictedOverrun,confidence};
}
function driverData(p){const m=modelForProject(p);return [['Material price escalation',Math.min(30,Math.round(m.predictedOverrun*.9))],['Contractor / execution delay',Math.min(25,Math.round(m.scheduleRisk*.25))],['Land acquisition / ROW',p.progress<60?18:9],['Approvals & clearances',p.status==='Delayed'?15:7],['Design / scope changes',m.overrun>10?12:6]].map(([name,value])=>({name,value}));}
function benchmarkData(projects,p){const peers=projects.filter(x=>x.sector===p.sector&&x.id!==p.id);const avg=peers.length?Math.round(peers.reduce((a,x)=>a+modelForProject(x).score,0)/peers.length):50;return {peerCount:peers.length,project:modelForProject(p).score,sectorAverage:avg,portfolioAverage:54};}
function PredictiveAnalytics(){
 const [projects]=useProjects(); const [selected,setSelected]=useState('');
 useEffect(()=>{if(!selected&&projects[0]?.id)setSelected(projects[0].id)},[projects,selected]);
 const p=projects.find(x=>String(x.id)===String(selected))||projects[0];
 const m=p?modelForProject(p):null; const drivers=p?driverData(p):[]; const bench=p?benchmarkData(projects,p):null;
 if(!p)return <Layout><SectionTitle title="Predictive Analytics & Early Warning" sub="SIH 26103 analytics readiness and evidence-based monitoring"/><div className="card">No project records are available.</div></Layout>;
 const dataCompleteness=m?.confidence||0;
 return <Layout>
  <SectionTitle title="Predictive Analytics & Early Warning" sub="SIH 26103 analytics readiness — validated ML accuracy is shown only after historical training/testing"/>
  <div className="toolbar card"><select value={p.id} onChange={e=>setSelected(e.target.value)}>{projects.map(x=><option key={x.id} value={x.id}>{x.id} — {x.name}</option>)}</select><span className="model-status">Evidence-based analytical model · ML validation: NOT CLAIMED</span></div>
  <div className="stats">
   <Stat label="Evidence Risk Score" value={m.score+'/100'} type={m.score>65?'high':'medium'}/>
   <Stat label="Observed Cost Overrun" value={m.predictedOverrun.toFixed(1)+'%'} type={m.predictedOverrun>15?'high':'medium'}/>
   <Stat label="Observed Schedule Slip" value={m.delayMonths+' months'} type={m.delayMonths>3?'high':'medium'}/>
   <Stat label="Input Completeness" value={dataCompleteness+'%'} type={dataCompleteness<70?'high':'low'}/>
  </div>
  <div className="grid2">
   <div className="card"><div className="card-head"><h3>Analytics Readiness</h3><span className="muted">SIH 26103 technical dimension (a–c)</span></div>
    <div className="metric-box"><span>Historical outcome-labelled training set</span><b>Not connected</b></div>
    <div className="metric-box"><span>Leakage-controlled train/test evaluation</span><b>Not validated</b></div>
    <div className="metric-box"><span>ML vs conventional statistical comparison</span><b>Pending historical data</b></div>
    <div className="metric-box"><span>Current CUF fields available</span><b>{cufFields.filter(x=>x.usedInBaseline).length}/{cufFields.length}</b></div>
    <p className="method-note">The application deliberately does not display a fabricated accuracy percentage. The April 2026 portfolio is a monitoring snapshot; validated predictive accuracy requires historical project outcomes and an independent time-aware test set.</p>
   </div>
   <div className="card"><h3>Evidence-Based Risk Drivers</h3><ResponsiveContainer width="100%" height={260}><BarChart data={drivers} layout="vertical" margin={{left:20,right:20}}><XAxis type="number" domain={[0,30]}/><YAxis type="category" dataKey="name" width={170} tick={{fontSize:10}}/><Tooltip/><Bar dataKey="value" fill="#2478e8" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer><p className="method-note">Driver values are transparent evidence indicators, not learned feature-importance or probability estimates.</p></div>
  </div>
  <div className="grid2"><div className="card"><h3>CUF vs Additional Variables</h3><div className="table-scroll"><table><thead><tr><th>Variable</th><th>Availability</th></tr></thead><tbody>{cufFields.map(f=><tr key={f.field}><td>{f.field}</td><td><span className="badge low">CUF · available</span></td></tr>)}{additionalVariables.map(f=><tr key={f}><td>{f}</td><td><span className="badge medium">Additional · proposed</span></td></tr>)}</tbody></table></div></div>
   <div className="card"><h3>Benchmarking Readiness</h3><div className="benchmark-bars"><div><span>Current project evidence score</span><b>{bench.project}/100</b></div><div><span>{p.sector||'Sector'} peer evidence average</span><b>{bench.sectorAverage}/100</b></div><div><span>Peer records available</span><b>{bench.peerCount}</b></div></div><p className="method-note">These are descriptive evidence comparisons. They are not a prediction accuracy score or an ML confidence percentage.</p></div>
  </div>
  <div className="card recommendation-card"><h3>Early Warning Status</h3><div className="warning-banner"><b>{m.score>=70?'HIGH EVIDENCE RISK':'MONITOR'}</b><span>{p.name}</span></div><ul className="decision-list"><li>{m.predictedOverrun>10?'Review revised-cost escalation and remaining-cost exposure.':'Continue approved cost monitoring.'}</li><li>{m.scheduleRisk>60?'Review milestone recovery and critical-path dependencies.':'Continue milestone monitoring.'}</li><li>{p.progress<60?'Obtain current site/drone evidence before updating physical-progress conclusions.':'Continue physical-progress verification.'}</li></ul></div>
  <div className="card analytics-readiness-note"><b>Validation gate:</b> ML prediction accuracy will be enabled only when a documented historical dataset, target labels, train/test split, baseline comparison and reproducible evaluation are available.</div>
 </Layout>
}
function EVM(){
 const [projects]=useProjects(); const [selected,setSelected]=useState(projects[0]?.id||''); const [plannedValue,setPlannedValue]=useState(null); const [plannedValueLoading,setPlannedValueLoading]=useState(false); const p=projects.find(x=>x.id===selected)||projects[0]; const m=p?modelForProject(p):null;
 useEffect(()=>{let live=true; if(!p){setPlannedValue(null);return} setPlannedValueLoading(true); setPlannedValue(null); fetch(`${API}/projects/${encodeURIComponent(p.id)}/planned-value`,{headers:authHeaders({Accept:'application/json'})}).then(r=>r.ok?r.json():null).then(data=>{if(live)setPlannedValue(data?.available===true?Number(data.plannedValue):null)}).catch(()=>{if(live)setPlannedValue(null)}).finally(()=>{if(live)setPlannedValueLoading(false)}); return()=>{live=false}},[p?.id]);
 if(!p)return <Layout><SectionTitle title="Earned Value Management"/><div className="card">No projects available.</div></Layout>;
 const pv=Number.isFinite(plannedValue)?plannedValue:null; const ev=m.ev; const ac=m.spent; const cpi=ac>0?ev/ac:null; const spi=pv!==null&&pv>0?ev/pv:null; const eac=cpi!==null?m.revised/cpi:null; const vac=eac===null?null:m.revised-eac;
 return <Layout><SectionTitle title="Earned Value Management (EVM)" sub="Approved Planned Value is fetched automatically for the selected project"/><div className="toolbar card"><select value={selected} onChange={e=>setSelected(e.target.value)}>{projects.map(x=><option key={x.id} value={x.id}>{x.id} — {x.name}</option>)}</select><div className="evm-planned-field"><span>Approved Planned Value</span><output className="evm-planned-value">{plannedValueLoading?'Loading…':pv===null?'Planned Value Not Available':`₹ ${pv.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} Cr`}</output></div></div><div className="evm-grid">{[['Planned Value (PV)',pv],['Earned Value (EV)',ev],['Actual Cost (AC)',ac],['CPI',cpi===null?'Not available':cpi.toFixed(2)],['SPI',spi===null?'Not available':spi.toFixed(2)],['EAC',eac],['ETC',eac===null?null:Math.max(0,eac-ac)],['VAC',vac],['TCPI',cpi===null?null:((m.revised-ev)/(m.revised-ac||1)).toFixed(2)]].map(([k,v])=><div className="evm-card" key={k}><small>{k}</small><strong>{typeof v==='number'&&k!=='CPI'&&k!=='SPI'?'₹ '+v.toLocaleString(undefined,{maximumFractionDigits:2})+' Cr':v===null?'Not available':v}</strong><span>{k==='CPI'?(cpi<1?'Below cost efficiency':'Healthy cost efficiency'):k==='SPI'?(spi<1?'Behind schedule':'On schedule'):''}</span></div>)}</div><div className="grid2"><div className="card"><h3>Performance Interpretation</h3><div className="metric-box"><span>Cost Variance (CV = EV − AC)</span><b>₹ {(ev-ac).toLocaleString(undefined,{maximumFractionDigits:2})} Cr</b></div><div className="metric-box"><span>Schedule Variance (SV = EV − PV)</span><b>{pv===null?'Not available':'₹ '+(ev-pv).toLocaleString(undefined,{maximumFractionDigits:2})+' Cr'}</b></div><div className="metric-box"><span>Variance at Completion (VAC)</span><b>{vac===null?'Not available':'₹ '+vac.toLocaleString(undefined,{maximumFractionDigits:2})+' Cr'}</b></div></div><div className="card"><h3>What should the administrator do?</h3><ul className="decision-list"><li>{cpi!==null&&cpi<1?'Investigate cost drivers and change orders.':'Review cost efficiency only when AC is available.'}</li><li>{spi!==null&&spi<1?'Create a milestone recovery plan and review critical path.':'Review schedule performance only when an approved planned value is available.'}</li><li>Validate physical progress against field evidence before approving the next release.</li></ul></div></div></Layout>
}
function ImageryMonitoring(){
 const [projects]=useProjects(); const [selected,setSelected]=useState(projects[0]?.id||''); const [file,setFile]=useState(null); const [result,setResult]=useState(null); const p=projects.find(x=>x.id===selected)||projects[0];
 const analyze=()=>{if(!file)return; setResult({fileName:file.name,size:file.size,uploadedAt:new Date().toISOString(),status:'evidence-uploaded'});};
 return <Layout><SectionTitle title="Drone & Imagery Physical Progress" sub="Upload site imagery to compare observed visual progress with the project-reported progress"/><div className="grid2"><div className="card"><h3>1. Select project & upload evidence</h3><Field label="Project"><select value={selected} onChange={e=>setSelected(e.target.value)}>{projects.map(x=><option key={x.id} value={x.id}>{x.id} — {x.name}</option>)}</select></Field><div className="upload-box"><input id="droneFile" type="file" accept="image/*" onChange={e=>{setFile(e.target.files?.[0]||null);setResult(null)}}/><label htmlFor="droneFile">▧ Choose drone / site image</label>{file&&<p>{file.name} · {(file.size/1024).toFixed(0)} KB</p>}</div><button className="primary" disabled={!file} onClick={analyze}>Analyze Physical Progress</button><p className="method-note">The browser does not invent a progress percentage. A production deployment should send geo-referenced imagery to a validated computer-vision service and store its model/version, confidence and evidence timestamp before using the result for official decisions.</p></div><div className="card"><h3>2. Evidence result</h3>{result?<><div className="metric-box"><span>Evidence file</span><b>{result.fileName}</b></div><div className="metric-box"><span>File size</span><b>{(result.size/1024).toFixed(0)} KB</b></div><div className="metric-box"><span>Uploaded</span><b>{new Date(result.uploadedAt).toLocaleString()}</b></div><div className="form-note success">✓ Evidence file recorded. No progress percentage is invented; validated computer-vision analysis is required before official use.</div></>:<p className="muted">Upload a current site image to create an evidence record.</p>}</div></div></Layout>
}

function parseProjectDate(value,endOfMonth=false){
 if(!value)return null;
 const s=String(value).trim(); let m=s.match(/^(\d{1,2})[\/-](\d{4})$/);
 if(m){const month=Number(m[1]),year=Number(m[2]);if(month<1||month>12)return null;return new Date(Date.UTC(year,month-(endOfMonth?0:1),endOfMonth?0:1));}
 m=s.match(/^(\d{4})[\/-](\d{1,2})$/);
 if(m){const year=Number(m[1]),month=Number(m[2]);if(month<1||month>12)return null;return new Date(Date.UTC(year,month-(endOfMonth?0:1),endOfMonth?0:1));}
 const d=new Date(s);return Number.isNaN(d.getTime())?null:d;
}
function formatProjectDate(value){const d=parseProjectDate(value);return d?d.toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}):'Not available'}
function dateDiffDays(a,b){const x=parseProjectDate(a),y=parseProjectDate(b,true);if(!x||!y)return null;return Math.max(0,Math.ceil((y-x)/86400000))}
function timeMetrics(p){
 const start=p.start||p.startDate||null;
 const plannedEnd=p.targetCompletion||p.completion||null;
 const revisedEnd=p.revisedCompletion||p.completion||plannedEnd;
 const planned=dateDiffDays(start,plannedEnd);
 const actualEnd=p.status==='Completed'?(p.actualCompletion||p.actualEnd||null):null;
 const endForElapsed=actualEnd||revisedEnd||plannedEnd;
 const startDate=parseProjectDate(start);
 const now=new Date();
 const elapsed=startDate?Math.max(0,Math.ceil(((actualEnd?parseProjectDate(actualEnd):now)-startDate)/86400000)):null;
 const actual=actualEnd?dateDiffDays(start,actualEnd):elapsed;
 const targetDate=parseProjectDate(plannedEnd,true);
 const calendarDelay=!actualEnd&&targetDate?Math.max(0,Math.ceil((now-targetDate)/86400000)):null;
 const durationDelay=actual===null||planned===null?null:Math.max(0,actual-planned);
 const delay=actualEnd?durationDelay:calendarDelay;
 const delayPct=delay===null||!planned?null:Math.round(delay/planned*1000)/10;
 return {planned,actual,delay,delayPct,plannedEnd,revisedEnd,actualEnd,expectedEnd:endForElapsed};
}
function Reports(){
 const [projects]=useProjects(); const [tab,setTab]=useState('Cost Overrun');
 const rows=projects.map(p=>({...p,model:modelForProject(p),time:timeMetrics(p)}));
 const sectors=[...new Set(rows.map(p=>p.sector).filter(Boolean))].map(name=>({name,value:rows.filter(p=>p.sector===name).reduce((a,p)=>a+p.model.predictedOverrun,0)/(rows.filter(p=>p.sector===name).length||1)}));
 return <Layout><SectionTitle title="Reports & Analytics" sub="Generated from the current project registry; source dates are preserved and duration/delay are calculated where possible"/><div className="card"><div className="tabs pills">{['Cost Overrun','Time Delay','Progress','Drivers','Benchmarking','Sector Analysis','Ministry Wise'].map(x=><button className={tab===x?'active':''} onClick={()=>setTab(x)} key={x}>{x}</button>)}</div>
 {rows.length===0?<div className="report-placeholder"><b>No report data available</b><p>Add/import project records first.</p></div>:<>
 {tab==='Cost Overrun'&&<><h3>Project Cost Exposure</h3><div className="table-scroll"><table><thead><tr><th>Project</th><th>Original</th><th>Revised</th><th>Cost Overrun</th><th>Expenditure</th></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.originalCost??'Not available'}</td><td>{(p.revisedCost??p.cost)??'Not available'}</td><td>{p.model.original>0&&p.model.revised>=0?`${p.model.predictedOverrun.toFixed(1)}%`:'Not available'}</td><td>{p.expenditure??'Not available'}</td></tr>)}</tbody></table></div></>}
 {tab==='Time Delay'&&<><h3>Time & Completion Analysis</h3><p className="method-note">Planned duration uses Start → Original/Target Completion. For completed projects, Actual End is shown only when an actual completion field is available. For ongoing projects, Revised/Expected End is shown; delay is calculated only where the available dates support it.</p><div className="table-scroll"><table><thead><tr><th>Project</th><th>Started</th><th>Original Planned End</th><th>Revised / Expected End</th><th>Actual End</th><th>Planned Duration</th><th>Elapsed / Actual Duration</th><th>Delay</th></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td><b>{p.name}</b></td><td>{formatProjectDate(p.start)}</td><td>{formatProjectDate(p.targetCompletion||p.completion)}</td><td>{formatProjectDate(p.revisedCompletion||p.completion)}</td><td>{p.time.actualEnd?formatProjectDate(p.time.actualEnd):'Ongoing'}</td><td>{p.time.planned==null?'Not available':`${p.time.planned} days`}</td><td>{p.time.actual==null?'Not available':`${p.time.actual} days`}</td><td>{p.time.delay==null?'Not available':p.time.delay>0?`${p.time.delay} days`:'On schedule'}</td></tr>)}</tbody></table></div></>}
 {tab==='Progress'&&<><h3>Project Progress</h3><div className="table-scroll"><table><thead><tr><th>Project</th><th>Started</th><th>Ended / Expected</th><th>Physical Progress</th><th>Financial Progress</th><th>Status</th><th>Data Source</th></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td>{p.name}</td><td>{formatProjectDate(p.start)}</td><td>{p.status==='Completed'&&p.time.actualEnd?formatProjectDate(p.time.actualEnd):formatProjectDate(p.revisedCompletion||p.completion)}</td><td>{p.progress==null?'Not available':`${p.progress}%`}</td><td>{p.financialProgress==null?'Not available':`${p.financialProgress}%`}</td><td>{p.status||'Not available'}</td><td>{p.sourceType||'Not available'}</td></tr>)}</tbody></table></div></>}
 {tab==='Drivers'&&<div className="table-scroll"><table><thead><tr><th>Project</th><th>Cost Risk</th><th>Schedule Risk</th><th>Top Driver</th></tr></thead><tbody>{rows.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.model.costRisk}</td><td>{p.model.scheduleRisk}</td><td>{driverData(p)[0].name}</td></tr>)}</tbody></table></div>}
 {tab==='Benchmarking'&&<div className="table-scroll"><table><thead><tr><th>Project</th><th>Risk Score</th><th>Peer Count</th><th>Sector Average</th></tr></thead><tbody>{rows.map(p=>{const b=benchmarkData(projects,p);return <tr key={p.id}><td>{p.name}</td><td>{p.model.score}</td><td>{b.peerCount}</td><td>{b.sectorAverage}</td></tr>})}</tbody></table></div>}
 {tab==='Sector Analysis'&&<div className="table-scroll"><table><thead><tr><th>Sector</th><th>Average Calculated Cost Overrun</th></tr></thead><tbody>{sectors.map(x=><tr key={x.name}><td>{x.name}</td><td>{x.value.toFixed(1)}%</td></tr>)}</tbody></table></div>}
 {tab==='Ministry Wise'&&<div className="table-scroll"><table><thead><tr><th>Ministry</th><th>Projects</th></tr></thead><tbody>{[...new Set(rows.map(x=>x.ministry).filter(Boolean))].map(x=><tr key={x}><td>{x}</td><td>{rows.filter(p=>p.ministry===x).length}</td></tr>)}</tbody></table></div>}
 </>}</div></Layout>
}
function DataSources(){
 const [info,setInfo]=useState(null); const [file,setFile]=useState(null); const [message,setMessage]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [syncing,setSyncing]=useState(false);
 const load=()=>fetch(`${API}/data-sources`).then(r=>r.json()).then(setInfo).catch(e=>setError(e.message));
 useEffect(()=>{load()},[]);
 const syncPaimana=async()=>{setSyncing(true);setMessage('');setError('');try{const r=await fetch(`${API}/paimana/sync`,{method:'POST'});const d=await r.json();if(!r.ok)throw new Error(d.error||'PAIMANA sync failed');setMessage(`PAIMANA sync complete: ${d.imported} official portfolio records imported. Exact route matching still requires verified GIS geometry.`);load();}catch(e){setError(e.message)}finally{setSyncing(false)}};
 const importGeoJSON=async()=>{if(!file)return;setBusy(true);setMessage('');setError('');try{const text=await file.text();const payload=JSON.parse(text);const r=await fetch(`${API}/projects/import`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Import failed');setMessage(`Imported ${d.imported} verified GIS project record(s). Total route-eligible records: ${d.totalVerifiedProjects}.`);load();}catch(e){setError(e.message)}finally{setBusy(false)}};
 const downloadTemplate=()=>{const sample={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[78.4867,17.385]},properties:{id:'GIS-001',name:'Example Verified Project',ministry:'Example Department',sector:'Transport',state:'',status:'Ongoing',progress:42,originalCost:150,cost:175,expenditure:60,risk:'Medium',sourceType:'REPLACE_WITH_AUTHORITATIVE_GIS_SOURCE',sourceUrl:'REPLACE_WITH_REAL_SOURCE_URL',sourceVerified:false,locationPrecision:'point'}}]};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(sample,null,2)],{type:'application/geo+json'}));a.download='verified-projects.template.geojson';a.click();};
 return <Layout><SectionTitle title="GIS Data & Sources" sub="The route engine is India-wide. Exact project detection depends on verified project geometry; this page is the controlled import point for that national GIS layer."/>
  <div className="stats"><Stat label="PAIMANA Portfolio" value={paimanaOverview.totalProjects.toLocaleString()} type="total"/><Stat label="Verified GIS records" value={info?.registry?.count??'—'} type="medium"/><Stat label="On-route threshold" value="≤ 500 m" type="low"/><Stat label="Route search" value="Full selected route" type="medium"/><Stat label="GIS envelope" value="≤ 25 km" type="low"/><Stat label="Routing / GIS services" value="4+" type="high"/></div>
  <div className="grid2">
   <div className="card paimana-source-card"><div className="card-head"><h3>PAIMANA official project register · 1,981 projects</h3><button className="view-btn" disabled={syncing} onClick={syncPaimana}>{syncing?'Syncing…':'Sync PAIMANA'}</button></div><p className="muted">Pull the current public PAIMANA portfolio into the project register. This imports official project metadata only; it does not invent coordinates or physical progress.</p><div className="analysis-action">Official source: MoSPI / IPMD PAIMANA public dashboard</div><p className="muted">After sync, add authoritative GIS geometry through the verified import below before a project can appear as an exact route conflict.</p></div>
   <div className="card"><div className="card-head"><h3>Import verified project GIS</h3></div><p className="muted">Use GeoJSON with Point, LineString or MultiLineString geometry. The backend will never geocode a project name and call that location exact.</p><input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={e=>setFile(e.target.files?.[0]||null)}/><div className="wizard-actions"><button className="ghost" onClick={downloadTemplate}>Download template</button><button className="primary" disabled={!file||busy} onClick={importGeoJSON}>{busy?'Importing…':'Import verified GIS'}</button></div>{message&&<div className="form-note success">✓ {message}</div>}{error&&<div className="form-note error">{error}</div>}</div>
   <div className="card"><h3>Route matching rules</h3><div className="analysis-action">Full selected road route → primary search scope</div><div className="analysis-action">Verified GIS geometry → exact route relationship</div><div className="analysis-action">PAIMANA road/locality match → monitoring candidate</div><div className="analysis-action">OSM construction → supplementary evidence, not official progress</div><p className="muted">Linear infrastructure should use LineString/MultiLineString geometry. Point geometry is allowed only when the coordinate is verified.</p></div>
  </div>
  <div className="card"><div className="card-head"><h3>Evidence layers</h3><button className="view-btn" onClick={load}>Refresh</button></div><div className="table-scroll"><table><thead><tr><th>Source</th><th>Scope</th><th>Route eligible</th><th>Progress rule</th></tr></thead><tbody>{(info?.sources||[]).map(x=><tr key={x.name}><td><b>{x.name}</b></td><td>{x.scope}</td><td>{x.routeEligible?'Yes':'Only after verified geometry import'}</td><td>{x.progress}</td></tr>)}</tbody></table></div><p className="muted">This separation prevents the system from presenting a tender, district name, or guessed geocode as proof that a project is physically on a selected route.</p></div>
 </Layout>
}

function AddProject(){
 const isAdmin=getSession()?.user?.role==='Administrator'||getSession()?.role==='Administrator';
 if(!isAdmin)return <Layout><SectionTitle title="Add New Infrastructure Project" sub="Administrator-only data management"/><div className="card access-locked"><h2>Administrator authentication required.</h2><p className="muted">General users can view and search the portal, but cannot add or modify project records.</p></div></Layout>;
 const [step,setStep]=useState(1); const [projects,setProjects]=useProjects(); const [saving,setSaving]=useState(false); const [form,setForm]=useState({name:'',ministry:'',sector:'Transport',state:'',agency:'',description:'',originalCost:'',revisedCost:'',start:'',completion:'',lat:'',lng:'',sourceUrl:''});
 const set=(k,v)=>setForm({...form,[k]:v});
 const score=useMemo(()=>{let s=30;if(Number(form.revisedCost)>Number(form.originalCost||0)*1.2)s+=30;if(form.sector==='Transport')s+=10;if(form.completion&&form.start)s+=8;return Math.min(100,s)},[form]);
 const next=()=>{if(step===1&&!form.name.trim())return alert('Enter project name');if(step===3&&((form.lat&&!form.lng)||(form.lng&&!form.lat)))return alert('Enter both latitude and longitude, or leave both blank.');setStep(Math.min(4,step+1))};
 const save=async()=>{
   if(!(await reauthenticateAdmin()))return;
   const risk=score>=70?'High':score>=45?'Medium':'Low';
   const p={id:'P-'+String(100+projects.length).padStart(3,'0'),name:form.name,ministry:form.ministry||'Department',sector:form.sector,state:form.state,risk,progress:null,cost:Number(form.revisedCost||form.originalCost||0),originalCost:Number(form.originalCost||0),expenditure:null,start:form.start||null,completion:form.completion||null,status:'New',agency:form.agency,description:form.description,lat:form.lat?Number(form.lat):undefined,lng:form.lng?Number(form.lng):undefined,sourceUrl:form.sourceUrl||undefined};
   setSaving(true);
   try{const r=await fetch(`${API}/projects`,{method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify(p)});const saved=await r.json();if(!r.ok)throw new Error(saved.error||'Could not create project');setProjects(xs=>[...xs,saved]);setStep(4);}catch(e){alert(e.message)}finally{setSaving(false)}
 };
 return <Layout><SectionTitle title="Add New Infrastructure Project" sub="Projects enter the dashboard immediately. User-entered coordinates are not treated as authoritative route geometry; route matching requires independent GIS verification through GIS Data & Sources."/><div className="card wizard"><div className="steps">{['Basic Details','Financial Details','Location & Timeline','Review'].map((x,i)=><div className={step===i+1?'current':''} key={x}><span>{i+1}</span>{x}</div>)}</div>
 {step===1&&<div className="form-grid"><Field label="Project Name *"><input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Enter project name"/></Field><Field label="Ministry/Department *"><select value={form.ministry} onChange={e=>set('ministry',e.target.value)}><option value="">Select ministry</option>{ministryOptions.map(x=><option key={x} value={x}>{x}</option>)}</select></Field><Field label="Sector *"><select value={form.sector} onChange={e=>set('sector',e.target.value)}>{['Transport','Energy','Water','Communication','Social Infra','Railway','Metro','Others'].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="State / UT *"><select value={form.state} onChange={e=>set('state',e.target.value)}><option value="">Select state or UT</option>{indiaStatesAndUnionTerritories.map(x=><option key={x} value={x}>{x}</option>)}</select></Field><Field label="Implementing Agency *" full><input value={form.agency} onChange={e=>set('agency',e.target.value)} placeholder="Enter agency name"/></Field><Field label="Project Description" full><textarea value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Enter project description"/></Field></div>}
 {step===2&&<div className="form-grid"><Field label="Original Cost (₹ Cr)"><input type="number" value={form.originalCost} onChange={e=>set('originalCost',e.target.value)} placeholder="12000"/></Field><Field label="Revised Cost (₹ Cr)"><input type="number" value={form.revisedCost} onChange={e=>set('revisedCost',e.target.value)} placeholder="15000"/></Field></div>}
 {step===3&&<div className="form-grid"><Field label="Latitude (optional; must be independently verified)"><input type="number" step="any" value={form.lat} onChange={e=>set('lat',e.target.value)} placeholder="17.3850"/></Field><Field label="Longitude (optional; must be independently verified)"><input type="number" step="any" value={form.lng} onChange={e=>set('lng',e.target.value)} placeholder="78.4867"/></Field><Field label="Start Date"><input type="date" value={form.start} onChange={e=>set('start',e.target.value)}/></Field><Field label="Expected Completion"><input type="date" value={form.completion} onChange={e=>set('completion',e.target.value)}/></Field><Field label="Source URL" full><input value={form.sourceUrl} onChange={e=>set('sourceUrl',e.target.value)} placeholder="Official departmental / GIS source URL"/></Field><div className="form-note">If coordinates are blank, the project is dashboard-only and will <b>not</b> be shown as a route conflict. This prevents false geographic matches.</div></div>}
 {step===4&&<div className="review"><h3>Review & Risk Estimate</h3><div className="review-grid">{Object.entries(form).filter(([k])=>k!=='description').map(([k,v])=><div key={k}><small>{k}</small><b>{v||'—'}</b></div>)}</div><div className="score-preview"><span>Estimated Risk Score</span><b>{score}/100</b><RiskBadge value={score>=70?'High':score>=45?'Medium':'Low'}/></div><p className="muted">Route matching: {form.lat&&form.lng?'Eligible after verified-coordinate import':'Not eligible until verified GIS geometry is supplied'}.</p></div>}
 <div className="wizard-actions"><button className="ghost" onClick={()=>setStep(Math.max(1,step-1))}>Back</button>{step<4?<button className="primary" onClick={next}>Next →</button>:<button className="primary" disabled={saving} onClick={save}>{saving?'Saving…':'Create Project ✓'}</button>}</div></div></Layout>
}

function Field({label,children,full}){return <label className={full?'full':''}><span>{label}</span>{children}</label>}

function Assistant(){
 const [projects]=useProjects(); const [messages,setMessages]=useState([{role:'assistant',text:'Ask about a project in the current registry. I will answer only from available project data and calculated risk metrics.'}]); const [input,setInput]=useState('');
 const send=()=>{if(!input.trim())return;const q=input.toLowerCase();const p=projects.find(x=>(x.name||'').toLowerCase().includes(q)||(x.id||'').toLowerCase()===q.trim());let text;if(!projects.length) text='No project records are currently available. Add a project or import an authoritative dataset first.'; else if(p){const m=modelForProject(p);text=`${p.name}: status ${p.status||'Not available'}, progress ${p.progress??'Not available'}%, risk ${p.risk||'Not available'}. Calculated risk score is ${m.score}/100, predicted cost overrun ${m.predictedOverrun.toFixed(1)}%, expected delay ${m.delayMonths} months. These are calculations from the stored record, not a claim of validated ML accuracy.`;} else if(q.includes('high risk')){const high=projects.filter(x=>x.risk==='High');text=high.length?`There are ${high.length} high-risk project records. ${high.slice(0,5).map(x=>x.name).join(', ')}.`:'No project is currently marked High Risk.';} else if(q.includes('recommend')) text='Select or name a project and I can calculate data-driven cost, schedule and risk indicators from its current record.'; else text='I can answer about projects, status, progress, cost, risk, alerts and calculated dependencies when those fields exist in the current registry.';setMessages(xs=>[...xs,{role:'user',text:input},{role:'assistant',text}]);setInput('')};
 return <Layout><SectionTitle title="AI Infrastructure Assistant" sub="Data-grounded assistant — no fabricated project facts"/><div className="assistant card"><div className="messages">{messages.map((m,i)=><div className={'message '+m.role} key={i}><div className="bubble">{m.text}</div><small>{m.role==='user'?'You':'Infra Risk Radar'}</small></div>)}</div><div className="chat-input"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="Ask about a project, risk, cost, delay..."/><button className="primary" onClick={send}>➤</button></div></div></Layout>
}
function App(){
 return <Routes><Route path="/login" element={<Login/>}/><Route path="/*" element={<Protected><Routes><Route path="/" element={<Dashboard/>}/><Route path="/paimana" element={<PaimanaOverview/>}/><Route path="/route" element={<RouteAnalysis/>}/><Route path="/map" element={<RouteAnalysis/>}/><Route path="/projects" element={<Projects/>}/><Route path="/projects/:id" element={<ProjectDetail/>}/><Route path="/predictive" element={<PredictiveAnalytics/>}/><Route path="/evm" element={<EVM/>}/><Route path="/imagery" element={<ImageryMonitoring/>}/><Route path="/risk" element={<RiskRadar/>}/><Route path="/dependencies" element={<Dependencies/>}/><Route path="/alerts" element={<Alerts/>}/><Route path="/reports" element={<Reports/>}/><Route path="/add" element={<AddProject/>}/><Route path="/assistant" element={<Assistant/>}/></Routes></Protected>}/></Routes>
}
createRoot(document.getElementById('root')).render(
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <App/>
  </BrowserRouter>
);