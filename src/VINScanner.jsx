import { useState, useEffect, useRef } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { createWorker } from 'tesseract.js'
import { X, CheckCircle, AlertCircle } from 'lucide-react'

const NAV='#1C2D5E', TEAL='#00B4A6', GREEN='#1A7A4A', ORANGE='#C05621', RL='#FF3B30'

function isValidVIN(v){
  return !!(v && v.length===17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(v.toUpperCase()))
}

// VIN check-digit (ISO 3779). A real VIN passes; most OCR misreads fail — this
// is what lets us auto-accept a confident read with zero taps.
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
  return v[8] === (rem===10 ? 'X' : String(rem))
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
  return { vin:'', verified:false }
}

export default function VINScanner({ onVINDetected, onClose }){
  const [phase, setPhase] = useState('scanning')   // scanning | confirm | error
  const [vin, setVin] = useState('')
  const [verified, setVerified] = useState(false)
  const [hint, setHint] = useState('Point at the VIN — barcode or printed text')

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const controlsRef = useRef(null)
  const doneRef = useRef(false)
  const workerRef = useRef(null)
  const ocrLoopRef = useRef(false)
  const onDetectedRef = useRef(onVINDetected)
  const onCloseRef = useRef(onClose)
  useEffect(()=>{ onDetectedRef.current = onVINDetected; onCloseRef.current = onClose })

  // Auto-accept a check-digit-valid read instantly (no confirm tap). For an
  // unverified-but-valid-format read, stop and show confirm so the user checks.
  function accept(candidate, isVerified, msg){
    if(doneRef.current) return
    if(isVerified){
      doneRef.current = true
      stop()
      onDetectedRef.current((candidate||'').toUpperCase())
      onCloseRef.current()
      return
    }
    doneRef.current = true
    stop()
    setVin(candidate); setVerified(false); setHint(msg||'Verify the VIN'); setPhase('confirm')
  }

  // Barcode + OCR run together, always. Whichever gets a confident read wins.
  useEffect(()=>{
    if(phase !== 'scanning') return
    doneRef.current = false
    let cancelled = false

    // ZXing barcode
    const reader = new BrowserMultiFormatReader()
    reader.decodeFromVideoDevice(undefined, videoRef.current, (result, err, controls) => {
      if(controls && !controlsRef.current) controlsRef.current = controls
      if(doneRef.current || !result) return
      const raw = result.getText()
      const cleaned = normalizeOCR(raw).replace(/[^A-HJ-NPR-Z0-9]/g,'')
      const cand = isValidVIN(cleaned) ? cleaned : extractVIN(raw).vin
      if(isValidVIN(cand)) accept(cand, passesCheckDigit(cand), 'Verify the scanned VIN')
    }).catch(e => { console.error('camera', e); setPhase('error') })

    // Tesseract OCR loop
    ;(async()=>{
      try{
        if(!workerRef.current){
          const w = await createWorker('eng')
          await w.setParameters({ tessedit_char_whitelist:'ABCDEFGHJKLMNPRSTUVWXYZ0123456789' })
          if(cancelled){ await w.terminate(); return }
          workerRef.current = w
        }
        ocrLoopRef.current = true
        while(ocrLoopRef.current && !cancelled && !doneRef.current){
          const v = videoRef.current
          if(v && v.videoWidth){
            const frame = cropScanZone(v, canvasRef.current)
            if(frame){
              try{
                const { data } = await workerRef.current.recognize(frame)
                if(!doneRef.current && data?.text){
                  const { vin:cand, verified } = extractVIN(data.text)
                  if(verified) accept(cand, true)
                  else if(cand) setHint('Hold steady…')
                }
              }catch{}
            }
          }
          await new Promise(r=>setTimeout(r, 250))   // tight loop; recognize() dominates timing
        }
      }catch(e){ console.error('ocr', e) }
    })()

    return ()=>{ cancelled = true; ocrLoopRef.current = false; stop() }
  }, [phase])

  // Crop central band, upscale + binarize for sharper OCR on printed VINs.
  function cropScanZone(video, canvas){
    if(!video || !canvas) return null
    const vw = video.videoWidth, vh = video.videoHeight
    if(!vw || !vh) return null
    const sx=vw*0.05, sw=vw*0.90, sy=vh*0.36, sh=vh*0.28, scale=2
    canvas.width = sw*scale; canvas.height = sh*scale
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    try{
      const img = ctx.getImageData(0,0,canvas.width,canvas.height), d = img.data
      for(let i=0;i<d.length;i+=4){
        const g = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]
        const v = g>115 ? 255 : 0
        d[i]=d[i+1]=d[i+2]=v
      }
      ctx.putImageData(img,0,0)
    }catch{}
    return canvas
  }

  function stop(){
    ocrLoopRef.current = false
    if(controlsRef.current){ try{ controlsRef.current.stop() }catch{} controlsRef.current = null }
  }
  useEffect(()=>()=>{ if(workerRef.current){ try{ workerRef.current.terminate() }catch{} workerRef.current=null } },[])

  function rescan(){
    doneRef.current = false
    setVin(''); setVerified(false); setHint('Point at the VIN — barcode or printed text')
    setPhase('idle'); setTimeout(()=>setPhase('scanning'), 80)
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:9999,display:'flex',flexDirection:'column',background:'#000'}}>
      <div style={{background:NAV,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:'#fff'}}>Scan VIN</div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',marginTop:1}}>Barcode or printed text — auto-detects</div>
        </div>
        <button onClick={()=>{stop();onClose()}}
          style={{background:'rgba(255,255,255,0.12)',border:'none',borderRadius:8,width:36,height:36,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <X size={18} color="#fff"/>
        </button>
      </div>

      <div style={{flex:1,position:'relative',overflow:'hidden',display:phase==='confirm'||phase==='error'?'none':'block',background:'#000'}}>
        <video ref={videoRef} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}} autoPlay playsInline muted/>
        <canvas ref={canvasRef} style={{display:'none'}}/>
        {(phase==='scanning'||phase==='idle') && (
          <div style={{position:'absolute',inset:0,pointerEvents:'none'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:'36%',background:'rgba(0,0,0,0.55)'}}/>
            <div style={{position:'absolute',bottom:0,left:0,right:0,height:'36%',background:'rgba(0,0,0,0.55)'}}/>
            <div style={{position:'absolute',top:'36%',left:'5%',right:'5%',height:'28%',border:`1.5px solid rgba(255,59,48,0.6)`,borderRadius:6}}>
              {[
                {top:-2,left:-2,borderTop:`3px solid ${RL}`,borderLeft:`3px solid ${RL}`},
                {top:-2,right:-2,borderTop:`3px solid ${RL}`,borderRight:`3px solid ${RL}`},
                {bottom:-2,left:-2,borderBottom:`3px solid ${RL}`,borderLeft:`3px solid ${RL}`},
                {bottom:-2,right:-2,borderBottom:`3px solid ${RL}`,borderRight:`3px solid ${RL}`},
              ].map((s,i)=>(<div key={i} style={{position:'absolute',width:20,height:20,...s}}/>))}
              <div style={{position:'absolute',top:'50%',left:'3%',right:'3%',height:2,transform:'translateY(-50%)',background:`linear-gradient(to right,transparent,${RL} 15%,${RL} 85%,transparent)`,boxShadow:`0 0 8px ${RL},0 0 20px ${RL}66`}}/>
            </div>
            <div style={{position:'absolute',bottom:0,left:0,right:0,background:'linear-gradient(to top,rgba(0,0,0,0.9),transparent)',padding:'24px 20px 18px',textAlign:'center'}}>
              <div style={{fontSize:13,color:'#fff',fontWeight:500}}>{hint}</div>
            </div>
          </div>
        )}
        {phase==='idle' && (
          <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.7)'}}>
            <div style={{width:36,height:36,border:`3px solid ${TEAL}`,borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
          </div>
        )}
      </div>

      {phase==='error' && (
        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32,textAlign:'center',background:'#0a0a14'}}>
          <AlertCircle size={44} color={RL} style={{marginBottom:14}}/>
          <div style={{fontWeight:700,fontSize:16,color:'#fff',marginBottom:8}}>Camera Not Available</div>
          <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',lineHeight:1.7,marginBottom:24,maxWidth:280}}>
            On iPhone: Settings → Safari → Camera → Allow, then reload.
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
            <div style={{width:'100%',maxWidth:360}}>
              <div style={{fontSize:11,fontWeight:600,color:'#718096',marginBottom:5}}>Confirm or edit the VIN</div>
              <input value={vin} onChange={e=>{const nv=e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'').substring(0,17); setVin(nv); setVerified(passesCheckDigit(nv))}} maxLength={17} autoFocus
                style={{width:'100%',fontFamily:'monospace',fontSize:18,letterSpacing:2,padding:'12px 14px',border:`1.5px solid ${verified?GREEN:'#CBD5E0'}`,borderRadius:8,outline:'none',boxSizing:'border-box',color:NAV,fontWeight:800}}/>
              <div style={{fontSize:11,color:verified?GREEN:ORANGE,marginTop:5}}>
                {verified ? '✓ Valid VIN — check digit passes' : isValidVIN(vin) ? '17 characters — check digit failed, verify each character' : `${vin.length}/17 characters`}
              </div>
            </div>
          </div>
          <div style={{padding:'12px 20px 32px',display:'flex',gap:10}}>
            <button onClick={rescan}
              style={{flex:1,background:'#EDF2F7',border:'none',borderRadius:8,padding:'14px',fontSize:13,fontWeight:600,color:'#4A5568',cursor:'pointer'}}>
              Scan Again
            </button>
            <button onClick={()=>{onVINDetected(vin.toUpperCase());onClose()}} disabled={!vin||vin.length<10}
              style={{flex:2,background:vin.length>=10?NAV:'#CBD5E0',color:'#fff',border:'none',borderRadius:8,padding:'14px',fontSize:14,fontWeight:700,cursor:vin.length>=10?'pointer':'not-allowed'}}>
              Use This VIN →
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  )
}
