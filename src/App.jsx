import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth, useUser, UserButton } from "@clerk/clerk-react";
import {
  Car, BarChart2, Camera, FileText, User, DollarSign,
  CheckCircle, Clock, XCircle, AlertTriangle, Upload, Download,
  ChevronDown, ChevronUp, RefreshCw, Save, X, TrendingUp,
  Tag, ArrowRight, Radio, Search, Plus, ChevronLeft,
  Activity, Sparkles, Globe, AlertCircle, LayoutDashboard,
  ClipboardList, Package, Settings, Bell, ChevronRight,
  Printer, Image, Building2, ShieldCheck, Zap,
  FileSearch, Mail, ExternalLink, ScanLine, Edit3, Share2, Info, Copy, Check, MoreVertical
} from "lucide-react";
import VINScanner from './VINScanner.jsx'
import { computeSuggestedBuy, confidenceFrom, LUXURY_MAKES } from '../shared/suggestedBuy.js'
import { useNavigate, useLocation } from 'react-router-dom'
import * as XLSX from 'xlsx'


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
// Friendly, consistent date display: "Jun 12, 2026" (avoids raw ISO look).
const fmtDate = d => { try { return new Date(d).toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'}); } catch { return ''; } };
// Deterministic muted colour from a make name, for photoless thumbnails so the
// inventory list is scannable (each brand gets a consistent placeholder colour).
const makeColor = (make) => {
  const palette = ['#3B5BA5','#5A7D9A','#6B5B95','#4A7C59','#9A6A4A','#7A5C8E','#436B8C','#8C6A43','#5E8C7D','#7D5E8C'];
  const s = (make||'').toLowerCase();
  let h = 0; for (let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
};
const stockNum = () => 'V'+Math.floor(10000+Math.random()*90000);
// Guaranteed-unique id even when many are created in the same millisecond
// (e.g. bulk import). Date.now() alone collides in tight loops → React key
// clashes that make rows render/update as one. Add a counter + randomness.
let _idCounter = 0;
const uid = () => `${Date.now().toString(36)}${(_idCounter++).toString(36)}${Math.random().toString(36).slice(2,7)}`;
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
const blankAppraisal = () => ({id:uid(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'in_progress',disposition:'retail',source:'',appraiser:'',salesperson:'',vin:'',year:'',make:'',model:'',series:'',bodyType:'',engine:'',transmission:'',drivetrain:'',extColour:'',intColour:'',odometer:'',marketLow:null,marketMid:null,marketHigh:null,marketAvgPrice:null,marketDaysSupply:null,likeMineSupply:null,marketDataFetched:null,activeComps:null,avgDaysToSell:null,tires:'',paint:'',interior:'',mechanical:'',accidentVisible:false,reconCost:'',appraisedValue:'',profitObjective:'',targetGrossOverride:'',photos:[],notes:'',firstName:'',lastName:'',phone:'',email:'',address:'',postal:'',province:'',lienHolder:'',lienPayoff:'',comments:[],carfax:null,certCost:'',pack:'',finalizedAt:null,finalizedBy:null,log:[{ts:new Date().toISOString(),field:'AppraisalCreated',old:'',new:'In Progress',user:'System'}]});

// ─── PERMISSIONS ──────────────────────────────────────────────────────
// vAuto-style granular permissions, toggled per user in Settings. This is
// UI-level gating (organizes workflow, prevents accidents) — NOT server-enforced
// security, which comes with real auth in the backend phase.
// Each: key, label, description, and whether it's an active gate or a parked
// placeholder for future multi-store / marketplace features.
const PERMISSIONS = [
  {key:'base',          label:'Salesperson',                desc:'Basic access: create and edit appraisals, view inventory, work leads.', base:true},
  {key:'finalize',      label:'Finalize appraisals',        desc:'Lock and finalize appraisals.'},
  {key:'savePrices',    label:'Save vehicle prices',        desc:'Modify and save vehicle pricing in inventory.'},
  {key:'reports',       label:'Dealer management',          desc:'View management reports.'},
  {key:'sysAdmin',      label:'System Administrator',       desc:'Edit dealership configuration and settings.'},
  {key:'userAdmin',     label:'User Administrator',         desc:'Create and manage users and their permissions.'},
  {key:'carfax',        label:'Purchase Carfax reports',    desc:'Pull paid Carfax Canada history reports.'},
  {key:'deleteInv',     label:'Delete inventory records',   desc:'Permanently delete inventory records.'},
  // Parked placeholders — defined but inactive until the features exist.
  {key:'wholesaleBuyer',label:'Wholesale Buyer',            desc:'View and buy off the wholesale trade network.', parked:true},
  {key:'enterpriseXfer',label:'Enterprise Transfer Manager',desc:'Transfer vehicles between dealerships in a group; save and modify pricing.', parked:true},
];
const ALL_PERMISSION_KEYS = PERMISSIONS.map(p=>p.key);
// Permissions are stored on the dealer as { [staffName]: { permKey: true, ... } }.
// Anyone not listed (or with no map) gets FULL access — avoids locking out an
// existing single-user setup. Once a user has an explicit entry, it's authoritative.
function permsFor(dealer, userName){
  const map = dealer?.permissions;
  if(!map || !map[userName]) return null;        // null = no explicit entry → treat as full access
  return map[userName];
}
function userCan(dealer, userName, permKey){
  if(permKey==='base') return true;              // everyone has base access
  const p = permsFor(dealer, userName);
  if(p==null) return true;                       // no explicit perms set → full access (legacy/owner)
  return !!p[permKey];
}
const blankVehicle = (a=null) => ({id:uid(),stockNumber:stockNum(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'pending',disposition:'retail',fromAppraisalId:a?.id||null,vin:a?.vin||'',year:a?.year||'',make:a?.make||'',model:a?.model||'',series:a?.series||'',bodyType:a?.bodyType||'',engine:a?.engine||'',transmission:a?.transmission||'',drivetrain:a?.drivetrain||'',extColour:a?.extColour||'',intColour:a?.intColour||'',odometer:a?.odometer||'',listPrice:'',unitCost:a?.appraisedValue||'',reconCost:a?.reconCost||'',marketLow:a?.marketLow||null,marketMid:a?.marketMid||null,marketHigh:a?.marketHigh||null,marketAvgPrice:a?.marketAvgPrice||null,marketDaysSupply:a?.marketDaysSupply||null,likeMineSupply:a?.likeMineSupply||null,marketDataFetched:a?.marketDataFetched||null,activeComps:a?.activeComps||null,avgDaysToSell:a?.avgDaysToSell||null,_comps:a?._comps?[...a._comps]:null,_marketMeta:a?._marketMeta||null,_soldStats:a?._soldStats||null,_medianCompMileage:a?._medianCompMileage||a?.medianCompMileage||null,medianCompMileage:a?._medianCompMileage||a?.medianCompMileage||null,medianDaysListed:a?.medianDaysListed||null,marketDaySupply:a?.marketDaySupply||a?.marketDaysSupply||null,description:'',features:[...(a?.features||[])],damageFlags:[],photos:[...(a?.photos||[])],feeds:{autotrader:{active:false},cargurus:{active:false},website:{active:false},auction:{active:false}},log:[{ts:new Date().toISOString(),field:'VehicleCreated',old:'',new:a?'Created from appraisal':'Manual entry',user:'System'}],notes:a?.notes||'',carfax:a?.carfax||null});

// ─── SEED DATA ────────────────────────────────────────────────────────
const SEED = [
  {id:'v1',stockNumber:'V10482',createdAt:new Date(Date.now()-6*86400000).toISOString(),updatedAt:new Date().toISOString(),status:'available',disposition:'retail',vin:'SALKP9FU5PA040378',year:'2023',make:'Land Rover',model:'Range Rover',series:'SE',bodyType:'4D Sport Utility',engine:'3.0L I6 Turbo',transmission:'Automatic',drivetrain:'AWD',extColour:'Fuji White',intColour:'Caraway',odometer:'43679',listPrice:'124990',unitCost:'102000',reconCost:'2500',marketLow:112000,marketMid:118364,marketHigh:128000,marketAvgPrice:118364,marketDaysSupply:92,likeMineSupply:53,marketDataFetched:new Date().toISOString(),activeComps:43,avgDaysToSell:41,description:'',features:['20-Way Climate Seats','Panoramic Roof','11.4" Rear Entertainment','Head-Up Display','360 Camera','Meridian Sound System'],photos:[],feeds:{autotrader:{active:true},cargurus:{active:true},website:{active:true},auction:{active:false}},log:[],notes:'',carfax:null},
  {id:'v2',stockNumber:'V28374',createdAt:new Date(Date.now()-18*86400000).toISOString(),updatedAt:new Date().toISOString(),status:'available',disposition:'retail',vin:'1FTFW1E54NFA02341',year:'2022',make:'Ford',model:'F-150',series:'XLT',bodyType:'Pickup Truck',engine:'3.5L V6 EcoBoost',transmission:'Automatic',drivetrain:'4WD',extColour:'Iconic Silver',intColour:'Black',odometer:'38200',listPrice:'54900',unitCost:'44000',reconCost:'1200',marketLow:49000,marketMid:53500,marketHigh:58000,marketAvgPrice:53500,marketDaysSupply:45,likeMineSupply:28,marketDataFetched:new Date().toISOString(),activeComps:31,avgDaysToSell:22,description:'',features:['Heated Seats','Remote Start','SYNC 4','B&O Sound','Trailer Tow Package'],photos:[],feeds:{autotrader:{active:true},cargurus:{active:true},website:{active:true},auction:{active:false}},log:[],notes:'',carfax:null},
  {id:'v3',stockNumber:'V39201',createdAt:new Date(Date.now()-3*86400000).toISOString(),updatedAt:new Date().toISOString(),status:'in_recon',disposition:'retail',vin:'2T3RFREV7MW123456',year:'2021',make:'Toyota',model:'RAV4',series:'XLE',bodyType:'SUV',engine:'2.5L 4-Cylinder',transmission:'Automatic',drivetrain:'AWD',extColour:'Magnetic Gray',intColour:'Black',odometer:'52100',listPrice:'41500',unitCost:'33000',reconCost:'800',marketLow:37000,marketMid:41000,marketHigh:45500,marketDataFetched:new Date().toISOString(),activeComps:19,avgDaysToSell:18,description:'',features:['Apple CarPlay','Lane Assist','Adaptive Cruise','Heated Seats'],photos:[],feeds:{autotrader:{active:false},cargurus:{active:false},website:{active:false},auction:{active:false}},log:[],notes:'In for detail and paint touch-up',carfax:null},
  {id:'v4',stockNumber:'V44829',createdAt:new Date(Date.now()-45*86400000).toISOString(),updatedAt:new Date().toISOString(),status:'available',disposition:'retail',vin:'WBA5R1C57KAK12345',year:'2019',make:'BMW',model:'3 Series',series:'330i',bodyType:'Sedan',engine:'2.0L 4-Cylinder Turbo',transmission:'Automatic',drivetrain:'RWD',extColour:'Alpine White',intColour:'Black Leather',odometer:'61800',listPrice:'38200',unitCost:'29500',reconCost:'1500',marketLow:33000,marketMid:37500,marketHigh:42000,marketDataFetched:new Date().toISOString(),activeComps:28,avgDaysToSell:35,description:'',features:['iDrive Navigation','Heated Seats','Sport Package','Sunroof','Parking Sensors'],photos:[],feeds:{autotrader:{active:true},cargurus:{active:true},website:{active:true},auction:{active:false}},log:[],notes:'',carfax:null},
];

const DEFAULT_DEALER = {name:'Your Dealership',logo:null,address:'123 Main Street',city:'Toronto',province:'ON',postal:'M5V 3K4',phone:'416-555-0100',email:'info@yourdealership.ca',website:'www.yourdealership.ca',staff:['Manager','Sales','Appraiser'],
  // Appraisal pricing strategy (drives the Suggested Buy engine)
  marketPositionPct:97,   // where the dealer wants to retail vs. market mid (e.g. 97%)
  targetGross:2500,       // base front-end gross target ($)
  avgRecon:1500,          // default recon if none entered on the appraisal ($)
  aboutExcerpt:''};       // short dealership blurb woven into AI descriptions

// ─── API CALLS ────────────────────────────────────────────────────────
// Backend base URL. In production set VITE_API_URL (e.g. your Railway URL,
// no trailing slash) in Netlify env vars. Falls back to local dev server.
// Bump alongside MARKET_SHAPE_VERSION in server.js when the comp object changes.
const MARKET_SHAPE = 'v8-specfix';
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
// Shared secret for private (team) API endpoints — set VITE_TEAM_KEY in Netlify
// to match the backend's TEAM_API_KEY. Sent as x-vantage-key on team calls.
const TEAM_KEY = import.meta.env.VITE_TEAM_KEY || '';

// Clerk's token comes from a React hook, but teamHeaders() is a plain function
// called from dozens of non-component places. A module-level holder bridges the
// two: a component refreshes it, everything else reads it synchronously.
// Sending the team key alongside keeps older clients working during the
// switchover, and lets the backend accept whichever it can verify.
let CLERK_TOKEN = '';
export function setClerkToken(t){ CLERK_TOKEN = t || ''; }
const teamHeaders = (extra={}) => {
  const h = {...extra};
  if (CLERK_TOKEN) h['Authorization'] = `Bearer ${CLERK_TOKEN}`;
  if (TEAM_KEY) h['x-vantage-key'] = TEAM_KEY;
  return h;
};

// Safely parse a fetch Response as JSON. The backend (Railway) can return an
// HTML page instead of JSON — e.g. a 502/503 gateway page during a cold start,
// or a default error page if the server crashes. Calling res.json() on that
// throws the cryptic `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
// This reads the body as text first, detects an HTML response, and surfaces a
// clear, human-readable message instead.
async function parseJsonResponse(res, label = 'server') {
  const text = await res.text();
  const looksHtml = /^\s*</.test(text);
  if (looksHtml) {
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error(`The ${label} is waking up — please try again in a few seconds.`);
    }
    throw new Error(`The ${label} returned an unexpected response — please try again.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The ${label} returned an unreadable response — please try again.`);
  }
}

// NHTSA's Trim field can be a comma-separated list of candidate trims when the
// VIN doesn't pin down an exact one, e.g. "L, LE, LE w/Tech pkg, LE - US Source".
// Parse it into clean, distinct base trims the user can pick from.
function parseTrimOptions(rawTrim, rawSeries) {
  // Only use the Trim field for options; Series is often a generic code
  // ("18 Series", "F-Series") that isn't a real trim choice.
  const raw = rawTrim || ''
  if (!raw) return []
  const seen = new Set()
  const opts = []
  for (let part of raw.split(',')) {
    part = part.trim()
    if (!part) continue
    // Cut everything from "w/" onward, and drop "- US Source" style suffixes.
    let base = part.split(/w\//i)[0]
    base = base.split(/\s+-\s+/)[0]
    base = base.trim()
    if (!base) continue
    // NHTSA sometimes puts a body description in the Trim field ("Wagon Body
    // Style", "Sport Utility Vehicle"). Offering that as a trim is worse than
    // offering nothing: it gets sent to the comp search, matches no listing,
    // and the whole set silently widens to every version of the model.
    if (/\b(body style|body type|sport utility|utility vehicle|passenger car|wagon body|pickup body)\b/i.test(base)) continue
    const key = base.toLowerCase()
    if (!seen.has(key) && base.length <= 16) { seen.add(key); opts.push(base) }
  }
  return opts
}

// ── Manual Year/Make/Model/Trim entry (no VIN) ──
// Curated consumer auto brands (NHTSA's raw "all makes" list is 12k+ entries of
// trailer/custom shops — unusable for a dropdown). These are the brands a used
// car dealer actually appraises.
const MANUAL_MAKES = ['Acura','Alfa Romeo','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler','Dodge','Fiat','Ford','Genesis','GMC','Honda','Hyundai','Infiniti','Jaguar','Jeep','Kia','Land Rover','Lexus','Lincoln','Maserati','Mazda','Mercedes-Benz','MINI','Mitsubishi','Nissan','Polestar','Porsche','Ram','Subaru','Tesla','Toyota','Volkswagen','Volvo'];

// Cache NHTSA lookups so reopening a dropdown doesn't re-fetch (free API, but
// still avoid redundant calls).
const _nhtsaCache = { models: {}, trims: {} };

async function fetchModelsFor(year, make) {
  if (!year || !make) return [];
  const key = `${year}|${make}`.toLowerCase();
  if (_nhtsaCache.models[key]) return _nhtsaCache.models[key];
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformakeyear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`;
    const r = await fetch(url);
    const d = await r.json();
    const models = [...new Set((d.Results || []).map(m => m.Model_Name).filter(Boolean))].sort();
    _nhtsaCache.models[key] = models;
    return models;
  } catch { return []; }
}

// NHTSA can return candidate trims via GetCanadianVehicleSpecifications-style
// data, but the reliable free path is decodevin trims per model is sparse. We
// pull trims from the VPIC "GetModelsForMakeYear" + the trim list endpoint.
async function fetchTrimsFor(year, make, model) {
  if (!year || !make || !model) return [];
  const key = `${year}|${make}|${model}`.toLowerCase();
  if (_nhtsaCache.trims[key]) return _nhtsaCache.trims[key];
  try {
    // VPIC doesn't expose a clean trims-by-model endpoint; derive from VinAudit-
    // independent NHTSA "vehicle types"/series is unreliable. Best free trim
    // source: NHTSA's "GetCanadianVehicleSpecifications" lacks trims, so we fall
    // back to an empty list (trim becomes optional text). Kept as a hook so we
    // can wire a richer source later without touching the UI.
    _nhtsaCache.trims[key] = [];
    return [];
  } catch { return []; }
}

async function fetchMarketBySpec(specId, postal, radius = 250, drivetrain = '', trim = '') {
  if (!specId) throw new Error('Year, make and model required');
  if (!postal) throw new Error('Dealer postal code required (set it in Settings)');
  let url = `${API_BASE}/api/market-by-spec?spec_id=${encodeURIComponent(specId)}&postal=${encodeURIComponent(postal)}&radius=${radius}`;
  if (drivetrain) url += `&drivetrain=${encodeURIComponent(drivetrain)}`;
  if (trim) url += `&trim=${encodeURIComponent(trim)}`;
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { res = await fetch(url); break; }
    catch (e) { if (attempt === 1) throw e; await new Promise(r => setTimeout(r, 800)); }
  }
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return parseJsonResponse(res, 'market server');
}

// Build a VinAudit spec_id from parts: "2024_toyota_corolla_le" (trim optional).
function buildSpecId(year, make, model, trim) {
  const slug = s => (s || '').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const parts = [year, slug(make), slug(model)];
  if (trim) parts.push(slug(trim));
  return parts.filter(Boolean).join('_');
}

async function decodeVIN(vin) {
  const V = vin.toUpperCase();
  const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${V}?format=json`)
  if (!res.ok) throw new Error('Network error')
  const data = await res.json()
  let r = data.Results?.[0] || {}
  const codes = String(r.ErrorCode || '').split(',').map(s => s.trim());
  const noMatch = codes.includes('8') || codes.includes('11');
  const pick = (obj) => {
    const engineParts = [
      obj.DisplacementL ? `${parseFloat(obj.DisplacementL).toFixed(1)}L` : '',
      obj.EngineCylinders ? `${obj.EngineCylinders}-Cylinder` : '',
    ].filter(Boolean)
    const rawMake = obj.Make || ''
    return {
      year: obj.ModelYear || '', make: rawMake ? rawMake.charAt(0).toUpperCase() + rawMake.slice(1).toLowerCase() : '',
      model: obj.Model || '', series: obj.Series || obj.Trim || obj.Series2 || '',
      bodyType: obj.BodyClass || '', engine: engineParts.join(' '),
      transmission: obj.TransmissionStyle || '', drivetrain: obj.DriveType || '',
      extColour: '', intColour: '',
      _rawTrim: obj.Trim || '', _rawSeries: obj.Series || '',
    }
  }
  let out = pick(r);
  if (noMatch || !out.make || !out.model) {
    try {
      const res2 = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${V}?format=json`)
      if (res2.ok) {
        const d2 = await res2.json()
        const byVar = {}
        for (const row of (d2.Results || [])) {
          if (row.Value != null && row.Value !== '' && row.Value !== 'Not Applicable') byVar[row.Variable] = row.Value
        }
        const v2 = pick({
          ModelYear: byVar['Model Year'], Make: byVar['Make'], Model: byVar['Model'],
          Series: byVar['Series'] || byVar['Trim'], Series2: byVar['Series2'],
          BodyClass: byVar['Body Class'], DisplacementL: byVar['Displacement (L)'],
          EngineCylinders: byVar['Engine Number of Cylinders'],
          TransmissionStyle: byVar['Transmission Style'], DriveType: byVar['Drive Type'],
        })
        out = {
          year: out.year || v2.year, make: out.make || v2.make, model: out.model || v2.model,
          series: out.series || v2.series, bodyType: out.bodyType || v2.bodyType,
          engine: out.engine || v2.engine, transmission: out.transmission || v2.transmission,
          drivetrain: out.drivetrain || v2.drivetrain, extColour: '', intColour: '',
          _rawTrim: out._rawTrim || v2._rawTrim, _rawSeries: out._rawSeries || v2._rawSeries,
        }
      }
    } catch { /* best-effort */ }
  }
  if (!out.year && !out.make && !out.model) throw new Error('VIN not found')
  // NHTSA's Trim and Series fields are unreliable as trim levels — they carry
  // body classes ("Wagon Body Style") and generic codes ("F-Series"), which then
  // get sent to the comp search, match nothing, and silently widen the set to
  // every version of the model. They're kept only as picker suggestions; the
  // authoritative trim comes from NeoVIN below.
  const trimOptions = parseTrimOptions(out._rawTrim, out._rawSeries)
  out.trimOptions = trimOptions
  out.series = ''
  delete out._rawTrim; delete out._rawSeries

  // ── Upgrade with server-side data ──────────────────────────────
  // NHTSA is weak on trim (often blank for Japanese/Korean makes). The backend
  // has NeoVIN (confirmed trim) and can list the trims that actually exist in
  // the market, so the picker always offers real, comp-matching values.
  try {
    const [neoRes, trimRes] = await Promise.allSettled([
      fetch(`${API_BASE}/api/vin/${V}`).then(r => r.ok ? r.json() : null),
      out.make && out.model
        ? fetch(`${API_BASE}/api/trims?year=${encodeURIComponent(out.year||'')}&make=${encodeURIComponent(out.make)}&model=${encodeURIComponent(out.model)}`).then(r => r.ok ? r.json() : null)
        : Promise.resolve(null),
    ])
    const neo = neoRes.status === 'fulfilled' && neoRes.value && neoRes.value.data
    const list = trimRes.status === 'fulfilled' && trimRes.value && Array.isArray(trimRes.value.trims) ? trimRes.value.trims : []
    // Real market trims become the dropdown options (superset of NHTSA's guess).
    if (list.length) {
      const merged = [...list]
      for (const t of out.trimOptions || []) if (!merged.some(m => m.toLowerCase() === t.toLowerCase())) merged.push(t)
      out.trimOptions = merged
    }
    if (neo) {
      // NeoVIN's confirmed trim wins when we don't already have a clean one.
      // NeoVIN's trim is authoritative — it's a real trim level, where NHTSA
      // may have supplied a body description. Overwrite unless the user has
      // already chosen something themselves.
      if (neo.series) out.series = neo.series
      // Fill any gaps NHTSA left.
      if (neo.engine && !out.engine) out.engine = neo.engine
      if (neo.transmission && !out.transmission) out.transmission = neo.transmission
      if (neo.drivetrain && !out.drivetrain) out.drivetrain = neo.drivetrain
      // Colour intentionally NOT auto-filled — not VIN-encoded, decoder guesses
      // it and is often wrong. Appraiser enters what they see.
      // Make sure the confirmed trim is offered in the list.
      if (neo.series && !(out.trimOptions||[]).some(t => t.toLowerCase() === neo.series.toLowerCase())) {
        out.trimOptions = [neo.series, ...(out.trimOptions || [])]
      }
    }
  } catch { /* best-effort — NHTSA result still stands */ }
  return out
}

async function generateDescription(v, dealer) {
  // Build the multimodal message: vehicle facts + any photos (vision).
  const facts = [v.year,v.make,v.model,v.series,v.engine,v.drivetrain,v.extColour&&`Exterior: ${v.extColour}`,v.intColour&&`Interior: ${v.intColour}`,v.odometer&&`${fmtN(v.odometer)} km`].filter(Boolean).join(', ');
  const dealerCity = [dealer?.city, dealer?.province].filter(Boolean).join(', ');
  const dealerExcerpt = (dealer?.aboutExcerpt||'').trim();
  const photos = (v.photos||[]).filter(p=>p&&p.dataUrl&&/^data:image\//.test(p.dataUrl)).slice(0,6);
  const content = [];
  for (const p of photos) {
    const m = /^data:(image\/[a-zA-Z+]+);base64,(.*)$/.exec(p.dataUrl);
    if (m) content.push({type:'image',source:{type:'base64',media_type:m[1],data:m[2]}});
  }
  const hasPhotos = content.length>0;

  // ── Verified selling points (only what the DATA supports) ──
  const selling = [];
  // Low km: only if we can compare to the market and it's genuinely below median.
  const odo = Number(v.odometer);
  const medKm = Number(v.medianCompMileage ?? v._medianCompMileage);
  if (Number.isFinite(odo) && Number.isFinite(medKm) && medKm > 0 && odo < medKm * 0.9) {
    selling.push(`low kilometres (this unit's ${fmtN(odo)} km is below the ~${fmtN(medKm)} km typical of comparable listings)`);
  }
  // Carfax-derived claims — ONLY if Carfax is actually pulled and shows it.
  const cfx = v.carfax;
  if (cfx) {
    if (cfx.clean === true || cfx.accidents === 0) selling.push('no reported accidents (per Carfax)');
    if (cfx.owners === 1) selling.push('one owner (per Carfax)');
    if (cfx.service_records && Number(cfx.service_records) > 0) selling.push('service history on file (per Carfax)');
  }
  // CPO / certified, if flagged on the vehicle.
  if (v.certified) selling.push('certified pre-owned');

  content.push({type:'text',text:
`You are an expert automotive copywriter helping a Canadian used-car dealership write a vehicle listing. ${hasPhotos?`You are given ${content.length-0} photo(s) of THIS exact vehicle plus its known data.`:'You are given the vehicle data (no photos provided).'}

Vehicle: ${facts}
Known features already on file: ${v.features?.join(', ')||'none listed'}
Notes: ${v.notes||'none'}
VERIFIED selling points you MAY use (these are backed by data — use the relevant ones naturally): ${selling.length?selling.join('; '):'none verified — do NOT claim low km, accident-free, or one-owner status'}

CRITICAL ACCURACY RULES — a wrong claim in a published ad creates liability for the dealer:
- OPTIONS: List ONLY equipment that is genuinely STANDARD on this EXACT trim, PLUS anything you can clearly SEE in the photos. Do NOT list options that "usually" or "typically" or "may" come on this model. If you are not certain it is standard on this specific trim (or visible in a photo), DO NOT list it. A shorter, correct list is required over a longer, speculative one.
- SELLING PHRASES: You may ONLY use "low kilometres", "no accidents"/"clean history", "one owner", or "certified" if they appear in the VERIFIED selling points above. If a claim is not in that list, you MUST NOT state it.
- Never invent colours, packages, or history.

Write the DESCRIPTION to be sales-oriented and SEO-friendly for AutoTrader/CarGurus:
- Lead with the year/make/model/trim (good for search).
- Weave in the key standard features/options so the description is information-rich (buyers and search engines reward detail).
- Naturally include the VERIFIED selling phrases (e.g. "low kilometres", "no reported accidents", "one owner") where applicable — these help trigger marketplace value badges.
${dealerCity?`- Reference the dealership's location as "${dealerCity}" (e.g. "available now in ${dealerCity}") instead of a generic "Canada" — local SEO matters.`:'- Do not invent a specific city; keep location general if none is given.'}
${dealerExcerpt?`- Work in this dealership's own positioning naturally (do not quote it verbatim or let it dominate): "${dealerExcerpt}"`:''}
- Compelling and professional, but honest. No emojis. 4-6 sentences is fine here (richer is better for SEO), up to ~600 characters.

Respond with STRICT JSON only — no prose, no markdown:
{
  "description": "the rich, sales-oriented, SEO-friendly description following all rules above",
  "options": ["ONLY verified-standard-for-this-trim or clearly-visible-in-photo equipment — no guesses"],
  "damageFlags": [${hasPhotos?'"POSSIBLE visible damage or wear in the photos for the appraiser to VERIFY IN PERSON (e.g. a possible scratch on the rear bumper, curb rash on a front wheel). Flags to check, NOT a condition assessment. Empty array if nothing notable."':''}]
}`});

  const res = await fetch(`${API_BASE}/api/claude`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    model:'claude-sonnet-4-6',
    max_tokens:900,
    messages:[{role:'user',content}]
  })});
  const data = await parseJsonResponse(res, 'AI server');
  if (data.error) throw new Error(data.error.message||'AI error');
  let txt = data.content?.[0]?.text?.trim()||'';
  txt = txt.replace(/```json|```/g,'').trim();
  let parsed;
  try { parsed = JSON.parse(txt); }
  catch(e){ // Fallback: if the model returned plain prose, use it as the description.
    return { description: txt, options: [], damageFlags: [] };
  }
  return {
    description: String(parsed.description||'').trim(),
    options: Array.isArray(parsed.options)?parsed.options.map(s=>String(s).slice(0,60)).filter(Boolean):[],
    damageFlags: Array.isArray(parsed.damageFlags)?parsed.damageFlags.map(s=>String(s).slice(0,80)).filter(Boolean):[],
  };
}

// Real market data via VinAudit (Canadian comps). Needs vin + dealer postal.
async function fetchMarketData(vin, postal, radius = 250, drivetrain = '', trim = '') {
  if (!vin || vin.length !== 17) throw new Error('Valid VIN required');
  if (!postal) throw new Error('Dealer postal code required (set it in Settings)');
  let url = `${API_BASE}/api/market/${vin}?postal=${encodeURIComponent(postal)}&radius=${radius}`;
  if (drivetrain) url += `&drivetrain=${encodeURIComponent(drivetrain)}`;
  if (trim) url += `&trim=${encodeURIComponent(trim)}`;
  // Fetch with one retry — Railway can cold-start, dropping the first request.
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { res = await fetch(url); break; }
    catch (netErr) {
      if (attempt === 1) throw new Error('Could not reach the market server — check your connection and try again.');
      await new Promise(r => setTimeout(r, 1500)); // brief pause, then retry once
    }
  }
  const data = await parseJsonResponse(res, 'market server');
  if (!res.ok || data.error) {
    const e = String(data.error || 'Market lookup failed');
    if (/spec_vin|invalid vin|not found/i.test(e)) throw new Error("This VIN isn't recognized by the market database — check the VIN or enter comps manually.");
    throw new Error(e);
  }
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
  // Calls the backend Carfax route. Returns mock until Carfax credentials are
  // configured server-side, at which point this same call returns real data
  // (no frontend change needed).
  const res = await fetch(`${API_BASE}/api/carfax/${vin}`);
  if (!res.ok) throw new Error(`Carfax error ${res.status}`);
  return parseJsonResponse(res, 'Carfax service');
}

// Live competitive set — renders real VinAudit listings with clickable links.
// Pulls and shows vehicle history for any comp's VIN (e.g. to check whether a
// competitor's advertised car has reported accidents). Uses the same backend
// history route as the subject vehicle — returns mock until Carfax is configured.
function CompHistoryModal({ vin, onClose }){
  const [state,setState] = useState({status:'loading'});
  useEffect(()=>{
    let cancelled=false;
    fetchCarfax(vin).then(d=>{ if(!cancelled) setState({status:'done',data:d}); })
      .catch(()=>{ if(!cancelled) setState({status:'error'}); });
    return ()=>{cancelled=true;};
  },[vin]);
  const d = state.data;
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9998,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:12,maxWidth:380,width:'100%',overflow:'hidden',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
        <div style={{padding:'14px 18px',background:C.navy,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:14,fontWeight:800,color:'#fff'}}>Vehicle History</div>
            <div style={{fontSize:10,fontFamily:'monospace',color:'rgba(255,255,255,0.6)',marginTop:1}}>{vin}</div>
          </div>
          <button onClick={onClose} style={{background:'rgba(255,255,255,0.12)',border:'none',borderRadius:7,width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}><X size={16} color="#fff"/></button>
        </div>
        <div style={{padding:'18px'}}>
          {state.status==='loading'&&<div style={{textAlign:'center',padding:'20px',color:C.textLight,fontSize:13}}>Pulling history…</div>}
          {state.status==='error'&&<div style={{textAlign:'center',padding:'20px',color:C.red,fontSize:13}}>Couldn't pull history for this VIN.</div>}
          {state.status==='done'&&d&&<>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,padding:'10px 12px',borderRadius:8,background:d.clean?C.greenBg:C.redBg}}>
              <ShieldCheck size={18} color={d.clean?C.green:C.red}/>
              <span style={{fontWeight:700,fontSize:13,color:d.clean?C.green:C.red}}>{d.clean?'Clean history reported':'Issues reported'}</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              {[['Accidents',d.accidents],['Previous Owners',d.owners],['Service Records',d.service_records],['Last Odometer',d.last_reported_odometer?fmtN(d.last_reported_odometer)+' km':'—']].map(([k,v])=>(
                <div key={k} style={{background:C.navyMuted,borderRadius:7,padding:'9px 11px'}}>
                  <div style={{fontSize:9,color:C.textLight,fontWeight:600,textTransform:'uppercase',letterSpacing:0.4,marginBottom:3}}>{k}</div>
                  <div style={{fontSize:15,fontWeight:800,color:C.navy}}>{v}</div>
                </div>
              ))}
            </div>
            {d._source==='mock'&&<div style={{marginTop:12,fontSize:10,color:C.textLight,lineHeight:1.5}}>Sample data — connect a Carfax Canada account in Settings to pull real reports.</div>}
            {d.report_url&&<a href={d.report_url} target="_blank" rel="noopener noreferrer" style={{display:'block',marginTop:12,textAlign:'center',padding:'10px',background:C.navy,color:'#fff',borderRadius:8,fontSize:13,fontWeight:700,textDecoration:'none'}}>Open full report ↗</a>}
          </>}
        </div>
      </div>
    </div>
  );
}

function CompSet({ comps, myPrice, myKm, myDays, subjectTrim }) {
  // When too few same-trim comps exist the search widens to the whole model,
  // and the resulting average spans cars that don't sell for the same money.
  // Marking which comps aren't the subject's trim lets the appraiser weigh that
  // himself instead of taking the average on trust.
  const norm = t => (t||'').toString().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const subj = norm(subjectTrim);
  const trimDiffers = c => {
    const ct = norm(c.trim);
    if (!subj || !ct) return false;
    return ct !== subj && !ct.includes(subj) && !subj.includes(ct);
  };
  const [historyVin, setHistoryVin] = useState(null);
  const [openRow, setOpenRow] = useState(null);
  const onHistory = (vin) => setHistoryVin(vin);
  const [sort, setSort] = useState({ key: 'price', dir: 'asc' });
  // Both comp sections collapsed by default so they don't fill the page.
  const [openSec, setOpenSec] = useState({ listed: true, sold: false });
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
  const cell = {padding:'7px 12px'};
  const block = (heading, rows, mode, showMine, badge, secKey) => {
    const isOpen = !!openSec[secKey];
    // Subtle identity per block: live listings (blue) vs recently sold (green),
    // so the two comp tables are easy to tell apart at a glance.
    const tint = mode==='sold' ? {bar:C.green,head:C.greenBg,ic:C.green} : {bar:C.blue,head:C.blueBg,ic:C.blue};
    return (
    <div style={{background:'#fff',border:`1px solid ${C.border}`,borderLeft:`3px solid ${tint.bar}`,borderRadius:10,overflow:'hidden',marginBottom:10}}>
      <div onClick={()=>setOpenSec(s=>({...s,[secKey]:!s[secKey]}))} style={{padding:'10px 14px',borderBottom:isOpen?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',cursor:'pointer',userSelect:'none',background:tint.head}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <ChevronRight size={15} color={tint.ic} style={{transform:isOpen?'rotate(90deg)':'none',transition:'transform 0.15s'}}/>
          <span style={{fontWeight:700,fontSize:13,color:tint.ic}}>{heading}{heading?<span style={{color:C.textLight,fontWeight:500}}> ({rows.length})</span>:null}</span>
        </div>
        {badge}
      </div>
      {isOpen&&<><div className="comp-table-wrap" style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr style={{background:C.navyMuted}}>{[
            {label:'Price',key:'price'},
            {label:'Trim',key:'trim'},
            {label:'KM',key:'mileage'},
            {label:mode==='sold'?'Sold (days ago)':'Days',key:'days'},
            {label:'Location',key:'location'},
            {label:'Dealer',key:null},
            {label:'',key:null},
          ].map((h,i)=>(
            <th key={i} onClick={h.key?()=>toggleSort(h.key):undefined} style={{padding:'7px 12px',textAlign:'left',fontSize:10,fontWeight:600,color:sort.key===h.key?C.navy:C.textLight,borderBottom:`1px solid ${C.border}`,whiteSpace:'nowrap',cursor:h.key?'pointer':'default',userSelect:'none'}}>
              {h.label}{h.key&&sort.key===h.key&&<span style={{marginLeft:3}}>{sort.dir==='asc'?'▲':'▼'}</span>}
            </th>
          ))}</tr></thead>
          <tbody>
            {(()=>{
              const mine = (showMine && mode==='listed') ? {__mine:true,price:mp||null,mileage:myKm?Number(myKm):null,days:myDays?Number(myDays):null,id:'__myvehicle'} : null;
              const merged = mine ? [...rows, mine] : rows;
              return sortRows(merged,mode).map((c,i)=>{
              if(c.__mine){
                return (
                  <tr key="__myvehicle" style={{background:C.tealMuted,outline:`2px solid ${C.teal}`,outlineOffset:'-2px'}}>
                    <td style={{...cell,fontFamily:'monospace',fontWeight:800,color:C.teal,whiteSpace:'nowrap'}}>{mp?fmt(mp):'No price'}</td>
                    <td style={{...cell,fontFamily:'monospace',fontWeight:700,color:C.teal}}>{myKm?fmtN(myKm):'—'}</td>
                    <td style={{...cell,fontWeight:700,color:C.teal}}>{myDays?myDays:'—'}</td>
                    <td style={{...cell,color:C.teal}}>—</td>
                    <td style={{...cell,fontWeight:800,color:C.teal}} colSpan={2}>★ Your Vehicle</td>
                  </tr>
                );
              }
              const ago=mode==='sold'?soldAgo(c.dropDate):null;
              return (
            <React.Fragment key={c.id||i}>
              <tr style={{borderTop:`1px solid ${C.border}`}}>
                <td style={{...cell,fontFamily:'monospace',fontWeight:600,color:C.textDark,whiteSpace:'nowrap'}}>{fmt(c.price)}{c.certified&&<span style={{marginLeft:6,fontSize:9,fontWeight:700,color:C.green,background:C.greenBg,padding:'1px 5px',borderRadius:8}}>CPO</span>}</td>
                {/* Amber where the trim isn't the subject's — a widened search
                    averages cars that don't sell for the same money, and this
                    is what makes that visible rather than buried in the mean. */}
                <td style={{...cell,color:trimDiffers(c)?C.orange:C.textMid,maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={c.trim||''}>
                  {c.trim||'—'}
                </td>
                <td style={{...cell,fontFamily:'monospace',color:C.textMid,whiteSpace:'nowrap'}}>{c.mileage?fmtN(c.mileage):'—'}</td>
                {mode==='sold'
                  ? <td style={{...cell,whiteSpace:'nowrap',fontWeight:600,color:ago!=null&&ago<=14?C.green:C.textMid}}>{ago!=null?ago:'—'}</td>
                  : <td style={{...cell,whiteSpace:'nowrap',color:c.days>45?C.orange:C.textMid}}>{c.days?c.days:'—'}</td>}
                <td style={{...cell,color:C.textLight,whiteSpace:'nowrap'}}>{[c.city,c.region].filter(Boolean).join(', ')||'—'}</td>
                {/* Dealer only. The VIN, its copy control, the price-history
                    link, the source domain and the portal badges were five
                    extra things on every row — they live in the expanded row
                    now, one click away. */}
                <td style={{...cell,color:C.textDark}}>
                  <span style={{color:C.textDark}}>{c.dealer}</span>
                  {/private/i.test(c.sellerType||'')&&<span style={{marginLeft:6,fontSize:10,color:C.textLight}}>private</span>}
                </td>
                <td style={{...cell,whiteSpace:'nowrap',textAlign:'right'}}>
                  <button onClick={()=>setOpenRow(openRow===(c.id||i)?null:(c.id||i))}
                    style={{background:'none',border:'none',padding:0,fontSize:11.5,color:C.textLight,cursor:'pointer',fontFamily:'inherit'}}>
                    {openRow===(c.id||i)?'Less':'More'}
                  </button>
                </td>
              </tr>
              {openRow===(c.id||i)&&(
                <tr key={(c.id||i)+'-x'}>
                  <td colSpan={7} style={{padding:'0 12px 12px',borderBottom:`1px solid ${C.border}`}}>
                    <div style={{fontSize:12,color:C.textMid,lineHeight:1.7}}>
                      {c.vin&&<div style={{fontFamily:'monospace',fontSize:11.5,letterSpacing:0.3}}>{c.vin}</div>}
                      {/* Asking-price history — what the seller has done with this
                          listing, which is more use than a paid history report
                          on somebody else's car. */}
                      {Number.isFinite(c.priceChangePct)&&c.priceChangePct!==0?(
                        <div style={{marginTop:3,color:c.priceChangePct<0?C.orange:C.textMid}}>
                          Asking price {c.priceChangePct<0?'cut':'raised'} {Math.abs(c.priceChangePct)}%
                          {c.prevPrice?` — was ${fmt(c.prevPrice)}, now ${fmt(c.price)}`:''}
                        </div>
                      ):(
                        <div style={{marginTop:3,color:C.textLight}}>
                          No price change recorded{c.days?` in ${c.days} days listed`:''}
                        </div>
                      )}
                      <div style={{display:'flex',gap:16,flexWrap:'wrap',marginTop:6}}>
                        {c.url&&<a href={c.url} target="_blank" rel="noopener noreferrer" style={{color:C.navy,fontSize:12,textDecoration:'none',fontWeight:600}}>Open listing ↗</a>}
                        {c.vin&&<button onClick={()=>{navigator.clipboard?.writeText(c.vin);}} style={{background:'none',border:'none',padding:0,fontSize:12,color:C.textMid,cursor:'pointer',fontFamily:'inherit'}}>Copy VIN</button>}
  
                        {Array.isArray(c.portals)&&c.portals.map(pt=>(
                          <a key={pt.name} href={pt.url} target="_blank" rel="noopener noreferrer" style={{color:C.textMid,fontSize:12,textDecoration:'none'}}>{pt.name} ↗</a>
                        ))}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
            );});})()}
          </tbody>
        </table>
      </div>
      {/* Mobile: stacked cards instead of a horizontally-scrolling table */}
      <div className="comp-cards" style={{display:'none',flexDirection:'column'}}>
        {(()=>{
          const mine = (showMine && mode==='listed') ? {__mine:true,price:mp||null,mileage:myKm?Number(myKm):null,days:myDays?Number(myDays):null,id:'__myvehicle'} : null;
          const merged = mine ? [...rows, mine] : rows;
          return sortRows(merged,mode).map((c,i)=>{
            if(c.__mine){
              return (
                <div key="__myvehicle" style={{padding:'10px 14px',borderTop:`1px solid ${C.border}`,background:C.tealMuted,borderLeft:`3px solid ${C.teal}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontWeight:800,color:C.teal,fontSize:13}}>★ Your Vehicle</span>
                    <span style={{fontFamily:'monospace',fontWeight:800,color:C.teal,fontSize:15}}>{mp?fmt(mp):'No price'}</span>
                  </div>
                  <div style={{display:'flex',gap:12,marginTop:4,fontSize:11,color:C.teal}}>
                    <span>{myKm?fmtN(myKm)+' km':'— km'}</span>{myDays&&<span>{myDays} days</span>}
                  </div>
                </div>
              );
            }
            const ago=mode==='sold'?soldAgo(c.dropDate):null;
            return (
              <div key={c.id||i} style={{padding:'11px 14px',borderTop:`1px solid ${C.border}`}}>
                {/* Two lines: the price, then everything that qualifies it.
                    VIN, copy and history are one tap away rather than four
                    controls competing on every row. */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8}}>
                  <span style={{fontWeight:700,fontSize:16,color:C.textDark,letterSpacing:-0.3}}>
                    {fmt(c.price)}{c.certified&&<span style={{marginLeft:6,fontSize:10,fontWeight:600,color:C.textLight}}>CPO</span>}
                  </span>
                  <button onClick={()=>setOpenRow(openRow===(c.id||i)?null:(c.id||i))}
                    style={{background:'none',border:'none',padding:0,fontSize:12,color:C.textLight,cursor:'pointer',fontFamily:'inherit',flexShrink:0}}>
                    {openRow===(c.id||i)?'Less':'More'}
                  </button>
                </div>
                {/* Trim first: when the search has widened past the subject's
                    trim, an average across unlike cars is only trustworthy if
                    you can see what went into it. Differing trims are marked. */}
                {c.trim&&(
                  <div style={{marginTop:2,fontSize:12.5,fontWeight:600,color:trimDiffers(c)?C.orange:C.textDark}}>
                    {c.trim}{trimDiffers(c)&&<span style={{fontWeight:400}}> · different trim</span>}
                  </div>
                )}
                <div style={{marginTop:3,fontSize:12.5,color:C.textMid,lineHeight:1.5}}>
                  {[c.mileage?fmtN(c.mileage)+' km':null,
                    mode==='sold'?(ago!=null?`sold ${ago}d ago`:null):(c.days?`${c.days} days listed`:null),
                    c.dealer,
                   ].filter(Boolean).join(' · ')}
                  {Number.isFinite(c.priceChangePct)&&c.priceChangePct<0&&(
                    <span style={{color:C.orange}}>{` · cut ${Math.abs(c.priceChangePct)}%`}</span>
                  )}
                </div>
                {openRow===(c.id||i)&&(
                  <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`,fontSize:12,color:C.textMid,lineHeight:1.7}}>
                    <div>{[c.city,c.region].filter(Boolean).join(', ')||'Location not listed'}{/private/i.test(c.sellerType||'')?' · private seller':''}</div>
                    {c.vin&&<div style={{fontFamily:'monospace',fontSize:11.5,letterSpacing:0.3}}>{c.vin}</div>}
                    {/* Asking-price history — what the seller has done with this
                        listing, which is more use than a paid history report
                        on somebody else's car. */}
                    {Number.isFinite(c.priceChangePct)&&c.priceChangePct!==0?(
                      <div style={{marginTop:3,color:c.priceChangePct<0?C.orange:C.textMid}}>
                        Asking price {c.priceChangePct<0?'cut':'raised'} {Math.abs(c.priceChangePct)}%
                        {c.prevPrice?` — was ${fmt(c.prevPrice)}, now ${fmt(c.price)}`:''}
                      </div>
                    ):(
                      <div style={{marginTop:3,color:C.textLight}}>
                        No price change recorded{c.days?` in ${c.days} days listed`:''}
                      </div>
                    )}
                    <div style={{display:'flex',gap:14,marginTop:6,flexWrap:'wrap'}}>
                      {c.url&&<a href={c.url} target="_blank" rel="noopener noreferrer" style={{color:C.navy,fontSize:12,textDecoration:'none',fontWeight:600}}>Open listing ↗</a>}
                      {c.vin&&<button onClick={()=>{navigator.clipboard?.writeText(c.vin);}} style={{background:'none',border:'none',padding:0,fontSize:12,color:C.textMid,cursor:'pointer',fontFamily:'inherit'}}>Copy VIN</button>}

                    </div>
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div></>}
    </div>
    );
  };
  return (
    <div>
      {historyVin&&<CompHistoryModal vin={historyVin} onClose={()=>setHistoryVin(null)}/>}
      {active.length>0&&block('', active, 'listed', true, myRank&&<span style={{fontSize:11,fontFamily:'monospace',color:C.teal,background:C.tealMuted,padding:'2px 10px',borderRadius:12}}>Your price ranks #{myRank} of {active.length+1}</span>, 'listed')}
      {sold.length>0&&block('Recently Sold · likely', sold, 'sold', false, <span style={{fontSize:10,color:C.textLight}} title="Listing dropped off the market — usually sold, not guaranteed">last 45 days</span>, 'sold')}
    </div>
  );
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────
function Btn({children,onClick,variant='primary',size='md',disabled,full,style:sx={},className}) {
  const S={sm:{padding:'6px 14px',fontSize:12},md:{padding:'9px 20px',fontSize:13},lg:{padding:'12px 28px',fontSize:14}};
  const V={primary:{background:C.navy,color:'#fff',border:'none'},teal:{background:C.teal,color:'#fff',border:'none'},ghost:{background:'transparent',color:C.textMid,border:`1px solid ${C.borderStr}`},danger:{background:C.red,color:'#fff',border:'none'},success:{background:C.green,color:'#fff',border:'none'},outline:{background:'#fff',color:C.navy,border:`1.5px solid ${C.navy}`}};
  return <button className={className} onClick={onClick} disabled={disabled} style={{...S[size],...V[variant],borderRadius:6,fontWeight:600,cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.5:1,display:'inline-flex',alignItems:'center',gap:6,fontFamily:'inherit',transition:'all 0.15s',width:full?'100%':undefined,justifyContent:full?'center':undefined,...sx}}>{children}</button>;
}
function Input({value,onChange,placeholder,type='text',style:sx={},autoFocus}) {
  return <input type={type} autoFocus={autoFocus} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:'100%',padding:'8px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,color:C.textDark,fontFamily:'inherit',outline:'none',boxSizing:'border-box',...sx}} onFocus={e=>e.target.style.borderColor=C.navy} onBlur={e=>e.target.style.borderColor=C.borderStr}/>;
}
function Sel({value,onChange,options,placeholder}) {
  return <select value={value} onChange={e=>onChange(e.target.value)} style={{width:'100%',padding:'8px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,color:value?C.textDark:C.textLight,fontFamily:'inherit',outline:'none',appearance:'none'}}><option value="">{placeholder||'Select...'}</option>{options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}</select>;
}
// Shown when no VIN is entered: typo-proof Year/Make/Model dropdowns (NHTSA),
// plus an optional Trim. Writes year/make/model/series onto the record and can
// fetch market data by spec_id (no VIN needed). makes are curated; models load
// from NHTSA for the chosen year+make.
function ManualVehicleEntry({ data, onSet, postal, onMarket, busy }) {
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const years = [];
  for (let y = new Date().getFullYear() + 1; y >= 1995; y--) years.push(String(y));

  useEffect(() => {
    let cancelled = false;
    if (data.year && data.make) {
      setLoadingModels(true);
      fetchModelsFor(data.year, data.make).then(ms => { if (!cancelled) { setModels(ms); setLoadingModels(false); } });
    } else { setModels([]); }
    return () => { cancelled = true; };
  }, [data.year, data.make]);

  const canFetch = data.year && data.make && data.model && postal;
  return (
    <div style={{marginTop:10,padding:'12px',background:C.navyMuted,borderRadius:8,border:`1px dashed ${C.navyBorder}`}}>
      <div style={{fontSize:11,fontWeight:700,color:C.navy,marginBottom:8,display:'flex',alignItems:'center',gap:6}}><Car size={13}/>No VIN? Select the vehicle</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8}}>
        <div>
          <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Year</label>
          <Sel value={data.year} onChange={v=>{onSet({year:v,model:'',series:''});}} options={years} placeholder="Select year"/>
        </div>
        <div>
          <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Make</label>
          <Sel value={data.make} onChange={v=>{onSet({make:v,model:'',series:''});}} options={MANUAL_MAKES} placeholder="Select make"/>
        </div>
        <div>
          <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Model {loadingModels&&<span style={{color:C.textLight}}>loading…</span>}</label>
          <Sel value={data.model} onChange={v=>onSet({model:v,series:''})} options={models} placeholder={!data.year||!data.make?'Pick year & make first':(models.length?'Select model':'No models found')}/>
        </div>
        <div>
          <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Trim <span style={{color:C.textLight,fontWeight:400}}>(optional)</span></label>
          <Input value={data.series} onChange={v=>onSet({series:v})} placeholder="e.g. LE, XLT"/>
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8,marginTop:10}}>
        <Btn onClick={onMarket} disabled={!canFetch||busy} size="sm"><TrendingUp size={12} style={{animation:busy?'spin 1s linear infinite':undefined}}/>{busy?'Fetching…':'Fetch Market Data'}</Btn>
        {!postal&&<span style={{fontSize:10,color:C.orange}}>Set dealer postal in Settings first</span>}
        {!data.model&&data.year&&data.make&&<span style={{fontSize:10,color:C.textLight}}>Pick a model to continue</span>}
      </div>
    </div>
  );
}

// Trim picker: when the VIN decode returns multiple candidate trims, show a
// dropdown (with an "Other…" escape to type a custom value); otherwise a plain
// editable input, for when the decode can't pin the exact trim.
// One menu for every page-level action. Keeps the header to a single line and
// stops secondary actions competing with the work for attention.
function ActionMenu({items}){
  const [open,setOpen]=useState(false);
  const ref=useRef(null);
  useEffect(()=>{
    if(!open) return;
    const close=e=>{ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown',close);
    return()=>document.removeEventListener('mousedown',close);
  },[open]);
  const shown=(items||[]).filter(Boolean);
  if(!shown.length) return null;
  return (
    <div ref={ref} style={{position:'relative',flexShrink:0}}>
      <button onClick={()=>setOpen(o=>!o)} aria-label="Actions" aria-expanded={open}
        style={{background:'none',border:'none',padding:6,margin:-6,color:C.textMid,cursor:'pointer',display:'flex',alignItems:'center'}}>
        <MoreVertical size={20}/>
      </button>
      {open&&(
        <div style={{position:'absolute',right:0,top:'calc(100% + 6px)',background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,boxShadow:'0 8px 28px rgba(0,0,0,0.14)',minWidth:190,zIndex:60,overflow:'hidden'}}>
          {shown.map((it,i)=>(
            <button key={i} onClick={()=>{setOpen(false);it.onClick&&it.onClick();}}
              style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'11px 14px',background:'none',border:'none',borderBottom:i<shown.length-1?`1px solid ${C.border}`:'none',fontSize:13,color:C.textDark,fontFamily:'inherit',cursor:'pointer',textAlign:'left'}}>
              {it.icon&&<it.icon size={15} color={C.textMid}/>}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TrimField({value,onChange,options}){
  const opts = Array.isArray(options) ? options : [];
  // Show the picker whenever we have real options to offer — not just when the
  // decode was ambiguous. The appraiser can always switch to free text.
  const multi = opts.length > 0;
  const [custom,setCustom] = useState(false);
  const inList = opts.some(o=>o.toLowerCase()===(value||'').toLowerCase());
  if(!multi && !custom){
    return <Input value={value} onChange={onChange} placeholder=""/>;
  }
  if(custom || (value && !inList)){
    return (
      <div style={{display:'flex',gap:4}}>
        <Input value={value} onChange={onChange} placeholder="Type trim"/>
        {multi&&<button onClick={()=>{setCustom(false);onChange(opts[0]||'');}} title="Back to list" style={{flexShrink:0,padding:'0 8px',border:`1px solid ${C.borderStr}`,borderRadius:6,background:'#fff',cursor:'pointer',color:C.textMid,fontSize:11}}>↩</button>}
      </div>
    );
  }
  return (
    <select value={inList?value:''} onChange={e=>{ if(e.target.value==='__other'){setCustom(true);onChange('');} else onChange(e.target.value); }}
      style={{width:'100%',padding:'8px 12px',background:'#fff',border:`1px solid ${value?C.navy:C.orange}`,borderRadius:6,fontSize:13,color:value?C.textDark:C.textLight,fontFamily:'inherit',outline:'none',appearance:'none'}}>
      <option value="">Select trim…</option>
      {opts.map(o=><option key={o} value={o}>{o}</option>)}
      <option value="__other">Other / type manually…</option>
    </select>
  );
}

function Field({label,children,half,third}) {
  return <div style={{flex:third?'0 0 calc(33.3% - 8px)':half?'0 0 calc(50% - 6px)':'1 1 100%',minWidth:0}}><label style={{display:'block',fontSize:11,fontWeight:600,color:C.textMid,marginBottom:5}}>{label}</label>{children}</div>;
}
function Card({children,style:sx={}}) {
  return <div style={{background:C.card,borderRadius:8,border:`1px solid ${C.border}`,boxShadow:'0 1px 4px rgba(0,0,0,0.06)',...sx}}>{children}</div>;
}
function Sec({title,icon:Icon,children,open:def=true,badge,accent,tone,hidden,bare}) {
  const [o,setO]=useState(def);
  // hidden: this section belongs to a page the user isn't on.
  // bare: the section IS the page, so it drops its header and box — the page
  // title above it already says what this is.
  if(hidden) return null;
  if(bare) return <div>{children}</div>;
  // tone gives a section a subtle identity: a soft tinted header + a colored
  // left edge, so sections are easy to tell apart without being loud.
  const TONES={
    navy:{bar:C.navy,head:C.navyMuted,ic:C.navy},
    teal:{bar:C.teal,head:C.tealMuted,ic:C.teal},
    purple:{bar:C.purple,head:C.purpleBg,ic:C.purple},
    blue:{bar:C.blue,head:C.blueBg,ic:C.blue},
    green:{bar:C.green,head:C.greenBg,ic:C.green},
    orange:{bar:C.orange,head:C.orangeBg,ic:C.orange},
  };
  const t=tone&&TONES[tone];
  const headBg=accent?C.navy:(t?t.head:'none');
  const iconColor=accent?'#fff':(t?t.ic:C.navy);
  const titleColor=accent?'#fff':(t?t.ic:C.textDark);
  return (
    <Card style={{marginBottom:12,overflow:'hidden',...(t&&!accent?{borderLeft:`3px solid ${t.bar}`}:{})}}>
      <button onClick={()=>setO(!o)} style={{width:'100%',padding:'12px 16px',background:headBg,border:'none',display:'flex',alignItems:'center',gap:8,cursor:'pointer',borderBottom:o?`1px solid ${C.border}`:'none'}}>
        {Icon&&<Icon size={14} color={iconColor}/>}
        <span style={{fontWeight:700,fontSize:13,color:titleColor,flex:1,textAlign:'left'}}>{title}</span>
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
  return <div className="app-toast" style={{position:'fixed',bottom:24,right:24,background:C.navy,color:'#fff',borderRadius:8,padding:'12px 18px',display:'flex',alignItems:'center',gap:10,boxShadow:'0 8px 32px rgba(0,0,0,0.25)',zIndex:9999,maxWidth:340,borderLeft:`4px solid ${c[type]||C.teal}`}}><span style={{fontSize:13,flex:1}}>{message}</span><button onClick={onClose} style={{background:'none',border:'none',color:'rgba(255,255,255,0.5)',cursor:'pointer'}}><X size={14}/></button></div>;
}
function CarfaxBadge({carfax,onFetch,loading,canPull=true}) {
  if(loading) return <div style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 12px',background:C.navyMuted,borderRadius:6,fontSize:12}}><RefreshCw size={12} color={C.navy} style={{animation:'spin 1s linear infinite'}}/>Fetching Carfax...</div>;
  if(!carfax) return canPull
    ? <button onClick={onFetch} style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 14px',background:C.navy,color:'#fff',border:'none',borderRadius:6,fontSize:12,fontWeight:600,cursor:'pointer'}}><FileSearch size={13}/>Pull History Report</button>
    : <div title="Requires the Purchase Carfax reports permission" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 14px',background:C.navyMuted,color:C.textLight,borderRadius:6,fontSize:12,fontWeight:600}}><FileSearch size={13}/>Carfax (no access)</div>;
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

        {/* Backup — the server has no automated copy, so this is the only one
            unless the hosting plan is upgraded. Put in Settings where someone
            will actually find it. */}
        <Card style={{padding:20}}>
          <div style={{fontWeight:700,fontSize:14,color:C.navy,marginBottom:6,display:'flex',alignItems:'center',gap:8}}>
            <Download size={15} color={C.navy}/>Backup
          </div>
          <div style={{fontSize:12.5,color:C.textMid,lineHeight:1.6,marginBottom:12}}>
            Downloads every appraisal, vehicle, lead and setting as a single file.
            Keep it somewhere other than this app — OneDrive, iCloud, an email to
            yourself. There is no automatic backup, so this is the only copy.
          </div>
          <Btn onClick={async()=>{
            try{
              const r=await fetch(`${API_BASE}/api/export`,{headers:teamHeaders()});
              if(!r.ok) throw new Error('failed');
              const blob=await r.blob();
              const url=URL.createObjectURL(blob);
              const a=document.createElement('a');
              a.href=url; a.download=`vantage-backup-${new Date().toISOString().slice(0,10)}.json`;
              document.body.appendChild(a); a.click(); a.remove();
              URL.revokeObjectURL(url);
            }catch{ alert('Could not download the backup. Check your connection and try again.'); }
          }}><Download size={13}/>Download backup</Btn>
          <div style={{fontSize:11.5,color:C.textLight,marginTop:10,lineHeight:1.5}}>
            Worth doing weekly, and before anything that changes a lot of records.
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
            <div>
              <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>About Your Dealership <span style={{fontWeight:400,color:C.textLight}}>(woven into AI listing descriptions)</span></label>
              <textarea value={d.aboutExcerpt||''} onChange={e=>set('aboutExcerpt',e.target.value)} rows={3} placeholder="e.g. Family-owned since 1998, every vehicle safety-certified, free home delivery across the GTA, financing for all credit situations." style={{width:'100%',padding:'8px 10px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:12,color:C.textDark,fontFamily:'inherit',outline:'none',boxSizing:'border-box',resize:'vertical',lineHeight:1.5}}/>
              <div style={{fontSize:10,color:C.textLight,marginTop:3}}>Your selling points — the AI works these into descriptions naturally. Keep it factual; it appears in published ads.</div>
            </div>
          </div>
        </Card>

        {/* Staff / Users + Permissions */}
        <Card style={{padding:20,gridColumn:'1/-1'}}>
          <div style={{fontWeight:700,fontSize:14,color:C.navy,marginBottom:4,display:'flex',alignItems:'center',gap:8}}><User size={15} color={C.navy}/>Staff & Permissions</div>
          <p style={{fontSize:12,color:C.textLight,marginBottom:14}}>These names appear in the top-bar user picker and are recorded on every change in the action log. Set what each person can do below. Anyone with no boxes checked has full access (so you're never locked out).</p>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>
            {(d.staff||[]).map((s,i)=>(
              <span key={i} style={{background:C.navyMuted,color:C.navy,borderRadius:20,padding:'5px 12px',fontSize:13,display:'inline-flex',alignItems:'center',gap:6}}>{s}<button onClick={()=>{const newStaff=(d.staff||[]).filter((_,j)=>j!==i);const newPerms={...(d.permissions||{})};delete newPerms[s];setD(p=>({...p,staff:newStaff,permissions:newPerms}));}} style={{background:'none',border:'none',color:C.navy,cursor:'pointer',padding:0,display:'flex'}}><X size={11}/></button></span>
            ))}
            {(!d.staff||d.staff.length===0)&&<span style={{fontSize:12,color:C.textLight}}>No staff added yet — defaults to Manager / Sales / Appraiser.</span>}
          </div>
          <div style={{display:'flex',gap:8,maxWidth:360,marginBottom:18}}>
            <input id="staff-add" placeholder="Add staff name, press Enter" onKeyDown={e=>{if(e.key==='Enter'&&e.target.value.trim()){set('staff',[...(d.staff||[]),e.target.value.trim()]);e.target.value='';e.preventDefault();}}} style={{flex:1,padding:'8px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontFamily:'inherit',outline:'none'}}/>
            <Btn variant="ghost" size="sm" onClick={()=>{const el=document.getElementById('staff-add');if(el?.value.trim()){set('staff',[...(d.staff||[]),el.value.trim()]);el.value='';}}}><Plus size={13}/>Add</Btn>
          </div>

          {/* Permission matrix: staff (rows) × permissions (columns/checkboxes) */}
          {(d.staff||[]).length>0&&(
            <div style={{overflowX:'auto'}}>
              <div style={{fontSize:12,fontWeight:700,color:C.textMid,marginBottom:10}}>Permissions</div>
              {(d.staff||[]).map(name=>{
                const userPerms=(d.permissions||{})[name];
                const hasExplicit=!!userPerms;
                const toggle=(key)=>{
                  setD(p=>{
                    const perms={...(p.permissions||{})};
                    const cur={...(perms[name]||{})};
                    if(cur[key]) delete cur[key]; else cur[key]=true;
                    perms[name]=cur;
                    return {...p,permissions:perms};
                  });
                };
                const setFullAccess=()=>{
                  setD(p=>{const perms={...(p.permissions||{})};delete perms[name];return {...p,permissions:perms};});
                };
                return (
                  <div key={name} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginBottom:10}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{width:24,height:24,background:C.navy,borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:10,fontWeight:800,color:'#fff'}}>{name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</span></div>
                        <span style={{fontSize:14,fontWeight:700,color:C.navy}}>{name}</span>
                        {!hasExplicit&&<span style={{fontSize:10,fontWeight:700,color:C.green,background:C.greenBg,padding:'2px 8px',borderRadius:20}}>FULL ACCESS</span>}
                      </div>
                      {hasExplicit&&<button onClick={setFullAccess} style={{background:'none',border:'none',color:C.teal,fontSize:11,fontWeight:600,cursor:'pointer',textDecoration:'underline'}}>Grant full access</button>}
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))',gap:8}}>
                      {PERMISSIONS.filter(p=>!p.base).map(perm=>{
                        const checked=hasExplicit?!!userPerms[perm.key]:true; // full access when no explicit map
                        return (
                          <label key={perm.key} title={perm.desc} style={{display:'flex',alignItems:'flex-start',gap:8,cursor:perm.parked?'not-allowed':'pointer',opacity:perm.parked?0.5:1,padding:'6px 8px',borderRadius:6,background:checked&&!perm.parked?C.tealMuted:'transparent'}}>
                            <input type="checkbox" checked={checked} disabled={perm.parked} onChange={()=>!perm.parked&&toggle(perm.key)} style={{marginTop:2,cursor:perm.parked?'not-allowed':'pointer'}}/>
                            <div>
                              <div style={{fontSize:12,fontWeight:600,color:C.navy}}>{perm.label}{perm.parked&&<span style={{fontSize:9,color:C.textLight,marginLeft:5,fontWeight:400}}>(coming soon)</span>}</div>
                              <div style={{fontSize:10,color:C.textLight,lineHeight:1.3}}>{perm.desc}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Pricing Strategy — drives the Suggested Buy engine on appraisals */}
        <Card style={{padding:20,gridColumn:'1/-1'}}>
          <div style={{fontWeight:700,fontSize:14,color:C.navy,marginBottom:4,display:'flex',alignItems:'center',gap:8}}><Sparkles size={15} color={C.navy}/>Pricing Strategy</div>
          <p style={{fontSize:12,color:C.textLight,marginBottom:14}}>These drive the <strong>Suggested Buy</strong> price on every appraisal — the tool works backward from your target retail to a recommended purchase price. Always a suggestion you can override.</p>
          <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
            <div style={{flex:1,minWidth:180}}>
              <Field label="Retail Market Position (%)"><Input value={d.marketPositionPct??97} onChange={v=>set('marketPositionPct',v)} type="number"/></Field>
              <div style={{fontSize:10.5,color:C.textLight,marginTop:3,lineHeight:1.4}}>Where you price retail vs. market mid. 97% = just under mid. Lower = more aggressive pricing.</div>
            </div>
            <div style={{flex:1,minWidth:180}}>
              <Field label="Target Gross ($)"><Input value={d.targetGross??2500} onChange={v=>set('targetGross',v)} type="number"/></Field>
              <div style={{fontSize:10.5,color:C.textLight,marginTop:3,lineHeight:1.4}}>Base front-end gross you aim for. Auto-widens on slow-moving vehicles.</div>
            </div>
            <div style={{flex:1,minWidth:180}}>
              <Field label="Average Recon ($)"><Input value={d.avgRecon??1500} onChange={v=>set('avgRecon',v)} type="number"/></Field>
              <div style={{fontSize:10.5,color:C.textLight,marginTop:3,lineHeight:1.4}}>Used when no recon is entered on an appraisal. Auto-bumps for luxury makes.</div>
            </div>
          </div>
          <div style={{marginTop:12,padding:'10px 12px',background:C.tealMuted,borderRadius:6,border:`1px solid ${C.teal}`,fontSize:11,color:C.textMid,lineHeight:1.5}}>
            <strong style={{color:C.teal}}>How it works:</strong> Suggested Buy = (market mid × your position %) − target gross − recon − costs. Slow markets raise the gross; luxury makes raise the recon; reported history issues lower the number. Carfax is factored in once connected.
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
// Shown when the acting user lacks permission for a gated page.
function NoAccess({label,need}){
  return (
    <div style={{maxWidth:480,margin:'40px auto',textAlign:'center'}}>
      <Card style={{padding:'40px 28px'}}>
        <ShieldCheck size={32} color={C.navyBorder} style={{marginBottom:12}}/>
        <div style={{fontSize:16,fontWeight:800,color:C.navy,marginBottom:6}}>{label} is restricted</div>
        <div style={{fontSize:13,color:C.textMid,lineHeight:1.5}}>You don't have the <b>{need}</b> permission. Ask an administrator to grant it in Settings → Staff &amp; Permissions, or switch to a user who has access.</div>
      </Card>
    </div>
  );
}

// ─── CUSTOMER LEADS INBOX ─────────────────────────────────────────────
// Warm leads from the widget. Differentiated from regular appraisals and sorted
// by urgency: specialist-needed first, then oldest-unworked (speed-to-lead).
function timeAgo(iso){
  const ms=Date.now()-new Date(iso).getTime();
  const m=Math.floor(ms/60000), h=Math.floor(m/60), d=Math.floor(h/24);
  if(m<1) return 'just now';
  if(m<60) return `${m}m ago`;
  if(h<24) return `${h}h ago`;
  return `${d}d ago`;
}
// Urgency tier from how long a lead has sat unworked (speed-to-lead matters most
// in the first hour). Specialist-needed leads are always elevated.
function leadUrgency(lead){
  const ms=Date.now()-new Date(lead.created_at).getTime();
  const h=ms/3600000;
  const specialist=lead.thin_market || lead.offer_amount==null;
  if(specialist || h>=24) return {level:'high',label:specialist?'Needs callback':'⚠ Over 1 day',color:C.red,bg:C.redBg};
  if(h>=4) return {level:'med',label:'Follow up soon',color:C.orange,bg:C.orangeBg};
  return {level:'new',label:'New',color:C.green,bg:C.greenBg};
}
function LeadsInbox({leads,loading,onRefresh,onOpen,onDismiss,error,filter,onFilter}){
  const [q,setQ]=useState('');
  const [sort,setSort]=useState('urgency');
  const sorted=[...leads]
    .filter(l=>{
      if(!q) return true;
      const t=q.toLowerCase();
      return [l.customer_name,l.customer_phone,l.customer_email,l.vin,
              l.year,l.make,l.model,l.trim,l.postal,l.source]
        .some(v=>(v||'').toString().toLowerCase().includes(t));
    })
    .sort((a,b)=>{
      if(sort==='newest') return new Date(b.created_at)-new Date(a.created_at);
      if(sort==='oldest') return new Date(a.created_at)-new Date(b.created_at);
      if(sort==='value') return Number(b.offer_amount||b.market_mid||0)-Number(a.offer_amount||a.market_mid||0);
      // Default: whoever most needs calling. Urgency first, then oldest within
      // a tier, since a lead going cold matters more than one that just landed.
      const ua=leadUrgency(a), ub=leadUrgency(b);
      const rank={high:0,med:1,new:2};
      if(rank[ua.level]!==rank[ub.level]) return rank[ua.level]-rank[ub.level];
      return new Date(a.created_at)-new Date(b.created_at);
    });
  const specialistCount=leads.filter(l=>l.thin_market||l.offer_amount==null).length;

  return (
    <div style={{maxWidth:760,margin:'0 auto'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
        <div>
          <h2 style={{fontSize:18,fontWeight:800,color:C.navy,display:'flex',alignItems:'center',gap:8}}><Zap size={18} color={C.orange}/>Customer Leads</h2>
          <p style={{fontSize:13,color:C.textLight}}>{leads.length} pending{specialistCount>0?` · ${specialistCount} need a callback`:''}</p>
        </div>
        <Btn variant="ghost" size="sm" onClick={onRefresh}><RefreshCw size={12} style={{animation:loading?'spin 1s linear infinite':undefined}}/> Refresh</Btn>
      </div>
      {/* Working a lead marks it converted, which used to remove it from view
          with no way back. These tabs keep every lead reachable. */}
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        {[['pending','New'],['converted','Worked'],['dismissed','Dismissed'],['all','All']].map(([v,label])=>(
          <button key={v} onClick={()=>onFilter&&onFilter(v)}
            style={{padding:'6px 14px',borderRadius:20,fontSize:12,fontWeight:700,cursor:'pointer',
              border:`1px solid ${filter===v?C.navy:C.border}`,
              background:filter===v?C.navy:'#fff',color:filter===v?'#fff':C.textMid}}>
            {label}
          </button>
        ))}
      </div>

      <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:180,position:'relative'}}>
          <Search size={13} color={C.textLight} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)'}}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, phone, vehicle, VIN..."
            style={{width:'100%',padding:'8px 12px 8px 30px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
        </div>
        <select value={sort} onChange={e=>setSort(e.target.value)}
          style={{padding:'8px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontFamily:'inherit',outline:'none'}}>
          <option value="urgency">Needs calling first</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="value">Highest value</option>
        </select>
      </div>

      {error?(
        <Card style={{padding:'32px',textAlign:'center',border:`1px solid ${C.red}`,background:'#FEF2F2'}}>
          <AlertTriangle size={30} color={C.red} style={{marginBottom:10}}/>
          <div style={{fontSize:14,fontWeight:700,color:C.red}}>
            {error==='auth'?"Can't read leads — not authorised":"Can't reach the leads service"}
          </div>
          <div style={{fontSize:12,color:C.textMid,marginTop:6,maxWidth:420,margin:'6px auto 0',lineHeight:1.5}}>
            {error==='auth'
              ? "Customer leads may be waiting. The team key this app sends doesn't match the one on the server, so the inbox can't load them. Check VITE_TEAM_KEY (Netlify) against TEAM_API_KEY (Railway) and redeploy."
              : "The request failed. If the backend was asleep it may just need another try."}
          </div>
          <div style={{marginTop:14}}><Btn variant="ghost" size="sm" onClick={onRefresh}><RefreshCw size={12}/> Try again</Btn></div>
        </Card>
      ):leads.length===0?(
        <Card style={{padding:'48px',textAlign:'center'}}>
          <Zap size={32} color={C.navyBorder} style={{marginBottom:10}}/>
          <div style={{fontSize:14,fontWeight:700,color:C.textMid}}>{q?'No leads match that search':filter==='pending'?'No new leads':filter==='converted'?'No worked leads yet':filter==='dismissed'?'No dismissed leads':'No leads yet'}</div>
          <div style={{fontSize:12,color:C.textLight,marginTop:4}}>New customer submissions from your widget will appear here.</div>
        </Card>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {sorted.map(lead=>{
            const u=leadUrgency(lead);
            const specialist=lead.thin_market||lead.offer_amount==null;
            return (
              <div key={lead.id} role="button" tabIndex={0}
                onClick={()=>onOpen(lead)}
                onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpen(lead);}}}
                style={{background:'#fff',borderRadius:12,border:`1px solid ${C.border}`,borderLeft:`4px solid ${u.color}`,padding:16,boxShadow:'0 1px 3px rgba(0,0,0,0.05)',cursor:'pointer',WebkitTapHighlightColor:'transparent'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
                  <div style={{flex:1,minWidth:0}}>
                    {/* Urgency + time */}
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                      <span style={{background:u.bg,color:u.color,fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:20,textTransform:'uppercase',letterSpacing:0.4}}>{u.label}</span>
                      <span style={{fontSize:11,color:C.textLight}}>{timeAgo(lead.created_at)}</span>
                      <span style={{background:C.purpleBg,color:C.purple,fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:20,textTransform:'uppercase',letterSpacing:0.4}}>Customer</span>
                    </div>
                    {/* Vehicle */}
                    <div style={{fontSize:15,fontWeight:800,color:C.navy}}>{lead.year} {lead.make} {lead.model} {lead.trim?<span style={{fontWeight:500,color:C.textMid}}>{lead.trim}</span>:null}</div>
                    <div style={{fontSize:12,color:C.textMid,marginTop:2}}>
                      {lead.odometer?`${Number(lead.odometer).toLocaleString('en-CA')} km`:'km not provided'}
                      {lead.vin?` · VIN ${lead.vin}`:''}
                      {lead.accident?<span style={{color:C.orange}}> · Reported accident</span>:''}
                    </div>
                    {/* Contact — prominent for callback */}
                    <div style={{display:'flex',gap:14,marginTop:10,flexWrap:'wrap'}}>
                      <div style={{display:'flex',alignItems:'center',gap:5,fontSize:13,fontWeight:600,color:C.navy}}><User size={13} color={C.textLight}/>{lead.customer_name}</div>
                      {lead.customer_phone&&<a href={`tel:${lead.customer_phone}`} style={{display:'flex',alignItems:'center',gap:5,fontSize:13,color:C.teal,fontWeight:600,textDecoration:'none'}}>📞 {lead.customer_phone}</a>}
                      {lead.customer_email&&<a href={`mailto:${lead.customer_email}`} style={{display:'flex',alignItems:'center',gap:5,fontSize:13,color:C.teal,fontWeight:600,textDecoration:'none'}}><Mail size={13}/>{lead.customer_email}</a>}
                    </div>
                    {/* Customer-reported detail chips (appraiser context) */}
                    {(lead.condition_opinion||lead.tire_condition||lead.brake_condition||lead.ownership||(lead.photos&&lead.photos.length)||lead.known_issues)&&(
                      <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
                        {lead.condition_opinion&&<span style={{fontSize:11,background:C.navyMuted,color:C.textMid,padding:'2px 8px',borderRadius:6}}>Condition: <b style={{color:C.navy}}>{lead.condition_opinion}</b></span>}
                        {lead.tire_condition&&<span style={{fontSize:11,background:C.navyMuted,color:C.textMid,padding:'2px 8px',borderRadius:6}}>Tires: {lead.tire_condition}</span>}
                        {lead.brake_condition&&<span style={{fontSize:11,background:C.navyMuted,color:C.textMid,padding:'2px 8px',borderRadius:6}}>Brakes: {lead.brake_condition}</span>}
                        {lead.ownership&&<span style={{fontSize:11,background:lead.ownership==='owned'?C.greenBg:C.orangeBg,color:lead.ownership==='owned'?C.green:C.orange,padding:'2px 8px',borderRadius:6,fontWeight:600,textTransform:'capitalize'}}>{lead.ownership}{lead.lien_balance!=null?` · $${Number(lead.lien_balance).toLocaleString('en-CA')} owing`:''}</span>}
                        {lead.photos&&lead.photos.length>0&&<span style={{fontSize:11,background:C.blueBg,color:C.blue,padding:'2px 8px',borderRadius:6,fontWeight:600}}>📷 {lead.photos.length} photo{lead.photos.length>1?'s':''}</span>}
                      </div>
                    )}
                    {lead.known_issues&&<div style={{fontSize:12,color:C.textMid,marginTop:8,background:C.orangeBg,borderRadius:6,padding:'6px 10px'}}><b style={{color:C.orange}}>Reported issues:</b> {lead.known_issues}</div>}
                  </div>
                  {/* Offer / range / specialist */}
                  <div style={{textAlign:'right',flexShrink:0}}>
                    {specialist?(
                      <div style={{background:C.redBg,borderRadius:8,padding:'8px 12px'}}>
                        <div style={{fontSize:10,color:C.red,fontWeight:700,textTransform:'uppercase'}}>Needs quote</div>
                        <div style={{fontSize:11,color:C.textMid,maxWidth:120,marginTop:2}}>{lead.thin_market?'Thin market':'Mileage flag'}</div>
                      </div>
                    ):(
                      <div>
                        <div style={{fontSize:10,color:C.textLight,fontWeight:600,textTransform:'uppercase'}}>Instant offer shown</div>
                        <div style={{fontSize:20,fontWeight:800,color:C.green,fontFamily:'monospace'}}>{lead.offer_amount?`$${Number(lead.offer_amount).toLocaleString('en-CA')}`:'—'}</div>
                        {lead.confidence&&<div style={{fontSize:10,color:C.textLight}}>{lead.confidence} confidence</div>}
                      </div>
                    )}
                  </div>
                </div>
                {/* Actions */}
                <div style={{display:'flex',gap:8,marginTop:14,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
                  <Btn size="sm" variant="teal" onClick={e=>{e.stopPropagation();onOpen(lead);}}><ArrowRight size={13}/>Work this lead</Btn>
                  <Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation();onDismiss(lead.id);}}><X size={13}/>Dismiss</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Dashboard({vehicles,appraisals,dealer,onNav,onOpenVehicle,onOpenAppraisal,leads,onOpenLead}) {
  // Retail operations aren't running yet, so the dashboard shows only the two
  // things that matter day to day: customers waiting on an answer, and the
  // appraisals in flight. Inventory tiles, recon flags and advertising checks
  // are removed rather than sitting empty.
  const pending=(leads||[]).filter(l=>!l.status||l.status==='pending');
  const recent=[...appraisals].sort((x,y)=>new Date(y.updatedAt||y.createdAt||0)-new Date(x.updatedAt||x.createdAt||0)).slice(0,8);

  return (
    <div>
      <h2 className='page-title' style={{fontSize:20,fontWeight:700,color:C.navy,marginBottom:16,letterSpacing:-0.3}}>
        {dealer?.name||'Your Dealership'}
      </h2>

      {/* New leads first — a customer waiting is the only thing on this screen
          with a clock running on it. */}
      {pending.length>0&&(
        <div style={{marginBottom:22}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
            <h3 style={{fontSize:14,fontWeight:700,color:C.navy}}>New leads</h3>
            <span style={{fontSize:11,fontWeight:700,color:'#fff',background:C.orange,borderRadius:10,padding:'1px 8px'}}>{pending.length}</span>
            <button onClick={()=>onNav('leads')} style={{marginLeft:'auto',fontSize:12,color:C.textMid,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}}>View all →</button>
          </div>
          <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',background:'#fff'}}>
            {pending.slice(0,5).map((l,i,arr)=>(
              <div key={l.id} onClick={()=>onOpenLead&&onOpenLead(l)}
                style={{padding:'13px 15px',borderBottom:i<arr.length-1?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:13.5,color:C.textDark,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {[l.year,l.make,l.model].filter(Boolean).join(' ')||l.vin||'Vehicle'}
                  </div>
                  <div style={{fontSize:12,color:C.textLight,marginTop:2}}>
                    {[l.customer_name||l.customerName,l.mileage?`${fmtN(l.mileage)} km`:null,
                      l.source&&l.source!=='widget'?l.source:null,
                      fmtDate(l.created_at||l.createdAt)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {l.market_mid&&<span style={{fontSize:13,fontWeight:700,color:C.navy,flexShrink:0}}>{fmt(l.market_mid)}</span>}
                <ChevronRight size={15} color={C.textLight} style={{flexShrink:0}}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent appraisals */}
      <div>
        <div style={{display:'flex',alignItems:'center',marginBottom:10}}>
          <h3 style={{fontSize:14,fontWeight:700,color:C.navy}}>Recent appraisals</h3>
          <button onClick={()=>onNav('appraisals')} style={{marginLeft:'auto',fontSize:12,color:C.textMid,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}}>View all →</button>
        </div>
        {recent.length===0?(
          <div style={{padding:'26px 0',fontSize:13,color:C.textLight}}>
            No appraisals yet. Start one with New Appraisal.
          </div>
        ):(
          <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',background:'#fff'}}>
            {recent.map((a,i,arr)=>(
              <div key={a.id} onClick={()=>onOpenAppraisal(a)}
                style={{padding:'13px 15px',borderBottom:i<arr.length-1?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:13.5,color:C.textDark,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {[a.year,a.make,a.model,a.series].filter(Boolean).join(' ')||'Untitled'}
                  </div>
                  <div style={{fontSize:12,color:C.textLight,marginTop:2}}>
                    {[a.odometer?`${fmtN(a.odometer)} km`:null,fmtDate(a.updatedAt||a.createdAt)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {a.appraisedValue&&<span style={{fontSize:13,fontWeight:700,color:C.navy,flexShrink:0}}>{fmt(a.appraisedValue)}</span>}
                <ABadge status={a.status}/>
                <ChevronRight size={15} color={C.textLight} style={{flexShrink:0}}/>
              </div>
            ))}
          </div>
        )}
      </div>
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
    <button onClick={copy} title={copied?'Copied!':'Copy VIN'} style={{
      background:copied?C.greenBg:'rgba(28,45,94,0.06)',
      border:`1px solid ${copied?C.green:C.navyBorder}`,
      borderRadius:5,padding:'4px 7px',
      color:copied?C.green:C.navy,
      cursor:'pointer',
      display:'inline-flex',alignItems:'center',justifyContent:'center',
      transition:'all 0.2s',flexShrink:0,
    }}>
      {copied?<Check size={13}/>:<Copy size={13}/>}
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
  // Selectable expiry: use a.offerExpiry if set, else default to +7 days.
  const expDate=a.offerExpiry?new Date(a.offerExpiry+'T00:00:00'):new Date(Date.now()+7*86400000);
  const expiry=expDate.toLocaleDateString('en-CA',{dateStyle:'long'});
  const row=(k,v)=>v?`<div class="pp-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`:'';
  const cfx=a.carfax?`<div class="pp-sec"><h3>Vehicle History</h3><div class="pp-grid">
      ${row('Reported Accidents', a.carfax.accidents)}
      ${row('Previous Owners', a.carfax.owners)}
      ${row('Service Records', a.carfax.service_records)}
      <div class="pp-row"><span class="k">Status</span><span class="pill ${a.carfax.clean?'good':'bad'}">${a.carfax.clean?'Clean History':'Issues Reported'}</span></div>
    </div></div>`:'';
  const body=`
    ${dealerHeader(dealer,'Cash Offer','Vehicle Purchase Offer')}
    <div class="pp-sec"><h3>Prepared For</h3><div class="pp-grid">
      ${row('Customer', cust||'—')}
      ${row('Phone', a.phone)}
      ${row('Email', a.email)}
      ${row('Date', today)}
      ${row('Offer Valid Until', expiry)}
    </div></div>
    <div class="pp-sec"><h3>Vehicle</h3><div class="pp-grid">
      ${row('Vehicle', veh)}
      ${row('VIN', a.vin)}
      ${row('Odometer', a.odometer?fmtN(a.odometer)+' km':'')}
      ${row('Body', a.bodyType)}
      ${row('Exterior', a.extColour)}
      ${row('Interior', a.intColour)}
      ${row('Engine', a.engine)}
      ${row('Drivetrain', a.drivetrain)}
      ${row('Transmission', a.transmission)}
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
    <div>
      {decoded?(
        <div>
          {/* This section is the only place the vehicle is identified now, so it
              carries the name and kilometres as well as the specs. */}
          <div style={{padding:'2px 0 10px'}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:17,fontWeight:700,color:C.navy,letterSpacing:-0.3,lineHeight:1.25}}>
                  {[data.year,data.make,data.model,data.series].filter(Boolean).join(' ')||'Vehicle not identified'}
                </div>
                {data.odometer&&<div style={{fontSize:14,color:C.textDark,marginTop:2}}>{Number(data.odometer).toLocaleString('en-CA')} km</div>}
              </div>
              <button onClick={onEdit} style={{background:'none',border:'none',padding:0,fontSize:12,color:C.textMid,cursor:'pointer',flexShrink:0,fontFamily:'inherit'}}>
                Edit
              </button>
            </div>
            <div style={{fontSize:12.5,color:C.textLight,lineHeight:1.5,marginTop:5}}>
              {[data.engine,data.drivetrain,data.transmission].filter(Boolean).join(' · ')||'Specs pending'}
              {(data.extColour||data.intColour)&&<span>{' · '}{[data.extColour,data.intColour].filter(Boolean).join(' / ')}</span>}
            </div>
          </div>

          {/* Carfax tags */}
          {(data.carfax||(data.odometer&&data.marketAvgOdometer))&&(
            <div style={{padding:'0 0 8px'}}>
              <CarfaxTags carfax={data.carfax} odometer={data.odometer} marketAvgOdometer={data.marketAvgOdometer}/>
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

// ── Suggested Buy engine (rules-based v1) ──────────────────────────────────
// Appraises BACKWARD from the dealer's target retail position to a suggested
// purchase price, and returns a plain-English rationale. Deterministic math —
// no AI call. The dealer's strategy lives in dealer settings; everything is a
// SUGGESTION the user can override.
// computeSuggestedBuy, confidenceFrom, and LUXURY_MAKES now live in the SHARED
// brain (../shared/suggestedBuy.js) so this appraisal page and the customer
// widget compute the IDENTICAL number. Imported at the top of this file.

function AppraisalForm({initial,onSave,onBack,showToast,onConvert,onFinalize,onUnlock,user='Staff',onGetDealer,onCheckDup,onOpenExisting,can=()=>true}) {
  const [a,setA]=useState(initial);
  const [vl,setVl]=useState(false);
  const [ml,setMl]=useState(false);
  const [cl,setCl]=useState(false);
  const [dupMatch,setDupMatch]=useState(null);   // existing active appraisal/inventory for this VIN
  const locked=!!a.finalizedAt;
  const [vehExpanded,setVehExpanded]=useState(!initial?.year);
  const [vinCopied,setVinCopied]=useState(false);
  const [sub,setSub]=useState(null);   // null = hub; otherwise the open page
  useEffect(()=>{ window.scrollTo(0,0); },[sub]);
  const [filtersOpen,setFiltersOpen]=useState(false);
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

  // ── Auto-fetch market data ──────────────────────────────────────
  // Previously the appraiser had to press a button. That existed to limit paid
  // lookups, but the backend now caches each vehicle for 24h, so a repeat view
  // costs nothing — there's no reason to make someone click. Runs once per
  // appraisal as soon as we have enough to search on.
  // Reset AI guard when the appraiser switches vehicle.
  useEffect(()=>{ aiRef.current=null; },[a.id]);

  // Declared here because the AI effect below reads it in its dependency array,
  // and dependency arrays evaluate during render — a const declared further down
  // would be in the temporal dead zone and throw before the page could paint.
  const marketStale = !!a.marketMid && a._marketTrim!==undefined &&
    ((a.series||'')!==(a._marketTrim||'') || (a.drivetrain||'')!==(a._marketDrive||''));

  // ── AI appraisal ────────────────────────────────────────────────
  // Runs once market data lands. Claude sees the real comps we just pulled and
  // writes the number plus the reasoning behind it.
  const [aiBusy,setAiBusy]=useState(false);
  const [whyOpen,setWhyOpen]=useState(false);
  const aiRef=useRef(null);
  const formulaBuyRef=useRef(null);
  const runAppraisal=useCallback(async(appr)=>{
    const src=appr||aRef.current; if(!src) return;
    const comps=src._comps||[];
    if(!comps.length) return;
    setAiBusy(true);
    try{
      const r=await fetch(`${API_BASE}/api/appraise`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          vehicle:{year:src.year,make:src.make,model:src.model,trim:src.series,
            odometer:src.odometer,condition:src.conditionNotes||src.mechanical||'',
            accident:src.accidentVisible?(src.accidentAmount?`Declared ~$${src.accidentAmount}`:'Declared'):'',
            notes:src.notes||''},
          market:{marketLow:src.marketLow,marketMid:src.marketMid,marketHigh:src.marketHigh,
            count:src.marketCount,medianCompMileage:src._medianCompMileage,
            medianDaysListed:src.marketDaysSupply,comps},
        }),
      });
      const d=await r.json();
      if(d&&d.success){
        setA(prev=>({...prev,_ai:d}));
        showToast(`AI appraisal: buy at ${fmt(d.buy)}`, d.outOfBand?'info':'success');
      } else if(d&&d.error){ showToast(d.error,'error'); }
    }catch{ showToast('AI appraisal failed','error'); }
    finally{ setAiBusy(false); }
  },[]);
  // Re-run whenever the comps change, not once per vehicle. The first fetch
  // often lands before the trim is decoded, so it's a wide model-level set that
  // prices high; the tighter trim-matched refetch that follows was leaving the
  // AI number stale until someone manually refreshed. Keyed on the fetch
  // timestamp so it recomputes for each new comp set but not on every render.
  useEffect(()=>{
    if(locked) return;
    if(!a.marketMid||!(a._comps||[]).length) return;
    if(!Number(a.odometer)) return;   // no km, no valuation
    // Wait until the picture has settled before spending a call. The first
    // fetch often precedes the trim decode, and a refetch follows; appraising
    // the interim set produces a number that visibly corrects itself. Hold off
    // while a refetch is pending, and debounce so a burst of updates yields one
    // appraisal rather than one per step.
    if(marketStale) return;            // trim changed, comps are about to change
    if(ml) return;                     // a fetch is in flight
    const stamp=a.marketDataFetched||'';
    if(aiRef.current===stamp) return;  // already appraised against this comp set
    const t=setTimeout(()=>{
      aiRef.current=stamp;
      runAppraisal(aRef.current);
    },900);
    return()=>clearTimeout(t);
  },[a.marketMid,a.marketDataFetched,a._comps,a.odometer,locked,marketStale,ml,runAppraisal]);

  // ── Keep the market estimate in step with the trim ──────────────
  // The band is trim-sensitive (an XLT and a Platinum are different markets),
  // so once market data exists, changing trim/drivetrain makes it stale. Flag
  // it immediately, then re-run the lookup after a short debounce so toggling
  // through the picker doesn't fire a request per keystroke.
  const mktRefreshRef=useRef(null);
  useEffect(()=>{
    if(locked) return;
    if(!marketStale) return;
    if(a.vin?.length!==17) return;
    clearTimeout(mktRefreshRef.current);
    mktRefreshRef.current=setTimeout(()=>{ fetchMkt(); },1200);
    return()=>clearTimeout(mktRefreshRef.current);
  },[a.series,a.drivetrain,marketStale,locked]);

  function forceSave(){
    onSave(aRef.current, true); // silent
    setSavedAt(new Date().toISOString());
    setIsDirty(false);
    showToast('Saved','success');
  }

  async function decode(){if(a.vin.length!==17){showToast('Enter a valid 17-character VIN','error');return;}setVl(true);try{const d=await decodeVIN(a.vin.toUpperCase());setA(p=>{const next={...p,...d,updatedAt:new Date().toISOString()};aRef.current=next;return next;});setIsDirty(true);setVehExpanded(true);showToast(`Decoded: ${[d.year,d.make,d.model].filter(Boolean).join(' ')||'partial — review fields'}`,'success');
    // Duplicate check: does this VIN already have an active appraisal or sit in inventory?
    if(onCheckDup){const m=onCheckDup(a.vin.toUpperCase(),a.id);setDupMatch(m||null);}
  }catch{showToast('Could not decode — enter manually','error');}finally{setVl(false);}}
  // ── Auto-decode ─────────────────────────────────────────────────
  // A 17-character VIN is unambiguous — there's nothing to confirm, so waiting
  // for a button press just leaves the appraiser staring at blank fields.
  // Decodes once per VIN; the manual Decode button still works for re-runs.
  const decodedVinRef=useRef('');
  useEffect(()=>{
    if(locked) return;
    const v=(a.vin||'').toUpperCase().trim();
    if(v.length!==17) return;
    if(decodedVinRef.current===v) return;   // already handled this VIN
    if(a.make&&a.model) { decodedVinRef.current=v; return; }  // came in pre-filled
    decodedVinRef.current=v;
    const t=setTimeout(()=>{ decode(); },400);
    return()=>clearTimeout(t);
  },[a.vin,locked]);

  async function fetchMkt(){
    const dealer=onGetDealer?onGetDealer():null;
    const postal=dealer?.postal;
    if(!postal){showToast('Set your dealer postal code in Settings first','error');return;}
    // A VIN gives the tightest match, but it isn't required — plenty of cars
    // arrive as a lead with year/make/model and no VIN, and the market can
    // still be searched on the spec. Refusing to price those was needlessly
    // strict, since the same endpoint already backs the customer widget.
    const hasVin=a.vin.length===17;
    const specId=hasVin?null:buildSpecId(a.year,a.make,a.model,a.series);
    if(!hasVin&&!specId){showToast('Enter a VIN, or a year, make and model','error');return;}
    setMl(true);
    try{
      const m=hasVin
        ? await fetchMarketData(a.vin,postal,a.searchDistance||250,a.drivetrain||"",a.series||"")
        : await fetchMarketBySpec(specId,postal,a.searchDistance||250,a.drivetrain||"",a.series||"");
      if(!m.found){showToast(m.message||'No Canadian comps found for this vehicle','warning');setMl(false);return;}
      const note=`${m.meta.comps} comps · ${m.meta.matchMode==='trim'?'trim match':'model match'}${m.meta.widened?' (widened)':''}`;
      setA(p=>{const next=withLog({...p,marketLow:m.marketLow,marketMid:m.marketMid,marketHigh:m.marketHigh,marketAvgPrice:m.marketAvgPrice,activeComps:m.activeComps,marketDaysSupply:m.marketDaysSupply,marketDaySupply:m.marketDaySupply,medianDaysListed:m.medianDaysListed,_soldStats:m.soldStats,marketDataFetched:m.marketDataFetched,_marketMeta:m.meta,_medianCompMileage:m.medianCompMileage,_comps:m.comps,_marketTrim:(a.series||''),_marketDrive:(a.drivetrain||''),updatedAt:new Date().toISOString()},[logEvent('Market Data',`mid ${fmt(m.marketMid)} · ${note}`,user)]);aRef.current=next;return next;});
      setIsDirty(true);
      showToast(`Market: ${note}`,'success');
    }catch(e){showToast(e.message||'Market data unavailable','error');}
    finally{setMl(false);}
  }
  // Manual (no-VIN) market fetch using year/make/model/trim → spec_id.
  async function fetchMktBySpec(){
    const dealer=onGetDealer?onGetDealer():null;
    const postal=dealer?.postal;
    if(!postal){showToast('Set your dealer postal code in Settings first','error');return;}
    if(!a.year||!a.make||!a.model){showToast('Pick year, make and model','error');return;}
    setMl(true);
    try{
      const specId=buildSpecId(a.year,a.make,a.model,a.series);
      const m=await fetchMarketBySpec(specId,postal,a.searchDistance||250,a.drivetrain||"",a.series||"");
      if(!m.found){showToast(m.message||'No Canadian comps found for this vehicle','warning');setMl(false);return;}
      const note=`${m.meta.comps} comps · ${m.meta.matchMode==='trim'?'trim match':'model match'}`;
      setA(p=>{const next=withLog({...p,marketLow:m.marketLow,marketMid:m.marketMid,marketHigh:m.marketHigh,marketAvgPrice:m.marketAvgPrice,activeComps:m.activeComps,marketDaysSupply:m.marketDaysSupply,marketDaySupply:m.marketDaySupply,medianDaysListed:m.medianDaysListed,_soldStats:m.soldStats,marketDataFetched:m.marketDataFetched,_marketMeta:m.meta,_medianCompMileage:m.medianCompMileage,_comps:m.comps,updatedAt:new Date().toISOString()},[logEvent('Market Data',`mid ${fmt(m.marketMid)} · ${note} (manual)`,user)]);aRef.current=next;return next;});
      setIsDirty(true);
      showToast(`Market: ${note}`,'success');
    }catch(e){showToast(e.message||'Market data unavailable','error');}
    finally{setMl(false);}
  }
  // Auto-fetch ONCE when the VIN first becomes valid and we have no cached comps.
  // After this, criteria changes recompute locally (no further VinAudit calls).
  // Auto-fetch ONCE after the vehicle is DECODED (make present), so the trim and
  // drivetrain are available to tighten the comp match. Firing on bare VIN alone
  // sent an empty trim → model-only match → the whole model's price range.
  const autoFetchedRef=useRef(false);
  useEffect(()=>{
    if(locked) return;
    // Either a VIN or a decoded year/make/model is enough to search on.
    if(!(a.vin?.length===17 || (a.year&&a.make&&a.model))){ autoFetchedRef.current=false; return; }
    // Stored comps outlive changes to how comps are built — the miles-to-km
    // correction being the costly example, where saved numbers stayed wrong
    // until someone happened to refresh. The backend stamps each payload with
    // the comp shape it was built from; anything that doesn't match the current
    // shape is refetched once. Checking a version rather than the presence of
    // one field means future changes heal themselves too.
    const staleShape = !!(a.marketMid && a._marketMeta && a._marketMeta.shapeVersion!==MARKET_SHAPE);
    if((a._comps || a.marketMid) && !staleShape) return;
    if(autoFetchedRef.current) return;
    if(!a.make) return;                 // wait until decode has populated the vehicle
    // Odometer is not optional: pricing a car without knowing its kilometres
    // produces a number that looks authoritative and isn't. Wait for it.
    if(!Number(a.odometer)) return;
    const dealer=onGetDealer?onGetDealer():null;
    if(!dealer?.postal) return;
    autoFetchedRef.current=true;
    fetchMkt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[a.vin,a.make,a.odometer]);
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
  // Log what the appraiser committed to, next to what each method predicted.
  // The entered number is the closest thing to ground truth we have, so this is
  // the only way to find out which method is closer and whether either is
  // consistently high or low. Fire-and-forget: never block finalizing.
  const logCalibration=useCallback((appr)=>{
    const src=appr||aRef.current; if(!src) return;
    const finalValue=Number(src.appraisedValue);
    if(!Number.isFinite(finalValue)||finalValue<=0) return;
    fetch(`${API_BASE}/api/calibration`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        appraisalId:src.id, vin:src.vin, year:src.year, make:src.make, model:src.model,
        trim:src.series, odometer:Number(src.odometer)||null, marketMid:src.marketMid,
        compCount:(src._comps||[]).length, matchMode:src._marketMeta?.matchMode||'',
        formulaBuy:Number(src.suggestedBuy)||formulaBuyRef.current||null, aiBuy:src._ai?.buy||null,
        finalValue, appraiser:src.appraiser||'',
      }),
    }).catch(()=>{});
  },[]);

  function doFinalize(){
    forceSave();
    logCalibration(aRef.current);
    onFinalize&&onFinalize(aRef.current);
  }

  return (
    <div>
      {showVINScanner&&<VINScanner onVINDetected={v=>{set('vin',v);setVehExpanded(true);}} onClose={()=>setShowVINScanner(false)}/>}
      {/* Header — one line. Back is a bare arrow, the vehicle is named once
          (the VIN lives in its own field below, not repeated here), and every
          action folds into a single menu so the page opens on the work, not on
          a row of buttons. Saving is automatic, so there's no save state to
          report. */}
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'4px 2px 14px'}}>
        <button onClick={()=>sub?setSub(null):onBack()} aria-label="Back"
          style={{background:'none',border:'none',padding:4,margin:'0 -4px 0 0',color:C.textMid,cursor:'pointer',display:'flex',alignItems:'center',flexShrink:0}}>
          <ChevronLeft size={22}/>
        </button>
        {/* Branding sits inline here on mobile now that the top bar is gone —
            one row of chrome instead of two. */}
        <div className="hide-desktop" style={{display:'flex',alignItems:'center',gap:7,flexShrink:0}}>
          <div style={{width:24,height:24,borderRadius:6,background:C.navy,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <span style={{fontSize:11,fontWeight:900,color:'#fff',fontFamily:'monospace',letterSpacing:-1}}>V</span>
          </div>
          <span style={{fontSize:14,fontWeight:800,color:C.navy,letterSpacing:-0.3}}>Vantage</span>
        </div>
        {/* No vehicle details here — they belong in the Vehicle section, and
            repeating them made the same fact appear twice on one screen. On a
            sub-page the header names the page instead. */}
        <div style={{flex:1,minWidth:0}}>
          {sub&&<div style={{fontSize:15,fontWeight:700,color:C.navy,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            {[a.year,a.make,a.model].filter(Boolean).join(' ')}
          </div>}
        </div>
        {locked&&<ShieldCheck size={16} color={C.purple} title="Finalized" style={{flexShrink:0}}/>}
        <select value={a.status} disabled={locked} onChange={e=>set('status',e.target.value)}
          style={{padding:'6px 8px',border:'none',background:'none',fontSize:12,fontFamily:'inherit',color:C.textMid,cursor:locked?'not-allowed':'pointer',flexShrink:0,textAlign:'right'}}>
          {Object.entries(AS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>
        <ActionMenu items={[
          ...(locked?[]:[{label:'Share',icon:Share2,onClick:async()=>{
            const r=await shareVehicle(aRef.current,null)
            if(r.copied) showToast('Copied to clipboard','success')
            else if(r.success) showToast('Shared','success')
          },show:!!(a.year&&a.make)}]),
          {label:'Copy VIN',icon:Copy,onClick:()=>{navigator.clipboard?.writeText(a.vin);showToast('VIN copied','success')},show:!!a.vin},
          {label:'Consumer offer',icon:Printer,onClick:printConsumerOffer,show:!!a.appraisedValue},
          {label:'Move to inventory',icon:CheckCircle,onClick:()=>onConvert(aRef.current),show:a.status!=='purchased'&&!!a.vin&&!!a.year},
          {label:'Finalize',icon:ShieldCheck,onClick:doFinalize,show:!locked&&can('finalize')&&!!a.vin&&!!a.year&&!!a.appraisedValue},
          {label:'Unlock',icon:Edit3,onClick:()=>onUnlock&&onUnlock(aRef.current),show:locked},
        ].filter(x=>x.show!==false)}/>
      </div>
      {locked&&(
        <div style={{fontSize:11,color:C.textLight,margin:'-6px 0 12px 32px'}}>
          Finalized by {a.finalizedBy||'—'} on {new Date(a.finalizedAt).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'})}
        </div>
      )}

      {/* Duplicate-VIN warning — this car already has an active appraisal or is in
          inventory. Soft warning (never blocks); offers a jump to the existing record. */}
      {dupMatch&&(
        <div style={{background:C.orangeBg,border:`1.5px solid ${C.orange}`,borderRadius:10,padding:'12px 16px',marginBottom:14,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <AlertTriangle size={20} color={C.orange} style={{flexShrink:0}}/>
          <div style={{flex:1,minWidth:200}}>
            <div style={{fontSize:14,fontWeight:700,color:C.navy}}>This VIN is already in your system</div>
            <div style={{fontSize:12,color:C.textMid,marginTop:2}}>
              {dupMatch.kind==='inventory'
                ? `${dupMatch.label} is already in inventory${dupMatch.stock?` (Stock #${dupMatch.stock})`:''}.`
                : `There's already an active appraisal for ${dupMatch.label}${dupMatch.who?` by ${dupMatch.who}`:''}.`}
              {' '}You can continue, but you may be duplicating an existing record.
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <Btn size="sm" variant="primary" onClick={()=>onOpenExisting&&onOpenExisting(dupMatch)}><ArrowRight size={13}/>Open existing</Btn>
            <Btn size="sm" variant="ghost" onClick={()=>setDupMatch(null)}>Continue anyway</Btn>
          </div>
        </div>
      )}

      {/* Inside a page: a way back and a title. The long accordion is gone —
          each area opens on its own so you're never scrolling past sections you
          didn't want to reach the one you did. */}
      {sub&&(
        <div style={{fontSize:20,fontWeight:700,color:C.navy,letterSpacing:-0.3,marginBottom:16}}>
          {{market:'Comparables',condition:'Condition',history:'History report',customer:'Customer',notes:'Notes',log:'Activity'}[sub]}
        </div>
      )}

      {/* Two-column layout on the hub; a page uses the full width. */}
      <div className={sub?undefined:"two-col"} style={sub?{display:'block'}:{display:'grid',gridTemplateColumns:'minmax(300px, 360px) 1fr',gap:14,alignItems:'start'}}>
        {/* LEFT RAIL — sticks to viewport as the right column scrolls. Hidden
            on a sub-page so the page gets the full width instead of an empty
            column beside it. */}
        <div className="appraisal-left" style={sub?{display:'none'}:{position:'sticky',top:64,alignSelf:'start',maxHeight:'calc(100vh - 76px)',overflowY:'auto',overflowX:'hidden',paddingBottom:8}}>
      <Sec title="Vehicle" icon={Car} accent hidden={!!sub}>
        {/* VIN. Decodes on entry, so there's no Decode button. Once decoded the
            field itself is the VIN display — tap it to copy rather than parking
            a second button beside it. */}
        <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center'}}>
          <div style={{flex:1,position:'relative'}}>
            <Input value={a.vin} onChange={v=>set('vin',v.toUpperCase().replace(/[^A-Z0-9]/g,'').substring(0,17))} placeholder="17-character VIN" style={{fontFamily:'monospace',letterSpacing:0.5,fontSize:14,paddingRight:a.vin.length===17?34:12}}/>
            {a.vin.length===17&&(
              <button onClick={()=>{navigator.clipboard?.writeText(a.vin);setVinCopied(true);setTimeout(()=>setVinCopied(false),1400);}}
                aria-label="Copy VIN" title="Copy VIN"
                style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',padding:4,color:vinCopied?C.green:C.textLight,cursor:'pointer',display:'flex'}}>
                {vinCopied?<Check size={14}/>:<Copy size={14}/>}
              </button>
            )}
          </div>
          {vl&&<RefreshCw size={14} color={C.textLight} style={{animation:'spin 1s linear infinite',flexShrink:0}}/>}
          <button onClick={()=>setShowVINScanner(true)} aria-label="Scan VIN"
            style={{background:'none',border:`1px solid ${C.borderStr}`,borderRadius:7,padding:'8px 10px',color:C.textMid,cursor:'pointer',display:'flex',alignItems:'center',gap:5,fontSize:12,fontFamily:'inherit',flexShrink:0}}>
            <ScanLine size={14}/>Scan
          </button>
        </div>
        {/* No VIN → manual year/make/model/trim picker only. Once a VIN is
            decoded OR the user has picked a vehicle manually, show the summary
            + editable detail fields instead (no duplicate field sets). */}
        {!a.vin&&!(a.year&&a.make&&a.model)?(
          <ManualVehicleEntry data={a} onSet={patch=>{Object.entries(patch).forEach(([k,v])=>set(k,v));}} postal={(onGetDealer?onGetDealer():null)?.postal} onMarket={fetchMktBySpec} busy={ml}/>
        ):(
          <>
            {/* Summary or expand */}
            <VehicleSummary data={a} onEdit={()=>setVehExpanded(p=>!p)}/>
            {/* Expandable details */}
            {vehExpanded&&(
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.navyBorder}`}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:8}}>
              {[{f:'year',l:'Year',ph:''},{f:'make',l:'Make',ph:''},{f:'model',l:'Model',ph:''},{f:'series',l:'Trim',ph:''},{f:'bodyType',l:'Body',ph:''},{f:'engine',l:'Engine',ph:''},{f:'odometer',l:'km',ph:'',t:'number'},{f:'extColour',l:'Ext. Colour',ph:''},{f:'intColour',l:'Int. Colour',ph:''}].map(x=>(
                <div key={x.f} style={{minWidth:0}}>
                  {/* Odometer is the one field the appraiser must supply — the
                      VIN decodes itself and the valuation can't run without km,
                      so it's called out until it's filled. */}
                  <label style={{display:'block',fontSize:10,fontWeight:600,color:x.f==='odometer'&&!a.odometer&&a.make?C.orange:C.textMid,marginBottom:4}}>
                    {x.l}
                    {x.f==='series'&&a.trimOptions?.length>1&&!a.series&&<span style={{color:C.orange,marginLeft:4}}>• pick</span>}
                    {x.f==='odometer'&&!a.odometer&&a.make&&<span style={{color:C.orange,marginLeft:4}}>• enter to price</span>}
                  </label>
                  {x.f==='series'
                    ? <TrimField value={a.series} onChange={v=>set('series',v)} options={a.trimOptions}/>
                    : <Input value={a[x.f]} onChange={v=>set(x.f,v)} placeholder={x.ph} type={x.t||'text'}
                        autoFocus={x.f==='odometer'&&!a.odometer&&!!a.make}
                        style={x.f==='odometer'&&!a.odometer&&a.make?{borderColor:C.orange,boxShadow:`0 0 0 3px ${C.orange}22`}:undefined}/>}
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
          </>
        )}
        {/* Photos — combined into vehicle section */}
        <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.navyBorder}`}}>
          {/* Notes sit with the car — recon items and condition observations are
              things you write while looking at it. */}
          <button onClick={()=>{setSub('notes');window.scrollTo(0,0);}}
            style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'12px 2px',marginBottom:4,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',textAlign:'left'}}>
            <span style={{fontSize:13,color:C.textDark,fontWeight:600}}>Notes</span>
            <span style={{fontSize:12.5,color:C.textLight,marginLeft:'auto',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>
              {a.notes?`${a.notes.slice(0,26)}${a.notes.length>26?'…':''}`:'None'}
            </span>
            <ChevronRight size={15} color={C.textLight} style={{flexShrink:0}}/>
          </button>

          {/* One + rather than two large buttons. On a phone the camera option
              appears; on desktop it's a file picker. */}
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
            <span style={{fontSize:12.5,fontWeight:600,color:C.textMid}}>Photos{a.photos.length>0?` (${a.photos.length})`:''}</span>
            <label className="cap-only" style={{marginLeft:'auto',display:'inline-flex',alignItems:'center',justifyContent:'center',width:30,height:30,borderRadius:15,border:`1px solid ${C.borderStr}`,color:C.textMid,cursor:'pointer',flexShrink:0}} title="Take photo">
              <Camera size={15}/><input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={photo} multiple/>
            </label>
            <label style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:30,height:30,borderRadius:15,border:`1px solid ${C.borderStr}`,color:C.textMid,cursor:'pointer',flexShrink:0}} title="Add photos">
              <Plus size={16}/><input type="file" accept="image/*" style={{display:'none'}} onChange={photo} multiple/>
            </label>
          </div>
        {a.photos.length>0?<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))',gap:8}}>{(a.photos||[]).map(p=><div key={p.id} style={{position:'relative',borderRadius:7,overflow:'hidden',border:`1px solid ${C.border}`}}><img src={p.dataUrl} style={{width:'100%',height:80,objectFit:'cover',display:'block'}} alt=""/><button onClick={()=>setA(prev=>({...prev,photos:prev.photos.filter(ph=>ph.id!==p.id)}))} style={{position:'absolute',top:3,right:3,background:'rgba(0,0,0,0.6)',border:'none',borderRadius:'50%',width:20,height:20,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}><X size={10} color="white"/></button></div>)}</div>:<div style={{fontSize:12,color:C.textLight,paddingBottom:4}}>No photos yet</div>}
        </div>

        {/* Condition and the history report describe the car, so they live in
            this section rather than in a list further down the page. */}
        {!sub&&(
          <div style={{marginTop:12,borderTop:`1px solid ${C.border}`}}>
            {[
              {id:'condition',label:'Condition',      value:[a.tires,a.paint,a.interior,a.mechanical].filter(Boolean).length?`${[a.tires,a.paint,a.interior,a.mechanical].filter(Boolean).length} recorded`:'Not recorded'},
              {id:'history',  label:'History report', value:a.carfax?(a.carfax.clean?'Clean':'Issues found'):'Not pulled'},
            ].map((r,i)=>(
              <button key={r.id} onClick={()=>{setSub(r.id);window.scrollTo(0,0);}}
                style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'12px 2px',background:'none',border:'none',borderBottom:i===0?`1px solid ${C.border}`:'none',cursor:'pointer',fontFamily:'inherit',textAlign:'left'}}>
                <span style={{fontSize:13,color:C.textDark,fontWeight:600}}>{r.label}</span>
                <span style={{fontSize:12.5,color:C.textLight,marginLeft:'auto'}}>{r.value}</span>
                <ChevronRight size={15} color={C.textLight}/>
              </button>
            ))}
          </div>
        )}
      </Sec>

      {/* Offer & Pricing moved to top of right column (above Vehicle History) */}

        </div>{/* end LEFT RAIL */}

        {/* RIGHT COLUMN — all other sections scroll past the sticky vehicle panel */}
        <div style={{minWidth:0}}>

      {/* Notes must live outside the left rail: the rail is hidden while a
          sub-page is open, which left the Notes page blank. */}
      <Sec title="Notes" icon={FileText} hidden={sub!=='notes'} bare>
        <textarea value={a.notes} onChange={e=>set('notes',e.target.value)} placeholder="Recon items, special options, condition observations..." rows={10} autoFocus style={{width:'100%',padding:'12px 14px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:8,fontSize:14,fontFamily:'inherit',resize:'vertical',outline:'none',boxSizing:'border-box',lineHeight:1.6,color:C.textDark}}/>
      </Sec>

      {/* This exact VIN turned up in the market data — the car is advertised
          now, or has recently been through the market. Worth knowing before you
          make an offer, so it sits above everything else. */}
      {!sub&&a._marketMeta?.subjectListing&&(()=>{
        const sl=a._marketMeta.subjectListing;
        const live=sl.status!=='sold';
        return (
          <div style={{marginBottom:14,padding:'14px 16px',borderRadius:10,background:live?C.orangeBg:C.navyMuted,border:`1px solid ${live?C.orange:C.navyBorder}`}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
              <AlertTriangle size={15} color={live?C.orange:C.navy}/>
              <span style={{fontSize:13,fontWeight:800,color:live?C.orange:C.navy}}>
                {live?'This car is advertised right now':'This car was recently on the market'}
              </span>
            </div>
            <div style={{fontSize:12.5,color:C.textMid,lineHeight:1.6}}>
              {live
                ? `Listed by ${sl.dealer||'a seller'}${sl.city?` in ${sl.city}`:''} at ${fmt(sl.price)}${sl.days?`, ${sl.days} days on market`:''}.`
                : `Listed by ${sl.dealer||'a seller'}${sl.city?` in ${sl.city}`:''} at ${fmt(sl.price)} before it came off the market${sl.days?` after ${sl.days} days`:''}.`}
              {Number.isFinite(sl.priceChangePct)&&sl.priceChangePct!==0&&sl.prevPrice
                ? ` Asking price ${sl.priceChangePct<0?'cut':'raised'} ${Math.abs(sl.priceChangePct)}% from ${fmt(sl.prevPrice)}.`
                : ''}
              {/private/i.test(sl.sellerType||'')?' Listed privately.':''}
            </div>
            <div style={{fontSize:12,color:C.textLight,marginTop:6,lineHeight:1.5}}>
              {live
                ? 'The customer may be shopping it themselves, or another store already has it. It is excluded from the comparables — a car cannot be its own comp.'
                : 'It may have sold, or simply been withdrawn.'}
            </div>
            {sl.url&&<a href={sl.url} target="_blank" rel="noopener noreferrer" style={{display:'inline-block',marginTop:8,fontSize:12.5,fontWeight:600,color:C.navy,textDecoration:'none'}}>See the listing ↗</a>}
          </div>
        );
      })()}

      {/* Comparables stands on its own between the car and the money, because
          it's the evidence you check before deciding what to pay. */}
      {!sub&&(
        <button onClick={()=>{setSub('market');window.scrollTo(0,0);}}
          style={{width:'100%',display:'flex',alignItems:'center',gap:14,padding:'18px 18px',marginBottom:14,background:C.teal,border:'none',borderRadius:12,cursor:'pointer',fontFamily:'inherit',textAlign:'left',boxShadow:'0 4px 14px rgba(0,180,166,0.28)'}}>
          <BarChart2 size={22} color="#fff" style={{flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:16,fontWeight:800,color:'#fff',letterSpacing:-0.2}}>Comparables</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.85)',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              {(()=>{
                const n=(a._comps||[]).length||a.activeComps||0;
                if(ml) return 'Loading…';
                if(!n) return (a.year&&a.make&&a.model)||a.vin?.length===17
                  ? 'Not loaded yet'
                  : 'Add a VIN, or year make and model';
                return `${n} listings · ${fmt(a.marketMid)} mid`;
              })()}
            </div>
          </div>
          <ChevronRight size={20} color="#fff" style={{flexShrink:0,opacity:0.9}}/>
        </button>
      )}

      <Sec title="Offer & Pricing" icon={DollarSign} accent hidden={!!sub}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:10,marginBottom:12,alignItems:'start'}}>
          <div style={{minWidth:0}}><label style={{display:'block',fontSize:11,fontWeight:600,color:C.textMid,marginBottom:5}}>Recon Cost ($)</label><Input value={a.reconCost} onChange={v=>set('reconCost',v)} type="number" /></div>
          <div style={{minWidth:0}}><label style={{display:'block',fontSize:11,fontWeight:600,color:C.textMid,marginBottom:5}}>Cert / Transport ($)</label><Input value={a.certCost||''} onChange={v=>set('certCost',v)} type="number" /></div>
          <div style={{minWidth:0}}><label style={{display:'block',fontSize:11,fontWeight:600,color:C.textMid,marginBottom:5}}>Pack ($)</label><Input value={a.pack||''} onChange={v=>set('pack',v)} type="number" /></div>
          <div style={{minWidth:0,gridColumn:'1 / -1'}}><label style={{display:'block',fontSize:11,fontWeight:600,color:C.textMid,marginBottom:5}}>Offer Valid Until</label><Input value={a.offerExpiry||''} onChange={v=>set('offerExpiry',v)} type="date" style={{width:'100%',minWidth:0,boxSizing:'border-box',maxWidth:'100%'}}/></div>
          <div style={{minWidth:0}}><label style={{display:'block',fontSize:11,fontWeight:600,color:C.textMid,marginBottom:5}}>Gross Override ($)</label><Input value={a.targetGrossOverride||''} onChange={v=>set('targetGrossOverride',v)} type="number" placeholder="optional"/></div>
          <div style={{minWidth:0}}><label style={{display:'block',fontSize:11,fontWeight:600,color:C.teal,marginBottom:5}}>Your Offer ($)</label><Input value={a.appraisedValue} onChange={v=>set('appraisedValue',v)} type="number" placeholder="Enter offer" style={{fontSize:15,fontWeight:700}}/></div>
        </div>
        {a.targetGrossOverride&&<div style={{fontSize:9,color:C.textLight,marginTop:-6,marginBottom:10,lineHeight:1.3}}>Override the gross for this car. Pricier units usually warrant more — unless they turn fast (e.g. Toyota/Lexus).</div>}
        {a.offerExpiry&&<div style={{fontSize:9,color:C.textLight,marginTop:-6,marginBottom:10}}>Offer expires {fmtDate(a.offerExpiry)}</div>}
        {/* Suggested Buy — appears once market data is loaded, before/after the
            user enters their own offer. Always a suggestion; user decides. */}
        {a.marketMid&&(()=>{
          const dealer=onGetDealer?onGetDealer():DEFAULT_DEALER;
          const sb=computeSuggestedBuy({...a,comps:a._comps},dealer);
          if(!sb) return null;
          const confColor=sb.confidence==='High'?C.green:sb.confidence==='Medium'?C.navy:C.orange;
          formulaBuyRef.current=sb.suggested;
          const aiSecond=a._ai?.buy?(()=>{
            const gap=Math.round(((a._ai.buy-sb.suggested)/sb.suggested)*100);
            return {buy:a._ai.buy,gap,disagrees:Math.abs(gap)>=8};
          })():null;
          // The two numbers sit together, at the same weight, because they
          // answer the same question by different methods — separating them
          // made the second one look like trivia.
          return(
            <div style={{marginBottom:14,maxWidth:520}}>
              <div style={{display:'flex',gap:0,alignItems:'stretch',border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
                <div style={{flex:1,padding:'12px 14px',minWidth:0}}>
                  <div style={{fontSize:10.5,fontWeight:700,color:C.textLight,letterSpacing:0.4,marginBottom:4}}>SUGGESTED BUY</div>
                  <div style={{fontSize:24,fontWeight:800,color:C.navy,letterSpacing:-0.5,lineHeight:1.1}}>{fmt(sb.suggested)}</div>
                  <div style={{fontSize:10.5,color:confColor,marginTop:3}}>{sb.confidence.toLowerCase()} confidence · formula</div>
                </div>
                {aiSecond&&(
                  <div style={{flex:1,padding:'12px 14px',minWidth:0,borderLeft:`1px solid ${C.border}`,background:aiSecond.disagrees?C.orangeBg:'transparent'}}>
                    <div style={{fontSize:10.5,fontWeight:700,color:C.textLight,letterSpacing:0.4,marginBottom:4}}>SECOND OPINION</div>
                    <div style={{fontSize:24,fontWeight:800,color:aiSecond.disagrees?C.orange:C.navy,letterSpacing:-0.5,lineHeight:1.1}}>{fmt(aiSecond.buy)}</div>
                    <div style={{fontSize:10.5,color:aiSecond.disagrees?C.orange:C.textLight,marginTop:3}}>
                      {aiSecond.gap>0?'+':''}{aiSecond.gap}% · Claude on the comps
                    </div>
                  </div>
                )}
                {aiBusy&&!aiSecond&&(
                  <div style={{flex:1,padding:'12px 14px',borderLeft:`1px solid ${C.border}`,display:'flex',alignItems:'center'}}>
                    <span style={{fontSize:11,color:C.textLight}}>Second opinion…</span>
                  </div>
                )}
              </div>

              {aiSecond?.disagrees&&(
                <div style={{fontSize:12,color:C.orange,marginTop:8,lineHeight:1.5}}>
                  The two methods disagree by {Math.abs(aiSecond.gap)}% — worth a look before you offer.
                </div>
              )}

              <div style={{display:'flex',gap:14,alignItems:'center',marginTop:10,flexWrap:'wrap'}}>
                {(!a.appraisedValue)&&<button onClick={()=>set('appraisedValue',String(sb.suggested))} style={{background:C.navy,color:'#fff',border:'none',borderRadius:7,padding:'9px 16px',fontSize:12.5,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Use {fmt(sb.suggested)}</button>}
                <button onClick={()=>setWhyOpen(o=>!o)} style={{background:'none',border:'none',padding:0,fontSize:12,color:C.textMid,cursor:'pointer',fontFamily:'inherit'}}>{whyOpen?'Hide reasoning':'Why these numbers'}</button>
              </div>

              {whyOpen&&(
                <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,display:'flex',flexDirection:'column',gap:8}}>
                  <div>
                    <div style={{fontSize:10.5,fontWeight:700,color:C.textLight,letterSpacing:0.4,marginBottom:4}}>FORMULA</div>
                    {sb.reasons.map((r,i)=><div key={i} style={{fontSize:12,color:C.textMid,lineHeight:1.5}}>{r}</div>)}
                  </div>
                  {a._ai&&(
                    <div>
                      <div style={{fontSize:10.5,fontWeight:700,color:C.textLight,letterSpacing:0.4,marginBottom:4}}>CLAUDE</div>
                      <div style={{fontSize:12,color:C.textMid,lineHeight:1.5}}>{a._ai.reasoning}</div>
                      <div style={{fontSize:11,color:C.textLight,marginTop:4}}>
                        Retail read {fmt(a._ai.retail)} · {a._ai.compsUsed} comps
                        {a._ai.outOfBand&&<span style={{color:C.red}}> · outside the listing range</span>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
        {a.appraisedValue&&a.marketMid&&(()=>{
          const totalCost=Number(a.appraisedValue)+Number(a.reconCost||0)+Number(a.certCost||0)+Number(a.pack||0);
          const adjPct=Math.round((totalCost/Number(a.marketMid))*100);
          const askingPrice=a.marketMid?Math.round(Number(a.marketMid)*0.98):null;
          const cardBg={background:C.navyMuted,borderRadius:8,padding:'10px 12px',border:`1px solid ${C.border}`};
          const lbl={fontSize:9,color:C.textLight,marginBottom:3,fontWeight:600,textTransform:'uppercase',letterSpacing:0.5};
          return(
            <div style={{marginTop:4}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8,marginBottom:8}}>
                <div style={cardBg}><div style={lbl}>Your Offer</div><div style={{fontSize:15,fontWeight:800,color:C.navy,fontFamily:'monospace'}}>{fmt(a.appraisedValue)}</div></div>
                <div style={cardBg}><div style={lbl}>All-In Cost</div><div style={{fontSize:15,fontWeight:800,color:C.navy,fontFamily:'monospace'}}>{fmt(totalCost)}</div></div>
                <div style={cardBg}><div style={lbl}>Proj. Gross</div><div style={{fontSize:15,fontWeight:800,color:projGross!==null&&projGross<0?C.red:C.green,fontFamily:'monospace'}}>{projGross!==null?fmt(projGross):'—'}</div></div>
                <div style={cardBg}><div style={lbl}>Cost / Market</div><div style={{fontSize:15,fontWeight:800,fontFamily:'monospace',color:adjPct<=92?C.green:adjPct<=100?C.navy:C.red}}>{adjPct}%</div><div style={{fontSize:9,color:C.textLight,marginTop:1}}>Target 85–95%</div></div>
                {askingPrice&&<div style={cardBg}><div style={lbl}>Suggested Retail</div><div style={{fontSize:15,fontWeight:800,color:C.navy,fontFamily:'monospace'}}>{fmt(askingPrice)}</div><div style={{fontSize:9,color:C.textLight,marginTop:1}}>98% of market mid</div></div>}
              </div>
            </div>
          );
        })()}
        {/* Lien Information */}
        <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
          <div style={{fontSize:10,color:C.textLight,fontWeight:600,marginBottom:8,textTransform:'uppercase',letterSpacing:0.5}}>Lien Information</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'flex-end'}}>
            <div style={{flex:1,minWidth:120,display:'flex',flexDirection:'column'}}>
              <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Lienholder</label>
              <input value={a.lienHolder||''} onChange={e=>set('lienHolder',e.target.value)} placeholder="Bank / Finance Co."
                style={{width:'100%',padding:'7px 10px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:12,color:C.textDark,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
            </div>
            <div style={{flex:1,minWidth:100,display:'flex',flexDirection:'column'}}>
              <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Payoff ($)</label>
              <input type="number" value={a.lienPayoff||''} onChange={e=>set('lienPayoff',e.target.value)} 
                style={{width:'100%',padding:'7px 10px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:12,color:C.textDark,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
            </div>
          </div>
        </div>
      </Sec>

      <Sec title="Vehicle History" icon={ShieldCheck} tone="purple" hidden={sub!=='history'} bare>
        <CarfaxBadge carfax={a.carfax} onFetch={pullCarfax} loading={cl} canPull={can('carfax')}/>
      </Sec>

      <Sec title="Market Intelligence" icon={BarChart2} tone="blue" hidden={sub!=='market'} bare>
        {/* Second opinion now sits beside Suggested Buy — no separate block. */}
        {a._marketMeta?.trimMixed&&!marketStale&&(
          <div style={{margin:'0 0 10px',padding:'8px 12px',background:'#FEF2F2',border:`1px solid ${C.red}`,borderRadius:6,fontSize:11,color:C.textMid,display:'flex',alignItems:'flex-start',gap:8}}>
            <AlertTriangle size={12} color={C.red} style={{flexShrink:0,marginTop:1}}/>
            <span>Only <strong>{a._marketMeta.trimMatchCount??0}</strong> comparable{(a._marketMeta.trimMatchCount??0)===1?'':'s'} matched <strong>{a._marketMeta.subjectTrim||'this trim'}</strong> — too few to price against, so the figures below include <strong>other trims</strong>. Review the comps before relying on this band.</span>
          </div>
        )}
        {marketStale&&(
          <div style={{margin:'0 0 10px',padding:'8px 12px',background:'#FFF7ED',border:`1px solid ${C.orange}`,borderRadius:6,fontSize:11,color:C.textMid,display:'flex',alignItems:'center',gap:8}}>
            <RefreshCw size={12} color={C.orange}/>
            <span>Trim changed — re-running the market lookup for <strong>{a.series||'this trim'}</strong>. Figures below are from the previous trim.</span>
          </div>
        )}
        {/* Filters sit behind a control. Nobody opens this page to set a radius
            — they open it to see the cars, so the cars come first. */}
        <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:12}}>
          <button onClick={()=>setFiltersOpen(o=>!o)}
            style={{background:'none',border:'none',padding:0,fontSize:12.5,color:C.textMid,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:5}}>
            {filtersOpen?'Hide filters':'Filters'}
            <span style={{color:C.textLight}}>· {a.searchDistance||150} km</span>
          </button>
          <button onClick={fetchMkt} disabled={ml||a.vin.length!==17} aria-label="Refresh"
            style={{background:'none',border:'none',padding:0,marginLeft:'auto',color:C.textLight,cursor:ml?'default':'pointer',display:'flex'}}>
            <RefreshCw size={14} style={{animation:ml?'spin 1s linear infinite':undefined}}/>
          </button>
        </div>
        <div style={{display:filtersOpen?'flex':'none',gap:10,marginBottom:14,flexWrap:'wrap',alignItems:'flex-end'}}>
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
        </div>
        {!a.marketMid?(
          <div style={{padding:'14px 0',fontSize:12.5,color:C.textLight,lineHeight:1.5}}>
            {ml?'Pulling comparable listings…'
              :a.vin.length!==17?'Enter the VIN to identify the vehicle.'
              :!a.make?'Decoding the VIN…'
              :!Number(a.odometer)?'Enter the odometer reading — pricing needs the kilometres.'
              :'Comparable listings will load automatically.'}
          </div>
        ):(
          <div>
            {/* One summary, not seven boxes. The mid is the number; the spread
                and the context sit under it as a sentence. Everything that was
                a tinted tile — active count, day supply, median km, a letter
                grade — is either here in words or gone, because a screen of
                boxed numbers in five colours reads as noise. */}
            {(()=>{
              const meta=a._marketMeta||{};
              const n=(a._comps||[]).length||meta.activeCount||a.activeComps||0;
              const thin=n<5;
              const days=(a.medianDaysListed!=null?a.medianDaysListed:a.marketDaysSupply);
              // Day supply only appears when sold data supports it — the
              // backend returns null rather than a guess, and a fabricated
              // number here would be worse than a missing one.
              const mds=a.marketDaySupply;
              const bits=[
                `${n} listing${n===1?'':'s'}`,
                meta.matchMode==='trim'?'same trim':'same model',
                days!=null?`${days} days listed`:null,
                a._medianCompMileage?`${fmtN(a._medianCompMileage)} km typical`:null,
                mds!=null?`${mds}-day supply${mds<=45?' · moving fast':mds>=90?' · slow segment':''}`:null,
              ].filter(Boolean);
              return (
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:30,fontWeight:800,color:C.navy,letterSpacing:-0.8,lineHeight:1.05}}>{fmt(a.marketMid)}</div>
                  <div style={{fontSize:13,color:C.textMid,marginTop:4}}>
                    typical asking price · {fmt(a.marketLow)}–{fmt(a.marketHigh)} range
                  </div>
                  <div style={{fontSize:12.5,color:C.textLight,marginTop:6,lineHeight:1.5}}>
                    {bits.join(' · ')}
                  </div>
                  {/* When the search has widened past the subject's trim, a
                      single average spans cars that don't sell for the same
                      money. Showing the median per trim answers the question
                      that average hides: which trims sit above and below. */}
                  {(()=>{
                    const cs=(a._comps||[]).filter(c=>c.trim&&Number.isFinite(c.price));
                    if(cs.length<4) return null;
                    const by={};
                    cs.forEach(c=>{ (by[c.trim]=by[c.trim]||[]).push(c.price); });
                    const rows=Object.entries(by)
                      .filter(([,ps])=>ps.length>=2)
                      .map(([t,ps])=>{
                        const sorted=[...ps].sort((x,y)=>x-y);
                        return {trim:t,n:ps.length,mid:sorted[Math.floor(sorted.length/2)]};
                      })
                      .sort((x,y)=>y.mid-x.mid);
                    if(rows.length<2) return null;
                    const subj=(a.series||'').toLowerCase();
                    return (
                      <div style={{marginTop:12,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                        <div style={{fontSize:10.5,fontWeight:700,color:C.textLight,letterSpacing:0.4,marginBottom:6}}>BY TRIM</div>
                        {rows.map(r=>{
                          const isSubj=subj&&r.trim.toLowerCase().includes(subj);
                          return (
                            <div key={r.trim} style={{display:'flex',alignItems:'baseline',gap:8,fontSize:12.5,padding:'3px 0',color:isSubj?C.navy:C.textMid,fontWeight:isSubj?700:400}}>
                              <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.trim}</span>
                              <span style={{color:C.textLight,fontSize:11.5}}>{r.n}</span>
                              <span style={{fontVariantNumeric:'tabular-nums'}}>{fmt(r.mid)}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {a._marketMeta?.staleFallback&&(
                    <div style={{fontSize:12.5,color:C.orange,marginTop:8,lineHeight:1.5}}>
                      Most of these have been listed over {a._marketMeta.staleDays||200} days. Long-sitting cars are often already sold or mispriced, so this range is weak evidence.
                    </div>
                  )}
                  {a._marketMeta?.staleDropped>0&&(
                    <div style={{fontSize:12.5,color:C.textLight,marginTop:6,lineHeight:1.5}}>
                      {a._marketMeta.staleDropped} listing{a._marketMeta.staleDropped===1?'':'s'} excluded for sitting over {a._marketMeta.staleDays||200} days.
                    </div>
                  )}
                  {thin&&(
                    <div style={{fontSize:12.5,color:C.orange,marginTop:8,lineHeight:1.5}}>
                      Thin data — treat as directional.
                    </div>
                  )}
                  {/* Widespread discounting means asking prices are ahead of what
                      buyers will pay, so the band above reads high. */}
                  {(()=>{
                    const cs=(a._comps||[]).filter(c=>Number.isFinite(c.priceChangePct)&&c.priceChangePct<0);
                    if(!cs.length||!n) return null;
                    const share=Math.round((cs.length/n)*100);
                    const avg=Math.round(cs.reduce((t,c)=>t+Math.abs(c.priceChangePct),0)/cs.length*10)/10;
                    if(share<25) return null;
                    return (
                      <div style={{fontSize:12.5,color:C.orange,marginTop:8,lineHeight:1.5}}>
                        {cs.length} of {n} have cut their price, averaging {avg}% — asks are running ahead of the market, so treat this range as optimistic.
                      </div>
                    );
                  })()}
                  {a._marketMeta?.trimMixed&&(
                    <div style={{fontSize:12.5,color:C.orange,marginTop:6,lineHeight:1.5}}>
                      Includes other trims — only {a._marketMeta.trimMatchCount??0} matched {a._marketMeta.subjectTrim||'this trim'}.
                    </div>
                  )}
                </div>
              );
            })()}
            {/* Live Competitive Set — real VinAudit listings with links */}
            {a._comps&&a._comps.length>0&&<div style={{marginBottom:10}}><CompSet comps={a._comps} myPrice={a.appraisedValue} myKm={a.odometer} subjectTrim={a.series}/></div>}
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

      <Sec title="Vehicle Condition" icon={CheckCircle} hidden={sub!=='condition'} bare>
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10,marginBottom:10}}>
          {[{f:'tires',l:'Tires',o:['Good','Fair','Needs Replacement']},{f:'paint',l:'Paint / Body',o:['Clean','Minor Scratches','Needs Work','Repainted']},{f:'interior',l:'Interior',o:['Clean','Fair','Poor']},{f:'mechanical',l:'Mechanical',o:['Good','Minor Issues','Major Issues']}].map(x=><Field key={x.f} label={x.l}><Sel value={a[x.f]} onChange={v=>set(x.f,v)} options={x.o}/></Field>)}
        </div>
        <div onClick={()=>set('accidentVisible',!a.accidentVisible)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:a.accidentVisible?C.redBg:C.navyMuted,borderRadius:7,border:`1px solid ${a.accidentVisible?C.red:C.navyBorder}`,cursor:'pointer'}}>
          <input type="checkbox" checked={a.accidentVisible} readOnly style={{width:15,height:15,accentColor:C.red}}/>
          <span style={{fontSize:13,fontWeight:600,color:a.accidentVisible?C.red:C.textDark}}>Accident / Damage Visible</span>
          {a.accidentVisible&&<AlertTriangle size={15} color={C.red} style={{marginLeft:'auto'}}/>}
        </div>
      </Sec>

      <Sec title="Customer Information" icon={User} tone="orange" hidden={sub!=='customer'} bare>
        <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
          <Field label="First Name" half><Input value={a.firstName} onChange={v=>set('firstName',v)} placeholder="John"/></Field>
          <Field label="Last Name" half><Input value={a.lastName} onChange={v=>set('lastName',v)} placeholder="Smith"/></Field>
          <Field label="Phone" half><Input value={a.phone} onChange={v=>set('phone',v)} placeholder="416-555-0100" type="tel"/></Field>
          <Field label="Email" half><Input value={a.email} onChange={v=>set('email',v)} placeholder="john@email.com" type="email"/></Field>
          <Field label="Province" half><Sel value={a.province} onChange={v=>set('province',v)} options={['ON','QC','BC','AB','MB','SK','NS','NB','NL','PE','NT','YT','NU']}/></Field>
          <Field label="Lien Payoff ($)" half><Input value={a.lienPayoff} onChange={v=>set('lienPayoff',v)} type="number" placeholder="0"/></Field>
        </div>
      </Sec>

      <Sec title="Action Log" icon={Activity} hidden={sub!=='log'} bare>
        <ActionLog entries={a.log}/>
      </Sec>

          {/* Each area opens as its own page; the row carries its current value
              so you can tell whether it's worth opening. */}
          {!sub&&(
            <div style={{marginTop:14,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',background:'#fff'}}>
              {[
                {id:'customer', label:'Customer',       value:[a.firstName,a.lastName].filter(Boolean).join(' ')||'None'},
                {id:'log',      label:'Activity',       value:`${(a.log||[]).length} entries`},
              ].map((r,i,arr)=>(
                <button key={r.id} onClick={()=>{setSub(r.id);window.scrollTo(0,0);}}
                  style={{width:'100%',display:'flex',alignItems:'center',gap:12,padding:'14px 16px',background:'none',border:'none',borderBottom:i<arr.length-1?`1px solid ${C.border}`:'none',cursor:'pointer',fontFamily:'inherit',textAlign:'left'}}>
                  <span style={{fontSize:13.5,color:C.textDark,fontWeight:600,flexShrink:0}}>{r.label}</span>
                  <span style={{fontSize:12.5,color:C.textLight,marginLeft:'auto',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{r.value}</span>
                  <ChevronRight size={15} color={C.textLight} style={{flexShrink:0}}/>
                </button>
              ))}
            </div>
          )}
        </div>{/* end RIGHT COLUMN */}
      </div>{/* end two-col */}

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,padding:'4px 4px 8px',fontSize:11,color:C.textLight}}>
        <span>Created {new Date(a.createdAt).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'})}</span>
        <span>Last saved {savedAt?new Date(savedAt).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'}):'—'}</span>
      </div>
    </div>
  );
}
// ─── APPRAISAL LIST ───────────────────────────────────────────────────
function AppraisalList({appraisals,onNew,onEdit}) {
  const [q,setQ]=useState('');const [fs,setFs]=useState('');const [sort,setSort]=useState('newest');
  const filtered=appraisals
    .filter(a=>(!q||[a.vin,a.make,a.model,a.year,a.series,a.firstName,a.lastName,a.phone]
      .some(v=>(v||'').toString().toLowerCase().includes(q.toLowerCase())))&&(!fs||a.status===fs))
    // Most recently touched first by default — an appraisal you were just
    // working on is the one you're most likely coming back to.
    .sort((a,b)=>{
      if(sort==='oldest') return new Date(a.updatedAt||a.createdAt||0)-new Date(b.updatedAt||b.createdAt||0);
      if(sort==='created') return new Date(b.createdAt||0)-new Date(a.createdAt||0);
      if(sort==='value') return Number(b.appraisedValue||0)-Number(a.appraisedValue||0);
      return new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0);
    });
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
        <select value={sort} onChange={e=>setSort(e.target.value)} style={{padding:'8px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontFamily:'inherit',outline:'none'}}>
          <option value="newest">Recently updated</option>
          <option value="created">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="value">Highest value</option>
        </select>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:14}} className='stat-grid-4'>
        {Object.entries(AS).map(([k,s])=><div key={k} style={{background:C.card,borderRadius:7,padding:'10px 14px',border:`1px solid ${C.border}`}}><div style={{fontSize:10,color:C.textLight,fontWeight:600,marginBottom:3}}>{s.label}</div><div style={{fontSize:20,fontWeight:800,color:s.color,fontFamily:'monospace'}}>{appraisals.filter(a=>a.status===k).length}</div></div>)}
      </div>
      {filtered.length===0?<Card style={{padding:'40px',textAlign:'center'}}><ClipboardList size={32} color={C.navyBorder} style={{marginBottom:10}}/><div style={{fontSize:14,fontWeight:700,color:C.textMid,marginBottom:14}}>No appraisals yet</div><Btn onClick={onNew}><Plus size={13}/>New Appraisal</Btn></Card>:(
        <Card style={{overflow:'hidden'}}>{filtered.map((a,i)=><div key={a.id} onClick={()=>onEdit(a)} style={{padding:'12px 16px',borderBottom:i<filtered.length-1?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',gap:12,cursor:'pointer',transition:'background 0.15s'}} onMouseEnter={e=>e.currentTarget.style.background=C.navyMuted} onMouseLeave={e=>e.currentTarget.style.background='transparent'}><div style={{width:38,height:38,background:makeColor(a.make),borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><span style={{fontSize:14,fontWeight:800,color:'#fff'}}>{(a.make||'?').charAt(0).toUpperCase()}</span></div><div style={{flex:1}}><div style={{fontWeight:700,fontSize:13,color:C.navy}}>{[a.year,a.make,a.model,a.series].filter(Boolean).join(' ')||'Untitled'}</div><div style={{display:'flex',gap:10,marginTop:2}}>{a.vin&&<span style={{fontSize:11,fontFamily:'monospace',color:C.textLight}}>{a.vin}</span>}{a.odometer&&<span style={{fontSize:11,color:C.textLight}}>{fmtN(a.odometer)} km</span>}</div></div><ABadge status={a.status}/>{a.carfax&&<ShieldCheck size={14} color={a.carfax.clean?C.green:C.red}/>}{a.appraisedValue&&<div style={{fontSize:14,fontWeight:800,color:C.navy,fontFamily:'monospace'}}>{fmt(a.appraisedValue)}</div>}<div style={{fontSize:11,color:C.textLight,textAlign:'right'}}>{fmtDate(a.createdAt)}</div><ChevronRight size={13} color={C.textLight}/></div>)}</Card>
      )}
    </div>
  );
}

// ─── INVENTORY LIST ───────────────────────────────────────────────────
// ─── BULK IMPORT / INVENTORY SYNC ─────────────────────────────────────
// Reads an .xlsx/.xls/.csv with arbitrary column layouts, fuzzy-maps headers
// to our fields, diffs against existing inventory by VIN, and applies:
//   • new VINs  → add (queued for one VinAudit fetch each)
//   • existing  → auto-apply changed fields from the sheet
//   • missing   → 3-sync grace period, then prompt to verify gone
// Designed so a Gmail Apps Script can later feed the same engine automatically.

// Canonical fields and the header aliases we recognize (lowercased, stripped).
const IMPORT_FIELDS = [
  { key:'vin',        label:'VIN',        required:true,  aliases:['vin','vinnumber','vin#','vinno','vehicleidentificationnumber','serialnumber'] },
  { key:'odometer',   label:'Odometer',   required:true,  aliases:['odometer','odo','mileage','miles','km','kms','kilometers','kilometres','mileagekm'] },
  { key:'stockNumber',label:'Stock #',    required:false, aliases:['stock','stock#','stockno','stocknumber','stk','stk#','unit','unit#'] },
  { key:'year',       label:'Year',       required:false, aliases:['year','yr','modelyear','my'] },
  { key:'make',       label:'Make',       required:false, aliases:['make','manufacturer','brand'] },
  { key:'model',      label:'Model',      required:false, aliases:['model','modelname'] },
  { key:'series',     label:'Trim',       required:false, aliases:['trim','series','grade','style','submodel','trimlevel'] },
  { key:'bodyType',   label:'Body',       required:false, aliases:['body','bodytype','bodystyle','type'] },
  { key:'extColour',  label:'Ext. Colour',required:false, aliases:['color','colour','extcolor','extcolour','exteriorcolor','exteriorcolour','extcolor'] },
  { key:'intColour',  label:'Int. Colour',required:false, aliases:['interior','intcolor','intcolour','interiorcolor','interiorcolour'] },
  { key:'engine',     label:'Engine',     required:false, aliases:['engine','enginedescription','motor'] },
  { key:'transmission',label:'Transmission',required:false,aliases:['transmission','trans','gearbox'] },
  { key:'drivetrain', label:'Drivetrain', required:false, aliases:['drivetrain','drive','drivetype','driveline'] },
  { key:'listPrice',  label:'List Price', required:false, aliases:['price','listprice','retailprice','askingprice','internetprice','advertisedprice','msrp','saleprice'] },
  { key:'unitCost',   label:'Unit Cost',  required:false, aliases:['cost','unitcost','acv','bookvalue','wholesale','purchaseprice','acquisitioncost'] },
]

const normHeader = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'')

// Some sheets bundle year/make/model/trim into one column (e.g. "2025 Hyundai
// Elantra Luxury"). Detect that column and split it as a fallback — VIN decode
// remains authoritative and overrides these once enrichment runs.
const VEHICLE_DESC_ALIASES=['vehicle','vehicledescription','description','yearmakemodel','ymm','unitdescription']
function findDescColumn(headers){
  const norm=headers.map(normHeader)
  for(const a of VEHICLE_DESC_ALIASES){ const i=norm.indexOf(a); if(i!==-1) return i }
  return -1
}
function parseVehicleDesc(s){
  s=String(s||'').trim()
  const m=s.match(/\b(19|20)\d{2}\b/)
  const year=m?m[0]:''
  let rest=year?s.replace(year,'').trim():s
  const parts=rest.split(/\s+/).filter(Boolean)
  return { year, make:parts[0]||'', model:parts[1]||'', series:parts.slice(2).join(' ')||'' }
}

// Auto-map sheet headers → our fields. Returns { fieldKey: columnIndex|null }
function autoMapColumns(headers){
  const norm = headers.map(normHeader)
  const map = {}
  for(const f of IMPORT_FIELDS){
    let idx = -1
    // exact alias match first
    for(const a of f.aliases){ const i=norm.indexOf(a); if(i!==-1){ idx=i; break; } }
    // then "contains" match (e.g. "Mileage (km)")
    if(idx===-1){ idx = norm.findIndex(h=> f.aliases.some(a=> h.includes(a) || a.includes(h)&&h.length>2 )) }
    map[f.key] = idx===-1 ? null : idx
  }
  return map
}

// Normalize a raw cell for a given field (VIN upper, numbers stripped of $/commas).
function normCell(field, raw){
  let s = raw==null ? '' : String(raw).trim()
  if(field==='vin') return s.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,17)
  if(['odometer','listPrice','unitCost','year'].includes(field)) return s.replace(/[^0-9.]/g,'')
  return s
}

function BulkImport({ existingVehicles, onClose, onApply, dealer }){
  const [stage,setStage]=useState('upload')   // upload | map | diff | done
  const [fileName,setFileName]=useState('')
  const [headers,setHeaders]=useState([])
  const [rows,setRows]=useState([])           // array of raw cell arrays
  const [colMap,setColMap]=useState({})
  const [descCol,setDescCol]=useState(-1)
  const [error,setError]=useState('')
  const [diff,setDiff]=useState(null)         // {added:[], updated:[], missing:[]}

  function handleFile(e){
    const file=e.target.files?.[0]; if(!file) return
    setFileName(file.name); setError('')
    const reader=new FileReader()
    reader.onload=ev=>{
      try{
        const wb=XLSX.read(ev.target.result,{type:'array'})
        const ws=wb.Sheets[wb.SheetNames[0]]
        const aoa=XLSX.utils.sheet_to_json(ws,{header:1,blankrows:false,defval:''})
        if(!aoa.length){ setError('That sheet looks empty.'); return }
        // Find the header row: first row with >=2 non-empty cells that look like labels
        let hIdx=0
        for(let i=0;i<Math.min(aoa.length,10);i++){ if(aoa[i].filter(c=>String(c).trim()).length>=2){ hIdx=i; break } }
        const hdrs=aoa[hIdx].map(h=>String(h).trim())
        const dataRows=aoa.slice(hIdx+1).filter(r=>r.some(c=>String(c).trim()))
        setHeaders(hdrs); setRows(dataRows); setColMap(autoMapColumns(hdrs)); setDescCol(findDescColumn(hdrs)); setStage('map')
      }catch(err){ setError('Could not read that file. Make sure it is a valid .xlsx, .xls, or .csv.') }
    }
    reader.onerror=()=>setError('Could not read that file.')
    reader.readAsArrayBuffer(file)
  }

  // Build parsed records from rows using the (possibly user-corrected) colMap
  function parseRecords(){
    return rows.map(r=>{
      const rec={}
      for(const f of IMPORT_FIELDS){
        const ci=colMap[f.key]
        if(ci!=null && ci>=0) rec[f.key]=normCell(f.key, r[ci])
      }
      // If year/make/model weren't directly mapped, fall back to parsing a
      // combined "Vehicle" description column (decode later overrides these).
      if(descCol>=0 && (!rec.year||!rec.make||!rec.model)){
        const p=parseVehicleDesc(r[descCol])
        if(!rec.year) rec.year=p.year
        if(!rec.make) rec.make=p.make
        if(!rec.model) rec.model=p.model
        if(!rec.series) rec.series=p.series
      }
      return rec
    }).filter(rec=> (rec.vin||'').length===17)   // must have a valid VIN length
  }

  function computeDiff(){
    const records=parseRecords()
    const byVin={}; existingVehicles.forEach(v=>{ if(v.vin) byVin[v.vin.toUpperCase()]=v })
    const sheetVins=new Set(records.map(r=>r.vin))
    const added=[], updated=[]
    for(const rec of records){
      const ex=byVin[rec.vin]
      if(!ex){ added.push(rec); continue }
      // figure out which fields changed
      const changes={}
      for(const f of IMPORT_FIELDS){
        if(f.key==='vin') continue
        const nv=rec[f.key]
        if(nv!=null && nv!=='' && String(ex[f.key]??'')!==String(nv)){ changes[f.key]={from:ex[f.key]??'',to:nv} }
      }
      if(Object.keys(changes).length) updated.push({vehicle:ex, changes, rec})
    }
    // missing: in system, not in sheet → bump missingCount; flag at >=3
    const missing=[]
    existingVehicles.forEach(v=>{
      if(v.status==='sold') return
      if(v.vin && !sheetVins.has(v.vin.toUpperCase())){
        const count=(v._missingCount||0)+1
        missing.push({vehicle:v, count})
      }
    })
    setDiff({added,updated,missing}); setStage('diff')
  }

  function applyAll(target){
    onApply({ diff, target, dealer })
    setStage('done')
  }

  const required=IMPORT_FIELDS.filter(f=>f.required)
  const mapReady=required.every(f=>colMap[f.key]!=null && colMap[f.key]>=0)
  const validCount=rows.filter(r=>{ const ci=colMap.vin; return ci!=null&&String(r[ci]||'').replace(/[^A-Za-z0-9]/g,'').length===17 }).length

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',zIndex:9998,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'4vh 16px',overflowY:'auto'}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:14,maxWidth:760,width:'100%',boxShadow:'0 20px 60px rgba(0,0,0,0.3)',overflow:'hidden'}}>
        <div style={{padding:'16px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:34,height:34,borderRadius:8,background:C.navyMuted,display:'flex',alignItems:'center',justifyContent:'center'}}><Upload size={17} color={C.navy}/></div>
          <div style={{flex:1}}><div style={{fontWeight:800,fontSize:16,color:C.navy}}>Bulk Import / Sync</div><div style={{fontSize:12,color:C.textLight}}>{stage==='upload'?'Upload an inventory spreadsheet (any layout)':stage==='map'?'Confirm column mapping':stage==='diff'?'Review changes before applying':'Done'}</div></div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:C.textLight}}><X size={20}/></button>
        </div>

        <div style={{padding:20,maxHeight:'70vh',overflowY:'auto'}}>
          {error&&<div style={{background:C.redBg,border:`1px solid ${C.red}`,borderRadius:8,padding:'10px 12px',fontSize:13,color:C.red,marginBottom:14}}>{error}</div>}

          {stage==='upload'&&(
            <div>
              <label style={{display:'block',border:`2px dashed ${C.navyBorder}`,borderRadius:12,padding:'40px 20px',textAlign:'center',cursor:'pointer',background:C.navyMuted}}>
                <Upload size={28} color={C.navy} style={{marginBottom:10}}/>
                <div style={{fontSize:14,fontWeight:700,color:C.navy,marginBottom:4}}>Choose a spreadsheet</div>
                <div style={{fontSize:12,color:C.textLight}}>.xlsx, .xls, or .csv — columns can be in any order</div>
                <input type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={handleFile}/>
              </label>
              <div style={{fontSize:12,color:C.textLight,marginTop:14,lineHeight:1.6}}>
                <strong>Required columns:</strong> VIN and Odometer. Everything else (price, stock #, year/make/model, colours, etc.) is auto-detected if present. New VINs are added; existing VINs are updated from the sheet; cars missing for 3 syncs are flagged for review.
              </div>
            </div>
          )}

          {stage==='map'&&(
            <div>
              <div style={{fontSize:13,color:C.textMid,marginBottom:14}}>We read <strong>{fileName}</strong> — {rows.length} rows, {headers.length} columns. We auto-matched the columns below. Fix any that look wrong, then continue.</div>
              {descCol>=0&&(!colMap.year||!colMap.make||!colMap.model)&&<div style={{background:C.navyMuted,borderRadius:8,padding:'8px 12px',fontSize:12,color:C.textMid,marginBottom:14}}>Detected a combined <strong>"{headers[descCol]}"</strong> column — we'll split year/make/model/trim from it. VIN decode will confirm and fill the rest.</div>}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
                {IMPORT_FIELDS.map(f=>(
                  <div key={f.key} style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:12,fontWeight:600,color:f.required?C.navy:C.textMid,minWidth:90}}>{f.label}{f.required&&<span style={{color:C.red}}> *</span>}</span>
                    <select value={colMap[f.key]==null?'':colMap[f.key]} onChange={e=>setColMap(m=>({...m,[f.key]:e.target.value===''?null:Number(e.target.value)}))} style={{flex:1,padding:'6px 8px',border:`1px solid ${colMap[f.key]==null&&f.required?C.red:C.borderStr}`,borderRadius:6,fontSize:12,fontFamily:'inherit',background:'#fff'}}>
                      <option value="">— not mapped —</option>
                      {headers.map((h,i)=><option key={i} value={i}>{h||`Column ${i+1}`}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
                <div style={{fontSize:12,color:validCount>0?C.green:C.orange,fontWeight:600}}>{validCount} of {rows.length} rows have a valid 17-char VIN</div>
                <div style={{display:'flex',gap:8}}>
                  <Btn variant="ghost" size="sm" onClick={()=>setStage('upload')}>Back</Btn>
                  <Btn size="sm" disabled={!mapReady||validCount===0} onClick={computeDiff}>Review Changes →</Btn>
                </div>
              </div>
              {!mapReady&&<div style={{fontSize:11,color:C.red,marginTop:8}}>Map the required fields (VIN, Odometer) to continue.</div>}
            </div>
          )}

          {stage==='diff'&&diff&&(
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
                <div style={{background:C.greenBg,borderRadius:8,padding:'12px',textAlign:'center'}}><div style={{fontSize:22,fontWeight:800,color:C.green}}>{diff.added.length}</div><div style={{fontSize:11,color:C.textMid,fontWeight:600}}>New cars</div></div>
                <div style={{background:C.navyMuted,borderRadius:8,padding:'12px',textAlign:'center'}}><div style={{fontSize:22,fontWeight:800,color:C.navy}}>{diff.updated.length}</div><div style={{fontSize:11,color:C.textMid,fontWeight:600}}>Updated</div></div>
                <div style={{background:C.orangeBg,borderRadius:8,padding:'12px',textAlign:'center'}}><div style={{fontSize:22,fontWeight:800,color:C.orange}}>{diff.missing.filter(m=>m.count>=3).length}</div><div style={{fontSize:11,color:C.textMid,fontWeight:600}}>Missing 3+ syncs</div></div>
              </div>

              {diff.added.length>0&&<div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:700,color:C.green,marginBottom:6}}>New cars to add ({diff.added.length}) — each uses one market-data lookup</div>
                <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',maxHeight:160,overflowY:'auto'}}>
                  {diff.added.map((r,i)=><div key={i} style={{padding:'7px 12px',borderBottom:i<diff.added.length-1?`1px solid ${C.border}`:'none',fontSize:12,display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontFamily:'monospace',color:C.textDark}}>{r.vin}</span><span style={{color:C.textLight}}>{[r.year,r.make,r.model].filter(Boolean).join(' ')||'—'} · {r.odometer?Number(r.odometer).toLocaleString():'—'} km</span></div>)}
                </div>
              </div>}

              {diff.updated.length>0&&<div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:700,color:C.navy,marginBottom:6}}>Updated cars ({diff.updated.length}) — changes auto-applied from sheet</div>
                <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',maxHeight:180,overflowY:'auto'}}>
                  {diff.updated.map((u,i)=><div key={i} style={{padding:'7px 12px',borderBottom:i<diff.updated.length-1?`1px solid ${C.border}`:'none',fontSize:12}}>
                    <div style={{fontFamily:'monospace',color:C.textDark,marginBottom:2}}>{u.vehicle.vin} <span style={{color:C.textLight,fontFamily:'inherit'}}>#{u.vehicle.stockNumber}</span></div>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{Object.entries(u.changes).map(([k,c])=><span key={k} style={{fontSize:10,background:C.navyMuted,borderRadius:6,padding:'2px 7px',color:C.textMid}}>{IMPORT_FIELDS.find(f=>f.key===k)?.label||k}: {String(c.from)||'—'} → <strong>{String(c.to)}</strong></span>)}</div>
                  </div>)}
                </div>
              </div>}

              {diff.missing.filter(m=>m.count>=3).length>0&&<div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:700,color:C.orange,marginBottom:6}}>Missing 3+ syncs — verify these are gone</div>
                <div style={{border:`1px solid ${C.orange}`,borderRadius:8,overflow:'hidden',maxHeight:140,overflowY:'auto'}}>
                  {diff.missing.filter(m=>m.count>=3).map((m,i)=><div key={i} style={{padding:'7px 12px',fontSize:12,display:'flex',justifyContent:'space-between',gap:8,background:C.orangeBg}}><span>{[m.vehicle.year,m.vehicle.make,m.vehicle.model].filter(Boolean).join(' ')} <span style={{fontFamily:'monospace',color:C.textLight}}>#{m.vehicle.stockNumber}</span></span><span style={{color:C.orange,fontWeight:600}}>absent {m.count} syncs</span></div>)}
                </div>
              </div>}

              <div style={{background:C.navyMuted,borderRadius:8,padding:'10px 12px',fontSize:11,color:C.textMid,marginBottom:14}}>
                New cars will be decoded (free) and queued for one market-data lookup each. Existing cars get the sheet's changes applied immediately. Missing cars are only flagged — nothing is deleted automatically.
              </div>

              <div style={{display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap'}}>
                <Btn variant="ghost" size="sm" onClick={()=>setStage('map')}>Back</Btn>
                <Btn size="sm" onClick={()=>applyAll('inventory')}>Apply to Inventory</Btn>
                <Btn size="sm" variant="teal" onClick={()=>applyAll('appraisals')}>Create Appraisals</Btn>
              </div>
            </div>
          )}

          {stage==='done'&&(
            <div style={{textAlign:'center',padding:'24px 0'}}>
              <CheckCircle size={40} color={C.green} style={{marginBottom:12}}/>
              <div style={{fontSize:16,fontWeight:800,color:C.navy,marginBottom:4}}>Import applied</div>
              <div style={{fontSize:13,color:C.textMid,marginBottom:18}}>New cars are being decoded and queued for market data. You can close this window.</div>
              <Btn onClick={onClose}>Done</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InventoryList({vehicles,onAdd,onImport,onEdit}) {
  const [q,setQ]=useState('');const [fs,setFs]=useState('');const [sort,setSort]=useState('newest');
  const filtered=vehicles.filter(v=>(!q||[v.vin,v.make,v.model,v.year,v.stockNumber].some(x=>(x||'').toLowerCase().includes(q.toLowerCase())))&&(!fs||v.status===fs)).sort((a,b)=>sort==='newest'?new Date(b.createdAt)-new Date(a.createdAt):sort==='price_high'?Number(b.listPrice||0)-Number(a.listPrice||0):sort==='price_low'?Number(a.listPrice||0)-Number(b.listPrice||0):daysAgo(b.createdAt)-daysAgo(a.createdAt));
  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <div><h2 style={{fontSize:18,fontWeight:800,color:C.navy}}>Inventory</h2><p style={{fontSize:13,color:C.textLight}}>{vehicles.filter(v=>v.status==='available').length} available · {vehicles.length} total</p></div>
        <div style={{display:'flex',gap:8}}>
          <Btn onClick={onImport} variant="outline"><Upload size={13}/>Import / Sync</Btn>
          <Btn onClick={onAdd}><Plus size={13}/>Add Vehicle</Btn>
        </div>
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
            <div style={{width:44,height:44,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,overflow:'hidden',background:v.photos?.length>0&&v.photos[0]?.dataUrl?C.navyMuted:makeColor(v.make)}}>{v.photos?.length>0&&v.photos[0]?.dataUrl?<img src={v.photos[0].dataUrl} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>:<span style={{fontSize:16,fontWeight:800,color:'#fff'}}>{(v.make||'?').charAt(0).toUpperCase()}</span>}</div>
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
function VehicleDetail({vehicle:iv,onSave,onBack,showToast,onShowSticker=()=>{},onGetDealer,user='Staff',can=()=>true}) {
  const [v,setV]=useState(iv);
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

  async function decode(){if(v.vin.length!==17){showToast('Valid 17-char VIN required','error');return;}setVl(true);try{const d=await decodeVIN(v.vin.toUpperCase());up(d);setVehExpandedDetail(true);showToast(`Decoded: ${[d.year,d.make,d.model].filter(Boolean).join(' ')||'partial — review fields'}`,'success');}catch{showToast('Could not decode — enter manually','error');}finally{setVl(false);}}
  async function genDesc(){setDl(true);try{
    const d=await generateDescription(v, onGetDealer?onGetDealer():null);
    const cur=vRef.current;
    // Merge AI options into existing features (case-insensitive dedup).
    const existing=cur.features||[];
    const lower=new Set(existing.map(f=>f.toLowerCase().trim()));
    const added=(d.options||[]).filter(o=>o&&!lower.has(o.toLowerCase().trim()));
    const mergedFeatures=[...existing,...added];
    up({description:d.description||cur.description, features:mergedFeatures, damageFlags:d.damageFlags||[]});
    const bits=['Description generated'];
    if(added.length) bits.push(`${added.length} option${added.length>1?'s':''} added`);
    if((d.damageFlags||[]).length) bits.push(`${d.damageFlags.length} item${d.damageFlags.length>1?'s':''} to verify`);
    showToast(bits.join(' · '),'success');
  }catch(e){showToast(e.message||'Generation failed','error');}finally{setDl(false);}}
  async function refMkt(){
    if(!v.vin||v.vin.length!==17){showToast('Valid VIN required','error');return;}
    const dealer=onGetDealer?onGetDealer():null;
    const postal=dealer?.postal;
    if(!postal){showToast('Set your dealer postal code in Settings first','error');return;}
    setMl(true);
    try{
      const m=await fetchMarketData(v.vin,postal,v.searchDistance||250,v.drivetrain||"",v.series||"");
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
  return (
    <div>
      {showVINScannerDetail&&<VINScanner onVINDetected={val=>{up({vin:val});setVehExpandedDetail(true);}} onClose={()=>setShowVINScannerDetail(false)}/>}

      {/* Top action bar */}
      <Card style={{padding:'12px 16px',marginBottom:12}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <button onClick={()=>{ if(isDirty) forceSaveV(); onBack(); }} style={{display:'flex',alignItems:'center',gap:4,background:'none',border:`1px solid ${C.borderStr}`,borderRadius:7,padding:'8px 12px',fontSize:12,fontWeight:600,color:C.textMid,cursor:'pointer',fontFamily:'inherit'}}><ChevronLeft size={14}/>Back</button>
          <SaveStatus isDirty={isDirty} savedAt={savedAt} onSave={forceSaveV}/>
          <span style={{fontSize:11,fontFamily:'monospace',color:C.textLight}}>#{v.stockNumber}</span>
          <span style={{fontSize:11,color:ageColor(days),fontFamily:'monospace'}}>· {days} days on lot</span>
          <div style={{flex:1}}/>
          <select value={v.status} onChange={e=>up({status:e.target.value})} style={{padding:'7px 10px',border:`1px solid ${C.borderStr}`,borderRadius:7,fontSize:12,fontFamily:'inherit',background:'#fff'}}>
            {Object.entries(VS).map(([k,s])=><option key={k} value={k}>{s.label}</option>)}
          </select>
          <button onClick={()=>onShowSticker(vRef.current)} style={{display:'flex',alignItems:'center',gap:5,background:C.navyMuted,border:`1px solid ${C.navyBorder}`,borderRadius:7,padding:'8px 12px',fontSize:12,fontWeight:700,color:C.navy,cursor:'pointer',fontFamily:'inherit'}}><Printer size={13}/>Sticker</button>
          <button onClick={async()=>{const r=await shareVehicle(v,onGetDealer?onGetDealer():null); if(r.copied) showToast('Vehicle info copied to clipboard','success'); else if(r.success) showToast('Shared!','success'); else if(r.reason!=='cancelled') showToast('Tap again or check permissions','error');}} style={{background:C.teal,color:'#fff',border:'none',borderRadius:7,padding:'8px 14px',fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}><Share2 size={14}/>Share</button>
          {v.status==='in_recon'&&<button onClick={()=>up({status:'available'})} style={{display:'flex',alignItems:'center',gap:5,background:C.green,border:'none',borderRadius:7,padding:'8px 14px',fontSize:12,fontWeight:700,color:'#fff',cursor:'pointer',fontFamily:'inherit'}}><CheckCircle size={13}/>Mark Available</button>}
          {v.status==='available'&&<button onClick={()=>up({status:'sold'})} style={{display:'flex',alignItems:'center',gap:5,background:'#fff',border:`1.5px solid ${C.navy}`,borderRadius:7,padding:'8px 14px',fontSize:12,fontWeight:700,color:C.navy,cursor:'pointer',fontFamily:'inherit'}}><Tag size={13}/>Mark Sold</button>}
        </div>
      </Card>

      {/* Two-column floating layout (mirrors appraisal) */}
      <div className="two-col" style={{display:'grid',gridTemplateColumns:'minmax(340px,400px) 1fr',gap:14,alignItems:'start'}}>

        {/* ── LEFT RAIL (floating) ── */}
        <div className="appraisal-left" style={{position:'sticky',top:64,alignSelf:'start',maxHeight:'calc(100vh - 76px)',overflowY:'auto',overflowX:'hidden',paddingBottom:8}}>

          <Sec title="Vehicle" icon={Car} accent>
            <div style={{display:'flex',gap:8,marginBottom:10}}>
              <div style={{flex:1}}><Input value={v.vin} onChange={val=>up({vin:val.toUpperCase().replace(/[^A-Z0-9]/g,'').substring(0,17)})} placeholder="17-char VIN" style={{fontFamily:'monospace',letterSpacing:1}}/></div>
              {v.vin&&v.vin.length>=10&&<CopyVIN vin={v.vin}/>}
              <Btn onClick={()=>setShowVINScannerDetail(true)} variant="ghost" size="sm" className="cap-only"><ScanLine size={13}/>Scan</Btn>
              <Btn onClick={decode} disabled={vl||v.vin.length!==17} size="sm"><RefreshCw size={11} style={{animation:vl?'spin 1s linear infinite':undefined}}/>{vl?'...':'Decode'}</Btn>
            </div>
            <VehicleSummary data={v} onEdit={()=>setVehExpandedDetail(p=>!p)}/>
            {vehExpandedDetail&&(
              <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.navyBorder}`}}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:8}}>
                  {[{f:'year',l:'Year',ph:''},{f:'make',l:'Make',ph:''},{f:'model',l:'Model',ph:''},{f:'series',l:'Trim',ph:''},{f:'bodyType',l:'Body',ph:''},{f:'engine',l:'Engine',ph:''},{f:'odometer',l:'KM',ph:'',t:'number'},{f:'extColour',l:'Ext. Colour',ph:''},{f:'intColour',l:'Int. Colour',ph:''}].map(x=>(
                    <div key={x.f} style={{minWidth:0}}>
                      <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>{x.l}{x.f==='series'&&v.trimOptions?.length>1&&!v.series&&<span style={{color:C.orange,marginLeft:4}}>• pick</span>}</label>
                      {x.f==='series'
                        ? <TrimField value={v.series} onChange={val=>up({series:val})} options={v.trimOptions}/>
                        : <Input value={v[x.f]} onChange={val=>up({[x.f]:val})} placeholder={x.ph} type={x.t||'text'}/>}
                    </div>
                  ))}
                  <div style={{minWidth:0}}><label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Transmission</label><Sel value={v.transmission} onChange={val=>up({transmission:val})} options={['Automatic','Manual','CVT','DCT']}/></div>
                  <div style={{minWidth:0}}><label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Drivetrain</label><Sel value={v.drivetrain} onChange={val=>up({drivetrain:val})} options={['FWD','RWD','AWD','4WD','4x4']}/></div>
                </div>
              </div>
            )}

            {/* Options / Features */}
            <div style={{marginTop:12}}>
              <div style={{fontSize:11,fontWeight:600,color:C.textMid,marginBottom:6}}>Options / Features</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>{(v.features||[]).map((f,i)=><span key={i} style={{background:C.navyMuted,color:C.navy,borderRadius:20,padding:'4px 12px',fontSize:12,display:'inline-flex',alignItems:'center',gap:5}}>{f}<button onClick={()=>up({features:v.features.filter((_,j)=>j!==i)})} style={{background:'none',border:'none',color:C.navy,cursor:'pointer',padding:0}}><X size={9}/></button></span>)}</div>
              <div style={{display:'flex',gap:8}}><input id="vfeat" placeholder="Add feature, press Enter" onKeyDown={e=>{if(e.key==='Enter'&&e.target.value.trim()){up({features:[...(v.features||[]),e.target.value.trim()]});e.target.value='';e.preventDefault();}}} style={{flex:1,padding:'7px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontFamily:'inherit',outline:'none'}}/><Btn variant="ghost" size="sm" onClick={()=>{const el=document.getElementById('vfeat');if(el?.value.trim()){up({features:[...(v.features||[]),el.value.trim()]});el.value='';}}}> Add</Btn></div>
            </div>

            {/* Description */}
            <div style={{marginTop:12}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}><div style={{fontSize:11,fontWeight:600,color:C.textMid}}>Listing Description{(v.photos||[]).length>0?<span style={{fontSize:9,color:C.teal,fontWeight:600,marginLeft:6}}>· reads your {v.photos.length} photo{v.photos.length>1?'s':''} for options</span>:''}</div><Btn onClick={genDesc} disabled={dl||!v.year} size="sm"><Sparkles size={11} style={{animation:dl?'spin 1s linear infinite':undefined}}/>{dl?'Generating...':'AI Generate'}</Btn></div>
              <textarea value={v.description} onChange={e=>up({description:e.target.value})} placeholder="Enter description or click AI Generate..." rows={3} style={{width:'100%',padding:'10px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:7,fontSize:13,fontFamily:'inherit',resize:'vertical',outline:'none',boxSizing:'border-box',lineHeight:1.6}}/>
            </div>

            {/* AI damage flags — possible issues seen in photos, to VERIFY in person.
                Explicitly not a condition assessment. */}
            {(v.damageFlags||[]).length>0&&(
            <div style={{marginTop:12,background:C.orangeBg,border:`1px solid ${C.orange}`,borderRadius:8,padding:'10px 12px'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                <AlertTriangle size={13} color={C.orange}/>
                <span style={{fontSize:11,fontWeight:800,color:C.orange,textTransform:'uppercase',letterSpacing:0.5}}>Verify in person</span>
              </div>
              <div style={{fontSize:10.5,color:C.textMid,marginBottom:8,fontStyle:'italic'}}>The AI noticed these in the photos. These are prompts to check — not a condition assessment. Confirm with your own eyes.</div>
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                {(v.damageFlags||[]).map((f,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'flex-start',gap:6,fontSize:12,color:C.textDark}}>
                    <span style={{color:C.orange,flexShrink:0}}>•</span>
                    <span style={{flex:1}}>{f}</span>
                    <button onClick={()=>up({damageFlags:v.damageFlags.filter((_,j)=>j!==i)})} title="Dismiss" style={{background:'none',border:'none',color:C.textLight,cursor:'pointer',padding:0,flexShrink:0}}><X size={11}/></button>
                  </div>
                ))}
              </div>
            </div>
            )}

            {/* Photos — combined into vehicle section */}
            <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.navyBorder}`}}>
              <div style={{fontSize:11,fontWeight:700,color:C.navy,marginBottom:6,display:'flex',alignItems:'center',gap:6}}><Camera size={13}/>Photos {v.photos?.length>0?`(${v.photos.length})`:''}</div>
              <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                <label className="cap-only" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 14px',background:C.navy,color:'#fff',borderRadius:6,fontSize:13,fontWeight:600,cursor:'pointer'}}><Camera size={13}/>Take Photo<input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={photo} multiple/></label>
                <label style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 14px',background:'#fff',color:C.textMid,border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,fontWeight:600,cursor:'pointer'}}><Upload size={13}/>Upload<input type="file" accept="image/*" style={{display:'none'}} onChange={photo} multiple/></label>
              </div>
              {v.photos?.length>0?<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))',gap:8}}>{(v.photos||[]).map(p=><div key={p.id} style={{position:'relative',borderRadius:7,overflow:'hidden',border:`1px solid ${C.border}`}}><img src={p.dataUrl} style={{width:'100%',height:72,objectFit:'cover',display:'block'}} alt=""/><div style={{padding:'3px 5px',background:'#fff'}}><select value={p.category} onChange={e=>up({photos:v.photos.map(ph=>ph.id===p.id?{...ph,category:e.target.value}:ph)})} style={{width:'100%',fontSize:10,border:'none',background:'none',fontFamily:'inherit'}}>{['Front','Rear','Driver Side','Pass. Side','Interior','Odometer','Engine','Damage','Misc'].map(c=><option key={c}>{c}</option>)}</select></div><button onClick={()=>up({photos:v.photos.filter(ph=>ph.id!==p.id)})} style={{position:'absolute',top:3,right:3,background:'rgba(0,0,0,0.6)',border:'none',borderRadius:'50%',width:20,height:20,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}><X size={10} color="white"/></button></div>)}</div>:<div style={{padding:'20px',background:C.navyMuted,borderRadius:7,textAlign:'center',border:`1.5px dashed ${C.navyBorder}`}}><div style={{fontSize:12,color:C.textLight}}>No photos yet</div></div>}
            </div>
          </Sec>

          {/* Pricing (inventory-specific) */}
          {/* Pricing moved to top of right column (above Vehicle History) */}

          {/* Advertising / Feeds (inventory-specific) */}
          <Sec title="Advertising" icon={Radio} open={false} badge={v.feeds&&Object.values(v.feeds).some(f=>f&&f.active)?'Live':null}>
            <p style={{fontSize:12,color:C.textLight,marginBottom:10}}>Requires at least one photo and a list price.</p>
            {[{key:'autotrader',label:'AutoTrader.ca',color:'#e85123',sub:'XML feed · every 4 hrs'},{key:'cargurus',label:'CarGurus.ca',color:'#009cfc',sub:'CSV/XML feed · every 4 hrs'},{key:'website',label:'Dealer Website',color:C.navy,sub:'Real-time · instant'},{key:'auction',label:'Public Auction',color:C.teal,sub:'Next auction event'}].map(f=>{
              const active=v.feeds?.[f.key]?.active;const ready=v.photos?.length>0&&v.listPrice&&v.year;
              return <div key={f.key} style={{background:'#fff',border:`1.5px solid ${active?f.color:C.border}`,borderRadius:8,padding:'10px 12px',display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                <div style={{width:30,height:30,borderRadius:7,background:active?f.color:C.navyMuted,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Globe size={14} color={active?'#fff':C.navy}/></div>
                <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,fontSize:12,color:C.textDark}}>{f.label}</div><div style={{fontSize:10,color:active?f.color:C.textLight}}>{active?`● Live`:f.sub}</div>{!ready&&!active&&<div style={{fontSize:10,color:C.orange,marginTop:1}}>⚠ Add photos and price first</div>}</div>
                <button onClick={()=>{if(!ready&&!active)return;up({feeds:{...v.feeds,[f.key]:{active:!active}}});}} style={{width:40,height:22,background:active?f.color:C.navyBorder,borderRadius:11,border:'none',cursor:ready||active?'pointer':'not-allowed',position:'relative',opacity:!ready&&!active?0.4:1,flexShrink:0}}>
                  <span style={{position:'absolute',top:2,left:active?18:2,width:18,height:18,background:'#fff',borderRadius:'50%',transition:'left 0.2s',display:'block'}}/>
                </button>
              </div>;
            })}
          </Sec>

          {/* Internal Notes */}
          <Sec title="Notes" icon={FileText} open={false}>
            <textarea value={v.notes} onChange={e=>up({notes:e.target.value})} placeholder="Internal notes..." rows={3} style={{width:'100%',padding:'10px 12px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:7,fontSize:13,fontFamily:'inherit',resize:'vertical',outline:'none',boxSizing:'border-box',lineHeight:1.6,color:C.textDark}}/>
          </Sec>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div>
          {days>=30&&<div style={{background:C.redBg,border:`1px solid ${C.red}`,borderRadius:7,padding:'10px 14px',marginBottom:12,display:'flex',alignItems:'center',gap:8}}><AlertCircle size={14} color={C.red}/><span style={{fontSize:13,color:C.red,fontWeight:600}}>{days} days on lot — price review recommended</span></div>}

          <Sec title="Pricing" icon={DollarSign} accent>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:10,marginBottom:10}}>
              {[{f:'listPrice',l:'List Price ($)'},{f:'unitCost',l:'Unit Cost ($)'},{f:'reconCost',l:'Recon ($)'}].map(x=>(
                <div key={x.f} style={{minWidth:0}}>
                  <label style={{display:'block',fontSize:10,fontWeight:600,color:x.f==='listPrice'?C.teal:C.textMid,marginBottom:4}}>{x.l}</label>
                  <input type="number" value={v[x.f]||''} disabled={!can('savePrices')} title={!can('savePrices')?'Requires the Save vehicle prices permission':undefined} onChange={e=>up({[x.f]:e.target.value})} style={{width:'100%',padding:'8px 10px',background:can('savePrices')?'#fff':C.navyMuted,border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:13,color:can('savePrices')?C.textDark:C.textLight,fontFamily:'inherit',outline:'none',boxSizing:'border-box',fontWeight:x.f==='listPrice'?700:400,cursor:can('savePrices')?'text':'not-allowed'}}/>
                </div>
              ))}
            </div>
            {!can('savePrices')&&<div style={{fontSize:11,color:C.textLight,marginBottom:10,marginTop:-4}}>Pricing is read-only — requires the “Save vehicle prices” permission.</div>}
            {/* Suggested List Price — a SUGGESTION the dealer confirms (like the
                appraisal amount), never auto-applied since it goes into a live ad. */}
            {v.suggestedListPrice>0&&String(v.listPrice||'')!==String(v.suggestedListPrice)&&(()=>{
              const posPct=Number((onGetDealer?onGetDealer():null)?.marketPositionPct)||97;
              const basisText=v.suggestedListBasis==='market'?`${posPct}% of market mid ${fmt(v.marketMid)}`:'cost + recon + target gross';
              return(
                <div style={{marginBottom:12,maxWidth:480,background:C.tealMuted,border:`1px solid ${C.teal}`,borderRadius:10,padding:'12px 14px'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <Sparkles size={15} color={C.teal}/>
                      <span style={{fontSize:11,fontWeight:800,color:C.teal,textTransform:'uppercase',letterSpacing:0.5}}>Suggested List Price</span>
                    </div>
                    <span style={{fontSize:20,fontWeight:800,color:C.teal,fontFamily:'monospace'}}>{fmt(v.suggestedListPrice)}</span>
                  </div>
                  <div style={{marginTop:6,fontSize:11,color:C.textMid,lineHeight:1.4}}>Based on {basisText}{v.suggestedListBasis==='cost-up'?' (market was below your margin floor)':''}.</div>
                  <button onClick={()=>up({listPrice:String(v.suggestedListPrice)})} style={{marginTop:10,background:C.teal,color:'#fff',border:'none',borderRadius:7,padding:'8px 14px',fontSize:12,fontWeight:700,cursor:'pointer'}}>Use this price →</button>
                  <div style={{marginTop:8,fontSize:9.5,color:C.textLight,fontStyle:'italic'}}>A suggestion based on your pricing strategy and the market — set your own price above if you prefer.</div>
                </div>
              );
            })()}
            {v.listPrice&&v.unitCost&&(()=>{
              const gross=Number(v.listPrice)-Number(v.unitCost||0)-Number(v.reconCost||0);
              const adjPct=v.marketMid?Math.round((Number(v.listPrice)/Number(v.marketMid))*100):null;
              const cardBg={background:C.navyMuted,borderRadius:8,padding:'10px 12px',border:`1px solid ${C.border}`};
              const lbl={fontSize:9,color:C.textLight,marginBottom:3,fontWeight:600,textTransform:'uppercase',letterSpacing:0.5};
              return(
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:8}}>
                  <div style={cardBg}><div style={lbl}>Gross Margin</div><div style={{fontSize:15,fontWeight:800,color:gross>0?C.green:C.red,fontFamily:'monospace'}}>{fmt(gross)}</div></div>
                  <div style={cardBg}><div style={lbl}>Days on Lot</div><div style={{fontSize:15,fontWeight:800,color:C.navy,fontFamily:'monospace'}}>{days}</div></div>
                  <div style={cardBg}><div style={lbl}>Price Rank</div><div style={{fontSize:15,fontWeight:800,color:C.navy,fontFamily:'monospace'}}>{myRank?`#${myRank} of ${comps.length+1}`:'—'}</div></div>
                  <div style={cardBg}><div style={lbl}>% of Market</div><div style={{fontSize:15,fontWeight:800,fontFamily:'monospace',color:adjPct?(adjPct<=95?C.green:adjPct<=102?C.navy:C.red):C.textLight}}>{adjPct?`${adjPct}%`:'—'}</div></div>
                </div>
              );
            })()}
          </Sec>

          <Sec title="Vehicle History" icon={ShieldCheck} tone="purple" badge={v.carfax?(v.carfax.clean?'✓ Clean':'⚠ Issues Found'):'Not Pulled'}>
            <CarfaxBadge carfax={v.carfax} onFetch={pullCfx} loading={cl} canPull={can('carfax')}/>
          </Sec>

          <Sec title="Market Intelligence" icon={BarChart2} tone="blue">
            <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:8,alignItems:'flex-end'}}>
              <div>
                <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>Distance</label>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <select value={v.searchDistance||150} onChange={e=>up({searchDistance:e.target.value})} style={{padding:'5px 8px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:12,fontFamily:'inherit',outline:'none'}}>
                    {DISTANCE_OPTS.map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                  <span style={{fontSize:10,color:C.textLight}}>km</span>
                </div>
              </div>
              <div>
                <label style={{display:'block',fontSize:10,fontWeight:600,color:C.textMid,marginBottom:4}}>KM Range</label>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <input type="number" value={v.odoFrom||''} onChange={e=>up({odoFrom:e.target.value})} placeholder="From" style={{width:70,padding:'5px 8px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:11,fontFamily:'inherit',outline:'none'}}/>
                  <span style={{fontSize:10,color:C.textLight}}>–</span>
                  <input type="number" value={v.odoTo||''} onChange={e=>up({odoTo:e.target.value})} placeholder="To" style={{width:70,padding:'5px 8px',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:6,fontSize:11,fontFamily:'inherit',outline:'none'}}/>
                </div>
              </div>
              <div style={{marginLeft:'auto'}}>
                <Btn onClick={refMkt} disabled={ml} variant="ghost" size="sm"><RefreshCw size={11} style={{animation:ml?'spin 1s linear infinite':undefined}}/> Refresh</Btn>
              </div>
            </div>
            {!v.marketMid?<div style={{textAlign:'center',padding:'12px 0'}}><Btn onClick={refMkt} disabled={ml}><TrendingUp size={13}/>{ml?'Loading...':'Fetch Market Data'}</Btn></div>:(
              <div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:8}}>{[{l:'Market Low',v:fmt(v.marketLow),c:C.green,t:'10th percentile of active comparable listing prices'},{l:'Market Mid',v:fmt(v.marketMid),c:C.navy,t:'Median of active comparable listing prices'},{l:'Market High',v:fmt(v.marketHigh),c:C.orange,t:'90th percentile of active comparable listing prices'}].map(s=><div key={s.l} title={s.t} style={{background:C.navyMuted,borderRadius:7,padding:'7px 10px',textAlign:'center',cursor:'help'}}><div style={{fontSize:10,color:C.textLight,fontWeight:600,marginBottom:2,display:'inline-flex',alignItems:'center',gap:3}}>{s.l}<Info size={10} color={C.textLight} style={{opacity:0.6}}/></div><div style={{fontSize:15,fontWeight:800,color:s.c,fontFamily:'monospace'}}>{s.v}</div></div>)}</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,marginBottom:8}}>
                  {[
                    {l:'Active Comps',v:v._marketMeta?v._marketMeta.activeCount:v.activeComps,t:'Unique active comparable listings'},
                    {l:'Market Day Supply',v:(v.marketDaySupply!=null)?v.marketDaySupply:null,t:'Days to sell current active inventory at recent sales rate (active ÷ sold × 45)'},
                    {l:'Median Days Listed',v:(v.medianDaysListed!=null?v.medianDaysListed:v.marketDaysSupply)??null,t:'Median days a current comp has been listed'},
                    {l:'Median Comp KM',v:v._medianCompMileage?fmtN(v._medianCompMileage)+' km':(v.marketAvgOdometer?fmtN(v.marketAvgOdometer)+' km':null),t:'Median odometer across active comps'},
                  ].map(s=>(
                    <div key={s.l} title={s.t} style={{background:'#fff',borderRadius:7,padding:'5px 9px',border:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',cursor:'help'}}>
                      <span style={{fontSize:10,color:C.textLight,display:'inline-flex',alignItems:'center',gap:3}}>{s.l}<Info size={10} color={C.textLight} style={{opacity:0.6}}/></span>
                      <span style={{fontSize:11,fontWeight:700,color:C.navy,fontFamily:'monospace'}}>{s.v||s.v===0?s.v:'—'}</span>
                    </div>
                  ))}
                </div>
                {v._soldStats&&v._soldStats.count>0&&(()=>{
                  const s=v._soldStats;
                  return(
                    <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',marginBottom:8}}>
                      <div style={{padding:'6px 10px',background:C.navyMuted,borderBottom:`1px solid ${C.border}`,fontSize:10,fontWeight:700,color:C.navy,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <span>Recently Sold — Comparable Market</span>
                        <span style={{fontSize:9,color:C.textLight,fontWeight:500}}>excluded from pricing</span>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)'}}>
                        {[{l:'Sold',v:s.count},{l:'Avg Days to Sell',v:s.avgDts!=null?s.avgDts:'—'},{l:'Avg Sold Price',v:s.avgPrice!=null?fmt(s.avgPrice):'—'},{l:'Avg KM',v:s.avgOdo!=null?fmtN(s.avgOdo):'—'}].map((c,i)=>(
                          <div key={c.l} style={{padding:'6px 8px',borderRight:i<3?`1px solid ${C.border}`:'none',textAlign:'center'}}>
                            <div style={{fontSize:9,fontWeight:600,color:C.textLight,marginBottom:3}}>{c.l}</div>
                            <div style={{fontSize:12,fontWeight:800,color:C.navy,fontFamily:'monospace'}}>{c.v}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {v.listPrice&&<div style={{background:'#fff',borderRadius:7,padding:'8px 10px',textAlign:'center',border:`1px solid ${C.border}`}}><div style={{fontSize:9,color:C.textLight,fontWeight:600,marginBottom:4,letterSpacing:1,textTransform:'uppercase'}}>Market Position</div><GaugeSmall price={v.listPrice} mid={v.marketMid}/></div>}
              </div>
            )}
            {comps.length>0
              ? <div style={{marginTop:12}}><CompSet comps={comps} myPrice={v.listPrice} myKm={v.odometer} myDays={days} subjectTrim={v.series}/></div>
              : v.marketMid&&<div style={{marginTop:12,background:C.navyMuted,border:`1px solid ${C.border}`,borderRadius:10,padding:'14px 16px',textAlign:'center',fontSize:12,color:C.textMid}}>Hit <strong>Refresh</strong> above to load live competitive listings.</div>}
          </Sec>

          <Sec title="Vehicle Log" icon={Activity} open={false}>
            <ActionLog entries={v.log}/>
          </Sec>
        </div>
      </div>

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,padding:'8px 4px',fontSize:11,color:C.textLight}}>
        <span>Stock #{v.stockNumber} · Created {new Date(v.createdAt).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'})}</span>
        <span>Last saved {savedAt?new Date(savedAt).toLocaleString('en-CA',{dateStyle:'medium',timeStyle:'short'}):'—'}</span>
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
        ${appraisals.map(a=>`<tr><td>${fmtDate(a.createdAt)}</td><td>${esc([a.year,a.make,a.model,a.series].filter(Boolean).join(' ')||'—')}</td><td>${esc((AS[a.status]||{}).label||'')}</td><td class="num">${a.odometer?fmtN(a.odometer):'—'}</td><td class="num">${a.appraisedValue?fmt(a.appraisedValue):'—'}</td></tr>`).join('')||'<tr><td colspan="5">No appraisals</td></tr>'}
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
// Clerk issues short-lived tokens, so this refreshes ahead of expiry and on
// mount. Without it a session would quietly start failing after about a minute.
function useClerkAuthBridge(){
  const { getToken, isSignedIn } = useAuth();
  useEffect(()=>{
    if(!isSignedIn) { setClerkToken(''); return; }
    let alive = true;
    const refresh = async()=>{
      try{ const t = await getToken(); if(alive) setClerkToken(t||''); }catch{}
    };
    refresh();
    const iv = setInterval(refresh, 30000);
    return()=>{ alive=false; clearInterval(iv); };
  },[getToken,isSignedIn]);
}

export default function Vantage() {
  useClerkAuthBridge();
  // Attribution now comes from the signed-in account rather than a picker
  // anyone could change, so "who appraised this" is a fact rather than an
  // honour-system selection.
  const { user: clerkUser } = useUser();
  const [page,setPage]=useState('dashboard');
  const navigate=useNavigate();
  const location=useLocation();
  const [vehicles,setVehicles]=useState(SEED);
  const [appraisals,setAppraisals]=useState([]);
  const [dealer,setDealer]=useState(DEFAULT_DEALER);
  const [activeV,setActiveV]=useState(null);
  const [showBulkImport,setShowBulkImport]=useState(false);
  const [activeA,setActiveA]=useState(null);
  const [toast,setToast]=useState(null);
  const [showScanner,setShowScanner]=useState(false);
  const [currentUser,setCurrentUser]=useState('');
  // Held in a ref so the save callbacks can stamp who made a change without
  // being recreated — and therefore re-firing — every time the user switches.
  const currentUserRef=useRef('');
  const appraisalsRef=useRef([]);
  const vehiclesRef=useRef([]);
  const pushRecordsRef=useRef(null);
  useEffect(()=>{ currentUserRef.current=currentUser; },[currentUser]);
  // Mirrored into refs so the one-time load effect can read current state
  // without listing them as dependencies and re-running on every edit.
  useEffect(()=>{ appraisalsRef.current=appraisals; },[appraisals]);
  useEffect(()=>{ vehiclesRef.current=vehicles; },[vehicles]);
  const [showUserMenu,setShowUserMenu]=useState(false);
  // Customer leads from the widget (pending appraisals). Fetched from the backend.
  const [leads,setLeads]=useState([]);
  const [leadsLoading,setLeadsLoading]=useState(false);
  const [leadsError,setLeadsError]=useState(null);
  const [leadFilter,setLeadFilter]=useState('pending');
  const showToast=useCallback((m,t='info')=>setToast({message:m,type:t}),[]);

  // Pull pending customer leads from the backend. Polls so new submissions show up.
  const loadLeads=useCallback(async()=>{
    setLeadsLoading(true);
    try{
      const q=leadFilter==='all'?'':`?status=${encodeURIComponent(leadFilter)}`;
      const r=await fetch(`${API_BASE}/api/leads${q}`,{headers:teamHeaders()});
      const d=await r.json().catch(()=>null);
      if(r.status===401||r.status===403){
        // Real leads may exist — we just aren't authorised to read them. Showing
        // an empty inbox here would look identical to "no customers", which is
        // how a live lead sits unnoticed. Say so instead.
        setLeadsError('auth');
      } else if(!r.ok){
        setLeadsError('network');
      } else if(d&&Array.isArray(d.leads)){
        setLeadsError(null); setLeads(d.leads);
      }
    }catch{ setLeadsError('network'); }
    finally{setLeadsLoading(false);}
  },[leadFilter]);

  // Mark a lead worked (converted/dismissed) on the backend, then refresh.
  const updateLeadStatus=useCallback(async(id,status)=>{
    try{
      await fetch(`${API_BASE}/api/leads/${id}`,{method:'PATCH',headers:teamHeaders({'Content-Type':'application/json'}),body:JSON.stringify({status})});
    }catch{}
    loadLeads();
  },[loadLeads]);

  // ─── URL ROUTING ───────────────────────────────────────────────────────
  // Each page (and each appraisal/vehicle/lead) has its own URL. We keep the
  // existing page/activeA/activeV state model and sync it with the address bar.
  // Map a page (+ optional active record) → a URL path.
  function urlForPage(pg, rec){
    switch(pg){
      case 'dashboard': return '/';
      case 'leads': return '/leads';
      case 'appraisals': return '/appraisals';
      case 'inventory': return '/inventory';
      case 'reports': return '/reports';
      case 'settings': return '/settings';
      case 'stickers': return '/stickers';
      case 'appraisal_form': return rec?.id?`/appraisal/${rec.id}`:'/appraisals';
      case 'vehicle_detail': return rec?.id?`/inventory/${rec.id}`:'/inventory';
      case 'sticker_detail': return rec?.id?`/inventory/${rec.id}/sticker`:'/inventory';
      default: return '/';
    }
  }
  // Navigate: update the URL (which drives the render via the effect below).
  const goto=useCallback((pg,rec)=>{
    const url=urlForPage(pg,rec);
    if(location.pathname!==url) navigate(url);
    setPage(pg);
  },[navigate,location.pathname]);

  // Every page opens at the top. Without this the browser keeps the previous
  // scroll offset, so opening an appraisal from halfway down the list dropped
  // you into the middle of the record.
  useEffect(()=>{
    window.scrollTo(0,0);
  },[location.pathname]);

  // Derive page + active record FROM the URL. Runs on direct loads, refresh,
  // and back/forward. Resolves :id paths into activeA/activeV once data is loaded.
  useEffect(()=>{
    const p=location.pathname.replace(/\/+$/,'')||'/';
    const seg=p.split('/').filter(Boolean);
    if(p==='/'){ setPage('dashboard'); return; }
    const top=seg[0];
    if(['leads','appraisals','inventory','reports','settings','stickers'].includes(top) && seg.length===1){
      setPage(top); return;
    }
    if(top==='appraisal' && seg[1]){
      const a=appraisals.find(x=>String(x.id)===seg[1]);
      if(a){ setActiveA(prev=>prev&&prev.id===a.id?prev:{...a}); setPage('appraisal_form'); }
      else if(activeA&&String(activeA.id)===seg[1]){ setPage('appraisal_form'); } // new/unsaved appraisal in memory
      else { setPage('appraisals'); } // unknown id (e.g. not in this browser) → list
      return;
    }
    if(top==='inventory' && seg[1]){
      const v=vehicles.find(x=>String(x.id)===seg[1]);
      if(v){ setActiveV(prev=>prev&&prev.id===v.id?prev:{...v}); setPage(seg[2]==='sticker'?'sticker_detail':'vehicle_detail'); }
      else if(activeV&&String(activeV.id)===seg[1]){ setPage(seg[2]==='sticker'?'sticker_detail':'vehicle_detail'); } // new/unsaved
      else { setPage('inventory'); }
      return;
    }
    if(top==='lead' && seg[1]){
      // Lead deep-link: open it as a pre-filled appraisal once leads are loaded.
      const l=leads.find(x=>String(x.id)===seg[1]);
      if(l){ openLeadRef.current?.(l); }
      return;
    }
    setPage('dashboard');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[location.pathname,appraisals,vehicles,leads,activeA,activeV]);

  // openLead is defined later; hold a ref so the URL effect can call it.
  const openLeadRef=useRef(null);

  // Staff list comes from dealer settings; falls back to a sensible default.
  // The signed-in person is the acting user. Their name is what gets stamped on
  // records, so it has to be recognisable — a full name if they set one, else
  // the local part of their email rather than a raw address.
  useEffect(()=>{
    if(!clerkUser) return;
    const nm = clerkUser.fullName
      || [clerkUser.firstName,clerkUser.lastName].filter(Boolean).join(' ')
      || (clerkUser.primaryEmailAddress?.emailAddress||'').split('@')[0];
    if(nm){ setCurrentUser(nm); try{localStorage.setItem('vantage_user',nm);}catch{} }
  },[clerkUser]);

  const staff=(dealer.staff&&dealer.staff.length>0)?dealer.staff:['Manager','Sales','Appraiser'];
  const actingUser=currentUser||staff[0]||'Staff';
  // Permission check for the current acting user (UI-level gating).
  const can=useCallback((permKey)=>userCan(dealer,actingUser,permKey),[dealer,actingUser]);

  function handleScanVIN(vin) {
    // When scanner detects a VIN, start a new appraisal with it pre-filled
    const a = blankAppraisal();
    a.vin = vin.toUpperCase();
    setActiveA(a);
    goto('appraisal_form', a);
    showToast('VIN scanned — tap Decode VIN to populate details', 'success');
  }

  // Duplicate-VIN detector. Returns a match if this VIN already has an ACTIVE
  // (non-finalized) appraisal or sits in current inventory — excluding the
  // appraisal being edited. Soft signal only; the form decides how to surface it.
  function checkDuplicate(vin, currentId){
    const V=(vin||'').toUpperCase().trim();
    if(V.length!==17) return null;
    const appr=appraisals.find(x=>x.id!==currentId && (x.vin||'').toUpperCase()===V && !x.finalizedAt && x.status!=='purchased');
    if(appr) return {kind:'appraisal',id:appr.id,label:[appr.year,appr.make,appr.model].filter(Boolean).join(' ')||V,who:appr.appraiser||'',ref:appr};
    const veh=vehicles.find(x=>(x.vin||'').toUpperCase()===V);
    if(veh) return {kind:'inventory',id:veh.id,label:[veh.year,veh.make,veh.model].filter(Boolean).join(' ')||V,stock:veh.stockNumber||'',ref:veh};
    return null;
  }
  // Jump to the existing record the duplicate warning points at.
  function openExistingDup(match){
    if(!match) return;
    if(match.kind==='inventory'){ setActiveV({...match.ref}); goto('vehicle_detail', match.ref); }
    else { setActiveA({...match.ref}); goto('appraisal_form', match.ref); }
  }

  // Open a customer lead as a PRE-FILLED appraisal: map the lead's vehicle +
  // contact + market data into a blank appraisal so the appraiser works it with
  // everything already there. Marks the lead converted.
  function openLead(lead){
    const a=blankAppraisal();
    a.source='Customer Lead';
    a.vin=lead.vin||'';
    a.year=lead.year||''; a.make=lead.make||''; a.model=lead.model||''; a.series=lead.trim||'';
    a.odometer=lead.odometer!=null?String(lead.odometer):'';
    a.firstName=(lead.customer_name||'').split(' ')[0]||'';
    a.lastName=(lead.customer_name||'').split(' ').slice(1).join(' ')||'';
    a.email=lead.customer_email||''; a.phone=lead.customer_phone||'';
    a.postal=lead.postal||'';
    // The lead's market mid was calculated at submission time from whatever the
    // customer told us, and carrying it over made an unsupported figure look
    // like a valuation — it displayed alongside "0 listings" and fed the
    // suggested buy. The appraisal fetches its own market data; until it does,
    // there is no number, which is the honest state.
    a._leadMarketMid=lead.market_mid||null;   // kept for reference only
    a.postal=lead.postal||a.postal;
    a.accidentVisible=!!lead.accident;
    a._leadId=lead.id;
    // Customer-reported condition → appraisal fields (appraiser verifies).
    if(lead.known_issues) a.mechanical=lead.known_issues;
    if(lead.tire_condition) a.tires=lead.tire_condition;
    // Ownership / lien → lien fields.
    if(lead.lien_holder) a.lienHolder=lead.lien_holder;
    if(lead.lien_balance!=null) a.lienPayoff=String(lead.lien_balance);
    // Photos uploaded by the customer → appraisal photos (already compressed).
    if(Array.isArray(lead.photos)&&lead.photos.length){
      a.photos=lead.photos.map((dataUrl,i)=>({id:`lead-${lead.id}-${i}`,dataUrl,category:'Customer'}));
    }
    a.notes=`Customer-submitted lead via widget on ${fmtDate(lead.created_at)}.`+
      (lead.condition_opinion?` Customer rates condition: ${lead.condition_opinion}.`:'')+
      (lead.brake_condition?` Brakes: ${lead.brake_condition}.`:'')+
      (lead.ownership?` Ownership: ${lead.ownership}${lead.lien_balance!=null?` (balance ~$${Number(lead.lien_balance).toLocaleString('en-CA')})`:''}.`:'')+
      (lead.thin_market?' [Flagged: thin market — specialist follow-up]':'')+
      (lead.offer_amount?` Instant offer shown: $${Number(lead.offer_amount).toLocaleString('en-CA')}.`:'');
    a.comments=[{ts:new Date().toISOString(),user:'System',text:`Imported from customer lead #${lead.id}. Customer contact: ${lead.customer_email||''} ${lead.customer_phone||''}`.trim()}];
    setActiveA(a);
    goto('appraisal_form', a);
    // The lead only stores a single market_mid from submission time — no comps,
    // no band, and possibly days old. Pull fresh market data straight away so
    // the appraiser isn't staring at an empty Market Intelligence panel.
    if(a.vin&&a.vin.length===17&&a.postal){
      fetchMarketData(a.vin,a.postal,a.searchDistance||250,a.drivetrain||'',a.series||'')
        .then(m=>{
          if(!m) return;
          setActiveA(prev=>{
            if(!prev||prev._leadId!==lead.id) return prev;   // user moved on
            return {...prev,
              marketLow:m.marketLow,marketMid:m.marketMid,marketHigh:m.marketHigh,
              marketAvg:m.marketAvg,marketCount:m.count,marketDataFetched:new Date().toISOString(),
              _marketMeta:m.meta||null,_medianCompMileage:m.medianCompMileage,_comps:m.comps,
              _marketTrim:(prev.series||''),_marketDrive:(prev.drivetrain||''),
            };
          });
        })
        .catch(()=>{});
    }
    if(lead.id) updateLeadStatus(lead.id,'converted');
    showToast('Lead opened as appraisal — verify details and finalize','success');
  }
  // Let the URL effect call openLead for /lead/:id deep-links.
  openLeadRef.current=openLead;

  // Appraisals, inventory and settings load from the server so every device
  // sees the same work. localStorage is kept only as an offline read-through
  // cache: if the network is down the app still opens with what it last saw,
  // rather than showing an empty store.
  const [dataError,setDataError]=useState(null);
  useEffect(()=>{
    // Paint from cache first so the app is usable immediately, then replace
    // with the server's copy when it arrives.
    try{const d=JSON.parse(localStorage.getItem('vantage_vehicles'));if(d&&d.length>0)setVehicles(d);}catch{}
    try{const d=JSON.parse(localStorage.getItem('vantage_appraisals'));if(d)setAppraisals(d);}catch{}
    try{const d=JSON.parse(localStorage.getItem('vantage_dealer'));if(d)setDealer(d);}catch{}
    try{const u=localStorage.getItem('vantage_user');if(u)setCurrentUser(u);}catch{}

    (async()=>{
      try{
        const [av,vv,dv]=await Promise.all([
          fetch(`${API_BASE}/api/appraisals`,{headers:teamHeaders()}).then(r=>r.ok?r.json():null),
          fetch(`${API_BASE}/api/vehicles`,{headers:teamHeaders()}).then(r=>r.ok?r.json():null),
          fetch(`${API_BASE}/api/dealer`,{headers:teamHeaders()}).then(r=>r.ok?r.json():null),
        ]);
        // Adopt the server's copy — but never let an empty response destroy
        // local records that have not been uploaded yet. On the first run after
        // this change the database is empty while the device still holds
        // everything, and overwriting would silently discard it. An empty
        // server with a populated cache means "not migrated", not "no data".
        const adopt=(items,current,setter,key)=>{
          if(!Array.isArray(items)) return;
          if(items.length===0&&current.length>0) return;   // keep local, push it up
          setter(items);
          try{localStorage.setItem(key,JSON.stringify(items));}catch{}
        };
        adopt(av&&av.items, appraisalsRef.current||[], setAppraisals, 'vantage_appraisals');
        adopt(vv&&vv.items, vehiclesRef.current||[], setVehicles, 'vantage_vehicles');
        // Anything the device holds that the server doesn't gets uploaded, so a
        // first run migrates itself rather than needing a separate step.
        if(av&&Array.isArray(av.items)&&av.items.length===0&&(appraisalsRef.current||[]).length){
          pushRecordsRef.current&&pushRecordsRef.current('appraisals',appraisalsRef.current,currentUserRef.current);
        }
        if(vv&&Array.isArray(vv.items)&&vv.items.length===0&&(vehiclesRef.current||[]).length){
          pushRecordsRef.current&&pushRecordsRef.current('vehicles',vehiclesRef.current,currentUserRef.current);
        }
        if(dv&&dv.settings){ setDealer(dv.settings); try{localStorage.setItem('vantage_dealer',JSON.stringify(dv.settings));}catch{} }
        setDataError(null);
      }catch{
        // Working from cache. Say so, because silently showing stale data is
        // how someone acts on a number that has since changed.
        setDataError('offline');
      }
    })();

    loadLeads();
    const t=setInterval(loadLeads,60000); // poll for new customer leads
    return ()=>clearInterval(t);
  },[loadLeads]);

  // Saves go record-by-record to the server. The callers hand over whole
  // arrays, so we send only what actually changed — writing all 20 appraisals
  // on every keystroke would be wasteful and would clobber a colleague's edit
  // to a record this device merely has open.
  const lastSaved=useRef({appraisals:new Map(),vehicles:new Map()});
  const pushRecords=useCallback(async(path,list,user)=>{
    const seen=lastSaved.current[path];
    const changed=list.filter(r=>{
      const json=JSON.stringify(r);
      if(seen.get(r.id)===json) return false;
      seen.set(r.id,json);
      return true;
    });
    for(const rec of changed){
      try{
        await fetch(`${API_BASE}/api/${path}/${encodeURIComponent(rec.id)}`,{
          method:'PUT',headers:teamHeaders({'Content-Type':'application/json'}),
          body:JSON.stringify({record:rec,user:user||''}),
        });
      }catch{ /* cache still holds it; next save retries */ }
    }
  },[]);

  useEffect(()=>{ pushRecordsRef.current=pushRecords; },[pushRecords]);

  const saveV=useCallback(l=>{
    try{localStorage.setItem('vantage_vehicles',JSON.stringify(l));}catch{}
    pushRecords('vehicles',l,currentUserRef.current);
  },[pushRecords]);
  const saveA=useCallback(l=>{
    try{localStorage.setItem('vantage_appraisals',JSON.stringify(l));}catch{}
    pushRecords('appraisals',l,currentUserRef.current);
  },[pushRecords]);
  const saveD=useCallback(d=>{
    try{localStorage.setItem('vantage_dealer',JSON.stringify(d));}catch{}
    fetch(`${API_BASE}/api/dealer`,{
      method:'PUT',headers:teamHeaders({'Content-Type':'application/json'}),
      body:JSON.stringify({settings:d,user:currentUserRef.current||''}),
    }).catch(()=>{});
  },[]);

  // ── Daily market-data refresh for active inventory ──
  // Refetches market data once on app load, ONLY for cars currently being
  // ADVERTISED (at least one feed active) whose data is >24h old. Cars in recon
  // or not yet listed don't burn API calls. Manual "Refresh" still works on any
  // car. To disable entirely, set AUTO_DAILY_REFRESH = false.
  const AUTO_DAILY_REFRESH = true;
  const refreshRan = useRef(false);
  const isAdvertised = (v) => v.feeds && Object.values(v.feeds).some(f => f && f.active);
  useEffect(()=>{
    if(!AUTO_DAILY_REFRESH || refreshRan.current) return;
    refreshRan.current = true;
    const postal = dealer?.postal;
    if(!postal) return; // need dealer postal to fetch local comps
    const DAY = 24*60*60*1000;
    const stale = vehicles.filter(v =>
      isAdvertised(v) &&                                   // only advertised units
      v.vin && v.vin.length===17 &&
      (!v.marketDataFetched || (Date.now()-new Date(v.marketDataFetched).getTime()) > DAY)
    );
    if(stale.length===0) return;
    let cancelled=false;
    (async()=>{
      for(const v of stale){
        if(cancelled) break;
        try{
          const m=await fetchMarketData(v.vin, postal, v.searchDistance||250, v.drivetrain||"", v.series||"");
          if(m && m.found){
            setVehicles(prev=>{
              const n=prev.map(x=>x.id===v.id?{...x,marketLow:m.marketLow,marketMid:m.marketMid,marketHigh:m.marketHigh,marketAvgPrice:m.marketAvgPrice,activeComps:m.activeComps,marketDaySupply:m.marketDaySupply,medianDaysListed:m.medianDaysListed,_soldStats:m.soldStats,_comps:m.comps,_marketMeta:m.meta,_medianCompMileage:m.medianCompMileage,marketDataFetched:m.marketDataFetched||new Date().toISOString()}:x);
              saveV(n);return n;
            });
          }
        }catch{ /* skip cars that fail (e.g. invalid VIN); don't block the rest */ }
        await new Promise(r=>setTimeout(r, 1200)); // pace requests
      }
    })();
    return ()=>{cancelled=true;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[dealer]);

  function pickUser(u){setCurrentUser(u);setShowUserMenu(false);try{localStorage.setItem('vantage_user',u);}catch{}}

  function nav(action) {
    if(action==='new_appraisal'){const a=blankAppraisal();setActiveA(a);goto('appraisal_form',a);}
    else if(action==='new_vehicle'){const v=blankVehicle();setActiveV(v);goto('vehicle_detail',v);}
    else{goto(action);}
  }
  function saveAppraisal(a,silent=false){
    setAppraisals(prev=>{
      const e=prev.find(x=>x.id===a.id);
      const merged=withLog(a, diffLog(e, a, actingUser)); // diff against stored version
      const n=e?prev.map(x=>x.id===a.id?merged:x):[merged,...prev];
      saveA(n);return n;
    });
    if(!silent){goto('appraisals');showToast('Appraisal saved','success');}
  }
  function convertToInventory(a){
    const ua=withLog({...a,status:'purchased',updatedAt:new Date().toISOString()},[logEvent('Status',AS.purchased.label,actingUser,(AS[a.status]||{}).label||'')]);
    setAppraisals(prev=>{const n=prev.map(x=>x.id===a.id?ua:x);saveA(n);return n;});
    const nv=blankVehicle(ua);
    // Suggested LIST PRICE — market-anchored (market mid × dealer's position %),
    // with the cost-up (appraised + recon + target gross) as a floor so we never
    // suggest below the deal's required margin. A starting point the dealer edits.
    const mid=Number(ua.marketMid);
    if(mid>0){
      const posPct=Number(dealer?.marketPositionPct)||97;
      const marketAnchored=Math.round(mid*(posPct/100));
      const costUpFloor=Math.round(Number(ua.appraisedValue||0)+Number(ua.reconCost||0)+Number(dealer?.targetGross||2500));
      // Store as a SUGGESTION only — do NOT auto-fill listPrice. The dealer
      // confirms it (like the appraisal amount), because it goes into a live ad.
      nv.suggestedListPrice = Math.max(marketAnchored,costUpFloor);
      nv.suggestedListBasis = marketAnchored>=costUpFloor ? 'market' : 'cost-up';
    }
    nv.log=[logEvent('VehicleCreated','Created from appraisal',actingUser)];
    setVehicles(prev=>{const n=[nv,...prev];saveV(n);return n;});
    setActiveV(nv);goto('vehicle_detail',nv);
    showToast(`${[a.year,a.make,a.model].filter(Boolean).join(' ')} moved to inventory`,'success');
  }
  // ── Bulk import / sync apply ──
  async function applyBulkImport({diff,target,dealer}){
    const postal=dealer?.postal;
    if(target==='appraisals'){
      // Create appraisals for new cars; existing-VIN updates don't apply to appraisals.
      const newAppraisals=diff.added.map((rec,i)=>{
        const a=blankAppraisal();
        return {...a, id:uid(), vin:rec.vin, odometer:rec.odometer||'', year:rec.year||'', make:rec.make||'', model:rec.model||'', series:rec.series||'', bodyType:rec.bodyType||'', engine:rec.engine||'', transmission:rec.transmission||'', drivetrain:rec.drivetrain||'', extColour:rec.extColour||'', intColour:rec.intColour||'', source:'Bulk import'};
      });
      if(newAppraisals.length){ setAppraisals(prev=>{const n=[...newAppraisals,...prev];saveA(n);return n;}); }
      showToast(`${newAppraisals.length} appraisals created from import`,'success');
      // decode + market fetch in background for the new ones
      bulkEnrich(newAppraisals, postal, 'appraisal');
      return;
    }
    // target === 'inventory'
    setVehicles(prev=>{
      let n=[...prev];
      // 1) updates: auto-apply changed fields to existing
      diff.updated.forEach(u=>{
        n=n.map(x=>x.id===u.vehicle.id?{...x,...u.rec,updatedAt:new Date().toISOString(),_missingCount:0}:x);
      });
      // 2) missing counters: bump for absent, reset handled above when present
      const sheetVins=new Set([...diff.added.map(r=>r.vin),...diff.updated.map(u=>u.vehicle.vin?.toUpperCase())]);
      // also count unchanged-but-present cars as present (reset their counter)
      n=n.map(x=>{
        if(!x.vin) return x;
        const inSheet=sheetVins.has(x.vin.toUpperCase())|| diff.missing.every(m=>m.vehicle.id!==x.id);
        if(diff.missing.find(m=>m.vehicle.id===x.id)){ return {...x,_missingCount:(x._missingCount||0)+1}; }
        return {...x,_missingCount:0};
      });
      // 3) new cars
      const newVehicles=diff.added.map((rec,i)=>{
        const v=blankVehicle();
        return {...v, id:uid(), stockNumber:rec.stockNumber||v.stockNumber, vin:rec.vin, odometer:rec.odometer||'', year:rec.year||'', make:rec.make||'', model:rec.model||'', series:rec.series||'', bodyType:rec.bodyType||'', engine:rec.engine||'', transmission:rec.transmission||'', drivetrain:rec.drivetrain||'', extColour:rec.extColour||'', intColour:rec.intColour||'', listPrice:rec.listPrice||'', unitCost:rec.unitCost||'', status:'pending', _missingCount:0, log:[logEvent('VehicleCreated','Added via bulk import',actingUser)]};
      });
      n=[...newVehicles,...n];
      saveV(n);
      // enrich new vehicles in background
      bulkEnrich(newVehicles, postal, 'vehicle');
      return n;
    });
    const flagged=diff.missing.filter(m=>m.count>=3).length;
    showToast(`${diff.added.length} added · ${diff.updated.length} updated${flagged?` · ${flagged} flagged missing`:''}`,'success');
  }

  // Decode (free) + market fetch (VinAudit) for freshly-imported records, paced.
  async function bulkEnrich(items, postal, kind){
    for(const it of items){
      try{
        const d=await decodeVIN(it.vin)
        const patch={...d}
        if(postal){
          try{ const m=await fetchMarketData(it.vin,postal); if(m&&m.found){ Object.assign(patch,{marketLow:m.marketLow,marketMid:m.marketMid,marketHigh:m.marketHigh,marketAvgPrice:m.marketAvgPrice,activeComps:m.activeComps,marketDaySupply:m.marketDaySupply,medianDaysListed:m.medianDaysListed,_soldStats:m.soldStats,_comps:m.comps,_marketMeta:m.meta,_medianCompMileage:m.medianCompMileage,marketDataFetched:m.marketDataFetched||new Date().toISOString()}); } }catch{}
        }
        if(kind==='vehicle'){ setVehicles(prev=>{const n=prev.map(x=>x.id===it.id?{...x,...patch}:x);saveV(n);return n;}); }
        else { setAppraisals(prev=>{const n=prev.map(x=>x.id===it.id?{...x,...patch}:x);saveA(n);return n;}); }
      }catch{ /* skip cars that fail to decode */ }
      await new Promise(r=>setTimeout(r, 1200))  // pace VinAudit calls
    }
  }

  function saveVehicle(v,silent=false){
    setVehicles(prev=>{
      const e=prev.find(x=>x.id===v.id);
      const merged=withLog(v, diffLog(e, v, actingUser));
      const n=e?prev.map(x=>x.id===v.id?merged:x):[merged,...prev];
      saveV(n);return n;
    });
    if(!silent){goto('inventory');showToast('Vehicle saved','success');}
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

  const navItems=[{k:'dashboard',l:'Dashboard',I:LayoutDashboard},{k:'leads',l:'Leads',I:Zap,badge:leads.length||null,badgeColor:C.orange},{k:'appraisals',l:'Appraisals',I:ClipboardList,badge:appraisals.filter(a=>a.status==='in_progress').length||null},{k:'inventory',l:'Inventory',I:Package},...(can('reports')?[{k:'reports',l:'Reports',I:BarChart2}]:[]),...(can('sysAdmin')?[{k:'settings',l:'Settings',I:Settings}]:[])];
  const cur=page.split('_')[0];

  return (
    <div style={{minHeight:'100vh',background:C.bg,fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,sans-serif"}}>
      {/* NAV */}
      <nav className="desktop-nav" style={{background:'#fff',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,zIndex:200,boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
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
                {n.badge>0&&<span style={{background:n.badgeColor||C.navy,color:'#fff',borderRadius:10,padding:'1px 6px',fontSize:10,fontWeight:700,marginLeft:2}}>{n.badge}</span>}
              </button>
            ))}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
            <button onClick={()=>nav('new_appraisal')} style={{padding:'6px 14px',background:C.navy,color:'#fff',border:'none',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:5,fontFamily:'inherit'}}><Plus size={13}/>New Appraisal</button>
            {/* Identity comes from the signed-in account now, so this is a
                profile and sign-out control rather than a picker anyone could
                use to act as someone else. */}
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span className="hide-mobile" style={{fontSize:12,fontWeight:600,color:C.navy,maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{actingUser}</span>
              <UserButton afterSignOutUrl="/" appearance={{elements:{avatarBox:{width:30,height:30}}}}/>
            </div>
          </div>
        </div>
      </nav>

      {/* Slim mobile-only top bar (the desktop nav is hidden on phones; the
          bottom tab bar handles navigation). Respects the iOS status-bar safe area. */}
      <div className="mobile-top-bar" style={{display:'none',background:'#fff',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,zIndex:200,alignItems:'center',justifyContent:'space-between',padding:'8px 16px',paddingTop:'calc(8px + env(safe-area-inset-top))',boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {dealer.logo?(
            <img src={dealer.logo} style={{maxHeight:26,objectFit:'contain'}} alt={dealer.name}/>
          ):(
            <div style={{width:28,height:28,borderRadius:7,background:C.navy,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:13,fontWeight:900,color:'#fff',fontFamily:'monospace',letterSpacing:-1}}>V</span></div>
          )}
          <span style={{fontSize:15,fontWeight:800,color:C.navy,letterSpacing:-0.3}}>Vantage</span>
        </div>
        <button onClick={()=>setShowUserMenu(s=>!s)} style={{display:'flex',alignItems:'center',gap:6,background:C.navyMuted,border:`1px solid ${C.navyBorder}`,borderRadius:8,padding:'4px 6px',cursor:'pointer'}}>
          <div style={{width:26,height:26,background:C.navy,borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:10,fontWeight:800,color:'#fff'}}>{actingUser.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</span></div>
          <ChevronDown size={12} color={C.textLight}/>
        </button>
        {showUserMenu&&(
          <>
            <div onClick={()=>setShowUserMenu(false)} style={{position:'fixed',inset:0,zIndex:300}}/>
            <div style={{position:'absolute',right:12,top:'calc(100% + 4px)',background:'#fff',border:`1px solid ${C.borderStr}`,borderRadius:8,boxShadow:'0 8px 28px rgba(0,0,0,0.16)',minWidth:170,zIndex:301,overflow:'hidden'}}>
              <div style={{padding:'8px 12px',fontSize:10,fontWeight:700,color:C.textLight,textTransform:'uppercase',letterSpacing:0.5,borderBottom:`1px solid ${C.border}`}}>Acting as</div>
              {staff.map(u=>(
                <button key={u} onClick={()=>pickUser(u)} style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'9px 12px',background:u===actingUser?C.navyMuted:'none',border:'none',cursor:'pointer',textAlign:'left',fontSize:13,color:C.textDark,fontFamily:'inherit'}}>
                  <div style={{width:22,height:22,background:u===actingUser?C.navy:C.bgDark,borderRadius:5,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:9,fontWeight:800,color:u===actingUser?'#fff':C.textMid}}>{u.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</span></div>
                  {u}{u===actingUser&&<CheckCircle size={13} color={C.green} style={{marginLeft:'auto'}}/>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* CONTENT */}
      <div className='content-pad' style={{maxWidth:1200,margin:'0 auto',padding:'24px 24px 60px'}}>
        {/* Working from the local cache. Said out loud because silently showing
            stale data is how someone acts on a number that has since changed —
            or worse, on a colleague's appraisal they can't actually see. */}
        {dataError==='offline'&&(
          <div style={{marginBottom:14,padding:'10px 14px',borderRadius:8,background:C.orangeBg,
            border:`1px solid ${C.orange}`,fontSize:12.5,color:C.textMid,lineHeight:1.5}}>
            Can't reach the server — showing the last data this device saw. Changes are saved locally and will sync when the connection returns.
          </div>
        )}
        {page==='dashboard'&&<Dashboard vehicles={vehicles} appraisals={appraisals} dealer={dealer} leads={leads} onOpenLead={openLead} onNav={nav} onOpenVehicle={v=>{setActiveV({...v});goto('vehicle_detail',v);}} onOpenAppraisal={a=>{setActiveA({...a});goto('appraisal_form',a);}}/>}
        {page==='leads'&&<LeadsInbox leads={leads} loading={leadsLoading} error={leadsError} filter={leadFilter} onFilter={setLeadFilter} onRefresh={loadLeads} onOpen={openLead} onDismiss={id=>updateLeadStatus(id,'dismissed')}/>}
        {page==='appraisals'&&<AppraisalList appraisals={appraisals} onNew={()=>nav('new_appraisal')} onEdit={a=>{setActiveA({...a});goto('appraisal_form',a);}}/>}
        {page==='appraisal_form'&&activeA&&<AppraisalForm key={activeA.id} initial={activeA} user={actingUser} can={can} onSave={(a,silent=false)=>saveAppraisal(a,silent)} onBack={()=>goto('appraisals')} showToast={showToast} onConvert={convertToInventory} onFinalize={finalizeAppraisal} onUnlock={unlockAppraisal} onGetDealer={()=>dealer} onCheckDup={checkDuplicate} onOpenExisting={openExistingDup}/>}
        {page==='inventory'&&<InventoryList vehicles={vehicles} onAdd={()=>nav('new_vehicle')} onImport={()=>setShowBulkImport(true)} onEdit={v=>{setActiveV({...v});goto('vehicle_detail',v);}}/>}
        {page==='vehicle_detail'&&activeV&&<VehicleDetail key={activeV.id} vehicle={activeV} user={actingUser} can={can} onSave={saveVehicle} onBack={()=>goto('inventory')} showToast={showToast} onShowSticker={v=>{setActiveV(v);goto('sticker_detail',v);}} onGetDealer={()=>dealer}/>}
        {page==='stickers'&&<StickerGenerator vehicles={vehicles} dealer={dealer}/>}
        {page==='sticker_detail'&&activeV&&<div style={{maxWidth:700,margin:'0 auto'}}><StickerGenerator vehicles={vehicles} dealer={dealer} preselected={activeV.id} onBack={()=>goto('vehicle_detail',activeV)}/></div>}
        {page==='reports'&&(can('reports')?<ReportsPage vehicles={vehicles} appraisals={appraisals} dealer={dealer} showToast={showToast}/>:<NoAccess label="Reports" need="Dealer management"/>)}
        {page==='settings'&&(can('sysAdmin')?<DealerSettings dealer={dealer} onSave={saveDealer} showToast={showToast}/>:<NoAccess label="Settings" need="System Administrator"/>)}
      </div>

      {toast&&<Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)}/>}
      {showBulkImport&&<BulkImport existingVehicles={vehicles} dealer={dealer} onClose={()=>setShowBulkImport(false)} onApply={applyBulkImport}/>}

      {/* VIN Scanner Modal */}
      {showScanner&&<VINScanner onVINDetected={handleScanVIN} onClose={()=>setShowScanner(false)}/>}

      {/* Mobile Bottom Navigation */}
      <div className="mobile-bottom-nav" style={{display:'none',justifyContent:'space-around',alignItems:'center'}}>
        {[
          {k:'dashboard',l:'Home',I:LayoutDashboard},
          {k:'leads',l:'Leads',I:Zap,badge:leads.length||null},
          {k:'new',l:'New',I:Plus,special:true},
          {k:'appraisals',l:'Appraisals',I:ClipboardList},
          
        ].map(n=>(
          <button key={n.k} onClick={()=>n.special?nav('new_appraisal'):nav(n.k)} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,background:n.special?'#1C2D5E':'none',border:'none',borderRadius:n.special?12:0,padding:n.special?'10px 16px':'6px 8px',cursor:'pointer',flex:1,color:n.special?'#fff':cur===n.k?'#1C2D5E':'#8C95A0',position:'relative'}}>
            <n.I size={n.special?22:18} color={n.special?'#fff':cur===n.k?'#1C2D5E':'#8C95A0'}/>
            {n.badge>0&&<span style={{position:'absolute',top:2,right:'50%',marginRight:-18,background:C.orange,color:'#fff',borderRadius:10,padding:'0px 5px',fontSize:9,fontWeight:700}}>{n.badge}</span>}
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
      .desktop-nav { display: none !important; }
      .mobile-top-bar { display: none !important; }
      .app-toast { bottom: 90px !important; right: 12px !important; left: 12px !important; max-width: none !important; }
      .dash-stats { grid-template-columns: repeat(2, 1fr) !important; }
      .dash-tiles { grid-template-columns: repeat(2, 1fr) !important; max-width: 100% !important; }
      .nav-links { display: none !important; }
      .nav-mobile-menu { display: flex !important; }
      .content-pad { padding: calc(14px + env(safe-area-inset-top)) 14px 80px !important; }
      .page-title { font-size: 16px !important; }
      .hide-mobile { display: none !important; }
      .hide-desktop { display: flex !important; }
      .field-half { flex: 1 1 100% !important; }
      .field-third { flex: 1 1 100% !important; }
      .sticky-bar { padding: 10px 14px !important; }
      .comp-table { font-size: 11px !important; }
      .comp-table-wrap { display: none !important; }
      .comp-cards { display: flex !important; }
      .stat-grid-4 { grid-template-columns: repeat(2, 1fr) !important; }
      .two-col { grid-template-columns: 1fr !important; }
      .appraisal-left { position: static !important; max-height: none !important; overflow: visible !important; }
    }
    @media (max-width: 480px) {
      .dash-tiles { grid-template-columns: 1fr !important; }
      .dash-stats { grid-template-columns: repeat(2, 1fr) !important; }
    }

    /* Bottom nav for mobile */
    .hide-desktop { display: none !important; }
    .mobile-bottom-nav {
      display: none;
      position: fixed;
      bottom: 0; left: 0; right: 0;
      background: #fff;
      border-top: 1px solid rgba(0,0,0,0.08);
      z-index: 150;
      padding: 8px 0 env(safe-area-inset-bottom);
      /* iOS repaints fixed elements out of step with momentum scrolling, so the
         bar visibly drifts and settles as you scroll. Giving it its own
         compositing layer means it's painted independently of the page. */
      transform: translateZ(0);
      -webkit-transform: translateZ(0);
      will-change: transform;
      -webkit-backface-visibility: hidden;
      backface-visibility: hidden;
    }
    @media (max-width: 768px) {
      .mobile-bottom-nav { display: flex !important; }
      /* iOS zooms in whenever a focused field's text is under 16px, and never
         zooms back out — so entering an odometer left the page magnified and
         the appraiser pinching to recover on every field. 16px is the threshold
         that stops it; it also reads better at arm's length beside a car. */
      input, select, textarea {
        font-size: 16px !important;
      }
    }
  `}</style>
    </div>
  );
}
