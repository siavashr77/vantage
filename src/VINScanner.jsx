import { useState, useEffect, useRef } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { createWorker } from 'tesseract.js'
import { X, CheckCircle, AlertCircle, Barcode, Type } from 'lucide-react'

const NAV='#1C2D5E', TEAL='#00B4A6', GREEN='#1A7A4A', ORANGE='#C05621', RL='#FF3B30'

function isValidVIN(v){
  return !!(v && v.length===17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(v.toUpperCase()))
}

// VIN check-digit validation (ISO 3779). Position 9 is computed from the rest.
const VIN_VALUES = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9,
  '0':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9 }
const VIN_WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2]
function passesCheckDigit(vin){
  const v = (vin||'').toUpperCase()
  if(!isValidVIN(v)) return false
  let sum = 0
  for(let i=0;i<17;i++){
    const val = VIN_VALUES[v[i]]
    if(val===undefined) return false
    sum += val * VIN_WEIGHTS[i]
  }
  const rem = sum % 11
  const check = rem===10 ? 'X' : String(rem)
  return v[8] === check
}

function normalizeOCR(s){
  return (s||'').toUpperCase().replace(/\s+/g,'').replace(/[IO]/g,m=>m==='I'?'1':'0').replace(/Q/g,'0')
}

function extractVIN(text){
  const c = normalizeOCR(text).replace(/[^A-HJ-NPR-Z0-9]/g,'')
  let formatOnly = null
  for(let i=0; i<=c.length-17; i++){
    const s=c.substring(i,i+17)
    if(passesCheckDigit(s)) return { vin:s, verified:true }
    if(isValidVIN(s) && !formatOnly) formatOnly = s
  }
  if(formatOnly) return { vin:formatOnly, verified:false }
  const m=c.match(/[A-HJ-NPR-Z0-9]{10,17}/g)
  const best = m ? m.reduce((a,b)=>a.length>b.length?a:b,'') : c.substring(0,17)
  return { vin:best.substring(0,17), verified:false }
}

export default function VINScanner({ onVINDetected, onClose }){
  const [phase, setPhase] = useState('scanning')
  const [mode, setMode] = useState('barcode')
  const [vin, setVin] = useState('')
  const [verified, setVerified] = useState(false)
  const [hint, setHint] = useState('Aim at the VIN barcode on the door jamb')
  const [manualVin, setManualVin] = useState('')
  const [showManual, setShowManual] = useState(false)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const readerRef = useRef(null)
  const controlsRef = useRef(null)
  const detectedRef = useRef(false)
  const workerRef = useRef(null)
  const ocrTimerRef = useRef(null)
  const ocrBusyRef = useRef(false)
  const modeRef = useRef(mode)
  useEffect(()=>{ modeRef.current = mode },[mode])

  function finish(candidate, isVerified, msg){
    if(detectedRef.current) return
    detectedRef.current = true
    stop()
    setVin(candidate); setVerified(isVerified); setPhase('confirm'); setHint(msg)
  }

  useEffect(()=>{
    if(phase !== 'scanning') return
    detectedRef.current = false
    const reader = new BrowserMultiFormatReader()
    readerRef.current = reader
    reader.decodeFromVideoDevice(undefined, videoRef.current, (result, error, controls) => {
      if(controls && !controlsRef.current) controlsRef.current = controls
      if(detectedRef.current) return
      if(result){
        const raw = result.getText()
        const cleaned = normalizeOCR(raw).replace(/[^A-HJ-NPR-Z0-9]/g,'')
        const candidate = isValidVIN(cleaned) ? cleaned : extractVIN(raw).vin
        if(isValidVIN(candidate)){
          finish(candidate, passesCheckDigit(candidate), 'Barcode read successfully')
        } else if(cleaned.length > 6){
          setHint(`Reading… (${cleaned.length} chars)`)
        }
      }
    }).catch(err => { console.error('Scanner error:', err); setPhase('error') })
    return () => stop()
  }, [phase])

  useEffect(()=>{
    if(phase !== 'scanning') return
    let cancelled = false
    ;(async()=>{
      try{
        if(!workerRef.current){
          const worker = await createWorker('eng')
          await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789' })
          if(cancelled){ await worker.terminate(); return }
          workerRef.current = worker
        }
        const tick = async () => {
          if(cancelled || detectedRef.current) return
          if(modeRef.current==='text' && !ocrBusyRef.current && videoRef.current && videoRef.current.videoWidth){
            ocrBusyRef.current = true
            try{
              const frame = cropScanZone(videoRef.current, canvasRef.current)
              if(frame){
                const { data } = await workerRef.current.recognize(frame)
                if(!cancelled && !detectedRef.current && data && data.text){
                  const { vin:cand } = extractVIN(data.text)
                  if(passesCheckDigit(cand)){
                    finish(cand, true, 'VIN text read successfully')
                  } else if(isValidVIN(cand)){
                    finish(cand, false, 'Text read — please verify')
                  } else if(cand && cand.length>=8){
                    setHint(`Reading text… (${cand.length} chars)`)
                  }
                }
              }
            }catch{ /* ignore bad frame */ }
            ocrBusyRef.current = false
          }
          if(!cancelled && !detectedRef.current) ocrTimerRef.current = setTimeout(tick, 1400)
        }
        ocrTimerRef.current = setTimeout(tick, 1200)
      }catch(e){ console.error('OCR init failed:', e) }
    })()
    return () => { cancelled = true; if(ocrTimerRef.current) clearTimeout(ocrTimerRef.current) }
  }, [phase])

  function cropScanZone(video, canvas){
    if(!video || !canvas) return null
    const vw = video.videoWidth, vh = video.videoHeight
    if(!vw || !vh) return null
    const sx = vw*0.05, sw = vw*0.90, sy = vh*0.33, sh = vh*0.34
    const scale = 2
    canvas.width = sw*scale; canvas.height = sh*scale
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw*scale, sh*scale)
    try{
      const img = ctx.getImageData(0,0,canvas.width,canvas.height)
      const d = img.data
      for(let i=0;i<d.length;i+=4){
        const g = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]
        const v = g>110 ? 255 : (g<70 ? 0 : g)
        d[i]=d[i+1]=d[i+2]=v
      }
      ctx.putImageData(img,0,0)
    }catch{ /* tainted canvas */ }
    return canvas
  }

  function stop(){
    if(controlsRef.current){ try{ controlsRef.current.stop() }catch{} controlsRef.current = null }
    if(ocrTimerRef.current){ clearTimeout(ocrTimerRef.current); ocrTimerRef.current = null }
  }

  useEffect(()=>()=>{ if(workerRef.current){ try{ workerRef.current.terminate() }catch{} workerRef.current=null } },[])

  function restart(){
    detectedRef.current = false
    setVin(''); setVerified(false)
    setHint(modeRef.current==='text' ? 'Aim at the printed VIN — hold steady' : 'Aim at the VIN barcode on the door jamb')
    setShowManual(false); setManualVin('')
    stop(); setPhase('idle')
    setTimeout(()=> setPhase('scanning'), 100)
  }

  function useManual(){
    if(manualVin.length >= 10){
      stop(); setVin(manualVin); setVerified(passesCheckDigit(manualVin)); setPhase('confirm'); setHint('Entered manually')
    }
  }

  function switchMode(m){
    setMode(m)
    setHint(m==='text' ? 'Aim at the printed VIN — hold steady' : 'Aim at the VIN barcode on the door jamb')
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:9999,display:'flex',flexDirection:'column',background:'#000'}}>
      <div style={{background:NAV,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:'#fff'}}>Scan VIN</div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',marginTop:1}}>
            {mode==='text' ? 'Reading printed VIN text — hold steady' : 'Point at door jamb barcode — auto-detects'}
          </div>
        </div>
        <button onClick={()=>{stop();onClose()}}
          style={{background:'rgba(255,255,255,0.12)',border:'none',borderRadius:8,width:36,height:36,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <X size={18} color="#fff"/>
        </button>
      </div>

      {(phase==='scanning'||phase==='idle') && (
        <div style={{background:NAV,padding:'0 16px 12px',display:'flex',gap:8,flexShrink:0}}>
          <button onClick={()=>switchMode('barcode')}
            style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'9px',borderRadius:8,border:`1px solid ${mode==='barcode'?TEAL:'rgba(255,255,255,0.15)'}`,background:mode==='barcode'?'rgba(0,180,166,0.15)':'transparent',color:mode==='barcode'?'#fff':'rgba(255,255,255,0.55)',fontSize:12,fontWeight:700,cursor:'pointer'}}>
            <Barcode size={14}/>Barcode
          </button>
          <button onClick={()=>switchMode('text')}
            style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'9px',borderRadius:8,border:`1px solid ${mode==='text'?TEAL:'rgba(255,255,255,0.15)'}`,background:mode==='text'?'rgba(0,180,166,0.15)':'transparent',color:mode==='text'?'#fff':'rgba(255,255,255,0.55)',fontSize:12,fontWeight:700,cursor:'pointer'}}>
            <Type size={14}/>Text (OCR)
          </button>
        </div>
      )}

      <div style={{flex:1,position:'relative',overflow:'hidden',display:phase==='confirm'||phase==='error'?'none':'block',background:'#000'}}>
        <video ref={videoRef} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}} autoPlay playsInline muted/>
        <canvas ref={canvasRef} style={{display:'none'}}/>
        {phase==='scanning' && (
          <div style={{position:'absolute',inset:0,pointerEvents:'none'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:'33%',background:'rgba(0,0,0,0.55)'}}/>
            <div style={{position:'absolute',bottom:'120px',left:0,right:0,height:'34%',background:'rgba(0,0,0,0.55)'}}/>
            <div style={{position:'absolute',top:'33%',left:'5%',right:'5%',height:'34%',border:`1.5px solid rgba(255,59,48,0.6)`,borderRadius:6}}>
              {[
                {top:-2,left:-2,borderTop:`3px solid ${RL}`,borderLeft:`3px solid ${RL}`},
                {top:-2,right:-2,borderTop:`3px solid ${RL}`,borderRight:`3px solid ${RL}`},
                {bottom:-2,left:-2,borderBottom:`3px solid ${RL}`,borderLeft:`3px solid ${RL}`},
                {bottom:-2,right:-2,borderBottom:`3px solid ${RL}`,borderRight:`3px solid ${RL}`},
              ].map((s,i)=>(<div key={i} style={{position:'absolute',width:20,height:20,...s}}/>))}
              <div style={{position:'absolute',top:'50%',left:'3%',right:'3%',height:2,transform:'translateY(-50%)',background:`linear-gradient(to right,transparent,${RL} 15%,${RL} 85%,transparent)`,boxShadow:`0 0 8px ${RL},0 0 20px ${RL}66`}}/>
            </div>
            <div style={{position:'absolute',bottom:0,left:0,right:0,background:'linear-gradient(to top,rgba(0,0,0,0.9),transparent)',padding:'28px 20px 16px',textAlign:'center'}}>
              <div style={{fontSize:13,color:'#fff',fontWeight:500}}>{hint}</div>
              {mode==='text' && <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',marginTop:3}}>Works on the dash, windshield, or printed labels</div>}
            </div>
          </div>
        )}
        {phase==='idle' && (
          <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.7)'}}>
            <div style={{width:36,height:36,border:`3px solid ${TEAL}`,borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
          </div>
        )}
      </div>

      {(phase==='scanning'||phase==='idle') && (
        <div style={{background:'rgba(0,0,0,0.92)',padding:'12px 16px',flexShrink:0}}>
          {!showManual ? (
            <button onClick={()=>setShowManual(true)}
              style={{width:'100%',background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,padding:'11px',fontSize:13,fontWeight:500,color:'rgba(255,255,255,0.6)',cursor:'pointer'}}>
              Can't scan? Type VIN manually
            </button>
          ) : (
            <div style={{display:'flex',gap:8}}>
              <input value={manualVin}
                onChange={e=>setManualVin(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'').substring(0,17))}
                placeholder="Enter 17-character VIN" maxLength={17} autoFocus
                style={{flex:1,padding:'10px 12px',background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.2)',borderRadius:7,fontSize:13,fontFamily:'monospace',letterSpacing:1,color:'#fff',outline:'none'}}/>
              <button onClick={useManual} disabled={manualVin.length<10}
                style={{background:manualVin.length>=10?TEAL:'rgba(255,255,255,0.1)',color:'#fff',border:'none',borderRadius:7,padding:'10px 16px',fontSize:13,fontWeight:700,cursor:manualVin.length>=10?'pointer':'not-allowed',flexShrink:0}}>
                Use →
              </button>
            </div>
          )}
        </div>
      )}

      {phase==='error' && (
        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32,textAlign:'center',background:'#0a0a14'}}>
          <AlertCircle size={44} color={RL} style={{marginBottom:14}}/>
          <div style={{fontWeight:700,fontSize:16,color:'#fff',marginBottom:8}}>Camera Not Available</div>
          <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',lineHeight:1.7,marginBottom:24,maxWidth:280}}>
            If on iPhone: Settings → Safari → Camera → Allow. Then reload this page.
          </div>
          <div style={{width:'100%',maxWidth:320,marginBottom:16}}>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8}}>Enter VIN manually instead:</div>
            <div style={{display:'flex',gap:8}}>
              <input value={manualVin} onChange={e=>setManualVin(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'').substring(0,17))}
                placeholder="17-character VIN" maxLength={17}
                style={{flex:1,padding:'10px 12px',background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.2)',borderRadius:7,fontSize:13,fontFamily:'monospace',letterSpacing:1,color:'#fff',outline:'none'}}/>
              <button onClick={useManual} disabled={manualVin.length<10}
                style={{background:manualVin.length>=10?TEAL:'rgba(255,255,255,0.1)',color:'#fff',border:'none',borderRadius:7,padding:'10px 16px',fontSize:13,fontWeight:700,cursor:manualVin.length>=10?'pointer':'not-allowed'}}>
                Use →
              </button>
            </div>
          </div>
          <button onClick={()=>{stop();onClose()}}
            style={{background:'rgba(255,255,255,0.08)',color:'rgba(255,255,255,0.6)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,padding:'10px 24px',fontSize:13,cursor:'pointer'}}>
            Close
          </button>
        </div>
      )}

      {phase==='confirm' && (
        <div style={{flex:1,display:'flex',flexDirection:'column',background:'#fff'}}>
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'24px 20px'}}>
            <CheckCircle size={44} color={verified?GREEN:ORANGE} style={{marginBottom:12}}/>
            <div style={{fontWeight:700,fontSize:16,color:NAV,marginBottom:16}}>{hint}</div>
            <div style={{background:'#F7F8FC',border:`1.5px solid ${verified?GREEN:(isValidVIN(vin)?ORANGE:'#E2E8F0')}`,borderRadius:10,padding:'14px 18px',marginBottom:14,width:'100%',maxWidth:360}}>
              <div style={{fontSize:10,fontWeight:600,color:'#718096',letterSpacing:1.5,textTransform:'uppercase',marginBottom:6}}>VIN</div>
              <div style={{fontFamily:'monospace',fontSize:19,fontWeight:800,color:NAV,letterSpacing:1.5,wordBreak:'break-all'}}>{vin}</div>
              {verified
                ? <div style={{fontSize:11,color:GREEN,marginTop:6}}>✓ Check digit valid — high confidence</div>
                : isValidVIN(vin)
                  ? <div style={{fontSize:11,color:ORANGE,marginTop:6}}>⚠ Check digit didn't validate — please confirm characters</div>
                  : <div style={{fontSize:11,color:ORANGE,marginTop:6}}>⚠ Please verify this VIN</div>}
            </div>
            <div style={{width:'100%',maxWidth:360}}>
              <div style={{fontSize:11,fontWeight:600,color:'#718096',marginBottom:5}}>Edit if needed</div>
              <input value={vin} onChange={e=>{const nv=e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'').substring(0,17); setVin(nv); setVerified(passesCheckDigit(nv))}} maxLength={17}
                style={{width:'100%',fontFamily:'monospace',fontSize:16,letterSpacing:2,padding:'10px 14px',border:`1.5px solid ${verified?GREEN:'#CBD5E0'}`,borderRadius:8,outline:'none',boxSizing:'border-box',color:NAV,fontWeight:700}}/>
              <div style={{fontSize:11,color:verified?GREEN:ORANGE,marginTop:4}}>
                {verified ? '✓ Valid VIN — check digit passes' : isValidVIN(vin) ? '17 characters — check digit failed, verify' : `${vin.length}/17 characters`}
              </div>
            </div>
          </div>
          <div style={{padding:'12px 20px 32px',display:'flex',gap:10}}>
            <button onClick={restart}
              style={{flex:1,background:'#EDF2F7',border:'none',borderRadius:8,padding:'13px',fontSize:13,fontWeight:600,color:'#4A5568',cursor:'pointer'}}>
              Scan Again
            </button>
            <button onClick={()=>{onVINDetected(vin.toUpperCase());onClose()}} disabled={!vin||vin.length<10}
              style={{flex:2,background:vin.length>=10?NAV:'#CBD5E0',color:'#fff',border:'none',borderRadius:8,padding:'13px',fontSize:14,fontWeight:700,cursor:vin.length>=10?'pointer':'not-allowed'}}>
              Use This VIN →
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  )
}
