import { useState, useEffect, useRef, useCallback } from "react";
import {
  Car, BarChart2, Camera, FileText, User, DollarSign,
  CheckCircle, Clock, XCircle, AlertTriangle, Upload,
  ChevronDown, ChevronUp, RefreshCw, Save, X, TrendingUp,
  Tag, ArrowRight, Radio, Search, Plus, ChevronLeft,
  Activity, Sparkles, Globe, AlertCircle, LayoutDashboard,
  ClipboardList, Package, Settings, Bell, ChevronRight,
  Printer, Image, Building2, ShieldCheck, Zap,
  FileSearch, Mail, ExternalLink, ScanLine, Edit3, Share2, Info
} from "lucide-react";
import VINScanner from './VINScanner.jsx'


// ─── VANTAGE PALETTE (ClickDocs family) ──────────────────────────────
const C = {
  navy:'#1C2D5E', navyLight:'#2B3F80', navyMuted:'rgba(28,45,94,0.07)',
  navyBorder:'rgba(28,45,94,0.15)',
  teal:'#00B4A6', tealLight:'#00C8B8', tealMuted:'rgba(0,180,166,0.1)',
  bg:'#EBEBEB', bgDark:'#E0E0E0', card:'#FFFFFF',
  textDark:'#1C2D5E', textMid:'#4A5568', textLight:'#8C95A0',
  green:'#1A7A4A', greenBg:'rgba(26,122,74,0.08)',
  orange:'#C05621', orangeBg:'rgba(192,86,33,0.08)',
  red:'#C53030', redBg:'rgba(197,48,48,0.08)',
  blue:'#2B6CB0', blueBg:'rgba(43,108,176,0.08)',
  purple:'#6B46C1', purpleBg:'rgba(107,70,193,0.08)',
  border:'rgba(0,0,0,0.08)', borderStr:'rgba(0,0,0,0.14)',
};

// ─── STATUS CONFIGS ───────────────────────────────────────────────────
const AS = {
  in_progress:{label:'In Progress',color:C.navy,  bg:C.navyMuted,  Icon:Clock},
  offer_made: {label:'Offer Made', color:C.orange, bg:C.orangeBg,   Icon:Tag},
  purchased:  {label:'Purchased',  color:C.green,  bg:C.greenBg,    Icon:CheckCircle},
  lost:       {label:'Lost',       color:C.red,    bg:C.redBg,      Icon:XCircle},
};
const VS = {
  pending:     {label:'Pending',      color:C.textLight,bg:'rgba(140,149,160,0.12)',Icon:Clock},
  in_recon:    {label:'In Recon',     color:C.orange,   bg:C.orangeBg,             Icon:AlertTriangle},
  available:   {label:'Available',    color:C.green,    bg:C.greenBg,              Icon:CheckCircle},
  sale_pending:{label:'Sale Pending', color:C.blue,     bg:C.blueBg,               Icon:Tag},
  sold:        {label:'Sold',         color:C.purple,   bg:C.purpleBg,             Icon:CheckCircle},
  wholesale:   {label:'Wholesale',    color:C.textMid,  bg:'rgba(74,85,104,0.08)', Icon:ArrowRight},
};

// ─── HELPERS ─────────────────────────────────────────────────────────
const fmt  = n => n?`$${Number(n).toLocaleString('en-CA')}`:'—';

const DISTANCE_OPTS = ['Auto',10,20,30,40,50,75,100,150,200,250,300,400,500,675,1250,1500,1750,2000,2500,3000,'All'];

function calcGrade(mds){
  if(!mds) return null;
  if(mds<30) return {grade:'A',color:'#1A7A4A',bg:'rgba(26,122,74,0.12)'};
  if(mds<60) return {grade:'B',color:'#2B6CB0',bg:'rgba(43,108,176,0.12)'};
  if(mds<90) return {grade:'C+',color:'#C05621',bg:'rgba(192,86,33,0.12)'};
  if(mds<120) return {grade:'C',color:'#C53030',bg:'rgba(197,48,48,0.12)'};
  return {grade:'D',color:'#742A2A',bg:'rgba(116,42,42,0.12)'};
}

function calcAction(vehicleMds, fleetAvgMds){
  if(!vehicleMds||!fleetAvgMds) return null;
  return Math.round(fleetAvgMds - vehicleMds);
}

function odometerAdj(vehicleOdo, marketAvgOdo){
  if(!vehicleOdo||!marketAvgOdo) return null;
  const diff = Number(marketAvgOdo) - Number(vehicleOdo);
  const rate = 0.08; // $0.08 per km
  return Math.round(diff * rate);
}

function mockHistoricalData(make, model){
  // Mock dealer historical data — replace with real data from DMS
  const seed = (make||'').charCodeAt(0) + (model||'').charCodeAt(0);
  const inStockCount = 2 + (seed % 4);
  const soldCount = 4 + (seed % 6);
  return {
    inStock: { count: inStockCount, avgAge: 18 + (seed%20), avgPrice: 38000 + (seed*200), avgOdo: 45000 + (seed*300) },
    sold:    { count: soldCount,   avgDts: 16 + (seed%18), avgPrice: 39500 + (seed*200), avgOdo: 47000 + (seed*300) },
  };
}
const fmtN = n => n?Number(n).toLocaleString('en-CA'):'—';
const daysAgo = d => Math.floor((Date.now()-new Date(d))/86400000);
const stockNum = () => 'V'+Math.floor(10000+Math.random()*90000);
const pct = (a,b) => (!a||!b)?null:Math.round((Number(a)/Number(b))*100);
const gaugeColor = p => !p?C.textLight:p<85?C.green:p<102?C.teal:p<112?C.orange:C.red;
const gaugeLabel = p => !p?'':p<85?'Below Market':p<102?'Competitive':p<112?'Above Market':'Overpriced';
const ageColor = d => d<15?C.green:d<30?C.orange:C.red;

// ─── ACTION LOG ───────────────────────────────────────────────────────
// Human-readable labels for tracked fields. Anything not listed is skipped
// (transient/derived market data, etc.) so the log stays meaningful.
const LOG_FIELDS = {
  status:'Status', disposition:'Disposition', vin:'VIN', year:'Year', make:'Make',
  model:'Model', series:'Trim', bodyType:'Body', engine:'Engine',
  transmission:'Transmission', drivetrain:'Drivetrain', extColour:'Ext. Colour',
  intColour:'Int. Colour', odometer:'Odometer', listPrice:'List Price',
  unitCost:'Unit Cost', reconCost:'Recon Cost', certCost:'Cert / Transport',
  pack:'Pack', appraisedValue:'Appraised Value', profitObjective:'Profit Objective',
  description:'Description', notes:'Notes', appraiser:'Appraiser',
  salesperson:'Salesperson', source:'Source', lienHolder:'Lien Holder',
  lienPayoff:'Lien Payoff', firstName:'Customer First Name',
  lastName:'Customer Last Name', phone:'Customer Phone', email:'Customer Email',
  province:'Province',
};
const MONEY_FIELDS = new Set(['listPrice','unitCost','reconCost','certCost','pack','appraisedValue','lienPayoff']);
const LONG_FIELDS = new Set(['description','notes']);

const logDisplay = (field,val) => {
  if(val===''||val===null||val===undefined) return '—';
  if(MONEY_FIELDS.has(field)) return fmt(val);
  if(field==='odometer') return fmtN(val)+' km';
  if(field==='status'){ return (AS[val]||VS[val])?.label || val; }
  if(LONG_FIELDS.has(field)){ const s=String(val); return s.length>40?s.slice(0,40)+'…':s; }
  return String(val);
};

// Compare prev vs next record, return array of log entries for changed tracked fields.
function diffLog(prev, next, user='Staff'){
  const ts=new Date().toISOString();
  const out=[];
  for(const f of Object.keys(LOG_FIELDS)){
    const a=prev?.[f], b=next?.[f];
    const av=(a===null||a===undefined)?'':a, bv=(b===null||b===undefined)?'':b;
    if(String(av)!==String(bv)){
      out.push({ts,field:LOG_FIELDS[f],old:logDisplay(f,a),new:logDisplay(f,b),user});
    }
  }
  return out;
}

// Append entries to a record's log (most-recent-first), capped at 200.
function withLog(record, entries){
  if(!entries||entries.length===0) return record;
  const log=[...entries,...(record.log||[])].slice(0,200);
  return {...record, log};
}

// Single-entry helper for explicit actions (carfax pull, market refresh, finalize…)
const logEvent = (field,newVal,user='Staff',old='') =>
  ({ts:new Date().toISOString(),field,old,new:newVal,user});

// ─── BLANK TEMPLATES ──────────────────────────────────────────────────
const blankAppraisal = () => ({id:Date.now().toString(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'in_progress',disposition:'retail',source:'',appraiser:'',salesperson:'',vin:'',year:'',make:'',model:'',series:'',bodyType:'',engine:'',transmission:'',drivetrain:'',extColour:'',intColour:'',odometer:'',marketLow:null,marketMid:null,marketHigh:null,marketAvgPrice:null,marketDaysSupply:null,likeMineSupply:null,marketDataFetched:null,activeComps:null,avgDaysToSell:null,tires:'',paint:'',interior:'',mechanical:'',accidentVisible:false,reconCost:'',appraisedValue:'',profitObjective:'',photos:[],notes:'',firstName:'',lastName:'',phone:'',email:'',address:'',postal:'',province:'',lienHolder:'',lienPayoff:'',comments:[],carfax:null,certCost:'',pack:'',finalizedAt:null,finalizedBy:null,log:[{ts:new Date().toISOString(),field:'AppraisalCreated',old:'',new:'In Progress',user:'System'}]});
const blankVehicle = (a=null) => ({id:Date.now().toString(),stockNumber:stockNum(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'pending',disposition:'retail',fromAppraisalId:a?.id||null,vin:a?.vin||'',year:a?.year||'',make:a?.make||'',model:a?.model||'',series:a?.series||'',bodyType:a?.bodyType||'',engine:a?.engine||'',transmission:a?.transmission||'',drivetrain:a?.drivetrain||'',extColour:a?.extColour||'',intColour:a?.intColour||'',odometer:a?.odometer||'',listPrice:'',unitCost:a?.appraisedValue||'',reconCost:a?.reconCost||'',marketLow:a?.marketLow||null,marketMid:a?.marketMid||null,marketHigh:a?.marketHigh||null,marketAvgPrice:a?.marketAvgPrice||null,marketDaysSupply:a?.marketDaysSupply||null,likeMineSupply:a?.likeMineSupply||null,marketDataFetched:a?.marketDataFetched||null,activeComps:a?.activeComps||null,avgDaysToSell:a?.avgDaysToSell||null,description:'',features:[...(a?.features||[])],photos:[...(a?.photos||[])],feeds:{autotrader:{active:false},cargurus:{active:false},website:{active:false},auction:{active:false}},log:[{ts:new Date().toISOString(),field:'VehicleCreated',old:'',new:a?'Created from appraisal':'Manual entry',user:'System'}],notes:a?.notes||'',carfax:a?.carfax||null});

// ─── SEED DATA ────────────────────────────────────────────────────────
const SEED = [
  {id:'v1',stockNumber:'V10482',createdAt:new Date(Date.now()-6*86400000).toISOString(),updatedAt:new Date().toISOString(),status:'available',disposition:'retail',vin:'SALKP9FU5PA040378',year:'2023',make:'Land Rover',model:'Range Rover',series:'SE',bodyType:'4D Sport Utility',engine:'3.0L I6 Turbo',transmission:'Automatic',drivetrain:'AWD',extColour:'Fuji White',intColour:'Caraway',odometer:'43679',listPrice:'124990',unitCost:'102000',reconCost:'2500',marketLow:112000,marketMid:118364,marketHigh:128000,marketAvgPrice:118364,marketDaysSupply:92,likeMineSupply:53,marketDataFetched:new Date().toISOString(),activeComps:43,avgDaysToSell:41,description:'',features:['20-Way Climate Seats','Panoramic Roof','11.4" Rear Entertainment','Head-Up Display','360 Camera','Meridian Sound System'],photos:[],feeds:{autotrader:{active:true},cargurus:{active:true},website:{active:true},auction:{active:false}},log:[],notes:'',carfax:null},
  {id:'v2',stockNumber:'V28374',createdAt:new Date(Date.now()-18*86400000).toISOString(),updatedAt:new Date().toISOString(),status:'available',disposition:'retail',vin:'1FTFW1E54NFA02341',year:'2022',make:'Ford',model:'F-150',series:'XLT',bodyType:'Pickup Truck',engine:'3.5L V6 EcoBoost',transmission:'Automatic',drivetrain:'4WD',extColour:'Iconic Silver',intColour:'Black',odometer:'38200',listPrice:'54900',unitCost:'44000',reconCost:'1200',marketLow:49000,marketMid:53500,marketHigh:58000,marketAvgPrice:53500,marketDaysSupply:45,likeMineSupply:28,marketDataFetched:new Date().toISOString(),activeComps:31,avgDaysToSell:22,description:'',features:['Heated Seats','Remote Start','SYNC 4','B&O Sound','Trailer Tow Package'],photos:[],feeds:{autotrader:{active:true},cargurus:{active:true},website:{active:true},auction:{active:false}},log:[],notes:'',carfax:null},
  {id:'v3',stockNumber:'V39201',createdAt:new Date(Date.now()-3*86400000).toISOString(),updatedAt:new Date().toISOString(),status:'in_recon',disposition:'retail',vin:'2T3RFREV7MW123456',year:'2021',make:'Toyota',model:'RAV4',series:'XLE',bodyType:'SUV',engine:'2.5L 4-Cylinder',transmission:'Automatic',drivetrain:'AWD',extColour:'Magnetic Gray',intColour:'Black',odometer:'52100',listPrice:'41500',unitCost:'33000',reconCost:'800',marketLow:37000,marketMid:41000,marketHigh:45500,marketDataFetched:new Date().toISOString(),activeComps:19,avgDaysToSell:18,description:'',features:['Apple CarPlay','Lane Assist','Adaptive Cruise','Heated Seats'],photos:[],feeds:{autotrader:{active:false},cargurus:{active:false},website:{active:false},auction:{active:false}},log:[],notes:'In for detail and paint touch-up',carfax:null},
  {id:'v4',stockNumber:'V44829',createdAt:new Date(Date.now()-45*86400000).toISOString(),updatedAt:new Date().toISOString(),status:'available',disposition:'retail',vin:'WBA5R1C57KAK12345',year:'2019',make:'BMW',model:'3 Series',series:'330i',bodyType:'Sedan',engine:'2.0L 4-Cylinder Turbo',transmission:'Automatic',drivetrain:'RWD',extColour:'Alpine White',intColour:'Black Leather',odometer:'61800',listPrice:'38200',unitCost:'29500',reconCost:'1500',marketLow:33000,marketMid:37500,marketHigh:42000,marketDataFetched:new Date().toISOString(),activeComps:28,avgDaysToSell:35,description:'',features:['iDrive Navigation','Heated Seats','Sport Package','Sunroof','Parking Sensors'],photos:[],feeds:{autotrader:{active:true},cargurus:{active:true},website:{active:true},auction:{active:false}},log:[],notes:'',carfax:null},
];

const DEFAULT_DEALER = {name:'Your Dealership',logo:null,address:'123 Main Street',city:'Toronto',province:'ON',postal:'M5V 3K4',phone:'416-555-0100',email:'info@yourdealership.ca',website:'www.yourdealership.ca',staff:['Manager','Sales','Appraiser']};

// ─── API CALLS ────────────────────────────────────────────────────────
// Backend base URL. In production set VITE_API_URL (e.g. your Railway URL,
// no trailing slash) in Netlify env vars. Falls back to local dev server.
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

async function decodeVIN(vin) {
  // Calls NHTSA directly from browser — free, no backend needed, CORS allowed
  const res = await fetch(
    `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin.toUpperCase()}?format=json`
  )
  if (!res.ok) throw new Error('Network error')
  const data = await res.json()
  const r = data.Results?.[0]
  if (!r || r.ErrorCode === '8' || r.ErrorCode === '11') {
    throw new Error('VIN not found')
  }
  const engineParts = [
    r.DisplacementL ? `${parseFloat(r.DisplacementL).toFixed(1)}L` : '',
    r.EngineCylinders ? `${r.EngineCylinders}-Cylinder` : '',
  ].filter(Boolean)
  const rawMake = r.Make || ''
  const make = rawMake.charAt(0).toUpperCase() + rawMake.slice(1).toLowerCase()
  let model = r.Model || ''
  let series = r.Series || r.Trim || ''
  // NHTSA's flat endpoint sometimes returns Make+Year but a BLANK Model.
  // Fall back to the verbose decoder, which resolves Model/Series more reliably.
  if (!model) {
    try {
      const res2 = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin.toUpperCase()}?format=json`)
      if (res2.ok) {
        const d2 = await res2.json()
        const byVar = {}
        for (const row of (d2.Results || [])) {
          if (row.Value != null && row.Value !== '') byVar[row.Variable] = row.Value
        }
        model = model || byVar['Model'] || ''
        series = series || byVar['Series'] || byVar['Trim'] || byVar['Series2'] || ''
      }
    } catch { /* fallback best-effort; leave model blank if it also fails */ }
  }
  return {
    year:         r.ModelYear || '',
    make:         make,
    model:        model,
    series:       series,
    bodyType:     r.BodyClass || '',
    engine:       engineParts.join(' '),
    transmission: r.TransmissionStyle || '',
    drivetrain:   r.DriveType || '',
    extColour:    '',
    intColour:    '',
  }
}

async function generateDescription(v) {
  const res = await fetch(`${API_BASE}/api/claude`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:500,messages:[{role:'user',content:`Write a compelling used car listing description for a Canadian dealership. Honest, specific, no emojis. 3-4 sentences max 280 chars.\nVehicle: ${[v.year,v.make,v.model,v.series,v.engine,v.drivetrain,v.extColour&&`Exterior: ${v.extColour}`,v.odometer&&`${fmtN(v.odometer)} km`].filter(Boolean).join(', ')}\nFeatures: ${v.features?.join(', ')||''}\nNotes: ${v.notes||'Clean off-lease return'}\nReturn ONLY the description text.`}]})});
  const data=await res.json();
  return data.content?.[0]?.text?.trim()||'';
}

// Real market data via VinAudit (Canadian comps). Needs vin + dealer postal.
async function fetchMarketData(vin, postal, radius = 250) {
  if (!vin || vin.length !== 17) throw new Error('Valid VIN required');
  if (!postal) throw new Error('Dealer postal code required (set it in Settings)');
  const url = `${API_BASE}/api/market/${vin}?postal=${encodeURIComponent(postal)}&radius=${radius}`;
  // Fetch with one retry — Railway can cold-start, dropping the first request.
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { res = await fetch(url); break; }
    catch (netErr) {
      if (attempt === 1) throw new Error('Could not reach the market server — check your connection and try again.');
      await new Promise(r => setTimeout(r, 1500)); // brief pause, then retry once
    }
  }
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Market lookup failed');
  return data; // {found, marketLow/Mid/High, comps:[...], meta:{...}} or {found:false}
}

// Re-derive market stats from ALREADY-FETCHED comps, applying local filters.
// This is how criteria changes (radius / odometer band) update the numbers
// WITHOUT spending another VinAudit lookup — you fetch once per VIN, then slice
// the cached comp set locally. Active listings only drive pricing; sold/dropped
// comps are summarized separately (never blended into Low/Mid/High).
function recomputeFromComps(comps, opts = {}) {
  const { radiusKm = null, odoFrom = '', odoTo = '' } = opts;
  if (!Array.isArray(comps) || comps.length === 0) return null;
  const lo = odoFrom !== '' && odoFrom != null ? Number(odoFrom) : null;
  const hi = odoTo !== '' && odoTo != null ? Number(odoTo) : null;
  const inBand = c => {
    if (radiusKm != null && Number.isFinite(c.distance) && c.distance > radiusKm) return false;
    const km = Number(c.mileage);
    if (lo != null && Number.isFinite(km) && km < lo) return false;
    if (hi != null && Number.isFinite(km) && km > hi) return false;
    return true;
  };
  const filtered = comps.filter(inBand);
  const active = filtered.filter(c => c.status !== 'dropped');
  const sold = filtered.filter(c => c.status === 'dropped');
  const prices = active.map(c => Number(c.price)).filter(p => Number.isFinite(p) && p >= 1000).sort((a, b) => a - b);
  if (prices.length === 0) return { found: false, activeCount: active.length, soldCount: sold.length };
  const pct = (arr, p) => {
    if (arr.length === 1) return arr[0];
    const idx = (arr.length - 1) * p, l = Math.floor(idx), h = Math.ceil(idx);
    return l === h ? arr[l] : Math.round(arr[l] + (arr[h] - arr[l]) * (idx - l));
  };
  const avg = arr => arr.length ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length) : null;
  const miles = active.map(c => Number(c.mileage)).filter(Number.isFinite).sort((a, b) => a - b);
  const days = active.map(c => Number(c.days)).filter(Number.isFinite).sort((a, b) => a - b);
  const soldPrices = sold.map(c => Number(c.price)).filter(p => Number.isFinite(p) && p >= 1000);
  const soldDts = sold.map(c => Number(c.days)).filter(Number.isFinite);
  const soldOdo = sold.map(c => Number(c.mileage)).filter(Number.isFinite);
  // Local MDS: active ÷ recent sold × 45 (same definition as the backend).
  const mds = sold.length > 0 ? Math.round((active.length / sold.length) * 45) : null;
  return {
    found: true,
    marketLow: pct(prices, 0.10),
    marketMid: pct(prices, 0.50),
    marketHigh: pct(prices, 0.90),
    marketAvgPrice: avg(prices),
    activeComps: active.length,
    medianCompMileage: miles.length ? pct(miles, 0.50) : null,
    medianDaysListed: days.length ? pct(days, 0.50) : null,
    marketDaySupply: mds,
    soldStats: {
      count: sold.length,
      avgPrice: avg(soldPrices),
      medianPrice: soldPrices.length ? pct([...soldPrices].sort((a, b) => a - b), 0.50) : null,
      avgDts: avg(soldDts),
      avgOdo: avg(soldOdo),
    },
  };
}

// Mock Carfax — replace with real API when credentials available
async function fetchCarfax(vin) {
  await new Promise(r=>setTimeout(r,1200));
  const clean = Math.random()>0.3;
  return {
    vin, fetchedAt:new Date().toISOString(),
    accidents: clean?0:Math.floor(1+Math.random()*2),
    owners: Math.floor(1+Math.random()*3),
    lien: Math.random()>0.8,
    odometer_issues: false,
    total_loss: false,
    service_records: Math.floor(2+Math.random()*8),
    last_reported_odometer: Math.round(Number(vin.charCodeAt(5))*800+20000),
    clean,
    report_url: `https://www.carfax.ca/vehicle-history-report?vin=${vin}`,
  };
}

// Live competitive set — renders real VinAudit listings with clickable links.
function CompSet({ comps, myPrice, myKm, myDays }) {
  const [feeState, setFeeState] = useState({});
  const [sort, setSort] = useState({ key: 'price', dir: 'asc' });
  // Both comp sections collapsed by default so they don't fill the page.
  const [openSec, setOpenSec] = useState({ listed: false, sold: false });
  if (!comps || comps.length === 0) return null;
  const mp = Number(myPrice) || null;
  const sold = comps.filter(c => c.status === 'dropped');
  const active = comps.filter(c => c.status !== 'dropped');
  const myRank = mp ? active.filter(c => c.price < mp).length + 1 : null;
  const soldAgo = (s) => { if(!s) return null; const d=new Date(s); if(isNaN(d.getTime())) return null; return Math.max(0,Math.round((Date.now()-d.getTime())/86400000)); };
  // Sort helper. Keys: price, mileage, days, location. Nulls always sort last.
  const sortRows = (rows, mode) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (c) => {
      if (sort.key === 'price') return c.price;
      if (sort.key === 'mileage') return c.mileage;
      if (sort.key === 'days') return mode === 'sold' ? soldAgo(c.dropDate) : c.days;
      if (sort.key === 'location') return [c.city, c.region].filter(Boolean).join(', ').toLowerCase() || null;
      return null;
    };
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;   // nulls last regardless of dir
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  };
  const toggleSort = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'location' ? 'asc' : 'asc' });
  const checkFees = async (c) => {
    if(!c.url) return;
    setFeeState(s=>({...s,[c.id]:{status:'loading'}}));
    try{
      const r = await fetch(`${API_BASE}/api/fees`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:c.url,dealer:c.dealer,vin:c.vin,source:c.source})});
      const d = await r.json();
      if(d.readable===false){ setFeeState(s=>({...s,[c.id]:{status:'unreadable',reason:d.reason}})); return; }
      setFeeState(s=>({...s,[c.id]:{status:'done',fees:d.fees||[],feeTotal:d.feeTotal||0}}));
    }catch(e){ setFeeState(s=>({...s,[c.id]:{status:'error'}})); }
  };
  const cell = {padding:'7px 12px'};
  const feeCell = (c) => {
    const fs = feeState[c.id];
    if(!fs) return c.url?<button onClick={()=>checkFees(c)} style={{fontSize:10,fontWeight:600,color:C.navy,background:C.navyMuted,border:'none',borderRadius:6,padding:'3px 8px',cursor:'pointer',whiteSpace:'nowrap'}}>Check fees</button>:<span style={{fontSize:10,color:C.textLight}}>—</span>;
    if(fs.status==='loading') return <span style={{fontSize:10,color:C.textLight}}>checking…</span>;
    if(fs.status==='unreadable') return <span style={{fontSize:10,color:C.textLight,cursor:'help'}} title={fs.reason||'could not read listing'}>couldn't read</span>;
    if(fs.status==='error') return <button onClick={()=>checkFees(c)} style={{fontSize:10,color:C.red,background:'none',border:'none',cursor:'pointer'}}>retry</button>;
    if(fs.feeTotal>0) return <span style={{fontSize:10,fontWeight:700,color:C.orange,whiteSpace:'nowrap'}} title={fs.fees.map(f=>`${f.name} ${fmt(f.amount)}`).join(' + ')}>+{fmt(fs.feeTotal)} → {fmt((c.price||0)+fs.feeTotal)}</span>;
    return <span style={{fontSize:10,fontWeight:600,color:C.green,whiteSpace:'nowrap'}}>no added fees</span>;
  };
  const block = (heading, rows, mode, showMine, badge, secKey) => {
    const isOpen = !!openSec[secKey];
    return (
    <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:10}}>
      <div onClick={()=>setOpenSec(s=>({...s,[secKey]:!s[secKey]}))} style={{padding:'10px 14px',borderBottom:isOpen?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',cursor:'pointer',userSelect:'none'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <ChevronRight size={15} color={C.navy} style={{transform:isOpen?'rotate(90deg)':'none',transition:'transform 0.15s'}}/>
          <span style={{fontWeight:700,fontSize:13,color:C.navy}}>{heading} <span style={{color:C.textLight,fontWeight:500}}>({rows.length})</span></span>
        </div>
        {badge}
      </div>
      {isOpen&&<div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr style={{background:C.navyMuted}}>{[
            {label:'Price',key:'price'},
            {label:'KM',key:'mileage'},
            {label:mode==='sold'?'Sold (days ago)':'Days',key:'days'},
            {label:'Location',key:'location'},
            {label:'Dealer',key:null},
            {label:'Fees',key:null},
            {label:'',key:null},
          ].map((h,i)=>(
            <th key={i} onClick={h.key?()=>toggleSort(h.key):undefined} style={{padding:'7px 12px',textAlign:'left',fontSize:10,fontWeight:600,color:sort.key===h.key?C.navy:C.textLight,borderBottom:`1px solid ${C.border}`,whiteSpace:'nowrap',cursor:h.key?'pointer':'default',userSelect:'none'}}>
              {h.label}{h.key&&sort.key===h.key&&<span style={{marginLeft:3}}>{sort.dir==='asc'?'▲':'▼'}</span>}
            </th>
          ))}</tr></thead>
          <tbody>
            {showMine&&mp&&<tr style={{background:C.tealMuted}}>
              <td style={{...cell,fontFamily:'monospace',fontWeight:700,color:C.teal}}>{fmt(mp)}</td>
              <td style={{...cell,fontFamily:'monospace',color:C.teal}}>{myKm?fmtN(myKm):'—'}</td>
              <td style={{...cell,color:C.teal}}>{myDays?myDays:'—'}</td>
              <td style={{...cell,color:C.teal}}>—</td>
              <td style={{...cell,fontWeight:700,color:C.teal}} colSpan={3}>Your Vehicle</td>
            </tr>}
            {sortRows(rows,mode).map((c,i)=>{
              const ago=mode==='sold'?soldAgo(c.dropDate):null;
              return (
              <tr key={c.id||i} style={{borderTop:`1px solid ${C.border}`}}>
                <td style={{...cell,fontFamily:'monospace',fontWeight:600,color:C.textDark,whiteSpace:'nowrap'}}>{fmt(c.price)}{c.certified&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,color:C.green,background:C.greenBg,padding:'1px 5px',borderRadius:8}}>CPO</span>}</td>
                <td style={{...cell,fontFamily:'monospace',color:C.textMid,whiteSpace:'nowrap'}}>{c.mileage?fmtN(c.mileage):'—'}</td>
                {mode==='sold'
                  ? <td style={{...cell,whiteSpace:'nowrap',fontWeight:600,color:ago!=null&&ago<=14?C.green:C.textMid}}>{ago!=null?ago:'—'}</td>
                  : <td style={{...cell,whiteSpace:'nowrap',color:c.days>45?C.orange:C.textMid}}>{c.days?c.days:'—'}</td>}
                <td style={{...cell,color:C.textLight,whiteSpace:'nowrap'}}>{[c.city,c.region].filter(Boolean).join(', ')||'—'}</td>
                <td style={{...cell,color:C.textDark}}>
                  <div>{c.dealer}</div>
                  <div style={{marginTop:2,display:'flex',gap:5,alignItems:'center',flexWrap:'wrap'}}>
                    {c.source&&<span style={{fontSize:9,color:C.textLight,background:C.navyMuted,padding:'1px 6px',borderRadius:8,whiteSpace:'nowrap'}}>{c.source}</span>}{Array.isArray(c.portals)&&c.portals.map(p=><a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer" style={{display:'inline-block',fontSize:9,fontWeight:600,color:C.teal,background:C.tealMuted,padding:'1px 6px',borderRadius:8,whiteSpace:'nowrap',textDecoration:'none',marginRight:4,marginTop:2}}>{p.name}</a>)}
                    {c.feeWarning&&<span title={`Caught adding fees on ${c.feeWarning.count} prior check${c.feeWarning.count>1?'s':''}`} style={{fontSize:9,fontWeight:700,color:C.orange,background:C.orangeBg,padding:'1px 6px',borderRadius:8,whiteSpace:'nowrap'}}>⚠ adds fees ~{fmt(c.feeWarning.avgFee)}</span>}
                  </div>
                </td>
                <td style={{...cell,whiteSpace:'nowrap'}}>{feeCell(c)}</td>
                <td style={{...cell,whiteSpace:'nowrap'}}>{c.url?<a href={c.url} target="_blank" rel="noopener noreferrer" style={{display:'inline-flex',alignItems:'center',gap:3,color:C.navy,fontSize:11,fontWeight:600,textDecoration:'none'}}><ExternalLink size={12}/>View</a>:<span style={{fontSize:10,color:C.textLight}}>—</span>}</td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>}
    </div>
    );
  };
  return (
    <div>
      {sold.length>0&&block('Recently Sold · likely', sold, 'sold', false, <span style={{fontSize:10,color:C.textLight}} title="Listing dropped off the market — usually sold, not guaranteed">last 45 days</span>, 'sold')}
      {active.length>0&&block('Currently Listed', active, 'listed', true, myRank&&<span style={{fontSize:11,fontFamily:'monospace',color:C.teal,background:C.tealMuted,padding:'2px 10px',borderRadius:12}}>Your price ranks #{myRank} of {active.length+1}</span>, 'listed')}
    </div>
  );
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────
function Btn({children,onClick,variant='primary',size='md',disabled,full,style:sx={},className}) {
  const S={sm:{padding:'6px 14px',fontSize:12},md:{padding:'9px 20px',fontSize:13},lg:{padding:'12px 28px',fontSize:14}};
  const V={primary:{background:C.navy,color:'#fff',border:'none'},teal:{background:C.teal,color:'#fff',border:'none'},ghost:{background:'transparent',color:C.textMid,border:`1px solid ${C.borderStr}`},danger:{background:C.red,color:'#fff',border:'none'},success:{background:C.green,color:'#fff',border:'none'},outline:{background:'#fff',color:C.navy,border:`1.5px solid ${C.navy}`}};
  return <button className={className} onClick={onClick} disabled={disabled} style={{...S[size],...V[variant],borderRadius:6,fontWeight:600,cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.5:1,display:'inline-flex',alignItems:'center',gap:6,fontFamily:'inherit',transition:'all 0.15s',width:full?'100%':undefined,justifyContent:full?'center':undefined,...sx}}>{children}</button>;
}
function Input({value,onChange,placeholder,type='text',style:sx={}}) {
  return <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:'100%',padding:'8px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,color:C.textDark,fontFamily:'inherit',outline:'none',boxSizing:'border-box',...sx}} onFocus={e=>e.target.style.borderColor=C.navy} onBlur={e=>e.target.style.borderColor=C.borderStr}/>;
}
function Sel({value,onChange,options,placeholder}) {
  return <select value={value} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'8px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,color:value?C.textDark:C.textLight,fontFamily:'inherit',outline:'none',appearance:'none'}}><option value="">{placeholder||'Select...'}</option>{options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}</select>;
}
function Field({label,children,half,third}) {
  return <div style={{flex:third?'0 0 calc(33.3% - 8px)':half?'0 0 calc(50% - 6px)':'1 1 100%',minWidth:0}}><label style={{display:'block',fontSize:11,fontWeight:600,color:C.textMid,marginBottom:5}}>{label}</label>{children}</div>;
}
function Card({children,style:sx={}}) {
  return <div style={{background:C.card,borderRadius:8,border:`1px solid ${C.border}`,boxShadow:'0 1px 4px rgba(0,0,0,0.06)',...sx}}>{children}</div>;
}
function Sec({title,icon:Icon,children,open:def=true,badge,accent}) {
  const [o,setO]=useState(def);
  return (
    <Card style={{marginBottom:12,overflow:'hidden'}}>
      <button onClick={()=>setO(!o)} style={{width:'100%',padding:'12px 16px',background:accent?C.navy:'none',border:'none',display:'flex',alignItems:'center',gap:8,cursor:'pointer',borderBottom:o?`1px solid ${C.border}`:'none'}}>
        {Icon&&<Icon size={14} color={accent?'#fff':C.navy}/>}
        <span style={{fontWeight:700,fontSize:13,color:accent?'#fff':C.textDark,flex:1,textAlign:'left'}}>{title}</span>
        {badge&&<span style={{background:accent?'rgba(255,255,255,0.2)':C.navyMuted,color:accent?'#fff':C.navy,borderRadius:12,padding:'2px 10px',fontSize:11,fontWeight:600}}>{badge}</span>}
        {o?<ChevronUp size={13} color={accent?'rgba(255,255,255,0.6)':C.textLight}/>:<ChevronDown size={13} color={accent?'rgba(255,255,255,0.6)':C.textLight}/>}
      </button>
      {o&&<div style={{padding:'14px 16px'}}>{children}</div>}
    </Card>
  );
}
function ABadge({status}) { const s=AS[status]||AS.in_progress; return <span style={{display:'inline-flex',alignItems:'center',gap:4,background:s.bg,color:s.color,borderRadius:12,padding:'3px 10px',fontSize:11,fontWeight:600}}><s.Icon size={10}/>{s.label}</span>; }
function VBadge({status}) { const s=VS[status]||VS.pending; return <span style={{display:'inline-flex',alignItems:'center',gap:4,background:s.bg,color:s.color,borderRadius:12,padding:'3px 10px',fontSize:11,fontWeight:600}}><s.Icon size={10}/>{s.label}</span>; }
function Toast({message,type,onClose}) {
  useEffect(()=>{const t=setTimeout(onClose,3500);return()=>clearTimeout(t);},[onClose]);
  const c={success:C.green,error:C.red,info:C.navy,warning:C.orange};
  return <div style={{position:'fixed',bottom:24,right:24,background:C.navy,color:'#fff',borderRadius:8,padding:'12px 18px',display:'flex',alignItems:'center',gap:10,boxShadow:'0 8px 32px rgba(0,0,0,0.25)',zIndex:9999,maxWidth:340,borderLeft:`4px solid ${c[type]||C.teal}`}}><span style={{fontSize:13,flex:1}}>{message}</span><button onClick={onClose} style={{background:'none',border:'none',color:'rgba(255,255,255,0.5)',cursor:'pointer'}}><X size={14}/></button></div>;
}
function CarfaxBadge({carfax,onFetch,loading}) {
  if(loading) return <div style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 12px',background:C.navyMuted,borderRadius:6,fontSize:12}}><RefreshCw size={12} color={C.navy} style={{animation:'spin 1s linear infinite'}}/>Fetching Carfax...</div>;
  if(!carfax) return <button onClick={onFetch} style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 14px',background:C.navy,color:'#fff',border:'none',borderRadius:6,fontSize:12,fontWeight:600,cursor:'pointer'}}><FileSearch size={13}/>Pull Carfax Report</button>;
  return (
    <div style={{background:carfax.clean?C.greenBg:C.redBg,border:`1px solid ${carfax.clean?C.green:C.red}`,borderRadius:8,padding:'10px 14px'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
        <ShieldCheck size={16} color={carfax.clean?C.green:C.red}/>
        <span style={{fontWeight:700,fontSize:13,color:carfax.clean?C.green:C.red}}>{carfax.clean?'Clean History':'Issues Found'}</span>
        <span style={{marginLeft:'auto',fontSize:10,color:C.textLight,fontFamily:'monospace'}}>Fetched {new Date(carfax.fetchedAt).toLocaleDateString('en-CA')}</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
        {[{l:'Accidents',v:carfax.accidents,bad:carfax.accidents>0},{l:'Owners',v:carfax.owners,bad:false},{l:'Lien',v:carfax.lien?'Yes':'Clear',bad:carfax.lien},{l:'Odometer',v:carfax.odometer_issues?'Issues':'OK',bad:carfax.odometer_issues},{l:'Service Records',v:carfax.service_records,bad:false},{l:'Total Loss',v:carfax.total_loss?'Yes':'No',bad:carfax.total_loss}].map(s=>(
          <div key={s.l} style={{background:'rgba(255,255,255,0.5)',borderRadius:6,padding:'7px 10px'}}>
            <div style={{fontSize:10,color:C.textLight,marginBottom:2,fontWeight:600}}>{s.l}</div>
            <div style={{fontSize:14,fontWeight:700,color:s.bad?C.red:C.green,fontFamily:'monospace'}}>{s.v}</div>
          </div>
        ))}
      </div>
      {carfax.report_url&&<a href={carfax.report_url} target="_blank" rel="noreferrer" style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:10,fontSize:11,color:C.navy,fontWeight:600}}><ExternalLink size={11}/>View Full Report on Carfax.ca</a>}
      <div style={{fontSize:10,color:C.textLight,marginTop:6}}>⚠ Using mock data — add Carfax Canada API credentials in Settings to enable live reports</div>
    </div>
  );
}
function GaugeSmall({price,mid}) {
  const p=pct(price,mid);
  if(!p) return null;
  return <div style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:40,height:6,background:C.bgDark,borderRadius:3,overflow:'hidden'}}><div style={{width:`${Math.min(100,Math.max(0,(p-50)/90*100))}%`,height:'100%',background:gaugeColor(p),borderRadius:3,transition:'width 0.4s'}}/></div><span style={{fontSize:11,fontFamily:'monospace',fontWeight:700,color:gaugeColor(p)}}>{p}%</span></div>;
}

// ─── ACTION LOG TABLE (reusable) ──────────────────────────────────────
function ActionLog({entries}){
  const rows=[...(entries||[])].sort((a,b)=>new Date(b.ts)-new Date(a.ts));
  if(rows.length===0) return <div style={{padding:'24px',textAlign:'center',color:C.textLight,fontSize:13}}><Activity size={26} color={C.navyBorder} style={{marginBottom:8,display:'block',margin:'0 auto 8px'}}/>No activity recorded yet. Changes you make will appear here automatically.</div>;
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead><tr style={{background:C.navyMuted}}>{['Date/Time','Field','From','To','User'].map(h=><th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:600,color:C.textLight,borderBottom:`1px solid ${C.border}`,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((e,i)=>(
          <tr key={i} style={{borderBottom:`1px solid ${C.border}`}}>
            <td style={{padding:'8px 12px',fontFamily:'monospace',fontSize:11,color:C.textLight,whiteSpace:'nowrap'}}>{new Date(e.ts).toLocaleString('en-CA',{dateStyle:'short',timeStyle:'short'})}</td>
            <td style={{padding:'8px 12px',fontWeight:600,color:C.textDark,whiteSpace:'nowrap'}}>{e.field}</td>
            <td style={{padding:'8px 12px',color:C.textLight,fontFamily:'monospace'}}>{e.old||'—'}</td>
            <td style={{padding:'8px 12px',color:C.green,fontFamily:'monospace',fontWeight:600}}>{e.new}</td>
            <td style={{padding:'8px 12px',color:C.textMid,whiteSpace:'nowrap'}}>{e.user}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ─── SAVE STATUS PILL (reusable across top action bars) ───────────────
function SaveStatus({isDirty,savedAt,onSave}){
  return (
    <button onClick={onSave} style={{
      display:'flex',alignItems:'center',justifyContent:'center',gap:5,
      padding:'9px 14px',borderRadius:7,border:`1px solid ${isDirty?C.orange:C.green}`,
      background:isDirty?C.orangeBg:C.greenBg,color:isDirty?C.orange:C.green,
      fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',
    }}>
      {isDirty?<Save size={13}/>:<CheckCircle size={13}/>}
      {isDirty?'Save Now':savedAt?`Saved ${new Date(savedAt).toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit'})}`:'Saved'}
    </button>
  );
}

// ─── WINDOW STICKER GENERATOR ─────────────────────────────────────────
function StickerGenerator({vehicles,dealer,preselected,onBack}) {
  const [sel,setSel]=useState(preselected?[preselected]:[]);
  const [preview,setPreview]=useState(null);
  const printRef=useRef();

  function toggleVehicle(id) {
    setSel(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev.slice(-1),id]); // max 2 at once
  }

  function handlePrint() {
    const win=window.open('','_blank');
    win.document.write(`
      <html><head><title>Window Stickers — ${dealer.name}</title>
      <style>
        @page { size: letter; margin: 0.5in; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Arial', sans-serif; background: #fff; }
        .page { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4in; page-break-after: always; }
        .sticker { border: 1.5px solid #000; padding: 0.25in; min-height: 9in; display: flex; flex-direction: column; }
        .dealer-header { text-align: center; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1.5px solid #000; }
        .dealer-logo { max-height: 60px; max-width: 100%; object-fit: contain; margin-bottom: 6px; }
        .dealer-name { font-size: 18px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; }
        .vehicle-name { text-align: center; padding: 14px 0; border-bottom: 1px solid #000; }
        .vehicle-name h1 { font-size: 22px; font-weight: 900; line-height: 1.2; }
        .section { padding: 10px 0; border-bottom: 1px solid #ddd; }
        .section-title { font-size: 10px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; text-align: center; margin-bottom: 6px; }
        .section-value { font-size: 13px; text-align: center; color: #333; }
        .options { padding: 10px 0; flex: 1; }
        .options-title { font-size: 10px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; text-align: center; margin-bottom: 8px; }
        .options ul { list-style: disc; padding-left: 18px; }
        .options ul li { font-size: 11px; margin-bottom: 3px; color: #222; line-height: 1.4; }
        .qr-section { text-align: center; padding-top: 14px; margin-top: auto; border-top: 1px solid #ddd; }
        .qr-section img { width: 90px; height: 90px; }
        .qr-label { font-size: 9px; color: #666; margin-top: 4px; letter-spacing: 0.5px; }
        .stock { font-size: 10px; color: #999; text-align: center; margin-top: 4px; }
        @media print { body { print-color-adjust: exact; } }
      </style></head><body>
      <div class="page">
        ${sel.map(id=>{
          const v=vehicles.find(x=>x.id===id);
          if(!v) return '';
          const vehicleName=`${v.year} ${v.make}\n${v.model}${v.series?' '+v.series:''}`;
          const qrUrl=`https://chart.googleapis.com/chart?chs=90x90&cht=qr&chl=${encodeURIComponent(`https://${dealer.website}/inventory/${v.vin}?utm_source=qr&utm_medium=windshield`)}&choe=UTF-8`;
          return `
            <div class="sticker">
              <div class="dealer-header">
                ${dealer.logo?`<img src="${dealer.logo}" class="dealer-logo" alt="${dealer.name}"/>`:`<div class="dealer-name">${dealer.name}</div>`}
              </div>
              <div class="vehicle-name">
                <h1>${v.year} ${v.make}<br>${v.model}${v.series?' '+v.series:''}</h1>
              </div>
              <div class="section">
                <div class="section-title">Odometer</div>
                <div class="section-value">${fmtN(v.odometer)} km</div>
              </div>
              ${(v.extColour||v.intColour)?`<div class="section"><div class="section-title">Exterior / Interior Colour</div><div class="section-value">${[v.extColour,v.intColour].filter(Boolean).join(' / ')}</div></div>`:''}
              ${v.features&&v.features.length>0?`<div class="options"><div class="options-title">Options</div><ul>${v.features.map(f=>`<li>${f}</li>`).join('')}</ul></div>`:''}
              <div class="qr-section">
                <img src="${qrUrl}" alt="QR Code"/>
                <div class="qr-label">Scan to view full listing</div>
                <div class="stock">Stock # ${v.stockNumber} · VIN: ${v.vin}</div>
              </div>
            </div>
          `;
        }).join('')}
        ${sel.length===1?'<div class="sticker" style="border:1.5px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:13px;">Second sticker</div>':''}
      </div>
      </body></html>
    `);
    win.document.close();
    setTimeout(()=>win.print(),500);
  }

  const avail=vehicles.filter(v=>v.status!=='sold'&&v.status!=='wholesale');

  return (
    <div>
      <div style={{marginBottom:20,display:'flex',alignItems:'center',gap:12}}>
        {onBack&&<Btn onClick={onBack} variant="ghost" size="sm"><ChevronLeft size={13}/>Back</Btn>}
        <div>
          <h2 style={{fontSize:18,fontWeight:800,color:C.navy}}>Window Sticker</h2>
          <p style={{fontSize:13,color:C.textLight,marginTop:2}}>Select up to 2 vehicles — prints 2 per page</p>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 340px',gap:20}}>
        {/* Vehicle selection */}
        <div>
          <Card style={{overflow:'hidden'}}>
            <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.border}`,background:C.navyMuted,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontWeight:700,fontSize:13,color:C.navy}}>Select Vehicles</span>
              <span style={{fontSize:11,color:C.textLight}}>{sel.length}/2 selected</span>
            </div>
            {avail.map((v,i)=>{
              const selected=sel.includes(v.id);
              return (
                <div key={v.id} onClick={()=>toggleVehicle(v.id)} style={{padding:'12px 14px',borderBottom:i<avail.length-1?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:12,cursor:'pointer',background:selected?C.tealMuted:C.card,transition:'background 0.15s'}} onMouseEnter={e=>{if(!selected)e.currentTarget.style.background=C.navyMuted;}} onMouseLeave={e=>{if(!selected)e.currentTarget.style.background=C.card;}}>
                  <div style={{width:20,height:20,borderRadius:4,border:`2px solid ${selected?C.teal:C.borderStr}`,background:selected?C.teal:C.card,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.15s'}}>
                    {selected&&<CheckCircle size={12} color="#fff"/>}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:13,color:C.navy}}>{v.year} {v.make} {v.model} {v.series}</div>
                    <div style={{display:'flex',gap:10,marginTop:2}}><span style={{fontSize:11,fontFamily:'monospace',color:C.textLight}}>#{v.stockNumber}</span><span style={{fontSize:11,color:C.textLight}}>{fmtN(v.odometer)} km</span>{v.extColour&&<span style={{fontSize:11,color:C.textLight}}>{v.extColour}</span>}</div>
                  </div>
                  <VBadge status={v.status}/>
                  {v.features?.length>0&&<span style={{fontSize:11,background:C.navyMuted,color:C.navy,borderRadius:12,padding:'2px 8px'}}>{v.features.length} options</span>}
                </div>
              );
            })}
          </Card>
        </div>

        {/* Preview + Print */}
        <div>
          <Card style={{padding:16,marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,color:C.navy,marginBottom:12}}>Sticker Preview</div>
            {sel.length===0?(
              <div style={{textAlign:'center',padding:'24px 0',color:C.textLight}}>
                <Printer size={28} color={C.navyBorder} style={{marginBottom:8}}/>
                <div style={{fontSize:12}}>Select vehicles to preview</div>
              </div>
            ):(
              sel.map(id=>{
                const v=vehicles.find(x=>x.id===id);
                if(!v) return null;
                return (
                  <div key={id} style={{background:'#fff',border:`1.5px solid ${C.borderStr}`,borderRadius:6,padding:'12px',marginBottom:10,fontSize:11}}>
                    {dealer.logo?(
                      <div style={{textAlign:'center',marginBottom:8}}><img src={dealer.logo} style={{maxHeight:36,maxWidth:'100%',objectFit:'contain'}} alt={dealer.name}/></div>
                    ):(
                      <div style={{textAlign:'center',fontWeight:900,fontSize:13,letterSpacing:2,marginBottom:8,textTransform:'uppercase',borderBottom:'1.5px solid #000',paddingBottom:6}}>{dealer.name}</div>
                    )}
                    <div style={{textAlign:'center',borderBottom:'1px solid #ccc',paddingBottom:8,marginBottom:8}}>
                      <div style={{fontWeight:900,fontSize:14,lineHeight:1.3}}>{v.year} {v.make}<br/>{v.model}{v.series?' '+v.series:''}</div>
                    </div>
                    <div style={{textAlign:'center',fontSize:11,borderBottom:'1px solid #eee',paddingBottom:6,marginBottom:6}}><div style={{fontWeight:700,fontSize:9,letterSpacing:1.5,textTransform:'uppercase',marginBottom:2}}>Odometer</div>{fmtN(v.odometer)} km</div>
                    {(v.extColour||v.intColour)&&<div style={{textAlign:'center',fontSize:11,borderBottom:'1px solid #eee',paddingBottom:6,marginBottom:6}}><div style={{fontWeight:700,fontSize:9,letterSpacing:1.5,textTransform:'uppercase',marginBottom:2}}>Exterior / Interior</div>{[v.extColour,v.intColour].filter(Boolean).join(' / ')}</div>}
                    {v.features?.length>0&&<div style={{marginBottom:8}}><div style={{fontWeight:700,fontSize:9,letterSpacing:1.5,textTransform:'uppercase',textAlign:'center',marginBottom:5}}>Options</div>{v.features.slice(0,6).map((f,i)=><div key={i} style={{fontSize:10,color:'#333',marginBottom:2}}>• {f}</div>)}{v.features.length>6&&<div style={{fontSize:10,color:C.textLight}}>+{v.features.length-6} more...</div>}</div>}
                    <div style={{textAlign:'center',borderTop:'1px solid #eee',paddingTop:8}}><div style={{width:60,height:60,background:'#f0f0f0',borderRadius:4,margin:'0 auto 4px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:C.textLight}}>QR CODE</div><div style={{fontSize:9,color:C.textLight}}>#{v.stockNumber}</div></div>
                  </div>
                );
              })
            )}
          </Card>

          <Btn onClick={handlePrint} disabled={sel.length===0} full variant="primary" size="lg">
            <Printer size={15}/>Print {sel.length} Sticker{sel.length!==1?'s':''}
          </Btn>
          {sel.length===1&&<div style={{fontSize:11,color:C.textLight,textAlign:'center',marginTop:6}}>Select a 2nd vehicle to fill the page</div>}
        </div>
      </div>
    </div>
  );
}

// ─── DEALER SETTINGS ──────────────────────────────────────────────────
function DealerSettings({dealer,onSave,showToast}) {
  const [d,setD]=useState(dealer);
  const set=(f,v)=>setD(p=>({...p,[f]:v}));
  const logoRef=useRef();

  function handleLogo(e) {
    const file=e.target.files[0];
    if(!file) return;
    if(file.size>2*1024*1024){showToast('Logo must be under 2MB','error');return;}
    const r=new FileReader();
    r.onload=ev=>set('logo',ev.target.result);
    r.readAsDataURL(file);
    e.target.value='';
  }

  return (
    <div>
      <div style={{marginBottom:20}}><h2 style={{fontSize:18,fontWeight:800,color:C.navy}}>Dealer Settings</h2><p style={{fontSize:13,color:C.textLight,marginTop:2}}>Your logo and details appear on stickers, reports, and documents</p></div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,alignItems:'start'}}>
        {/* Logo Upload */}
        <Card style={{padding:20}}>
          <div style={{fontWeight:700,fontSize:14,color:C.navy,marginBottom:14,display:'flex',alignItems:'center',gap:8}}><Image size={15} color={C.navy}/>Dealership Logo</div>
          <div style={{background:C.navyMuted,border:`2px dashed ${C.navyBorder}`,borderRadius:8,padding:20,textAlign:'center',marginBottom:14,cursor:'pointer',minHeight:120,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}} onClick={()=>logoRef.current?.click()}>
            {d.logo?(
              <div>
                <img src={d.logo} style={{maxHeight:80,maxWidth:'100%',objectFit:'contain',marginBottom:8}} alt="Logo"/>
                <div style={{fontSize:11,color:C.textLight}}>Click to replace</div>
              </div>
            ):(
              <div>
                <Upload size={24} color={C.navyBorder} style={{marginBottom:8}}/>
                <div style={{fontSize:13,fontWeight:600,color:C.textMid,marginBottom:4}}>Upload your logo</div>
                <div style={{fontSize:11,color:C.textLight}}>PNG, JPG, SVG · max 2MB</div>
              </div>
            )}
          </div>
          <input ref={logoRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleLogo}/>
          {d.logo&&<Btn onClick={()=>set('logo',null)} variant="ghost" size="sm" full><X size={12}/>Remove Logo</Btn>}
          <div style={{marginTop:12,padding:'10px 12px',background:C.tealMuted,borderRadius:6,border:`1px solid ${C.teal}`}}>
            <div style={{fontSize:11,color:C.teal,fontWeight:600,marginBottom:2}}>Logo is used on:</div>
            <div style={{fontSize:11,color:C.textMid}}>• Window stickers<br/>• Appraisal reports<br/>• Consumer offer documents<br/>• Dashboard header</div>
          </div>
        </Card>

        {/* Dealer Info */}
        <Card style={{padding:20}}>
          <div style={{fontWeight:700,fontSize:14,color:C.navy,marginBottom:14,display:'flex',alignItems:'center',gap:8}}><Building2 size={15} color={C.navy}/>Dealership Information</div>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <Field label="Dealership Name"><Input value={d.name} onChange={v=>set('name',v)} placeholder="Your Dealership Name"/></Field>
            <Field label="Street Address"><Input value={d.address} onChange={v=>set('address',v)} placeholder="123 Main Street"/></Field>
            <div style={{display:'flex',gap:10}}>
              <Field label="City" half><Input value={d.city} onChange={v=>set('city',v)} placeholder="Toronto"/></Field>
              <Field label="Province" half><Sel value={d.province} onChange={v=>set('province',v)} options={['ON','QC','BC','AB','MB','SK','NS','NB','NL','PE','NT','YT','NU']}/></Field>
            </div>
            <div style={{display:'flex',gap:10}}>
              <Field label="Postal Code" half><Input value={d.postal} onChange={v=>set('postal',v)} placeholder="M5V 3K4"/></Field>
              <Field label="Phone" half><Input value={d.phone} onChange={v=>set('phone',v)} placeholder="416-555-0100"/></Field>
            </div>
            <Field label="Website"><Input value={d.website} onChange={v=>set('website',v)} placeholder="www.yourdealership.ca"/></Field>
            <Field label="Email"><Input value={d.email} onChange={v=>set('email',v)} placeholder="info@yourdealership.ca" type="email"/></Field>
          </div>
        </Card>

        {/* Staff / Users */}
        <Card style={{padding:20,gridColumn:'1/-1'}}>
          <div style={{fontWeight:700,fontSize:14,color:C.navy,marginBottom:4,display:'flex',alignItems:'center',gap:8}}><User size={15} color={C.navy}/>Staff</div>
          <p style={{fontSize:12,color:C.textLight,marginBottom:14}}>These names appear in the top-bar user picker and are recorded on every change in the action log.</p>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
            {(d.staff||[]).map((s,i)=>(
              <span key={i} style={{background:C.navyMuted,color:C.navy,borderRadius:20,padding:'5px 12px',fontSize:13,display:'inline-flex',alignItems:'center',gap:6}}>{s}<button onClick={()=>set('staff',(d.staff||[]).filter((_,j)=>j!==i))} style={{background:'none',border:'none',color:C.navy,cursor:'pointer',padding:0,display:'flex'}}><X size={11}/></button></span>
            ))}
            {(!d.staff||d.staff.length===0)&&<span style={{fontSize:12,color:C.textLight}}>No staff added yet — defaults to Manager / Sales / Appraiser.</span>}
          </div>
          <div style={{display:'flex',gap:8,maxWidth:360}}>
            <input id="staff-add" placeholder="Add staff name, press Enter" onKeyDown={e=>{if(e.key==='Enter'&&e.target.value.trim()){set('staff',[...(d.staff||[]),e.target.value.trim()]);e.target.value='';e.preventDefault();}}} style={{flex:1,padding:'8px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontFamily:'inherit',outline:'none'}}/>
            <Btn variant="ghost" size="sm" onClick={()=>{const el=document.getElementById('staff-add');if(el?.value.trim()){set('staff',[...(d.staff||[]),el.value.trim()]);el.value='';}}}><Plus size={13}/>Add</Btn>
          </div>
        </Card>

        {/* API Settings */}
        <Card style={{padding:20,gridColumn:'1/-1'}}>
          <div style={{fontWeight:700,fontSize:14,color:C.navy,marginBottom:14,display:'flex',alignItems:'center',gap:8}}><Zap size={15} color={C.navy}/>API Integrations</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
            {[
              {name:'VinAudit Market Data',desc:'Pricing intelligence and market listings',status:'pending',key:'vinaudit_key'},
              {name:'Carfax Canada',desc:'Vehicle history reports by VIN',status:'pending',key:'carfax_key'},
              {name:'AutoTrader.ca Feed',desc:'Inventory feed distribution',status:'pending',key:'autotrader_key'},
            ].map(api=>(
              <div key={api.key} style={{background:C.navyMuted,borderRadius:7,padding:'12px 14px',border:`1px solid ${C.navyBorder}`}}>
                <div style={{fontWeight:700,fontSize:12,color:C.navy,marginBottom:3}}>{api.name}</div>
                <div style={{fontSize:11,color:C.textLight,marginBottom:10}}>{api.desc}</div>
                <input placeholder="Paste API key..." style={{width:'100%',padding:'6px 10px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:5,fontSize:11,fontFamily:'monospace',outline:'none',boxSizing:'border-box'}} value={d[api.key]||''} onChange={e=>set(api.key,e.target.value)}/>
                <div style={{marginTop:6,display:'flex',alignItems:'center',gap:5}}><div style={{width:6,height:6,borderRadius:'50%',background:d[api.key]?C.green:C.orange}}/><span style={{fontSize:10,color:d[api.key]?C.green:C.orange}}>{d[api.key]?'Key saved':'Not configured'}</span></div>
              </div>
            ))}
          </div>
          <div style={{marginTop:12,padding:'10px 14px',background:'rgba(192,86,33,0.06)',borderRadius:6,border:`1px solid ${C.orange}`,fontSize:11,color:C.textMid}}>
            <strong style={{color:C.orange}}>Carfax Canada:</strong> Contact your Carfax rep or visit dealer.carfax.ca to apply for API access. Once approved, paste your key above to enable live reports.
          </div>
        </Card>

        {/* Inventory Sync */}
        <Card style={{padding:20,gridColumn:'1/-1'}}>
          <div style={{fontWeight:700,fontSize:14,color:C.navy,marginBottom:4,display:'flex',alignItems:'center',gap:8}}><RefreshCw size={15} color={C.navy}/>Inventory Sync via Email</div>
          <p style={{fontSize:12,color:C.textLight,marginBottom:14}}>No DMS API needed. Set up a scheduled inventory export in your DMS (CDK, Oneighty, Dealertrack, PBS) to email a CSV to your unique Vantage sync address. Inventory updates automatically.</p>
          <div style={{background:C.navyMuted,borderRadius:7,padding:'12px 14px',border:`1px solid ${C.navyBorder}`,display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
            <Mail size={16} color={C.navy}/>
            <div>
              <div style={{fontSize:11,color:C.textLight,marginBottom:2}}>Your Vantage sync email address</div>
              <div style={{fontSize:13,fontFamily:'monospace',fontWeight:700,color:C.navy}}>sync-{d.name?.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')||'your-dealer'}@sync.vantagedealer.ca</div>
            </div>
            <button onClick={()=>{navigator.clipboard?.writeText(`sync-${d.name?.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')||'your-dealer'}@sync.vantagedealer.ca`);showToast('Email address copied','success');}} style={{marginLeft:'auto',padding:'6px 12px',background:C.navy,color:'#fff',border:'none',borderRadius:5,fontSize:11,fontWeight:600,cursor:'pointer'}}>Copy</button>
          </div>
          <div style={{fontSize:12,color:C.textMid}}><strong>Setup instructions:</strong> In your DMS, create a scheduled inventory report → set format to CSV → send to the address above → set schedule to daily at 6:00 AM. Vantage will process the file and sync your inventory automatically within minutes of receiving it.</div>
        </Card>
      </div>

      <div style={{marginTop:16,display:'flex',justifyContent:'flex-end'}}>
        <Btn onClick={()=>{onSave(d);showToast('Settings saved','success');}} variant="primary" size="lg"><Save size={14}/>Save Settings</Btn>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────
function Dashboard({vehicles,appraisals,dealer,onNav}) {
  const avail=vehicles.filter(v=>v.status==='available').length;
  const recon=vehicles.filter(v=>v.status==='in_recon').length;
  const aging=vehicles.filter(v=>daysAgo(v.createdAt)>=30&&v.status==='available').length;
  const inProg=appraisals.filter(a=>a.status==='in_progress').length;
  const tiles=[
    {label:'New Appraisal',    icon:ClipboardList, action:'new_appraisal', desc:'Start a trade-in or acquisition appraisal'},
    {label:'Add Vehicle',      icon:Car,           action:'new_vehicle',   desc:'Add a vehicle to inventory manually'},
    {label:'View Inventory',   icon:Package,       action:'inventory',     desc:'Browse and manage all stock'},
    {label:'Appraisal History',icon:FileText,      action:'appraisals',    desc:'View all past and active appraisals'},
  ];
  return (
    <div>
      {dealer.logo&&<div style={{marginBottom:16}}><img src={dealer.logo} style={{maxHeight:48,objectFit:'contain'}} alt={dealer.name}/></div>}
      <div style={{marginBottom:22}}><h1 style={{fontSize:22,fontWeight:800,color:C.navy,letterSpacing:-0.5}}>{dealer.name}</h1><p style={{fontSize:13,color:C.textLight}}>Vantage by ClickDocs · Dealer Command Centre</p></div>
      <div className='dash-stats' style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:28}}>
        {[{l:'Available',v:avail,c:C.green,Icon:CheckCircle},{l:'In Recon',v:recon,c:C.orange,Icon:AlertTriangle},{l:'Active Appraisals',v:inProg,c:C.navy,Icon:ClipboardList},{l:'Needs Attention',v:aging,c:aging>0?C.red:C.textLight,Icon:AlertCircle}].map(s=>(
          <Card key={s.l} style={{padding:'14px 16px',display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:38,height:38,borderRadius:8,background:C.navyMuted,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><s.Icon size={17} color={C.navy}/></div>
            <div><div style={{fontSize:11,color:C.textLight,fontWeight:500,marginBottom:2}}>{s.l}</div><div style={{fontSize:22,fontWeight:800,color:s.c,fontFamily:'monospace'}}>{s.v}</div></div>
          </Card>
        ))}
      </div>
      <div className='dash-tiles' style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:16,maxWidth:700,margin:'0 auto 28px'}}>
        {tiles.map(t=>(
          <button key={t.action} onClick={()=>onNav(t.action)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'32px 20px',display:'flex',flexDirection:'column',alignItems:'center',gap:12,cursor:'pointer',transition:'all 0.2s',boxShadow:'0 1px 4px rgba(0,0,0,0.06)',textAlign:'center'}} onMouseEnter={e=>{e.currentTarget.style.boxShadow='0 6px 24px rgba(28,45,94,0.12)';e.currentTarget.style.borderColor=C.navy;e.currentTarget.style.transform='translateY(-2px)';}} onMouseLeave={e=>{e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,0.06)';e.currentTarget.style.borderColor=C.border;e.currentTarget.style.transform='none';}}>
            <div style={{width:58,height:58,background:C.navyMuted,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center'}}><t.icon size={26} color={C.navy}/></div>
            <div><div style={{fontWeight:700,fontSize:14,color:C.navy,marginBottom:3}}>{t.label}</div><div style={{fontSize:12,color:C.textLight}}>{t.desc}</div></div>
          </button>
        ))}
      </div>
      {aging>0&&<div style={{background:C.redBg,border:`1px solid ${C.red}`,borderRadius:8,padding:'12px 16px',display:'flex',alignItems:'center',gap:10,marginBottom:16}}><AlertCircle size={15} color={C.red}/><div style={{fontSize:13,color:C.red,fontWeight:600}}>{aging} vehicle{aging!==1?'s':''} on lot 30+ days — price review needed</div><button onClick={()=>onNav('inventory')} style={{marginLeft:'auto',background:C.red,color:'#fff',border:'none',borderRadius:5,padding:'5px 12px',fontSize:12,fontWeight:600,cursor:'pointer'}}>Review</button></div>}
      {appraisals.length>0&&<div><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}><h3 style={{fontSize:14,fontWeight:700,color:C.navy}}>Recent Appraisals</h3><button onClick={()=>onNav('appraisals')} style={{fontSize:12,color:C.teal,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>View all →</button></div><Card style={{overflow:'hidden'}}>{appraisals.slice(0,4).map((a,i)=><div key={a.id} style={{padding:'10px 14px',borderBottom:i<Math.min(3,appraisals.length-1)?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:12}}><Car size={16} color={C.navy}/><div style={{flex:1}}><div style={{fontWeight:600,fontSize:13,color:C.textDark}}>{[a.year,a.make,a.model].filter(Boolean).join(' ')||'Untitled'}</div><div style={{fontSize:11,color:C.textLight}}>{new Date(a.createdAt).toLocaleDateString('en-CA')}</div></div><ABadge status={a.status}/>{a.appraisedValue&&<div style={{fontSize:13,fontWeight:700,color:C.navy,fontFamily:'monospace'}}>{fmt(a.appraisedValue)}</div>}</div>)}</Card></div>}
    </div>
  );
}

// ─── APPRAISAL FORM ───────────────────────────────────────────────────

// ── COPY VIN BUTTON ──────────────────────────────────────────────────
function CopyVIN({vin}){
  const [copied,setCopied]=useState(false)
  if(!vin||vin.length<10) return null
  function copy(){
    navigator.clipboard?.writeText(vin).then(()=>{
      setCopied(true)
      setTimeout(()=>setCopied(false),2000)
    }).catch(()=>{
      // fallback
      const el=document.createElement('input')
      el.value=vin
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(()=>setCopied(false),2000)
    })
  }
  return(
    <button onClick={copy} title="Copy VIN" style={{
      background:copied?C.greenBg:'rgba(28,45,94,0.06)',
      border:`1px solid ${copied?C.green:C.navyBorder}`,
      borderRadius:5,padding:'2px 8px',
      fontSize:10,fontWeight:600,
      color:copied?C.green:C.navy,
      cursor:'pointer',fontFamily:'monospace',
      display:'inline-flex',alignItems:'center',gap:4,
      transition:'all 0.2s',flexShrink:0,
    }}>
      {copied?'✓ Copied':'Copy'}
    </button>
  )
}

// ── CARFAX TAGS ──────────────────────────────────────────────────────
function CarfaxTags({carfax,odometer,marketAvgOdometer}){
  const tags=[]
  if(carfax){
    if(carfax.owners===1) tags.push({label:'1 Owner',ok:true,icon:'👤'})
    else if(carfax.owners>0) tags.push({label:`${carfax.owners} Owners`,ok:false,icon:'👥'})
    if(carfax.accidents===0) tags.push({label:'Accident Free',ok:true,icon:'✓'})
    else tags.push({label:`${carfax.accidents} Accident${carfax.accidents>1?'s':''}`,ok:false,icon:'⚠'})
    if(!carfax.lien) tags.push({label:'Lien Free',ok:true,icon:'✓'})
    else tags.push({label:'Lien on Title',ok:false,icon:'⚠'})
  }
  // Low KM based on market average
  const odo=Number(odometer)
  const avg=Number(marketAvgOdometer)
  if(odo>0&&avg>0){
    if(odo<avg*0.75) tags.push({label:'Low KM',ok:true,icon:'↓'})
  }
  if(tags.length===0) return null
  return(
    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
      {tags.map((t,i)=>(
        <span key={i} style={{
          display:'inline-flex',alignItems:'center',gap:4,
          background:t.ok?C.greenBg:C.redBg,
          color:t.ok?C.green:C.red,
          border:`1px solid ${t.ok?'rgba(26,122,74,0.2)':'rgba(197,48,48,0.2)'}`,
          borderRadius:20,padding:'3px 10px',
          fontSize:11,fontWeight:600,
        }}>
          <span style={{fontSize:10}}>{t.icon}</span>{t.label}
        </span>
      ))}
    </div>
  )
}

// ── SHARE VEHICLE ────────────────────────────────────────────────────
async function shareVehicle(v,dealer){
  const name=[v.year,v.make,v.model,v.series].filter(Boolean).join(' ')
  const specs=[
    v.odometer&&`${Number(v.odometer).toLocaleString('en-CA')} km`,
    v.extColour&&v.intColour?`${v.extColour} / ${v.intColour}`:v.extColour||v.intColour,
    v.engine,v.drivetrain,v.transmission,
  ].filter(Boolean)

  const carfaxLine = v.carfax ? [
    v.carfax.owners===1?'1 Owner':null,
    v.carfax.accidents===0?'Accident Free':null,
    !v.carfax.lien?'Lien Free':null,
  ].filter(Boolean).join(' · ') : ''

  const featureList = (v.features||[]).length>0
    ? '\nOptions:\n'+(v.features||[]).map(f=>`• ${f}`).join('\n')
    : ''

  const text = [
    `${name}`,
    specs.join(' | '),
    carfaxLine,
    featureList,
    '',
    `Stock #${v.stockNumber}`,
    `VIN: ${v.vin}`,
    dealer?.name?`\n${dealer.name}`:'',
    dealer?.phone||'',
  ].filter(s=>s!==null&&s!==undefined).join('\n').trim()

  // Try Web Share API with photos (iOS 15+ / Android Chrome)
  if(navigator.share){
    try{
      const shareData = {title:name, text}
      // Try to attach photos as files
      if(v.photos&&v.photos.length>0&&navigator.canShare){
        const files=[]
        for(const p of v.photos.slice(0,10)){
          try{
            const res=await fetch(p.dataUrl)
            const blob=await res.blob()
            const ext=blob.type.includes('png')?'png':'jpg'
            files.push(new File([blob],`${v.stockNumber}_${p.category||'photo'}.${ext}`,{type:blob.type}))
          }catch{}
        }
        if(files.length>0&&navigator.canShare({files})){
          shareData.files=files
        }
      }
      await navigator.share(shareData)
      return {success:true}
    }catch(e){
      if(e.name==='AbortError') return {success:false,reason:'cancelled'}
    }
  }
  // Fallback: copy to clipboard
  try{
    await navigator.clipboard.writeText(text)
    return {success:true,copied:true}
  }catch{
    return {success:false,reason:'clipboard'}
  }
}

// ─── PRINT / PDF HELPERS (browser print, matches sticker approach) ────
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function openPrintDoc(title, bodyHtml){
  const win=window.open('','_blank');
  if(!win){ alert('Please allow pop-ups to print/save this document.'); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    @page { size: letter; margin: 0.6in; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif; color:#1C2D5E; font-size:12px; line-height:1.5; }
    .pp-head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #1C2D5E; padding-bottom:14px; margin-bottom:18px; }
    .pp-logo { max-height:54px; max-width:220px; object-fit:contain; }
    .pp-dealer h1 { font-size:18px; font-weight:800; }
    .pp-dealer p { font-size:11px; color:#4A5568; }
    .pp-title { text-align:right; }
    .pp-title h2 { font-size:16px; font-weight:800; color:#00B4A6; text-transform:uppercase; letter-spacing:0.5px; }
    .pp-title p { font-size:10px; color:#8C95A0; }
    .pp-sec { margin-bottom:16px; }
    .pp-sec h3 { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.6px; color:#8C95A0; border-bottom:1px solid #E0E0E0; padding-bottom:4px; margin-bottom:8px; }
    .pp-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:6px 24px; }
    .pp-row { display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px dotted #E0E0E0; }
    .pp-row .k { color:#4A5568; } .pp-row .v { font-weight:700; font-family:'SFMono-Regular',Consolas,monospace; }
    .pp-offer { background:#1C2D5E; color:#fff; border-radius:10px; padding:18px 22px; display:flex; justify-content:space-between; align-items:center; margin:8px 0 4px; }
    .pp-offer .lbl { font-size:11px; text-transform:uppercase; letter-spacing:1px; opacity:0.7; }
    .pp-offer .amt { font-size:34px; font-weight:900; font-family:monospace; letter-spacing:-1px; }
    table { width:100%; border-collapse:collapse; font-size:11px; }
    th { text-align:left; background:#F3F4F6; padding:6px 8px; font-size:10px; text-transform:uppercase; letter-spacing:0.4px; color:#4A5568; border-bottom:2px solid #E0E0E0; }
    td { padding:6px 8px; border-bottom:1px solid #EEE; }
    .num { font-family:monospace; text-align:right; }
    .pp-foot { margin-top:24px; padding-top:12px; border-top:1px solid #E0E0E0; font-size:9px; color:#8C95A0; }
    .pill { display:inline-block; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700; }
    .good { background:rgba(26,122,74,0.12); color:#1A7A4A; } .bad { background:rgba(197,48,48,0.12); color:#C53030; }
    @media print { .no-print { display:none !important; } body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
    .pp-btn { background:#1C2D5E; color:#fff; border:none; border-radius:6px; padding:10px 20px; font-size:13px; font-weight:700; cursor:pointer; }
    .pp-toolbar { position:sticky; top:0; background:#fff; padding:10px 0 16px; display:flex; gap:8px; justify-content:flex-end; }
  </style></head><body>
  <div class="no-print pp-toolbar"><button class="pp-btn" onclick="window.print()">Print / Save as PDF</button></div>
  ${bodyHtml}
  </body></html>`);
  win.document.close();
}

function dealerHeader(dealer, docTitle, docSub){
  const logo=dealer.logo?`<img class="pp-logo" src="${dealer.logo}" alt=""/>`
    :`<div class="pp-dealer"><h1>${esc(dealer.name||'Dealership')}</h1></div>`;
  const contact=[dealer.address,[dealer.city,dealer.province,dealer.postal].filter(Boolean).join(' '),dealer.phone,dealer.website].filter(Boolean).map(esc).join(' &middot; ');
  return `<div class="pp-head">
    <div>${logo}${dealer.logo?`<p style="font-size:11px;color:#4A5568;margin-top:6px;">${contact}</p>`:`<p style="font-size:11px;color:#4A5568;margin-top:2px;">${contact}</p>`}</div>
    <div class="pp-title"><h2>${esc(docTitle)}</h2><p>${esc(docSub)}</p></div>
  </div>`;
}

function consumerOfferPrint(a, dealer){
  const veh=[a.year,a.make,a.model,a.series].filter(Boolean).join(' ')||'Vehicle';
  const cust=[a.firstName,a.lastName].filter(Boolean).join(' ');
  const today=new Date().toLocaleDateString('en-CA',{dateStyle:'long'});
  const expiry=new Date(Date.now()+7*86400000).toLocaleDateString('en-CA',{dateStyle:'long'});
  const row=(k,v)=>v?`<div class="pp-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`:'';
  const cfx=a.carfax?`<div class="pp-sec"><h3>Vehicle History (Carfax Canada)</h3><div class="pp-grid">
      ${row('Reported Accidents', a.carfax.accidents)}
      ${row('Previous Owners', a.carfax.owners)}
      ${row('Service Records', a.carfax.service_records)}
      <div class="pp-row"><span class="k">Status</span><span class="pill ${a.carfax.clean?'good':'bad'}">${a.carfax.clean?'Clean History':'Issues Reported'}</span></div>
    </div></div>`:'';
  const body=`
    ${dealerHeader(dealer,'Cash Offer','Vehicle Purchase Offer')}
    <div class="pp-sec"><h3>Prepared For</h3><div class="pp-grid">
      ${row('Customer', cust||'—')}
      ${row('Date', today)}
      ${row('Phone', a.phone)}
      ${row('Offer Valid Until', expiry)}
    </div></div>
    <div class="pp-sec"><h3>Vehicle</h3><div class="pp-grid">
      ${row('Vehicle', veh)}
      ${row('VIN', a.vin)}
      ${row('Odometer', a.odometer?fmtN(a.odometer)+' km':'')}
      ${row('Exterior', a.extColour)}
      ${row('Engine', a.engine)}
      ${row('Drivetrain', a.drivetrain)}
    </div></div>
    ${cfx}
    <div class="pp-sec"><h3>Our Offer</h3>
      <div class="pp-offer"><span class="lbl">Cash Offer for Your Vehicle</span><span class="amt">${fmt(a.appraisedValue)}</span></div>
      ${a.lienPayoff?`<p style="font-size:11px;color:#4A5568;margin-top:8px;">Estimated lien payoff of ${fmt(a.lienPayoff)} to be verified with your lender. Net figures will be confirmed at time of sale.</p>`:''}
    </div>
    <div class="pp-foot">
      This is a good-faith purchase offer based on the information and vehicle condition described above and is valid until ${esc(expiry)}, subject to physical inspection and verification of title and lien details. This document is not a binding contract of purchase or sale. Mileage and condition affect final value. Prepared by ${esc(a.finalizedBy||a.appraiser||dealer.name||'')}.
    </div>`;
  openPrintDoc(`Cash Offer — ${veh}`, body);
}


// ── COMPACT VEHICLE SUMMARY CARD ─────────────────────────────────────
function VehicleSummary({data,onEdit}){
  const decoded = data.year||data.make||data.model||data.vin
  return(
    <div style={{background:C.navyMuted,borderRadius:8,border:`1px solid ${C.navyBorder}`,overflow:'hidden'}}>
      {decoded?(
        <div>
          {/* Main info row */}
          <div style={{padding:'12px 14px',display:'flex',alignItems:'flex-start',gap:12}}>
            <div style={{width:38,height:38,background:C.navy,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <Car size={18} color="#fff"/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:800,fontSize:15,color:C.navy,letterSpacing:-0.3,lineHeight:1.2}}>
                {[data.year,data.make,data.model,data.series].filter(Boolean).join(' ')}
              </div>
              <div style={{fontSize:12,color:C.textMid,marginTop:2}}>
                {[data.engine,data.drivetrain,data.transmission].filter(Boolean).join(' · ')}
              </div>
              {(data.extColour||data.intColour)&&(
                <div style={{fontSize:11,color:C.textLight,marginTop:2}}>
                  {[data.extColour,data.intColour].filter(Boolean).join(' / ')}
                </div>
              )}
            </div>
            <button onClick={onEdit} style={{background:'#fff',border:`1px solid ${C.navyBorder}`,borderRadius:6,padding:'5px 10px',fontSize:11,fontWeight:600,color:C.navy,cursor:'pointer',flexShrink:0,display:'flex',alignItems:'center',gap:4}}>
              <Edit3 size={10}/>Edit
            </button>
          </div>

          {/* Mileage — large and prominent */}
          {data.odometer&&(
            <div style={{padding:'8px 14px',borderTop:`1px solid ${C.navyBorder}`,display:'flex',alignItems:'center',justifyContent:'space-between',background:'rgba(28,45,94,0.04)'}}>
              <span style={{fontSize:11,fontWeight:600,color:C.textLight,textTransform:'uppercase',letterSpacing:1}}>Odometer</span>
              <span style={{fontSize:15,fontWeight:800,color:C.navy,fontFamily:'monospace',letterSpacing:-0.3}}>
                {Number(data.odometer).toLocaleString('en-CA')} <span style={{fontSize:11,fontWeight:500,color:C.textLight}}>km</span>
              </span>
            </div>
          )}

          {/* VIN shown once in the editable row above — no duplicate here */}

          {/* Carfax tags */}
          {(data.carfax||(data.odometer&&data.marketAvgOdometer))&&(
            <div style={{padding:'8px 14px',borderTop:`1px solid ${C.navyBorder}`}}>
              <CarfaxTags carfax={data.carfax} odometer={data.odometer} marketAvgOdometer={data.marketAvgOdometer}/>
            </div>
          )}

          {/* Photos strip — inline */}
          {data.photos&&data.photos.length>0&&(
            <div style={{borderTop:`1px solid ${C.navyBorder}`,padding:'10px 14px'}}>
              <div style={{fontSize:10,fontWeight:600,color:C.textLight,textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>
                Photos ({data.photos.length})
              </div>
              <div style={{display:'flex',gap:8,overflowX:'auto',paddingBottom:4}}>
                {data.photos.map((p,i)=>(
                  <img key={p.id||i} src={p.dataUrl} alt={p.category||'photo'}
                    style={{width:72,height:54,objectFit:'cover',borderRadius:5,flexShrink:0,border:`1px solid ${C.navyBorder}`,cursor:'pointer'}}
                    onClick={()=>{
                      const w=window.open('','_blank')
                      w.document.write(`<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${p.dataUrl}" style="max-width:100%;max-height:100vh;object-fit:contain"/></body></html>`)
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ):(
        <div style={{padding:'14px',color:C.textLight,fontSize:13,textAlign:'center'}}>
          Enter VIN and tap Decode to populate vehicle details
        </div>
      )}
    </div>
  )
}

function AppraisalForm({initial,onSave,onBack,showToast,onConvert,onFinalize,onUnlock,user='Staff',onGetDealer}) {
  const [a,setA]=useState(initial);
  const [vl,setVl]=useState(false);
  const [ml,setMl]=useState(false);
  const [cl,setCl]=useState(false);
  const locked=!!a.finalizedAt;
  const [vehExpanded,setVehExpanded]=useState(!initial?.year);
  const [showVINScanner,setShowVINScanner]=useState(false);
  const [savedAt,setSavedAt]=useState(initial?.updatedAt||null);
  const [isDirty,setIsDirty]=useState(false);
  const autoSaveRef=useRef(null);
  const aRef=useRef(a);

  const set=(f,v)=>{ if(locked){showToast('Appraisal is finalized — unlock to edit','warning');return;} setA(p=>{const next={...p,[f]:v,updatedAt:new Date().toISOString()};aRef.current=next;setIsDirty(true);return next;}); };
  const pg=pct(a.appraisedValue,a.marketMid);
  const projGross=a.appraisedValue&&a.marketMid?Math.round(Number(a.marketMid)-Number(a.appraisedValue)-Number(a.reconCost||0)):null;

  // Auto-save when VIN + odometer present
  useEffect(()=>{
    if(locked) return;
    if(!a.vin||a.vin.length<10||!a.odometer) return;
    if(!isDirty) return;
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current=setTimeout(()=>{
      onSave(aRef.current, true); // silent=true, no navigation
      setSavedAt(new Date().toISOString());
      setIsDirty(false);
    },2000); // save 2s after last change
    return()=>clearTimeout(autoSaveRef.current);
  },[a,isDirty]);

  function forceSave(){
    onSave(aRef.current, true); // silent
    setSavedAt(new Date().toISOString());
    setIsDirty(false);
    showToast('Saved','success');
  }

  async function decode(){if(a.vin.length!==17){showToast('Enter a valid 17-character VIN','error');return;}setVl(true);try{const d=await decodeVIN(a.vin.toUpperCase());setA(p=>{const next={...p,...d,updatedAt:new Date().toISOString()};aRef.current=next;return next;});setIsDirty(true);showToast(`Decoded: ${d.year} ${d.make} ${d.model}`,'success');}catch{showToast('Could not decode — enter manually','error');}finally{setVl(false);}}
  async function fetchMkt(){
    if(a.vin.length!==17){showToast('Decode VIN first','error');return;}
    const dealer=onGetDealer?onGetDealer():null;
    const postal=dealer?.postal;
    if(!postal){showToast('Set your dealer postal code in Settings first','error');return;}
    setMl(true);
    try{
      const m=await fetchMarketData(a.vin,postal);
      if(!m.found){showToast(m.message||'No Canadian comps found for this vehicle','warning');setMl(false);return;}
      const note=`${m.meta.comps} comps · ${m.meta.matchMode==='trim'?'trim match':'model match'}${m.meta.widened?' (widened)':''}`;
      setA(p=>{const next=withLog({...p,marketLow:m.marketLow,marketMid:m.marketMid,marketHigh:m.marketHigh,marketAvgPrice:m.marketAvgPrice,activeComps:m.activeComps,marketDaysSupply:m.marketDaysSupply,marketDaySupply:m.marketDaySupply,medianDaysListed:m.medianDaysListed,_soldStats:m.soldStats,marketDataFetched:m.marketDataFetched,_marketMeta:m.meta,_medianCompMileage:m.medianCompMileage,_comps:m.comps,updatedAt:new Date().toISOString()},[logEvent('Market Data',`mid ${fmt(m.marketMid)} · ${note}`,user)]);aRef.current=next;return next;});
      setIsDirty(true);
      showToast(`Market: ${note}`,'success');
    }catch(e){showToast(e.message||'Market data unavailable','error');}
    finally{setMl(false);}
  }
  // Auto-fetch ONCE when the VIN first becomes valid and we have no cached comps.
  // After this, criteria changes recompute locally (no further VinAudit calls).
  const autoFetchedRef=useRef(false);
  useEffect(()=>{
    if(locked) return;
    if(a.vin?.length!==17){ autoFetchedRef.current=false; return; }
    if(a._comps || a.marketMid) return;
    if(autoFetchedRef.current) return;
    const dealer=onGetDealer?onGetDealer():null;
    if(!dealer?.postal) return;
    autoFetchedRef.current=true;
    fetchMkt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[a.vin]);
  // Recompute market numbers from CACHED comps when criteria change — no API call.
  function recompute(partial){
    const next={...aRef.current,...partial};
    const comps=next._comps;
    if(!comps||comps.length===0){ setA(p=>{const n={...p,...partial,updatedAt:new Date().toISOString()};aRef.current=n;setIsDirty(true);return n;}); return; }
    const r=recomputeFromComps(comps,{radiusKm:next._radius?Number(next._radius):null,odoFrom:next.odoFrom,odoTo:next.odoTo});
    setA(p=>{
      const n={...p,...partial,updatedAt:new Date().toISOString()};
      if(r&&r.found){n.marketLow=r.marketLow;n.marketMid=r.marketMid;n.marketHigh=r.marketHigh;n.marketAvgPrice=r.marketAvgPrice;n.activeComps=r.activeComps;n.marketDaySupply=r.marketDaySupply;n.medianDaysListed=r.medianDaysListed;n._medianCompMileage=r.medianCompMileage;n._soldStats=r.soldStats;}
      aRef.current=n;setIsDirty(true);return n;
    });
  }
  async function pullCarfax(){if(!a.vin||a.vin.length!==17){showToast('Valid VIN required','error');return;}setCl(true);try{const c=await fetchCarfax(a.vin);setA(p=>{const next=withLog({...p,carfax:c,updatedAt:new Date().toISOString()},[logEvent('Carfax Report',c.clean?'Clean':'Issues Found',user,'Not Pulled')]);aRef.current=next;return next;});setIsDirty(true);showToast('Carfax report retrieved','success');}catch{showToast('Carfax unavailable','error');}finally{setCl(false);}}
  function photo(e){if(locked){showToast('Appraisal is finalized — unlock to edit','warning');e.target.value='';return;}Array.from(e.target.files).forEach(f=>{const r=new FileReader();r.onload=ev=>setA(p=>{const next={...p,photos:[...p.photos,{id:Date.now().toString()+Math.random(),dataUrl:ev.target.result,category:'Misc',name:f.name}]};aRef.current=next;return next;});r.readAsDataURL(f);});setIsDirty(true);e.target.value='';}
  function printConsumerOffer(){
    forceSave();
    const dealer=onGetDealer?onGetDealer():DEFAULT_DEALER;
    consumerOfferPrint(aRef.current, dealer);
  }
  function doFinalize(){
    forceSave();
    onFinalize&&onFinalize(aRef.current);
  }

  return (
    <div>
      {showVINScanner&&<VINScanner onVINDetected={v=>{set('vin',v);setVehExpanded(true);}} onClose={()=>setShowVINScanner(false)}/>}
      <Card style={{marginBottom:12,overflow:'hidden'}}>
        {/* Title row */}
        <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:12,borderBottom:`1px solid ${C.border}`}}>
          <button onClick={onBack} style={{background:'none',border:'none',cursor:'pointer',color:C.textLight,display:'flex',alignItems:'center',gap:4,fontSize:13,padding:'4px 0',flexShrink:0}}>
            <ChevronLeft size={16} color={C.navy}/>
          </button>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:16,fontWeight:800,color:C.navy,lineHeight:1.2}}>
              {[a.year,a.make,a.model,a.series].filter(Boolean).join(' ')||'New Appraisal'}
            </div>
            {a.vin&&<div style={{display:'flex',alignItems:'center',gap:6,marginTop:2}}>
              <span style={{fontSize:10,fontFamily:'monospace',color:C.textLight}}>{a.vin}</span>
              <CopyVIN vin={a.vin}/>
            </div>}
          </div>
          <div style={{display:'flex',gap:6,flexShrink:0,alignItems:'center'}}>
            {locked&&<span style={{display:'inline-flex',alignItems:'center',gap:4,background:C.purpleBg,color:C.purple,borderRadius:12,padding:'4px 10px',fontSize:11,fontWeight:700}}><ShieldCheck size={12}/>Finalized</span>}
            <select value={a.status} disabled={locked} onChange={e=>set('status',e.target.value)} style={{padding:'5px 8px',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:11,fontFamily:'inherit',color:C.textDark,background:locked?C.bgDark:'#fff',cursor:locked?'not-allowed':'pointer'}}>
              {Object.entries(AS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>
        {/* Top action bar — replaces floating save bar */}
        <div style={{padding:'10px 16px',display:'flex',gap:8,flexWrap:'wrap',background:'rgba(28,45,94,0.02)'}}>
          {locked?(
            <>
              <div style={{flex:'1 1 200px',display:'flex',alignItems:'center',gap:6,fontSize:12,color:C.textMid}}>
                <ShieldCheck size={14} color={C.purple}/>Finalized by {a.finalizedBy||'—'} on {new Date(a.finalizedAt).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'})}
              </div>
              {a.appraisedValue&&<button onClick={printConsumerOffer} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:5,padding:'9px 14px',borderRadius:7,border:`1px solid ${C.navyBorder}`,background:C.navyMuted,color:C.navy,fontSize:12,fontWeight:700,cursor:'pointer'}}><Printer size={13}/>Consumer Offer</button>}
              {a.status!=='purchased'&&a.vin&&a.year&&<button onClick={()=>onConvert(aRef.current)} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:5,padding:'9px 14px',borderRadius:7,border:'none',background:C.teal,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}><CheckCircle size={13}/>To Inventory</button>}
              <button onClick={()=>onUnlock&&onUnlock(aRef.current)} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:5,padding:'9px 14px',borderRadius:7,border:`1px solid ${C.orange}`,background:C.orangeBg,color:C.orange,fontSize:12,fontWeight:700,cursor:'pointer'}}><Edit3 size={13}/>Unlock</button>
            </>
          ):(
            <>
              <SaveStatus isDirty={isDirty} savedAt={savedAt} onSave={forceSave}/>
              {a.year&&a.make&&<button onClick={async()=>{
                const r=await shareVehicle(aRef.current,null)
                if(r.copied) showToast('Copied to clipboard','success')
                else if(r.success) showToast('Shared!','success')
              }} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:5,padding:'9px 14px',borderRadius:7,border:`1px solid ${C.navyBorder}`,background:C.navyMuted,color:C.navy,fontSize:12,fontWeight:700,cursor:'pointer'}}>
                <Share2 size={13}/>Share
              </button>}
              {a.appraisedValue&&<button onClick={printConsumerOffer} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:5,padding:'9px 14px',borderRadius:7,border:`1px solid ${C.navyBorder}`,background:'#fff',color:C.navy,fontSize:12,fontWeight:700,cursor:'pointer'}}>
                <Printer size={13}/>Consumer Offer
              </button>}
              <div style={{flex:1}}/>
              {a.vin&&a.year&&a.appraisedValue&&<button onClick={doFinalize} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:5,padding:'9px 14px',borderRadius:7,border:'none',background:C.navy,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                <ShieldCheck size={13}/>Finalize
              </button>}
              {a.status!=='purchased'&&a.vin&&a.year&&<button onClick={()=>onConvert(aRef.current)} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:5,padding:'9px 14px',borderRadius:7,border:'none',background:C.teal,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                <CheckCircle size={13}/>To Inventory
              </button>}
            </>
          )}
        </div>
      </Card>

      {/* Two-column layout: sticky Vehicle panel on the left, everything else right */}
      <div className="two-col" style={{display:'grid',gridTemplateColumns:'minmax(300px, 360px) 1fr',gap:14,alignItems:'start'}}>
        {/* LEFT RAIL — sticks to viewport as the right column scrolls */}
        <div className="appraisal-left" style={{position:'sticky',top:14,alignSelf:'start',maxHeight:'calc(100vh - 28px)',overflowY:'auto',overflowX:'hidden',paddingBottom:8}}>
      <Sec title="Vehicle" icon={Car} accent>
        {/* VIN row */}
        <div style={{display:'flex',gap:8,marginBottom:10,alignItems:'center'}}>
          <div style={{flex:1}}>
            <Input value={a.vin} onChange={v=>set('vin',v.toUpperCase().replace(/[^A-Z0-9]/g,'').substring(0,17))} placeholder="17-character VIN" style={{fontFamily:'monospace',letterSpacing:1,fontSize:14}}/>
          </div>
          {a.vin&&a.vin.length>=10&&<CopyVIN vin={a.vin}/>}
          <Btn onClick={()=>setShowVINScanner(true)} variant="ghost" size="sm" className="cap-only"><ScanLine size={13}/>Scan</Btn>
          <Btn onClick={decode} disabled={vl||a.vin.length!==17} size="sm"><RefreshCw size={12} style={{animation:vl?'spin 1s linear infinite':undefined}}/>{vl?'...':'Decode'}</Btn>
        </div>
        {/* Summary or expand */}
        <VehicleSummary data={a} onEdit={()=>setVehExpanded(p=>!p)}/>
        {/* Expandable details */}
        {vehExpanded&&(
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.navyBorder}`}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:8}}>
              {[{f:'year',l:'Year',ph:''},{f:'make',l:'Make',ph:''},{f:'model',l:'Model',ph:''},{f:'series',l:'Trim',ph:''},{f:'bodyType',l:'Body',ph:''},{f:'engine',l:'Engine',ph:''},{f:'odometer',l:'Odometer (km)',ph:'',t:'number'},{f:'extColour',l:'Ext. Colour',ph:''},{f:'intColour',l:'Int. Colour',ph:''}].map(x=>(
                <div key={x.f} style={{minWidth:0}}>
                  <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>{x.l}</label>
                  <Input value={a[x.f]} onChange={v=>set(x.f,v)} placeholder={x.ph} type={x.t||'text'}/>
                </div>
              ))}
              <div style={{minWidth:0}}>
                <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Transmission</label>
                <Sel value={a.transmission} onChange={v=>set('transmission',v)} options={['Automatic','Manual','CVT','DCT']}/>
              </div>
              <div style={{minWidth:0}}>
                <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Drivetrain</label>
                <Sel value={a.drivetrain} onChange={v=>set('drivetrain',v)} options={['FWD','RWD','AWD','4WD','4x4']}/>
              </div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:8}}>
              <div style={{flex:1}}>
                <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Appraiser</label>
                <Input value={a.appraiser} onChange={v=>set('appraiser',v)} placeholder="Your name"/>
              </div>
              <div style={{flex:1}}>
                <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Source</label>
                <Sel value={a.source} onChange={v=>set('source',v)} options={['Trade-In','Walk-In','OpenLane','EBlock','OtoLane','Private','Other']}/>
              </div>
            </div>
          </div>
        )}
      </Sec>
      {/* Moved into floating panel: Photos, Notes, Offer & Pricing */}
      <Sec title="Photos" icon={Camera} badge={a.photos.length>0?`${a.photos.length}`:'None'}>
        <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
          <label className="cap-only" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',background:C.navy,color:'#fff',borderRadius:6,fontSize:13,fontWeight:600,cursor:'pointer'}}><Camera size={13}/>Take Photo<input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={photo} multiple/></label>
          <label style={{display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',background:'#fff',color:C.textMid,border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontWeight:600,cursor:'pointer'}}><Upload size={13}/>Upload<input type="file" accept="image/*" style={{display:'none'}} onChange={photo} multiple/></label>
        </div>
        {a.photos.length>0?<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))',gap:8}}>{(a.photos||[]).map(p=><div key={p.id} style={{position:'relative',borderRadius:7,overflow:'hidden',border:`1px solid ${C.border}`}}><img src={p.dataUrl} style={{width:'100%',height:80,objectFit:'cover',display:'block'}} alt=""/><div style={{padding:'3px 5px',background:'#fff'}}><select value={p.category} onChange={e=>setA(prev=>({...prev,photos:prev.photos.map(ph=>ph.id===p.id?{...ph,category:e.target.value}:ph)}))} style={{width:'100%',fontSize:10,border:'none',background:'none',fontFamily:'inherit'}}>{['Front','Rear','Driver Side','Pass. Side','Interior','Odometer','Engine','Damage','Misc'].map(c=><option key={c}>{c}</option>)}</select></div><button onClick={()=>setA(prev=>({...prev,photos:prev.photos.filter(ph=>ph.id!==p.id)}))} style={{position:'absolute',top:3,right:3,background:'rgba(0,0,0,0.6)',border:'none',borderRadius:'50%',width:20,height:20,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}><X size={10} color="white"/></button></div>)}</div>:<div style={{padding:'20px',background:C.navyMuted,borderRadius:7,textAlign:'center',border:`1.5px dashed ${C.navyBorder}`}}><div style={{fontSize:12,color:C.textLight}}>No photos yet</div></div>}
      </Sec>

      <Sec title="Notes" icon={FileText}>
        <textarea value={a.notes} onChange={e=>set('notes',e.target.value)} placeholder="Recon items, special options, condition observations..." rows={4} style={{width:'100%',padding:'10px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:7,fontSize:13,fontFamily:'inherit',resize:'vertical',outline:'none',boxSizing:'border-box',lineHeight:1.6,color:C.textDark}}/>
      </Sec>

      <Sec title="Offer & Pricing" icon={DollarSign} accent>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:12}}>
          <Field label="Recon Cost ($)"><Input value={a.reconCost} onChange={v=>set('reconCost',v)} type="number" placeholder="2,500"/></Field>
          <Field label="Cert / Transport ($)"><Input value={a.certCost||''} onChange={v=>set('certCost',v)} type="number" placeholder="0"/></Field>
          <Field label="Pack ($)"><Input value={a.pack||''} onChange={v=>set('pack',v)} type="number" placeholder="850"/></Field>
          <Field label="Your Offer / Appraised Value"><Input value={a.appraisedValue} onChange={v=>set('appraisedValue',v)} type="number" placeholder="Enter your offer" style={{fontSize:15,fontWeight:700}}/></Field>
        </div>
        {a.appraisedValue&&a.marketMid&&(()=>{
          const totalCost=Number(a.appraisedValue)+Number(a.reconCost||0)+Number(a.certCost||0)+Number(a.pack||0);
          const adjPct=Math.round((totalCost/Number(a.marketMid))*100);
          const grade=calcGrade(a.marketDaysSupply);
          const action=calcAction(a.marketDaysSupply, 72); // 72 = mock fleet avg MDS
          const askingPrice=a.marketMid?Math.round(Number(a.marketMid)*0.98):null;
          return(
            <div>
              {/* Summary cards */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:10}}>
                {[
                  {l:'Your Offer',v:fmt(a.appraisedValue)},
                  {l:'All-In Cost',v:fmt(totalCost)},
                  {l:'Proj. Gross',v:projGross!==null?fmt(projGross):'—'},
                ].map(s=>(
                  <div key={s.l} style={{background:'rgba(255,255,255,0.12)',borderRadius:7,padding:'8px 10px',border:'1px solid rgba(255,255,255,0.2)'}}>
                    <div style={{fontSize:9,color:'rgba(255,255,255,0.6)',marginBottom:2,fontWeight:600}}>{s.l}</div>
                    <div style={{fontSize:13,fontWeight:800,color:'#fff',fontFamily:'monospace'}}>{s.v}</div>
                  </div>
                ))}
              </div>
              {/* Market position row */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                {/* Adj % Cost to Market */}
                <div style={{background:'rgba(255,255,255,0.1)',borderRadius:7,padding:'8px 10px',border:'1px solid rgba(255,255,255,0.15)'}}>
                  <div style={{fontSize:9,color:'rgba(255,255,255,0.5)',fontWeight:600,marginBottom:3,textTransform:'uppercase',letterSpacing:0.5}}>Cost / Market</div>
                  <div style={{fontSize:18,fontWeight:900,fontFamily:'monospace',color:adjPct<=92?'#68D391':adjPct<=100?'#fff':'#FC8181'}}>{adjPct}%</div>
                  <div style={{fontSize:9,color:'rgba(255,255,255,0.4)',marginTop:1}}>Target: 85-95%</div>
                </div>
                {/* Provisioning Grade */}
                {grade&&(
                  <div style={{background:'rgba(255,255,255,0.1)',borderRadius:7,padding:'8px 10px',border:'1px solid rgba(255,255,255,0.15)',textAlign:'center'}}>
                    <div style={{fontSize:9,color:'rgba(255,255,255,0.5)',fontWeight:600,marginBottom:3,textTransform:'uppercase',letterSpacing:0.5}}>Grade</div>
                    <div style={{fontSize:22,fontWeight:900,color:grade.grade==='A'?'#68D391':grade.grade==='B'?'#63B3ED':grade.grade==='C+'?'#F6AD55':'#FC8181'}}>{grade.grade}</div>
                  </div>
                )}
                {/* Action badge */}
                {action!==null&&(
                  <div style={{background:'rgba(255,255,255,0.1)',borderRadius:7,padding:'8px 10px',border:'1px solid rgba(255,255,255,0.15)',textAlign:'center'}}>
                    <div style={{fontSize:9,color:'rgba(255,255,255,0.5)',fontWeight:600,marginBottom:3,textTransform:'uppercase',letterSpacing:0.5}}>MDS Impact</div>
                    <div style={{fontSize:20,fontWeight:900,color:action>0?'#68D391':action<0?'#FC8181':'rgba(255,255,255,0.5)'}}>
                      {action>0?'+':''}{action}
                    </div>
                    <div style={{fontSize:9,color:'rgba(255,255,255,0.4)',marginTop:1}}>{action>0?'Improves lot':action<0?'Hurts lot':'Neutral'}</div>
                  </div>
                )}
                {/* Asking Price suggestion */}
                {askingPrice&&(
                  <div style={{background:'rgba(255,255,255,0.1)',borderRadius:7,padding:'8px 10px',border:'1px solid rgba(255,255,255,0.15)'}}>
                    <div style={{fontSize:9,color:'rgba(255,255,255,0.5)',fontWeight:600,marginBottom:3,textTransform:'uppercase',letterSpacing:0.5}}>Suggested Retail</div>
                    <div style={{fontSize:14,fontWeight:900,color:'#fff',fontFamily:'monospace'}}>{fmt(askingPrice)}</div>
                    <div style={{fontSize:9,color:'rgba(255,255,255,0.4)',marginTop:1}}>98% of market mid</div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {/* Lien Information */}
        <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid rgba(255,255,255,0.15)'}}>
          <div style={{fontSize:10,color:'rgba(255,255,255,0.5)',fontWeight:600,marginBottom:8,textTransform:'uppercase',letterSpacing:0.5}}>Lien Information</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <div style={{flex:1,minWidth:120}}>
              <label style={{display:'block',fontSize:10,fontWeight:600,color:'rgba(255,255,255,0.5)',marginBottom:4}}>Lien Holder</label>
              <input value={a.lienHolder||''} onChange={e=>set('lienHolder',e.target.value)} placeholder="Bank / Finance Co."
                style={{width:'100%',padding:'7px 10px',background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.2)',borderRadius:6,fontSize:12,color:'#fff',fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
            </div>
            <div style={{flex:1,minWidth:100}}>
              <label style={{display:'block',fontSize:10,fontWeight:600,color:'rgba(255,255,255,0.5)',marginBottom:4}}>Lien Payoff ($)</label>
              <input type="number" value={a.lienPayoff||''} onChange={e=>set('lienPayoff',e.target.value)} placeholder="0"
                style={{width:'100%',padding:'7px 10px',background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.2)',borderRadius:6,fontSize:12,color:'#fff',fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
            </div>
          </div>
        </div>
      </Sec>

        </div>{/* end LEFT RAIL */}

        {/* RIGHT COLUMN — all other sections scroll past the sticky vehicle panel */}
        <div style={{minWidth:0}}>

      <Sec title="Carfax Canada" icon={ShieldCheck} badge={a.carfax?(a.carfax.clean?'✓ Clean':'⚠ Issues Found'):'Not Pulled'}>
        <CarfaxBadge carfax={a.carfax} onFetch={pullCarfax} loading={cl}/>
      </Sec>

      <Sec title="Market Intelligence" icon={BarChart2} badge={a.marketMid?'Live Data':'No Data'}>
        {/* Competitive Criteria Controls */}
        <div style={{display:'flex',gap:10,marginBottom:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          <div style={{minWidth:0}}>
            <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Distance</label>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <select value={a.searchDistance||150} onChange={e=>recompute({searchDistance:e.target.value,_radius:e.target.value})}
                style={{padding:'7px 10px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:12,fontFamily:'inherit',outline:'none'}}>
                {DISTANCE_OPTS.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
              <span style={{fontSize:11,color:C.textLight}}>km</span>
            </div>
          </div>
          <div style={{minWidth:0}}>
            <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Odometer Range</label>
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              <input type="number" value={a.odoFrom||''} onChange={e=>recompute({odoFrom:e.target.value})} placeholder="From"
                style={{width:70,padding:'7px 8px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:11,fontFamily:'inherit',outline:'none'}}/>
              <span style={{fontSize:10,color:C.textLight}}>to</span>
              <input type="number" value={a.odoTo||''} onChange={e=>recompute({odoTo:e.target.value})} placeholder="To"
                style={{width:70,padding:'7px 8px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:11,fontFamily:'inherit',outline:'none'}}/>
              <span style={{fontSize:10,color:C.textLight}}>km</span>
            </div>
          </div>
          <div style={{minWidth:0}}>
            <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Market Mode</label>
            <div style={{display:'flex',gap:8,alignItems:'center',padding:'7px 0'}}>
              {['Recent','Active'].map(m=>(
                <label key={m} style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer',fontSize:12,color:C.textDark}}>
                  <input type="radio" name={`mmode_${a.id}`} checked={(a.marketMode||'Recent')===m} onChange={()=>set('marketMode',m)}
                    style={{accentColor:C.navy}}/>{m}
                </label>
              ))}
            </div>
          </div>
          <Btn onClick={fetchMkt} disabled={ml||a.vin.length!==17} size="sm">
            <RefreshCw size={11} style={{animation:ml?'spin 1s linear infinite':undefined}}/>{ml?'Fetching...':'Fetch'}
          </Btn>
        </div>
        {!a.marketMid?(
          <div style={{textAlign:'center',padding:'12px 0',background:C.navyMuted,borderRadius:7}}>
            <div style={{fontSize:12,color:C.textLight,marginBottom:8}}>Set criteria above and fetch market data</div>
            <Btn onClick={fetchMkt} disabled={ml||a.vin.length!==17}><TrendingUp size={13}/>{ml?'Fetching...':'Fetch Market Data'}</Btn>
          </div>
        ):(
          <div>
            {/* Market averages */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:10}}>
              {[{l:'Market Low',v:fmt(a.marketLow),c:C.green,t:'10th percentile of active comparable listing prices — the low end of the market'},{l:'Market Mid',v:fmt(a.marketMid),c:C.navy,t:'Median (50th percentile) of active comparable listing prices'},{l:'Market High',v:fmt(a.marketHigh),c:C.orange,t:'90th percentile of active comparable listing prices — the high end of the market'}].map(s=>(
                <div key={s.l} title={s.t} style={{background:C.navyMuted,borderRadius:7,padding:'10px 12px',textAlign:'center',cursor:'help'}}>
                  <div style={{fontSize:10,color:C.textLight,marginBottom:3,fontWeight:600,display:'inline-flex',alignItems:'center',gap:3}}>{s.l}<Info size={10} color={C.textLight} style={{opacity:0.6}}/></div>
                  <div style={{fontSize:16,fontWeight:800,color:s.c,fontFamily:'monospace'}}>{s.v}</div>
                </div>
              ))}
            </div>
            {/* Data quality banner — comp count, match mode, thin-data warning */}
            {a._marketMeta&&(()=>{
              const meta=a._marketMeta;
              const thin=meta.comps<5;
              const bg=thin?C.orangeBg:C.greenBg, fg=thin?C.orange:C.green;
              return (
                <div style={{display:'flex',alignItems:'center',gap:8,background:bg,border:`1px solid ${fg}`,borderRadius:7,padding:'8px 12px',marginBottom:10,fontSize:12}}>
                  {thin?<AlertTriangle size={14} color={fg}/>:<CheckCircle size={14} color={fg}/>}
                  <span style={{color:fg,fontWeight:700}}>{meta.comps} comparable{meta.comps===1?'':'s'}</span>
                  <span style={{color:C.textMid}}>· {meta.matchMode==='trim'?'matched on trim':'matched on model'}{meta.widened?' (widened from trim)':''} · {meta.radius} km · Canada</span>
                  {thin&&<span style={{color:fg,marginLeft:'auto',fontWeight:600}}>Thin data — treat as directional</span>}
                </div>
              );
            })()}
            {/* Key metrics */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,marginBottom:10}}>
              {[
                {l:'Active Comps',v:a._marketMeta?a._marketMeta.activeCount:a.activeComps,t:'Unique active comparable listings the price stats are built from'},
                {l:'Market Day Supply',v:(a.marketDaySupply!=null)?a.marketDaySupply:null,t:'Days for the local market to sell current active inventory at the recent sales rate (active ÷ sold × 45). Lower = sells faster.'},
                {l:'Median Days Listed',v:(a.medianDaysListed!=null?a.medianDaysListed:a.marketDaysSupply)??null,t:'Median days a current comparable listing has been on the market'},
                {l:'Median Comp KM',v:a._medianCompMileage?fmtN(a._medianCompMileage)+' km':null,t:'Median odometer across active comparable listings'},
              ].map(s=>(
                <div key={s.l} title={s.t} style={{background:C.navyMuted,borderRadius:7,padding:'8px 12px',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'help'}}>
                  <span style={{fontSize:11,color:C.textLight,fontWeight:600,display:'inline-flex',alignItems:'center',gap:4}}>{s.l}<Info size={11} color={C.textLight} style={{opacity:0.6}}/></span>
                  <span style={{fontSize:13,fontWeight:700,color:C.navy,fontFamily:'monospace'}}>{s.v||s.v===0?s.v:'—'}</span>
                </div>
              ))}
            </div>
            {/* Live Competitive Set — real VinAudit listings with links */}
            {a._comps&&a._comps.length>0&&<div style={{marginBottom:10}}><CompSet comps={a._comps} myPrice={a.appraisedValue} myKm={a.odometer}/></div>}
            {/* Odometer Adjustment */}
            {a.odometer&&a.marketAvgOdometer&&(()=>{
              const adj=odometerAdj(a.odometer,a.marketAvgOdometer);
              if(!adj) return null;
              return(
                <div style={{background:adj>0?C.greenBg:C.orangeBg,border:`1px solid ${adj>0?C.green:C.orange}`,borderRadius:7,padding:'8px 12px',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <span style={{fontSize:11,fontWeight:600,color:adj>0?C.green:C.orange}}>Odometer Adjustment vs Market Avg</span>
                  <span style={{fontSize:13,fontWeight:800,fontFamily:'monospace',color:adj>0?C.green:C.orange}}>{adj>0?'+':''}{fmt(adj)}</span>
                </div>
              );
            })()}
            {/* Recently Sold — REAL market data (dropped listings), kept separate
                from the active price stats above. Never feeds Low/Mid/High. */}
            {a._soldStats&&a._soldStats.count>0&&(()=>{
              const s=a._soldStats;
              return(
                <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',marginBottom:2}}>
                  <div style={{padding:'8px 12px',background:C.navyMuted,borderBottom:`1px solid ${C.border}`,fontSize:11,fontWeight:700,color:C.navy,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span>Recently Sold — Comparable Market</span>
                    <span style={{fontSize:10,color:C.textLight,fontWeight:500}}>excluded from pricing above</span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)'}}>
                    {[
                      {l:'Sold',v:s.count},
                      {l:'Avg Days to Sell',v:s.avgDts!=null?s.avgDts:'—'},
                      {l:'Avg Sold Price',v:s.avgPrice!=null?fmt(s.avgPrice):'—'},
                      {l:'Avg KM',v:s.avgOdo!=null?fmtN(s.avgOdo):'—'},
                    ].map((c,i)=>(
                      <div key={c.l} style={{padding:'10px 12px',borderRight:i<3?`1px solid ${C.border}`:'none',textAlign:'center'}}>
                        <div style={{fontSize:10,fontWeight:600,color:C.textLight,marginBottom:4}}>{c.l}</div>
                        <div style={{fontSize:13,fontWeight:800,color:C.navy,fontFamily:'monospace'}}>{c.v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{padding:'6px 12px',background:'rgba(0,0,0,0.02)',borderTop:`1px solid ${C.border}`,fontSize:10,color:C.textLight}}>
                    Based on comparable listings that dropped off the market (likely sold). Shown for context only.
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Sec>

      <Sec title="Vehicle Condition" icon={CheckCircle}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10,marginBottom:10}}>
          {[{f:'tires',l:'Tires',o:['Good','Fair','Needs Replacement']},{f:'paint',l:'Paint / Body',o:['Clean','Minor Scratches','Needs Work','Repainted']},{f:'interior',l:'Interior',o:['Clean','Fair','Poor']},{f:'mechanical',l:'Mechanical',o:['Good','Minor Issues','Major Issues']}].map(x=><Field key={x.f} label={x.l}><Sel value={a[x.f]} onChange={v=>set(x.f,v)} options={x.o}/></Field>)}
        </div>
        <div onClick={()=>set('accidentVisible',!a.accidentVisible)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:a.accidentVisible?C.redBg:C.navyMuted,borderRadius:7,border:`1px solid ${a.accidentVisible?C.red:C.navyBorder}`,cursor:'pointer'}}>
          <input type="checkbox" checked={a.accidentVisible} readOnly style={{width:15,height:15,accentColor:C.red}}/>
          <span style={{fontSize:13,fontWeight:600,color:a.accidentVisible?C.red:C.textDark}}>Accident / Damage Visible</span>
          {a.accidentVisible&&<AlertTriangle size={15} color={C.red} style={{marginLeft:'auto'}}/>}
        </div>
      </Sec>

      <Sec title="Customer Information" icon={User} open={false}>
        <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
          <Field label="First Name" half><Input value={a.firstName} onChange={v=>set('firstName',v)} placeholder="John"/></Field>
          <Field label="Last Name" half><Input value={a.lastName} onChange={v=>set('lastName',v)} placeholder="Smith"/></Field>
          <Field label="Phone" half><Input value={a.phone} onChange={v=>set('phone',v)} placeholder="416-555-0100" type="tel"/></Field>
          <Field label="Email" half><Input value={a.email} onChange={v=>set('email',v)} placeholder="john@email.com" type="email"/></Field>
          <Field label="Province" half><Sel value={a.province} onChange={v=>set('province',v)} options={['ON','QC','BC','AB','MB','SK','NS','NB','NL','PE','NT','YT','NU']}/></Field>
          <Field label="Lien Payoff ($)" half><Input value={a.lienPayoff} onChange={v=>set('lienPayoff',v)} type="number" placeholder="0"/></Field>
        </div>
      </Sec>

      <Sec title="Action Log" icon={Activity} open={false} badge={(a.log||[]).length||null}>
        <ActionLog entries={a.log}/>
      </Sec>

        </div>{/* end RIGHT COLUMN */}
      </div>{/* end two-col */}

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,padding:'4px 4px 8px',fontSize:11,color:C.textLight}}>
        <span>Created {new Date(a.createdAt).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'})}</span>
        <span>Last updated {new Date(a.updatedAt).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'})}</span>
      </div>
    </div>
  );
}
// ─── APPRAISAL LIST ───────────────────────────────────────────────────
function AppraisalList({appraisals,onNew,onEdit}) {
  const [q,setQ]=useState('');const [fs,setFs]=useState('');
  const filtered=appraisals.filter(a=>(!q||[a.vin,a.make,a.model,a.year,a.firstName,a.lastName].some(v=>(v||'').toLowerCase().includes(q.toLowerCase())))&&(!fs||a.status===fs));
  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <div><h2 style={{fontSize:18,fontWeight:800,color:C.navy}}>Appraisals</h2><p style={{fontSize:13,color:C.textLight}}>{appraisals.length} total</p></div>
        <Btn onClick={onNew}><Plus size={13}/>New Appraisal</Btn>
      </div>
      <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:200,position:'relative'}}><Search size={13} color={C.textLight} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)'}}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search VIN, make, customer..." style={{width:'100%',padding:'8px 12px 8px 30px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/></div>
        <select value={fs} onChange={e=>setFs(e.target.value)} style={{padding:'8px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontFamily:'inherit',outline:'none'}}>
          <option value="">All</option>{Object.entries(AS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:14}} className='stat-grid-4'>
        {Object.entries(AS).map(([k,s])=><div key={k} style={{background:C.card,borderRadius:7,padding:'10px 14px',border:`1px solid ${C.border}`}}><div style={{fontSize:10,color:C.textLight,fontWeight:600,marginBottom:3}}>{s.label}</div><div style={{fontSize:20,fontWeight:800,color:s.color,fontFamily:'monospace'}}>{appraisals.filter(a=>a.status===k).length}</div></div>)}
      </div>
      {filtered.length===0?<Card style={{padding:'40px',textAlign:'center'}}><ClipboardList size={32} color={C.navyBorder} style={{marginBottom:10}}/><div style={{fontSize:14,fontWeight:700,color:C.textMid,marginBottom:14}}>No appraisals yet</div><Btn onClick={onNew}><Plus size={13}/>New Appraisal</Btn></Card>:(
        <Card style={{overflow:'hidden'}}>{filtered.map((a,i)=><div key={a.id} onClick={()=>onEdit(a)} style={{padding:'12px 16px',borderBottom:i<filtered.length-1?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:12,cursor:'pointer',transition:'background 0.15s'}} onMouseEnter={e=>e.currentTarget.style.background=C.navyMuted} onMouseLeave={e=>e.currentTarget.style.background='transparent'}><div style={{width:38,height:38,background:C.navyMuted,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Car size={17} color={C.navy}/></div><div style={{flex:1}}><div style={{fontWeight:700,fontSize:13,color:C.navy}}>{[a.year,a.make,a.model,a.series].filter(Boolean).join(' ')||'Untitled'}</div><div style={{display:'flex',gap:10,marginTop:2}}>{a.vin&&<span style={{fontSize:11,fontFamily:'monospace',color:C.textLight}}>{a.vin}</span>}{a.odometer&&<span style={{fontSize:11,color:C.textLight}}>{fmtN(a.odometer)} km</span>}</div></div><ABadge status={a.status}/>{a.carfax&&<ShieldCheck size={14} color={a.carfax.clean?C.green:C.red}/>}{a.appraisedValue&&<div style={{fontSize:14,fontWeight:800,color:C.navy,fontFamily:'monospace'}}>{fmt(a.appraisedValue)}</div>}<div style={{fontSize:11,color:C.textLight,textAlign:'right'}}>{new Date(a.createdAt).toLocaleDateString('en-CA')}</div><ChevronRight size={13} color={C.textLight}/></div>)}</Card>
      )}
    </div>
  );
}

// ─── INVENTORY LIST ───────────────────────────────────────────────────
function InventoryList({vehicles,onAdd,onEdit}) {
  const [q,setQ]=useState('');const [fs,setFs]=useState('');const [sort,setSort]=useState('newest');
  const filtered=vehicles.filter(v=>(!q||[v.vin,v.make,v.model,v.year,v.stockNumber].some(x=>(x||'').toLowerCase().includes(q.toLowerCase())))&&(!fs||v.status===fs)).sort((a,b)=>sort==='newest'?new Date(b.createdAt)-new Date(a.createdAt):sort==='price_high'?Number(b.listPrice||0)-Number(a.listPrice||0):sort==='price_low'?Number(a.listPrice||0)-Number(b.listPrice||0):daysAgo(b.createdAt)-daysAgo(a.createdAt));
  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <div><h2 style={{fontSize:18,fontWeight:800,color:C.navy}}>Inventory</h2><p style={{fontSize:13,color:C.textLight}}>{vehicles.filter(v=>v.status==='available').length} available · {vehicles.length} total</p></div>
        <Btn onClick={onAdd}><Plus size={13}/>Add Vehicle</Btn>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:14}} className='stat-grid-4'>
        {[{l:'Available',v:vehicles.filter(v=>v.status==='available').length,c:C.green},{l:'In Recon',v:vehicles.filter(v=>v.status==='in_recon').length,c:C.orange},{l:'Sold',v:vehicles.filter(v=>v.status==='sold').length,c:C.purple},{l:'Aging 30d+',v:vehicles.filter(v=>daysAgo(v.createdAt)>=30&&v.status==='available').length,c:C.red}].map(s=><div key={s.l} style={{background:C.card,borderRadius:7,padding:'10px 14px',border:`1px solid ${C.border}`}}><div style={{fontSize:10,color:C.textLight,fontWeight:600,marginBottom:3}}>{s.l}</div><div style={{fontSize:20,fontWeight:800,color:s.c,fontFamily:'monospace'}}>{s.v}</div></div>)}
      </div>
      <div style={{display:'flex',gap:10,marginBottom:12,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:200,position:'relative'}}><Search size={13} color={C.textLight} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)'}}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search stock #, VIN, make, model..." style={{width:'100%',padding:'8px 12px 8px 30px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/></div>
        <select value={fs} onChange={e=>setFs(e.target.value)} style={{padding:'8px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontFamily:'inherit',outline:'none'}}>
          <option value="">All Statuses</option>{Object.entries(VS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={sort} onChange={e=>setSort(e.target.value)} style={{padding:'8px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontFamily:'inherit',outline:'none'}}>
          <option value="newest">Newest</option><option value="price_high">Price ↓</option><option value="price_low">Price ↑</option><option value="age">Longest on Lot</option>
        </select>
      </div>
      <Card style={{overflow:'hidden'}}>
        {filtered.length===0?<div style={{padding:'40px',textAlign:'center'}}><Car size={32} color={C.navyBorder} style={{marginBottom:10}}/><div style={{fontSize:14,fontWeight:700,color:C.textMid,marginBottom:14}}>No vehicles found</div><Btn onClick={onAdd}><Plus size={13}/>Add Vehicle</Btn></div>:
        filtered.map((v,i)=>{
          const days=daysAgo(v.createdAt);const p=pct(v.listPrice,v.marketMid);const aging=days>=30&&v.status==='available';
          return <div key={v.id} onClick={()=>onEdit(v)} style={{padding:'12px 16px',borderBottom:i<filtered.length-1?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:12,cursor:'pointer',transition:'background 0.15s'}} onMouseEnter={e=>e.currentTarget.style.background=C.navyMuted} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <div style={{width:44,height:44,background:C.navyMuted,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,overflow:'hidden'}}>{v.photos?.length>0&&v.photos[0]?.dataUrl?<img src={v.photos[0].dataUrl} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>:<Car size={19} color={C.navy}/>}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}><span style={{fontSize:10,fontFamily:'monospace',color:C.textLight}}>#{v.stockNumber}</span><VBadge status={v.status}/>{aging&&<span style={{fontSize:10,background:C.redBg,color:C.red,borderRadius:4,padding:'1px 6px',fontWeight:600}}>⚠ {days}d on lot</span>}{v.carfax&&<ShieldCheck size={12} color={v.carfax.clean?C.green:C.red}/>}</div>
              <div style={{fontWeight:700,fontSize:13,color:C.navy}}>{[v.year,v.make,v.model,v.series].filter(Boolean).join(' ')||'Untitled'}</div>
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                {v.odometer&&<span style={{fontSize:12,fontFamily:'monospace',fontWeight:700,color:C.navy}}>{fmtN(v.odometer)} km</span>}
                {v.extColour&&<span style={{fontSize:11,color:C.textLight}}>{v.extColour}</span>}
              </div>
            </div>
            <div style={{display:'flex',gap:3,flexShrink:0}}>
              {v.feeds?.autotrader?.active&&<span style={{fontSize:9,background:'rgba(232,81,35,0.1)',color:'#e85123',padding:'2px 6px',borderRadius:4,fontFamily:'monospace',fontWeight:600}}>AT</span>}
              {v.feeds?.cargurus?.active&&<span style={{fontSize:9,background:'rgba(0,156,252,0.1)',color:'#009cfc',padding:'2px 6px',borderRadius:4,fontFamily:'monospace',fontWeight:600}}>CG</span>}
              {v.feeds?.website?.active&&<span style={{fontSize:9,background:C.tealMuted,color:C.teal,padding:'2px 6px',borderRadius:4,fontFamily:'monospace',fontWeight:600}}>WEB</span>}
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              {v.listPrice?<div style={{fontSize:15,fontWeight:800,color:C.navy,fontFamily:'monospace'}}>{fmt(v.listPrice)}</div>:<div style={{fontSize:12,color:C.textLight}}>No price</div>}
              <GaugeSmall price={v.listPrice} mid={v.marketMid}/>
            </div>
            <ChevronRight size={13} color={C.textLight}/>
          </div>;
        })}
      </Card>
    </div>
  );
}

// ─── VEHICLE DETAIL ───────────────────────────────────────────────────
function VehicleDetail({vehicle:iv,onSave,onBack,showToast,onShowSticker=()=>{},onGetDealer,user='Staff'}) {
  const [v,setV]=useState(iv);const [tab,setTab]=useState('info');
  const [dl,setDl]=useState(false);const [ml,setMl]=useState(false);const [vl,setVl]=useState(false);const [cl,setCl]=useState(false);
  const [vehExpandedDetail,setVehExpandedDetail]=useState(!iv?.year);
  const [showVINScannerDetail,setShowVINScannerDetail]=useState(false);
  const [savedAt,setSavedAt]=useState(iv?.updatedAt||null);
  const [isDirty,setIsDirty]=useState(false);
  const vRef=useRef(v);const autoSaveRef=useRef(null);
  const days=daysAgo(v.createdAt);
  const up=useCallback(f=>setV(p=>{const next={...p,...f,updatedAt:new Date().toISOString()};vRef.current=next;return next;}),[]);
  const initialRef=useRef(JSON.stringify(iv));
  useEffect(()=>{
    // Dirty only when content actually differs from what we loaded (ignore updatedAt churn).
    const {updatedAt:_u,...rest}={...v};
    const {updatedAt:_iu,...irest}=JSON.parse(initialRef.current);
    setIsDirty(JSON.stringify(rest)!==JSON.stringify(irest));
  },[v]);

  // Auto-save: vehicle always has a stock number, so save once VIN present
  useEffect(()=>{
    if(!isDirty) return;
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current=setTimeout(()=>{
      onSave(vRef.current,true);
      initialRef.current=JSON.stringify(vRef.current);
      setSavedAt(new Date().toISOString());
      setIsDirty(false);
    },2000);
    return()=>clearTimeout(autoSaveRef.current);
  },[v,isDirty]);

  function forceSaveV(){onSave(vRef.current,true);initialRef.current=JSON.stringify(vRef.current);setSavedAt(new Date().toISOString());setIsDirty(false);showToast('Saved','success');}

  async function decode(){if(v.vin.length!==17){showToast('Valid 17-char VIN required','error');return;}setVl(true);try{const d=await decodeVIN(v.vin.toUpperCase());up(d);showToast(`Decoded: ${d.year} ${d.make} ${d.model}`,'success');}catch{showToast('Could not decode','error');}finally{setVl(false);}}
  async function genDesc(){setDl(true);try{const d=await generateDescription(v);up({description:d});showToast('Description generated','success');}catch{showToast('Generation failed','error');}finally{setDl(false);}}
  async function refMkt(){
    if(!v.vin||v.vin.length!==17){showToast('Valid VIN required','error');return;}
    const dealer=onGetDealer?onGetDealer():null;
    const postal=dealer?.postal;
    if(!postal){showToast('Set your dealer postal code in Settings first','error');return;}
    setMl(true);
    try{
      const m=await fetchMarketData(v.vin,postal);
      if(!m.found){showToast(m.message||'No Canadian comps found','warning');setMl(false);return;}
      const note=`${m.meta.comps} comps · ${m.meta.matchMode==='trim'?'trim match':'model match'}${m.meta.widened?' (widened)':''}`;
      up(withLog({...vRef.current,marketLow:m.marketLow,marketMid:m.marketMid,marketHigh:m.marketHigh,marketAvgPrice:m.marketAvgPrice,activeComps:m.activeComps,marketDaysSupply:m.marketDaysSupply,marketDaySupply:m.marketDaySupply,medianDaysListed:m.medianDaysListed,_soldStats:m.soldStats,marketDataFetched:m.marketDataFetched,_marketMeta:m.meta,_medianCompMileage:m.medianCompMileage,_comps:m.comps},[logEvent('Market Data',`mid ${fmt(m.marketMid)} · ${note}`,user)]));
      showToast(`Market: ${note}`,'success');
    }catch(e){showToast(e.message||'Market data unavailable','error');}
    finally{setMl(false);}
  }
  async function pullCfx(){if(!v.vin||v.vin.length!==17){showToast('Valid VIN required','error');return;}setCl(true);try{const c=await fetchCarfax(v.vin);up(withLog({...vRef.current,carfax:c},[logEvent('Carfax Report',c.clean?'Clean':'Issues Found',user,'Not Pulled')]));showToast('Carfax report retrieved','success');}catch{showToast('Carfax unavailable','error');}finally{setCl(false);}}
  function photo(e){Array.from(e.target.files).forEach(f=>{const r=new FileReader();r.onload=ev=>up({photos:[...v.photos,{id:Date.now().toString()+Math.random(),dataUrl:ev.target.result,category:'Misc',name:f.name}]});r.readAsDataURL(f);});e.target.value='';}
  const comps=v._comps||[];
  const myRank=(v.listPrice&&comps.length)?comps.filter(c=>c.price<Number(v.listPrice)).length+1:null;
  const tabs=[{k:'info',l:'Vehicle Info',I:Car},{k:'pricing',l:'PriceIQ',I:BarChart2,alert:days>=30},{k:'carfax',l:'Carfax',I:ShieldCheck,alert:!v.carfax},{k:'photos',l:'Photos',I:Camera,alert:!(v.photos?.length>0)},{k:'feeds',l:'Feeds',I:Radio},{k:'log',l:'Vehicle Log',I:Activity}];
  return (
    <div>
      {showVINScannerDetail&&<VINScanner onVINDetected={val=>{up({vin:val});setVehExpandedDetail(true);}} onClose={()=>setShowVINScannerDetail(false)}/>}
      <Card style={{padding:'14px 18px',marginBottom:12}}>
        <div style={{display:'flex',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
              <span style={{fontSize:11,fontFamily:'monospace',color:C.textLight}}>#{v.stockNumber}</span>
              <span style={{fontSize:11,color:C.textLight}}>·</span>
              <span style={{fontSize:11,color:ageColor(days),fontFamily:'monospace'}}>{days} days on lot</span>
            </div>
            <div style={{fontSize:18,fontWeight:800,color:C.navy,marginBottom:4}}>{[v.year,v.make,v.model,v.series].filter(Boolean).join(' ')||'New Vehicle'}</div>
            {/* Mileage prominent in header */}
            {v.odometer&&<div style={{fontSize:16,fontWeight:700,color:C.navy,fontFamily:'monospace'}}>{Number(v.odometer).toLocaleString('en-CA')} <span style={{fontSize:12,fontWeight:400,color:C.textLight}}>km</span></div>}
            {/* VIN with copy */}
            {v.vin&&<div style={{display:'flex',alignItems:'center',gap:6,marginTop:4}}>
              <span style={{fontSize:10,fontFamily:'monospace',color:C.textLight}}>{v.vin}</span>
              <CopyVIN vin={v.vin}/>
            </div>}
            {/* Carfax tags */}
            <CarfaxTags carfax={v.carfax} odometer={v.odometer} marketAvgOdometer={v.marketAvgOdometer}/>
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8,flexShrink:0}}>
            <select value={v.status} onChange={e=>up({status:e.target.value})} style={{padding:'6px 10px',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:12,fontFamily:'inherit',background:'#fff'}}>
              {Object.entries(VS).map(([k,s])=><option key={k} value={k}>{s.label}</option>)}
            </select>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:17,fontWeight:900,color:C.navy,fontFamily:'monospace'}}>{fmt(v.listPrice)||'—'}</div>
              <GaugeSmall price={v.listPrice} mid={v.marketMid}/>
            </div>
            {/* Share button — prominent, always visible */}
            <button onClick={async()=>{
              const r=await shareVehicle(v,onGetDealer?onGetDealer():null)
              if(r.copied) showToast('Vehicle info copied to clipboard — paste into text or email','success')
              else if(r.success) showToast('Shared!','success')
              else if(r.reason!=='cancelled') showToast('Tap again or check browser permissions','error')
            }} style={{
              background:C.teal,color:'#fff',border:'none',borderRadius:8,
              padding:'8px 16px',fontSize:13,fontWeight:700,
              cursor:'pointer',display:'flex',alignItems:'center',gap:6,
              boxShadow:'0 2px 8px rgba(0,180,166,0.3)',
            }}>
              <Share2 size={15}/>Share Vehicle
            </button>
          </div>
        </div>
        {/* Top action bar — replaces floating save bar */}
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginTop:14,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
          <button onClick={()=>{ if(isDirty) forceSaveV(); onBack(); }} style={{display:'flex',alignItems:'center',gap:4,background:'none',border:`1px solid ${C.borderStr}`,borderRadius:7,padding:'8px 12px',fontSize:12,fontWeight:600,color:C.textMid,cursor:'pointer',fontFamily:'inherit'}}><ChevronLeft size={14}/>Back</button>
          <SaveStatus isDirty={isDirty} savedAt={savedAt} onSave={forceSaveV}/>
          <button onClick={()=>onShowSticker(vRef.current)} style={{display:'flex',alignItems:'center',gap:5,background:C.navyMuted,border:`1px solid ${C.navyBorder}`,borderRadius:7,padding:'8px 12px',fontSize:12,fontWeight:700,color:C.navy,cursor:'pointer',fontFamily:'inherit'}}><Printer size={13}/>Sticker</button>
          <div style={{flex:1}}/>
          {v.status==='in_recon'&&<button onClick={()=>up({status:'available'})} style={{display:'flex',alignItems:'center',gap:5,background:C.green,border:'none',borderRadius:7,padding:'8px 14px',fontSize:12,fontWeight:700,color:'#fff',cursor:'pointer',fontFamily:'inherit'}}><CheckCircle size={13}/>Mark Available</button>}
          {v.status==='available'&&<button onClick={()=>up({status:'sold'})} style={{display:'flex',alignItems:'center',gap:5,background:'#fff',border:`1.5px solid ${C.navy}`,borderRadius:7,padding:'8px 14px',fontSize:12,fontWeight:700,color:C.navy,cursor:'pointer',fontFamily:'inherit'}}><Tag size={13}/>Mark Sold</button>}
        </div>
      </Card>
      <Card style={{marginBottom:12,overflow:'hidden'}}>
        <div style={{display:'flex',overflowX:'auto',borderBottom:`1px solid ${C.border}`,padding:'0 4px'}}>
          {tabs.map(t=><button key={t.k} onClick={()=>setTab(t.k)} style={{padding:'10px 14px',background:'none',border:'none',borderBottom:`2px solid ${tab===t.k?C.navy:'transparent'}`,color:tab===t.k?C.navy:C.textLight,fontWeight:tab===t.k?700:500,fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',gap:5,whiteSpace:'nowrap',fontFamily:'inherit',position:'relative'}}><t.I size={12}/>{t.l}{t.alert&&<span style={{position:'absolute',top:5,right:4,width:6,height:6,background:C.orange,borderRadius:'50%'}}/>}</button>)}
        </div>
        <div style={{padding:16}}>
          {tab==='info'&&<div>
            {/* VIN + Scan */}
            <div style={{display:'flex',gap:8,marginBottom:10}}>
              <div style={{flex:1}}><Input value={v.vin} onChange={val=>up({vin:val.toUpperCase().replace(/[^A-Z0-9]/g,'').substring(0,17)})} placeholder="17-char VIN" style={{fontFamily:'monospace',letterSpacing:1}}/></div>
              <Btn onClick={()=>setShowVINScannerDetail(true)} variant="ghost" size="sm"><ScanLine size={13}/>Scan</Btn>
              <Btn onClick={decode} disabled={vl||v.vin.length!==17} size="sm"><RefreshCw size={11} style={{animation:vl?'spin 1s linear infinite':undefined}}/>{vl?'...':'Decode'}</Btn>
            </div>
            {/* Compact summary */}
            <VehicleSummary data={v} onEdit={()=>setVehExpandedDetail(p=>!p)}/>
            {/* Expandable fields */}
            {vehExpandedDetail&&(
              <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.navyBorder}`}}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:8}}>
                  {[{f:'year',l:'Year',ph:'2022'},{f:'make',l:'Make',ph:'Toyota'},{f:'model',l:'Model',ph:'RAV4'},{f:'series',l:'Trim',ph:'XLE'},{f:'bodyType',l:'Body',ph:'SUV'},{f:'engine',l:'Engine',ph:'2.5L'},{f:'odometer',l:'KM',ph:'52000',t:'number'},{f:'extColour',l:'Ext. Colour',ph:'White'},{f:'intColour',l:'Int. Colour',ph:'Black'}].map(x=>(
                    <div key={x.f} style={{minWidth:0}}>
                      <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>{x.l}</label>
                      <Input value={v[x.f]} onChange={val=>up({[x.f]:val})} placeholder={x.ph} type={x.t||'text'}/>
                    </div>
                  ))}
                  <div style={{minWidth:0}}><label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Transmission</label><Sel value={v.transmission} onChange={val=>up({transmission:val})} options={['Automatic','Manual','CVT','DCT']}/></div>
                  <div style={{minWidth:0}}><label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Drivetrain</label><Sel value={v.drivetrain} onChange={val=>up({drivetrain:val})} options={['FWD','RWD','AWD','4WD','4x4']}/></div>
                </div>
                {/* Pricing fields */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginTop:8,paddingTop:8,borderTop:`1px solid ${C.navyBorder}`}}>
                  {[{f:'listPrice',l:'List Price',t:'number'},{f:'unitCost',l:'Unit Cost',t:'number'},{f:'reconCost',l:'Recon Cost',t:'number'}].map(x=>(
                    <div key={x.f} style={{minWidth:0}}>
                      <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>{x.l}</label>
                      <Input value={v[x.f]} onChange={val=>up({[x.f]:val})} type="number"/>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:600,color:C.textMid,marginBottom:6}}>Options / Features</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>{(v.features||[]).map((f,i)=><span key={i} style={{background:C.navyMuted,color:C.navy,borderRadius:20,padding:'4px 12px',fontSize:12,display:'inline-flex',alignItems:'center',gap:5}}>{f}<button onClick={()=>up({features:v.features.filter((_,j)=>j!==i)})} style={{background:'none',border:'none',color:C.navy,cursor:'pointer',padding:0}}><X size={9}/></button></span>)}</div>
              <div style={{display:'flex',gap:8}}><input id="feat" placeholder="Add feature, press Enter" onKeyDown={e=>{if(e.key==='Enter'&&e.target.value.trim()){up({features:[...v.features,e.target.value.trim()]});e.target.value='';e.preventDefault();}}} style={{flex:1,padding:'7px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontFamily:'inherit',outline:'none'}}/><Btn variant="ghost" size="sm" onClick={()=>{const el=document.getElementById('feat');if(el?.value.trim()){up({features:[...v.features,el.value.trim()]});el.value='';}}}> Add</Btn></div>
            </div>
            <div style={{marginBottom:10}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}><div style={{fontSize:11,fontWeight:600,color:C.textMid}}>Listing Description</div><Btn onClick={genDesc} disabled={dl||!v.year} size="sm"><Sparkles size={11} style={{animation:dl?'spin 1s linear infinite':undefined}}/>{dl?'Generating...':'AI Generate'}</Btn></div>
              <textarea value={v.description} onChange={e=>up({description:e.target.value})} placeholder="Enter description or click AI Generate..." rows={3} style={{width:'100%',padding:'10px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:7,fontSize:13,fontFamily:'inherit',resize:'vertical',outline:'none',boxSizing:'border-box',lineHeight:1.6}}/>
            </div>
            <div><div style={{fontSize:11,fontWeight:600,color:C.textMid,marginBottom:5}}>Internal Notes</div><textarea value={v.notes} onChange={e=>up({notes:e.target.value})} rows={2} style={{width:'100%',padding:'9px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:7,fontSize:13,fontFamily:'inherit',resize:'vertical',outline:'none',boxSizing:'border-box'}}/></div>
          </div>}

          {tab==='pricing'&&<div>
            {/* Price + cost inputs */}
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
              <Field label="List Price ($)"><Input value={v.listPrice} onChange={val=>up({listPrice:val})} type="number" style={{fontSize:15,fontWeight:700}}/></Field>
              <Field label="Unit Cost ($)"><Input value={v.unitCost} onChange={val=>up({unitCost:val})} type="number"/></Field>
              <Field label="Recon ($)"><Input value={v.reconCost} onChange={val=>up({reconCost:val})} type="number"/></Field>
            </div>
            {/* KPI strip */}
            {v.listPrice&&v.unitCost&&(()=>{
              const gross=Number(v.listPrice)-Number(v.unitCost||0)-Number(v.reconCost||0);
              const adjPct=v.marketMid?Math.round((Number(v.listPrice)/Number(v.marketMid))*100):null;
              const grade=calcGrade(v.marketDaysSupply);
              return(
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12}}>
                  {[
                    {l:'Gross Margin',v:fmt(gross),c:gross>0?C.green:C.red},
                    {l:'Days on Lot',v:days,c:ageColor(days)},
                    {l:'Price Rank',v:myRank?`#${myRank} of ${comps.length+1}`:'—',c:C.navy},
                    {l:'% of Market',v:adjPct?`${adjPct}%`:'—',c:adjPct?gaugeColor(adjPct):C.textLight},
                  ].map(s=>(
                    <div key={s.l} style={{background:C.navyMuted,borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:10,color:C.textLight,fontWeight:600,marginBottom:4}}>{s.l}</div>
                      <div style={{fontSize:16,fontWeight:900,color:s.c,fontFamily:'monospace'}}>{s.v}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
            {days>=30&&<div style={{background:C.redBg,border:`1px solid ${C.red}`,borderRadius:7,padding:'10px 14px',marginBottom:12,display:'flex',alignItems:'center',gap:8}}><AlertCircle size={14} color={C.red}/><span style={{fontSize:13,color:C.red,fontWeight:600}}>{days} days on lot — price review recommended</span></div>}
            {/* Competitive Criteria Controls */}
            <div style={{background:C.navyMuted,borderRadius:10,padding:12,border:`1px solid ${C.navyBorder}`,marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div style={{fontWeight:700,fontSize:13,color:C.navy}}>Market Intelligence</div>
                <Btn onClick={refMkt} disabled={ml} variant="ghost" size="sm"><RefreshCw size={11} style={{animation:ml?'spin 1s linear infinite':undefined}}/> Refresh</Btn>
              </div>
              {/* Criteria row */}
              <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:12,alignItems:'flex-end'}}>
                <div>
                  <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Distance</label>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <select value={v.searchDistance||150} onChange={e=>up({searchDistance:e.target.value})}
                      style={{padding:'6px 8px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:12,fontFamily:'inherit',outline:'none'}}>
                      {DISTANCE_OPTS.map(d=><option key={d} value={d}>{d}</option>)}
                    </select>
                    <span style={{fontSize:10,color:C.textLight}}>km</span>
                  </div>
                </div>
                <div>
                  <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>KM Range</label>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <input type="number" value={v.odoFrom||''} onChange={e=>up({odoFrom:e.target.value})} placeholder="From"
                      style={{width:70,padding:'6px 8px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:11,fontFamily:'inherit',outline:'none'}}/>
                    <span style={{fontSize:10,color:C.textLight}}>–</span>
                    <input type="number" value={v.odoTo||''} onChange={e=>up({odoTo:e.target.value})} placeholder="To"
                      style={{width:70,padding:'6px 8px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:11,fontFamily:'inherit',outline:'none'}}/>
                  </div>
                </div>
                <div>
                  <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Mode</label>
                  <div style={{display:'flex',gap:8,alignItems:'center',padding:'6px 0'}}>
                    {['Recent','Active'].map(m=>(
                      <label key={m} style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer',fontSize:12,color:C.textDark}}>
                        <input type="radio" name={`vmode_${v.id}`} checked={(v.marketMode||'Recent')===m} onChange={()=>up({marketMode:m})}
                          style={{accentColor:C.navy}}/>{m}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              {!v.marketMid?<div style={{textAlign:'center',padding:'12px 0'}}><Btn onClick={refMkt} disabled={ml}><TrendingUp size={13}/>{ml?'Loading...':'Fetch Market Data'}</Btn></div>:(
                <div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:10}}>{[{l:'Market Low',v:fmt(v.marketLow),c:C.green},{l:'Market Mid',v:fmt(v.marketMid),c:C.navy},{l:'Market High',v:fmt(v.marketHigh),c:C.orange}].map(s=><div key={s.l} style={{background:'#fff',borderRadius:7,padding:'8px 10px',border:`1px solid ${C.border}`,textAlign:'center'}}><div style={{fontSize:9,color:C.textLight,fontWeight:600,marginBottom:2}}>{s.l}</div><div style={{fontSize:15,fontWeight:800,color:s.c,fontFamily:'monospace'}}>{s.v}</div></div>)}</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,marginBottom:10}}>
                    {[
                      {l:'Active Comps',v:v._marketMeta?v._marketMeta.activeCount:v.activeComps,t:'Unique active comparable listings'},
                      {l:'Market Day Supply',v:(v.marketDaySupply!=null)?v.marketDaySupply:null,t:'Days to sell current active inventory at recent sales rate (active ÷ sold × 45)'},
                      {l:'Median Days Listed',v:(v.medianDaysListed!=null?v.medianDaysListed:v.marketDaysSupply)??null,t:'Median days a current comp has been listed'},
                      {l:'Median Comp KM',v:v._medianCompMileage?fmtN(v._medianCompMileage)+' km':(v.marketAvgOdometer?fmtN(v.marketAvgOdometer)+' km':null),t:'Median odometer across active comps'},
                    ].map(s=>(
                      <div key={s.l} title={s.t} style={{background:'#fff',borderRadius:7,padding:'7px 10px',border:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',cursor:'help'}}>
                        <span style={{fontSize:10,color:C.textLight,display:'inline-flex',alignItems:'center',gap:3}}>{s.l}<Info size={10} color={C.textLight} style={{opacity:0.6}}/></span>
                        <span style={{fontSize:11,fontWeight:700,color:C.navy,fontFamily:'monospace'}}>{s.v||s.v===0?s.v:'—'}</span>
                      </div>
                    ))}
                  </div>
                  {/* Recently Sold — real market stats, excluded from pricing */}
                  {v._soldStats&&v._soldStats.count>0&&(()=>{
                    const s=v._soldStats;
                    return(
                      <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',marginBottom:10}}>
                        <div style={{padding:'7px 10px',background:C.navyMuted,borderBottom:`1px solid ${C.border}`,fontSize:10,fontWeight:700,color:C.navy,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                          <span>Recently Sold — Comparable Market</span>
                          <span style={{fontSize:9,color:C.textLight,fontWeight:500}}>excluded from pricing</span>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)'}}>
                          {[
                            {l:'Sold',v:s.count},
                            {l:'Avg Days to Sell',v:s.avgDts!=null?s.avgDts:'—'},
                            {l:'Avg Sold Price',v:s.avgPrice!=null?fmt(s.avgPrice):'—'},
                            {l:'Avg KM',v:s.avgOdo!=null?fmtN(s.avgOdo):'—'},
                          ].map((c,i)=>(
                            <div key={c.l} style={{padding:'8px 8px',borderRight:i<3?`1px solid ${C.border}`:'none',textAlign:'center'}}>
                              <div style={{fontSize:9,fontWeight:600,color:C.textLight,marginBottom:3}}>{c.l}</div>
                              <div style={{fontSize:12,fontWeight:800,color:C.navy,fontFamily:'monospace'}}>{c.v}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {/* Odometer Adjustment */}
                  {v.odometer&&v.marketAvgOdometer&&(()=>{
                    const adj=odometerAdj(v.odometer,v.marketAvgOdometer);
                    if(!adj) return null;
                    return(
                      <div style={{background:adj>0?C.greenBg:C.orangeBg,border:`1px solid ${adj>0?C.green:C.orange}`,borderRadius:7,padding:'7px 10px',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                        <span style={{fontSize:11,fontWeight:600,color:adj>0?C.green:C.orange}}>KM Adjustment vs Market Avg</span>
                        <span style={{fontSize:12,fontWeight:800,fontFamily:'monospace',color:adj>0?C.green:C.orange}}>{adj>0?'+':''}{fmt(adj)}</span>
                      </div>
                    );
                  })()}
                  {v.listPrice&&<div style={{background:'#fff',borderRadius:7,padding:'10px',textAlign:'center',border:`1px solid ${C.border}`}}><div style={{fontSize:9,color:C.textLight,fontWeight:600,marginBottom:6,letterSpacing:1,textTransform:'uppercase'}}>Market Position</div><GaugeSmall price={v.listPrice} mid={v.marketMid}/></div>}
                </div>
              )}
            </div>
            {comps.length>0
              ? <div style={{marginTop:12}}><CompSet comps={comps} myPrice={v.listPrice} myKm={v.odometer} myDays={days}/></div>
              : v.marketMid&&<div style={{marginTop:12,background:C.navyMuted,border:`1px solid ${C.border}`,borderRadius:10,padding:'14px 16px',textAlign:'center',fontSize:12,color:C.textMid}}>Hit <strong>Refresh</strong> above to load live competitive listings for this vehicle.</div>}
          </div>}

          {tab==='carfax'&&<div>
            <div style={{fontSize:13,color:C.textMid,marginBottom:14}}>Pull a Carfax Canada report for this vehicle. Reports are cached — you only pay once per VIN.</div>
            <CarfaxBadge carfax={v.carfax} onFetch={pullCfx} loading={cl}/>
          </div>}

          {tab==='photos'&&<div>
            <div style={{display:'flex',gap:8,marginBottom:12}}>
              <label className="cap-only" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',background:C.navy,color:'#fff',borderRadius:6,fontSize:13,fontWeight:600,cursor:'pointer'}}><Camera size={13}/>Take Photo<input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={photo} multiple/></label>
              <label style={{display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',background:'#fff',color:C.textMid,border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontWeight:600,cursor:'pointer'}}><Upload size={13}/>Upload<input type="file" accept="image/*" style={{display:'none'}} onChange={photo} multiple/></label>
            </div>
            {v.photos?.length>0?<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:8}}>{(v.photos||[]).map(p=><div key={p.id} style={{position:'relative',borderRadius:7,overflow:'hidden',border:`1px solid ${C.border}`}}><img src={p.dataUrl} style={{width:'100%',height:90,objectFit:'cover',display:'block'}} alt=""/><div style={{padding:'4px 5px',background:'#fff'}}><select value={p.category} onChange={e=>up({photos:v.photos.map(ph=>ph.id===p.id?{...ph,category:e.target.value}:ph)})} style={{width:'100%',fontSize:10,border:'none',background:'none',fontFamily:'inherit'}}>{['Front','Rear','Driver Side','Pass. Side','Interior','Odometer','Engine','Damage','Misc'].map(c=><option key={c}>{c}</option>)}</select></div><button onClick={()=>up({photos:v.photos.filter(ph=>ph.id!==p.id)})} style={{position:'absolute',top:3,right:3,background:'rgba(0,0,0,0.6)',border:'none',borderRadius:'50%',width:20,height:20,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}><X size={10} color="white"/></button></div>)}</div>:<div style={{padding:'24px',background:C.navyMuted,borderRadius:7,textAlign:'center',border:`1.5px dashed ${C.navyBorder}`}}><Camera size={22} color={C.navyBorder} style={{marginBottom:6}}/><div style={{fontSize:12,color:C.textLight}}>No photos yet</div></div>}
          </div>}

          {tab==='feeds'&&<div>
            <p style={{fontSize:13,color:C.textMid,marginBottom:14}}>Control where this vehicle is published. Requires at least one photo and a list price.</p>
            {[{key:'autotrader',label:'AutoTrader.ca',color:'#e85123',sub:'XML feed · every 4 hrs'},{key:'cargurus',label:'CarGurus.ca',color:'#009cfc',sub:'CSV/XML feed · every 4 hrs'},{key:'website',label:'Dealer Website',color:C.navy,sub:'Real-time · instant'},{key:'auction',label:'Public Auction',color:C.teal,sub:'Next auction event'}].map(f=>{
              const active=v.feeds?.[f.key]?.active;const ready=v.photos?.length>0&&v.listPrice&&v.year;
              return <div key={f.key} style={{background:'#fff',border:`1.5px solid ${active?f.color:C.border}`,borderRadius:8,padding:'12px 14px',display:'flex',alignItems:'center',gap:12,marginBottom:8,transition:'all 0.2s'}}>
                <div style={{width:34,height:34,borderRadius:7,background:active?f.color:C.navyMuted,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.2s'}}><Globe size={15} color={active?'#fff':C.navy}/></div>
                <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13,color:C.textDark}}>{f.label}</div><div style={{fontSize:11,color:active?f.color:C.textLight}}>{active?`● Live`:f.sub}</div>{!ready&&!active&&<div style={{fontSize:11,color:C.orange,marginTop:2}}>⚠ Add photos and price first</div>}</div>
                <button onClick={()=>{if(!ready&&!active)return;up({feeds:{...v.feeds,[f.key]:{active:!active}}});}} style={{width:40,height:22,background:active?f.color:C.navyBorder,borderRadius:11,border:'none',cursor:ready||active?'pointer':'not-allowed',position:'relative',opacity:!ready&&!active?0.4:1,transition:'all 0.2s',flexShrink:0}}>
                  <span style={{position:'absolute',top:2,left:active?18:2,width:18,height:18,background:'#fff',borderRadius:'50%',transition:'left 0.2s',display:'block'}}/>
                </button>
              </div>;
            })}
          </div>}

          {tab==='log'&&<div>
            <ActionLog entries={v.log}/>
          </div>}
        </div>
      </Card>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,padding:'4px 4px 8px',fontSize:11,color:C.textLight}}>
        <span>Stock #{v.stockNumber} · Created {new Date(v.createdAt).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'})}</span>
        <span>Last updated {new Date(v.updatedAt).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'})}</span>
      </div>
    </div>
  );
}

// ─── REPORTS ──────────────────────────────────────────────────────────
function downloadCSV(filename, rows){
  const csv=rows.map(r=>r.map(cell=>{
    const s=String(cell??'');
    return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
  }).join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url; link.download=filename;
  document.body.appendChild(link); link.click();
  document.body.removeChild(link); URL.revokeObjectURL(url);
}

function ReportsPage({vehicles,appraisals,dealer,showToast}){
  const [tab,setTab]=useState('appraisals');

  // ── Appraisal summary metrics ──
  const aStats=Object.keys(AS).map(k=>({k,label:AS[k].label,color:AS[k].color,count:appraisals.filter(a=>a.status===k).length}));
  const finalized=appraisals.filter(a=>a.finalizedAt);
  const offers=appraisals.filter(a=>a.appraisedValue);
  const avgOffer=offers.length?Math.round(offers.reduce((s,a)=>s+Number(a.appraisedValue||0),0)/offers.length):0;
  const conversion=appraisals.length?Math.round(appraisals.filter(a=>a.status==='purchased').length/appraisals.length*100):0;

  // ── Inventory aging buckets ──
  const live=vehicles.filter(v=>['available','in_recon','sale_pending'].includes(v.status));
  const buckets=[{l:'0–15 days',min:0,max:15,c:C.green},{l:'16–30 days',min:16,max:30,c:C.blue},{l:'31–60 days',min:31,max:60,c:C.orange},{l:'61+ days',min:61,max:1e9,c:C.red}];
  const aged=buckets.map(b=>{const items=live.filter(v=>{const d=daysAgo(v.createdAt);return d>=b.min&&d<=b.max;});return {...b,items,count:items.length,value:items.reduce((s,v)=>s+Number(v.listPrice||0),0)};});
  const totalValue=live.reduce((s,v)=>s+Number(v.listPrice||0),0);
  const avgAge=live.length?Math.round(live.reduce((s,v)=>s+daysAgo(v.createdAt),0)/live.length):0;

  function exportAppraisalsCSV(){
    const rows=[['Created','Status','Finalized','Year','Make','Model','Trim','VIN','Odometer','Appraised Value','Recon','Market Mid','Appraiser','Customer']];
    appraisals.forEach(a=>rows.push([
      new Date(a.createdAt).toLocaleString('en-CA'),(AS[a.status]||{}).label||a.status,
      a.finalizedAt?new Date(a.finalizedAt).toLocaleString('en-CA'):'',
      a.year,a.make,a.model,a.series,a.vin,a.odometer,a.appraisedValue,a.reconCost,a.marketMid,
      a.appraiser,[a.firstName,a.lastName].filter(Boolean).join(' '),
    ]));
    downloadCSV(`appraisal-summary-${new Date().toISOString().slice(0,10)}.csv`,rows);
    showToast('Appraisal CSV exported','success');
  }
  function exportAgingCSV(){
    const rows=[['Stock #','Status','Days on Lot','Year','Make','Model','Trim','VIN','Odometer','List Price','Unit Cost','Market Mid','Price vs Market %']];
    [...live].sort((a,b)=>daysAgo(b.createdAt)-daysAgo(a.createdAt)).forEach(v=>rows.push([
      v.stockNumber,(VS[v.status]||{}).label||v.status,daysAgo(v.createdAt),
      v.year,v.make,v.model,v.series,v.vin,v.odometer,v.listPrice,v.unitCost,v.marketMid,
      pct(v.listPrice,v.marketMid)||'',
    ]));
    downloadCSV(`inventory-aging-${new Date().toISOString().slice(0,10)}.csv`,rows);
    showToast('Inventory aging CSV exported','success');
  }
  function printAppraisalReport(){
    const body=`${dealerHeader(dealer,'Appraisal Summary',new Date().toLocaleDateString('en-CA',{dateStyle:'long'}))}
      <div class="pp-sec"><h3>Overview</h3><div class="pp-grid">
        <div class="pp-row"><span class="k">Total Appraisals</span><span class="v">${appraisals.length}</span></div>
        <div class="pp-row"><span class="k">Finalized</span><span class="v">${finalized.length}</span></div>
        <div class="pp-row"><span class="k">Average Offer</span><span class="v">${fmt(avgOffer)}</span></div>
        <div class="pp-row"><span class="k">Conversion to Inventory</span><span class="v">${conversion}%</span></div>
      </div></div>
      <div class="pp-sec"><h3>By Status</h3><table><thead><tr><th>Status</th><th class="num">Count</th></tr></thead><tbody>
        ${aStats.map(s=>`<tr><td>${esc(s.label)}</td><td class="num">${s.count}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="pp-sec"><h3>Detail</h3><table><thead><tr><th>Date</th><th>Vehicle</th><th>Status</th><th class="num">Odometer</th><th class="num">Offer</th></tr></thead><tbody>
        ${appraisals.map(a=>`<tr><td>${new Date(a.createdAt).toLocaleDateString('en-CA')}</td><td>${esc([a.year,a.make,a.model,a.series].filter(Boolean).join(' ')||'—')}</td><td>${esc((AS[a.status]||{}).label||'')}</td><td class="num">${a.odometer?fmtN(a.odometer):'—'}</td><td class="num">${a.appraisedValue?fmt(a.appraisedValue):'—'}</td></tr>`).join('')||'<tr><td colspan="5">No appraisals</td></tr>'}
      </tbody></table></div>
      <div class="pp-foot">Generated ${new Date().toLocaleString('en-CA')} · Vantage by ClickDocs</div>`;
    openPrintDoc('Appraisal Summary',body);
  }
  function printAgingReport(){
    const body=`${dealerHeader(dealer,'Inventory Aging',new Date().toLocaleDateString('en-CA',{dateStyle:'long'}))}
      <div class="pp-sec"><h3>Overview</h3><div class="pp-grid">
        <div class="pp-row"><span class="k">Live Units</span><span class="v">${live.length}</span></div>
        <div class="pp-row"><span class="k">Total List Value</span><span class="v">${fmt(totalValue)}</span></div>
        <div class="pp-row"><span class="k">Average Age</span><span class="v">${avgAge} days</span></div>
        <div class="pp-row"><span class="k">Aging 31+ days</span><span class="v">${aged[2].count+aged[3].count}</span></div>
      </div></div>
      <div class="pp-sec"><h3>Age Distribution</h3><table><thead><tr><th>Bucket</th><th class="num">Units</th><th class="num">List Value</th></tr></thead><tbody>
        ${aged.map(b=>`<tr><td>${esc(b.l)}</td><td class="num">${b.count}</td><td class="num">${fmt(b.value)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="pp-sec"><h3>Units (oldest first)</h3><table><thead><tr><th>Stock</th><th>Vehicle</th><th class="num">Days</th><th class="num">List</th><th class="num">vs Mkt</th></tr></thead><tbody>
        ${[...live].sort((a,b)=>daysAgo(b.createdAt)-daysAgo(a.createdAt)).map(v=>{const p=pct(v.listPrice,v.marketMid);return `<tr><td>#${esc(v.stockNumber)}</td><td>${esc([v.year,v.make,v.model,v.series].filter(Boolean).join(' '))}</td><td class="num">${daysAgo(v.createdAt)}</td><td class="num">${v.listPrice?fmt(v.listPrice):'—'}</td><td class="num">${p?p+'%':'—'}</td></tr>`;}).join('')||'<tr><td colspan="5">No live inventory</td></tr>'}
      </tbody></table></div>
      <div class="pp-foot">Generated ${new Date().toLocaleString('en-CA')} · Vantage by ClickDocs</div>`;
    openPrintDoc('Inventory Aging',body);
  }

  const StatCard=({label,value,color})=>(
    <div style={{background:C.card,borderRadius:8,padding:'14px 16px',border:`1px solid ${C.border}`}}>
      <div style={{fontSize:11,color:C.textLight,fontWeight:600,marginBottom:4}}>{label}</div>
      <div style={{fontSize:22,fontWeight:800,color:color||C.navy,fontFamily:'monospace'}}>{value}</div>
    </div>
  );

  return (
    <div>
      <div style={{marginBottom:18}}>
        <h2 style={{fontSize:18,fontWeight:800,color:C.navy}}>Reports</h2>
        <p style={{fontSize:13,color:C.textLight}}>Appraisal performance and inventory aging · export or print</p>
      </div>
      <div style={{display:'flex',gap:6,marginBottom:16,borderBottom:`1px solid ${C.border}`}}>
        {[{k:'appraisals',l:'Appraisal Summary',I:ClipboardList},{k:'aging',l:'Inventory Aging',I:Package}].map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k)} style={{padding:'9px 14px',background:'none',border:'none',borderBottom:`2px solid ${tab===t.k?C.navy:'transparent'}`,color:tab===t.k?C.navy:C.textLight,fontWeight:tab===t.k?700:500,fontSize:13,cursor:'pointer',display:'flex',alignItems:'center',gap:6,fontFamily:'inherit'}}><t.I size={13}/>{t.l}</button>
        ))}
      </div>

      {tab==='appraisals'&&<div>
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          <Btn onClick={printAppraisalReport} variant="outline"><Printer size={13}/>Print / PDF</Btn>
          <Btn onClick={exportAppraisalsCSV} variant="ghost"><FileText size={13}/>Export CSV</Btn>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}} className="stat-grid-4">
          <StatCard label="Total Appraisals" value={appraisals.length}/>
          <StatCard label="Finalized" value={finalized.length} color={C.purple}/>
          <StatCard label="Average Offer" value={fmt(avgOffer)}/>
          <StatCard label="Conversion" value={conversion+'%'} color={C.teal}/>
        </div>
        <Card style={{overflow:'hidden',marginBottom:16}}>
          <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:13,color:C.navy,background:C.navyMuted}}>By Status</div>
          {aStats.map((s,i)=>(
            <div key={s.k} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',borderBottom:i<aStats.length-1?`1px solid ${C.border}`:'none'}}>
              <div style={{flex:1,fontSize:13,color:C.textDark,fontWeight:600}}>{s.label}</div>
              <div style={{flex:2,height:8,background:C.bgDark,borderRadius:4,overflow:'hidden'}}><div style={{width:`${appraisals.length?s.count/appraisals.length*100:0}%`,height:'100%',background:s.color,borderRadius:4}}/></div>
              <div style={{width:40,textAlign:'right',fontFamily:'monospace',fontWeight:700,color:s.color}}>{s.count}</div>
            </div>
          ))}
        </Card>
      </div>}

      {tab==='aging'&&<div>
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          <Btn onClick={printAgingReport} variant="outline"><Printer size={13}/>Print / PDF</Btn>
          <Btn onClick={exportAgingCSV} variant="ghost"><FileText size={13}/>Export CSV</Btn>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}} className="stat-grid-4">
          <StatCard label="Live Units" value={live.length}/>
          <StatCard label="Total List Value" value={fmt(totalValue)}/>
          <StatCard label="Average Age" value={avgAge+'d'} color={ageColor(avgAge)}/>
          <StatCard label="Aging 31+ days" value={aged[2].count+aged[3].count} color={C.red}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}} className="stat-grid-4">
          {aged.map(b=>(
            <div key={b.l} style={{background:C.card,borderRadius:8,padding:'12px 14px',border:`1px solid ${C.border}`,borderTop:`3px solid ${b.c}`}}>
              <div style={{fontSize:11,color:C.textLight,fontWeight:600,marginBottom:4}}>{b.l}</div>
              <div style={{fontSize:20,fontWeight:800,color:b.c,fontFamily:'monospace'}}>{b.count}</div>
              <div style={{fontSize:11,color:C.textLight,fontFamily:'monospace',marginTop:2}}>{fmt(b.value)}</div>
            </div>
          ))}
        </div>
        <Card style={{overflow:'hidden'}}>
          <div style={{padding:'10px 14px',borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:13,color:C.navy,background:C.navyMuted}}>Units — oldest first</div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead><tr style={{background:C.navyMuted}}>{['Stock','Vehicle','Status','Days','List','vs Mkt'].map(h=><th key={h} style={{padding:'8px 12px',textAlign:h==='List'||h==='Days'||h==='vs Mkt'?'right':'left',fontSize:10,fontWeight:600,color:C.textLight,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
              <tbody>{[...live].sort((a,b)=>daysAgo(b.createdAt)-daysAgo(a.createdAt)).map((v,i)=>{const d=daysAgo(v.createdAt);const p=pct(v.listPrice,v.marketMid);return (
                <tr key={v.id} style={{borderBottom:`1px solid ${C.border}`}}>
                  <td style={{padding:'8px 12px',fontFamily:'monospace',color:C.textLight}}>#{v.stockNumber}</td>
                  <td style={{padding:'8px 12px',fontWeight:600,color:C.textDark}}>{[v.year,v.make,v.model,v.series].filter(Boolean).join(' ')}</td>
                  <td style={{padding:'8px 12px'}}><VBadge status={v.status}/></td>
                  <td style={{padding:'8px 12px',textAlign:'right',fontFamily:'monospace',fontWeight:700,color:ageColor(d)}}>{d}</td>
                  <td style={{padding:'8px 12px',textAlign:'right',fontFamily:'monospace'}}>{v.listPrice?fmt(v.listPrice):'—'}</td>
                  <td style={{padding:'8px 12px',textAlign:'right',fontFamily:'monospace',color:p?gaugeColor(p):C.textLight}}>{p?p+'%':'—'}</td>
                </tr>
              );})}
              {live.length===0&&<tr><td colSpan={6} style={{padding:'24px',textAlign:'center',color:C.textLight}}>No live inventory</td></tr>}</tbody>
            </table>
          </div>
        </Card>
      </div>}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────
export default function Vantage() {
  const [page,setPage]=useState('dashboard');
  const [vehicles,setVehicles]=useState(SEED);
  const [appraisals,setAppraisals]=useState([]);
  const [dealer,setDealer]=useState(DEFAULT_DEALER);
  const [activeV,setActiveV]=useState(null);
  const [activeA,setActiveA]=useState(null);
  const [toast,setToast]=useState(null);
  const [showScanner,setShowScanner]=useState(false);
  const [currentUser,setCurrentUser]=useState('');
  const [showUserMenu,setShowUserMenu]=useState(false);
  const showToast=useCallback((m,t='info')=>setToast({message:m,type:t}),[]);

  // Staff list comes from dealer settings; falls back to a sensible default.
  const staff=(dealer.staff&&dealer.staff.length>0)?dealer.staff:['Manager','Sales','Appraiser'];
  const actingUser=currentUser||staff[0]||'Staff';

  function handleScanVIN(vin) {
    // When scanner detects a VIN, start a new appraisal with it pre-filled
    const a = blankAppraisal();
    a.vin = vin.toUpperCase();
    setActiveA(a);
    setPage('appraisal_form');
    showToast('VIN scanned — tap Decode VIN to populate details', 'success');
  }

  useEffect(()=>{
    try{const d=JSON.parse(localStorage.getItem('vantage_vehicles'));if(d&&d.length>0)setVehicles(d);}catch{}
    try{const d=JSON.parse(localStorage.getItem('vantage_appraisals'));if(d)setAppraisals(d);}catch{}
    try{const d=JSON.parse(localStorage.getItem('vantage_dealer'));if(d)setDealer(d);}catch{}
    try{const u=localStorage.getItem('vantage_user');if(u)setCurrentUser(u);}catch{}
  },[]);

  const saveV=useCallback(l=>{try{localStorage.setItem('vantage_vehicles',JSON.stringify(l));}catch{}},[]);
  const saveA=useCallback(l=>{try{localStorage.setItem('vantage_appraisals',JSON.stringify(l));}catch{}},[]);
  const saveD=useCallback(d=>{try{localStorage.setItem('vantage_dealer',JSON.stringify(d));}catch{}},[]);
  function pickUser(u){setCurrentUser(u);setShowUserMenu(false);try{localStorage.setItem('vantage_user',u);}catch{}}

  function nav(action) {
    if(action==='new_appraisal'){setActiveA(blankAppraisal());setPage('appraisal_form');}
    else if(action==='new_vehicle'){setActiveV(blankVehicle());setPage('vehicle_detail');}
    else{setPage(action);}
  }
  function saveAppraisal(a,silent=false){
    setAppraisals(prev=>{
      const e=prev.find(x=>x.id===a.id);
      const merged=withLog(a, diffLog(e, a, actingUser)); // diff against stored version
      const n=e?prev.map(x=>x.id===a.id?merged:x):[merged,...prev];
      saveA(n);return n;
    });
    if(!silent){setPage('appraisals');showToast('Appraisal saved','success');}
  }
  function convertToInventory(a){
    const ua=withLog({...a,status:'purchased',updatedAt:new Date().toISOString()},[logEvent('Status',AS.purchased.label,actingUser,(AS[a.status]||{}).label||'')]);
    setAppraisals(prev=>{const n=prev.map(x=>x.id===a.id?ua:x);saveA(n);return n;});
    const nv=blankVehicle(ua);
    nv.log=[logEvent('VehicleCreated','Created from appraisal',actingUser)];
    setVehicles(prev=>{const n=[nv,...prev];saveV(n);return n;});
    setActiveV(nv);setPage('vehicle_detail');
    showToast(`${[a.year,a.make,a.model].filter(Boolean).join(' ')} moved to inventory`,'success');
  }
  function saveVehicle(v,silent=false){
    setVehicles(prev=>{
      const e=prev.find(x=>x.id===v.id);
      const merged=withLog(v, diffLog(e, v, actingUser));
      const n=e?prev.map(x=>x.id===v.id?merged:x):[merged,...prev];
      saveV(n);return n;
    });
    if(!silent){setPage('inventory');showToast('Vehicle saved','success');}
  }
  function saveDealer(d){setDealer(d);saveD(d);}
  function finalizeAppraisal(a){
    const fa=withLog({...a,status:a.status==='in_progress'?'offer_made':a.status,finalizedAt:new Date().toISOString(),finalizedBy:actingUser,updatedAt:new Date().toISOString()},[logEvent('Finalized','Appraisal locked',actingUser)]);
    setAppraisals(prev=>{const n=prev.map(x=>x.id===a.id?fa:x);saveA(n);return n;});
    setActiveA(fa);
    showToast('Appraisal finalized','success');
  }
  function unlockAppraisal(a){
    const ua=withLog({...a,finalizedAt:null,finalizedBy:null,updatedAt:new Date().toISOString()},[logEvent('Unlocked','Appraisal reopened for editing',actingUser)]);
    setAppraisals(prev=>{const n=prev.map(x=>x.id===a.id?ua:x);saveA(n);return n;});
    setActiveA(ua);
    showToast('Appraisal unlocked','info');
  }

  const navItems=[{k:'dashboard',l:'Dashboard',I:LayoutDashboard},{k:'appraisals',l:'Appraisals',I:ClipboardList,badge:appraisals.filter(a=>a.status==='in_progress').length||null},{k:'inventory',l:'Inventory',I:Package},{k:'reports',l:'Reports',I:BarChart2},{k:'settings',l:'Settings',I:Settings}];
  const cur=page.split('_')[0];

  return (
    <div style={{minHeight:'100vh',background:C.bg,fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,sans-serif"}}>
      {/* NAV */}
      <nav style={{background:'#fff',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,zIndex:200,boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'0 24px',height:52,display:'flex',alignItems:'center',gap:20}}>
          <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
            {dealer.logo?(
              <img src={dealer.logo} style={{maxHeight:32,objectFit:'contain'}} alt={dealer.name}/>
            ):(
              <div style={{width:32,height:32,borderRadius:7,background:C.navy,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:13,fontWeight:900,color:'#fff',fontFamily:'monospace',letterSpacing:-1}}>V</span></div>
            )}
            <div style={{display:'flex',alignItems:'center'}}>
              <span style={{fontSize:15,fontWeight:800,color:C.navy,letterSpacing:-0.3}}>Vantage</span>
              <span style={{fontSize:11,color:C.textLight,marginLeft:6,fontWeight:400}}>by ClickDocs</span>
            </div>
          </div>
          <div className='nav-links' style={{display:'flex',gap:2,flex:1}}>
            {navItems.map(n=>(
              <button key={n.k} onClick={()=>nav(n.k)} style={{padding:'6px 12px',background:cur===n.k?C.navyMuted:'none',border:'none',borderRadius:6,color:cur===n.k?C.navy:C.textLight,fontWeight:cur===n.k?700:500,fontSize:13,cursor:'pointer',display:'flex',alignItems:'center',gap:5,fontFamily:'inherit',transition:'all 0.15s',position:'relative'}}>
                <n.I size={13}/>{n.l}
                {n.badge>0&&<span style={{background:C.navy,color:'#fff',borderRadius:10,padding:'1px 6px',fontSize:10,fontWeight:700,marginLeft:2}}>{n.badge}</span>}
              </button>
            ))}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
            <button onClick={()=>nav('new_appraisal')} style={{padding:'6px 14px',background:C.navy,color:'#fff',border:'none',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:5,fontFamily:'inherit'}}><Plus size={13}/>New Appraisal</button>
            <div style={{position:'relative'}}>
              <button onClick={()=>setShowUserMenu(s=>!s)} title="Acting as" style={{display:'flex',alignItems:'center',gap:7,background:C.navyMuted,border:`1px solid ${C.navyBorder}`,borderRadius:8,padding:'4px 8px 4px 6px',cursor:'pointer'}}>
                <div style={{width:26,height:26,background:C.navy,borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:10,fontWeight:800,color:'#fff'}}>{actingUser.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</span></div>
                <span className="hide-mobile" style={{fontSize:12,fontWeight:600,color:C.navy,maxWidth:90,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{actingUser}</span>
                <ChevronDown size={12} color={C.textLight}/>
              </button>
              {showUserMenu&&(
                <>
                  <div onClick={()=>setShowUserMenu(false)} style={{position:'fixed',inset:0,zIndex:300}}/>
                  <div style={{position:'absolute',right:0,top:'calc(100% + 6px)',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:8,boxShadow:'0 8px 28px rgba(0,0,0,0.16)',minWidth:170,zIndex:301,overflow:'hidden'}}>
                    <div style={{padding:'8px 12px',fontSize:10,fontWeight:700,color:C.textLight,textTransform:'uppercase',letterSpacing:0.5,borderBottom:`1px solid ${C.border}`}}>Acting as</div>
                    {staff.map(u=>(
                      <button key={u} onClick={()=>pickUser(u)} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'9px 12px',background:u===actingUser?C.navyMuted:'none',border:'none',cursor:'pointer',textAlign:'left',fontSize:13,color:C.textDark,fontFamily:'inherit'}}>
                        <div style={{width:22,height:22,background:u===actingUser?C.navy:C.bgDark,borderRadius:5,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:9,fontWeight:800,color:u===actingUser?'#fff':C.textMid}}>{u.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</span></div>
                        {u}{u===actingUser&&<CheckCircle size={13} color={C.green} style={{marginLeft:'auto'}}/>}
                      </button>
                    ))}
                    <button onClick={()=>{setShowUserMenu(false);nav('settings');}} style={{width:'100%',padding:'9px 12px',background:'none',border:'none',borderTop:`1px solid ${C.border}`,cursor:'pointer',textAlign:'left',fontSize:12,color:C.teal,fontWeight:600,fontFamily:'inherit',display:'flex',alignItems:'center',gap:6}}><Settings size={12}/>Manage staff</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* CONTENT */}
      <div className='content-pad' style={{maxWidth:1200,margin:'0 auto',padding:'24px 24px 60px'}}>
        {page==='dashboard'&&<Dashboard vehicles={vehicles} appraisals={appraisals} dealer={dealer} onNav={nav}/>}
        {page==='appraisals'&&<AppraisalList appraisals={appraisals} onNew={()=>nav('new_appraisal')} onEdit={a=>{setActiveA({...a});setPage('appraisal_form');}}/>}
        {page==='appraisal_form'&&activeA&&<AppraisalForm initial={activeA} user={actingUser} onSave={(a,silent=false)=>saveAppraisal(a,silent)} onBack={()=>setPage('appraisals')} showToast={showToast} onConvert={convertToInventory} onFinalize={finalizeAppraisal} onUnlock={unlockAppraisal} onGetDealer={()=>dealer}/>}
        {page==='inventory'&&<InventoryList vehicles={vehicles} onAdd={()=>nav('new_vehicle')} onEdit={v=>{setActiveV({...v});setPage('vehicle_detail');}}/>}
        {page==='vehicle_detail'&&activeV&&<VehicleDetail vehicle={activeV} user={actingUser} onSave={saveVehicle} onBack={()=>setPage('inventory')} showToast={showToast} onShowSticker={v=>{setActiveV(v);setPage('sticker_detail');}} onGetDealer={()=>dealer}/>}
        {page==='stickers'&&<StickerGenerator vehicles={vehicles} dealer={dealer}/>}
        {page==='sticker_detail'&&activeV&&<div style={{maxWidth:700,margin:'0 auto'}}><StickerGenerator vehicles={vehicles} dealer={dealer} preselected={activeV.id} onBack={()=>setPage('vehicle_detail')}/></div>}
        {page==='reports'&&<ReportsPage vehicles={vehicles} appraisals={appraisals} dealer={dealer} showToast={showToast}/>}
        {page==='settings'&&<DealerSettings dealer={dealer} onSave={saveDealer} showToast={showToast}/>}
      </div>

      {toast&&<Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)}/>}

      {/* VIN Scanner Modal */}
      {showScanner&&<VINScanner onVINDetected={handleScanVIN} onClose={()=>setShowScanner(false)}/>}

      {/* Mobile Bottom Navigation */}
      <div className="mobile-bottom-nav" style={{display:'none',justifyContent:'space-around',alignItems:'center'}}>
        {[
          {k:'dashboard',l:'Home',I:LayoutDashboard},
          {k:'appraisals',l:'Appraisals',I:ClipboardList},
          {k:'scan',l:'Scan VIN',I:ScanLine||Camera,special:true},
          {k:'inventory',l:'Inventory',I:Package},
          
        ].map(n=>(
          <button key={n.k} onClick={()=>n.special?setShowScanner(true):nav(n.k)} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,background:n.special?'#1C2D5E':'none',border:'none',borderRadius:n.special?12:0,padding:n.special?'10px 16px':'6px 8px',cursor:'pointer',flex:1,color:n.special?'#fff':cur===n.k?'#1C2D5E':'#8C95A0'}}>
            <n.I size={n.special?22:18} color={n.special?'#fff':cur===n.k?'#1C2D5E':'#8C95A0'}/>
            <span style={{fontSize:9,fontWeight:n.special?800:cur===n.k?700:400,letterSpacing:0.3}}>{n.l}</span>
          </button>
        ))}
      </div>
      <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @keyframes spin { to { transform: rotate(360deg); } }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-thumb { background: #C4C8CC; border-radius: 3px; }
    input[type=number]::-webkit-outer-spin-button,
    input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }

    /* Camera-capture controls: only meaningful on mobile (rear camera). Hidden on desktop. */
    .cap-only { display: none !important; }

    /* ── MOBILE RESPONSIVE ── */
    @media (max-width: 768px) {
      .cap-only { display: inline-flex !important; }
      .dash-stats { grid-template-columns: repeat(2, 1fr) !important; }
      .dash-tiles { grid-template-columns: repeat(2, 1fr) !important; max-width: 100% !important; }
      .nav-links { display: none !important; }
      .nav-mobile-menu { display: flex !important; }
      .content-pad { padding: 14px 14px 80px !important; }
      .page-title { font-size: 16px !important; }
      .hide-mobile { display: none !important; }
      .field-half { flex: 1 1 100% !important; }
      .field-third { flex: 1 1 100% !important; }
      .sticky-bar { padding: 10px 14px !important; }
      .comp-table { font-size: 11px !important; }
      .stat-grid-4 { grid-template-columns: repeat(2, 1fr) !important; }
      .two-col { grid-template-columns: 1fr !important; }
      .appraisal-left { position: static !important; max-height: none !important; overflow: visible !important; }
    }
    @media (max-width: 480px) {
      .dash-tiles { grid-template-columns: 1fr !important; }
      .dash-stats { grid-template-columns: repeat(2, 1fr) !important; }
    }

    /* Bottom nav for mobile */
    .mobile-bottom-nav {
      display: none;
      position: fixed;
      bottom: 0; left: 0; right: 0;
      background: #fff;
      border-top: 1px solid rgba(0,0,0,0.08);
      z-index: 150;
      padding: 8px 0 env(safe-area-inset-bottom);
    }
    @media (max-width: 768px) {
      .mobile-bottom-nav { display: flex !important; }
    }
  `}</style>
    </div>
  );
}
