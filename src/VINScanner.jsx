import { useState, useEffect, useRef } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { createWorker } from 'tesseract.js'
import { X, CheckCircle, RotateCw } from 'lucide-react'

const NAV='#1C2D5E', TEAL='#00B4A6', GREEN='#1A7A4A', ORANGE='#C05621', RL='#FF3B30'

function isValidVIN(v){ return !!(v && v.length===17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(v.toUpperCase())) }

// Beyond "17 legal chars": a real VIN mixes letters and digits and has a
// model-year code (position 10) from the valid set. This rejects all-letter
// strings, mostly-digit strings (plates/dates), and other non-VIN text that
// happens to be 17 chars long.
const VIN_YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789'   // valid position-10 chars
function looksLikeVIN(v){
  if(!isValidVIN(v)) return false
  const digits = (v.match(/[0-9]/g)||[]).length
  const letters = (v.match(/[A-Z]/g)||[]).length
  if(digits < 3 || letters < 3) return false           // must genuinely mix both
  if(!VIN_YEAR_CODES.includes(v[9])) return false       // position 10 = model year
  return true
}

const VIN_VALUES = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9,'0':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9 }
const VIN_WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2]
function passesCheckDigit(vin){
  const v=(vin||'').toUpperCase(); if(!isValidVIN(v)) return false
  let sum=0; for(let i=0;i<17;i++){ const val=VIN_VALUES[v[i]]; if(val===undefined) return false; sum+=val*VIN_WEIGHTS[i] }
  return v[8]===(sum%11===10?'X':String(sum%11))
}
function normalizeOCR(s){ return (s||'').toUpperCase().replace(/\s+/g,'').replace(/[IO]/g,m=>m==='I'?'1':'0').replace(/Q/g,'0') }
// Longest run of legal VIN chars — used for progress feedback + extraction.
function longestRun(text){
  const c=normalizeOCR(text).replace(/[^A-HJ-NPR-Z0-9]/g,'')
  const m=c.match(/[A-HJ-NPR-Z0-9]+/g)
  return m ? m.reduce((a,b)=>a.length>b.length?a:b,'') : ''
}
function extractVIN(text){
  const c=normalizeOCR(text).replace(/[^A-HJ-NPR-Z0-9]/g,'')
  let formatOnly=null
  for(let i=0;i<=c.length-17;i++){ const s=c.substring(i,i+17); if(passesCheckDigit(s)) return {vin:s,verified:true}; if(isValidVIN(s)&&!formatOnly) formatOnly=s }
  return formatOnly ? {vin:formatOnly,verified:false} : {vin:'',verified:false}
}

export default function VINScanner({ onVINDetected, onClose }){
  const [phase, setPhase] = useState('scanning')
  const [vin, setVin] = useState('')
  const [verified, setVerified] = useState(false)
  const [progress, setProgress] = useState(0)        // 0..17 chars locked, for the live bar
  const [landscape, setLandscape] = useState(window.innerWidth > window.innerHeight)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const controlsRef = useRef(null)
  const doneRef = useRef(false)
  const workerRef = useRef(null)
  const loopRef = useRef(false)
  const lastCandRef = useRef(null)   // last OCR candidate, for 2-frame stability
  const onDetectedRef = useRef(onVINDetected)
  const onCloseRef = useRef(onClose)
  useEffect(()=>{ onDetectedRef.current=onVINDetected; onCloseRef.current=onClose })

  // Track orientation so we can nudge the user to rotate to landscape (VINs are
  // horizontal — landscape fills the frame with the VIN, like vAuto).
  useEffect(()=>{
    const onResize=()=>setLandscape(window.innerWidth>window.innerHeight)
    window.addEventListener('resize',onResize)
    window.addEventListener('orientationchange',onResize)
    return ()=>{ window.removeEventListener('resize',onResize); window.removeEventListener('orientationchange',onResize) }
  },[])

  function accept(candidate,isVerified){
    if(doneRef.current) return
    if(isVerified){ doneRef.current=true; stop(); onDetectedRef.current((candidate||'').toUpperCase()); onCloseRef.current(); return }
    doneRef.current=true; stop(); setVin(candidate); setVerified(false); setPhase('confirm')
  }

  useEffect(()=>{
    if(phase!=='scanning') return
    doneRef.current=false
    let cancelled=false

    const reader=new BrowserMultiFormatReader()
    reader.decodeFromVideoDevice(undefined, videoRef.current, (result,err,controls)=>{
      if(controls && !controlsRef.current) controlsRef.current=controls
      if(doneRef.current || !result) return
      const raw=result.getText()
      const cleaned=normalizeOCR(raw).replace(/[^A-HJ-NPR-Z0-9]/g,'')
      const cand=isValidVIN(cleaned)?cleaned:extractVIN(raw).vin
      // Barcodes are reliable, but still require it to look like a real VIN.
      if(looksLikeVIN(cand)) accept(cand, passesCheckDigit(cand))
    }).catch(e=>{ console.error('camera',e); setPhase('error') })

    ;(async()=>{
      try{
        if(!workerRef.current){
          const w=await createWorker('eng')
          await w.setParameters({ tessedit_char_whitelist:'ABCDEFGHJKLMNPRSTUVWXYZ0123456789', tessedit_pageseg_mode:'7' }) // PSM 7 = single line
          if(cancelled){ await w.terminate(); return }
          workerRef.current=w
        }
        loopRef.current=true
        while(loopRef.current && !cancelled && !doneRef.current){
          const v=videoRef.current
          if(v && v.videoWidth){
            const frame=cropBand(v, canvasRef.current)
            if(frame){
              try{
                const { data }=await workerRef.current.recognize(frame)
                if(!doneRef.current && data?.text){
                  const { vin:cand, verified }=extractVIN(data.text)
                  if(verified && looksLikeVIN(cand)){
                    // Check digit passes AND structurally a VIN → trust it.
                    setProgress(17); accept(cand,true)
                  } else {
                    const run=longestRun(data.text)
                    setProgress(Math.min(17, run.length))   // live feedback
                    // Only surface an unverified candidate for confirmation if it
                    // (a) looks structurally like a VIN, and (b) we read the SAME
                    // string on two consecutive frames (rejects one-frame flukes).
                    if(looksLikeVIN(cand)){
                      if(lastCandRef.current===cand){ accept(cand,false) }
                      else { lastCandRef.current=cand }
                    } else {
                      lastCandRef.current=null   // garbage read — reset stability
                    }
                  }
                }
              }catch{}
            }
          }
          await new Promise(r=>setTimeout(r,200))
        }
      }catch(e){ console.error('ocr',e) }
    })()

    return ()=>{ cancelled=true; loopRef.current=false; stop() }
  }, [phase])

  // Crop a WIDE, SHORT horizontal band (VIN shape) from the centre of the frame,
  // upscale + binarize for sharp single-line OCR.
  function cropBand(video, canvas){
    if(!video||!canvas) return null
    const vw=video.videoWidth, vh=video.videoHeight
    if(!vw||!vh) return null
    const sx=vw*0.04, sw=vw*0.92, sy=vh*0.42, sh=vh*0.16, scale=2.5
    canvas.width=sw*scale; canvas.height=sh*scale
    const ctx=canvas.getContext('2d')
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    try{
      const img=ctx.getImageData(0,0,canvas.width,canvas.height), d=img.data
      for(let i=0;i<d.length;i+=4){ const g=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; const v=g>120?255:0; d[i]=d[i+1]=d[i+2]=v }
      ctx.putImageData(img,0,0)
    }catch{}
    return canvas
  }

  function stop(){ loopRef.current=false; if(controlsRef.current){ try{ controlsRef.current.stop() }catch{} controlsRef.current=null } }
  useEffect(()=>()=>{ if(workerRef.current){ try{ workerRef.current.terminate() }catch{} workerRef.current=null } },[])

  function rescan(){
    doneRef.current=false; lastCandRef.current=null; setVin(''); setVerified(false); setProgress(0)
    setPhase('idle'); setTimeout(()=>setPhase('scanning'),80)
  }

  const pct = Math.round((progress/17)*100)

  return (
    <div style={{position:'fixed',inset:0,zIndex:9999,background:'#000',overflow:'hidden'}}>
      {/* Close button — always top-left */}
      <button onClick={()=>{stop();onClose()}}
        style={{position:'absolute',top:'calc(12px + env(safe-area-inset-top))',left:12,zIndex:10,background:'rgba(0,0,0,0.5)',border:'none',borderRadius:'50%',width:40,height:40,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
        <X size={20} color="#fff"/>
      </button>

      {(phase==='scanning'||phase==='idle') && (
        <>
          <video ref={videoRef} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}} autoPlay playsInline muted/>
          <canvas ref={canvasRef} style={{display:'none'}}/>

          {/* Rotate-to-landscape nudge (overlay) when held in portrait */}
          {!landscape && (
            <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.78)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,padding:24,textAlign:'center',zIndex:6}}>
              <RotateCw size={48} color={TEAL} style={{animation:'rock 1.6s ease-in-out infinite'}}/>
              <div style={{fontSize:18,fontWeight:800,color:'#fff'}}>Turn your phone sideways</div>
              <div style={{fontSize:14,color:'rgba(255,255,255,0.65)',maxWidth:300,lineHeight:1.5}}>VINs are long and horizontal — landscape fills the frame and reads far more accurately.</div>
            </div>
          )}

          {/* Horizontal scan band (VIN-shaped) + live progress */}
          {landscape && (
            <div style={{position:'absolute',inset:0,pointerEvents:'none'}}>
              {/* dim above/below the band */}
              <div style={{position:'absolute',top:0,left:0,right:0,height:'42%',background:'rgba(0,0,0,0.5)'}}/>
              <div style={{position:'absolute',top:'58%',left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)'}}/>
              {/* the band */}
              <div style={{position:'absolute',top:'42%',left:'4%',right:'4%',height:'16%',border:`2px solid ${pct>0?TEAL:'rgba(255,255,255,0.7)'}`,borderRadius:8,boxShadow:`0 0 0 9999px rgba(0,0,0,0) , 0 0 ${10+pct/4}px ${pct>0?TEAL:'transparent'}`,transition:'box-shadow 0.2s,border-color 0.2s'}}>
                {/* progress fill — the "thicker as it reads" cue */}
                <div style={{position:'absolute',left:0,bottom:0,top:0,width:`${pct}%`,background:`linear-gradient(90deg, rgba(0,180,166,0.05), rgba(0,180,166,0.22))`,borderRight:pct>0&&pct<100?`2px solid ${TEAL}`:'none',transition:'width 0.25s ease-out'}}/>
              </div>
              {/* instruction + live char count */}
              <div style={{position:'absolute',top:'60%',left:0,right:0,textAlign:'center',marginTop:14}}>
                <div style={{fontSize:14,color:'#fff',fontWeight:600,textShadow:'0 1px 3px rgba(0,0,0,0.8)'}}>
                  {pct===0 ? 'Line the VIN up inside the box' : pct<100 ? `Reading… ${progress}/17` : 'Got it!'}
                </div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.6)',marginTop:3,textShadow:'0 1px 2px rgba(0,0,0,0.8)'}}>Barcode or printed VIN — hold steady</div>
              </div>
            </div>
          )}

          {phase==='idle' && (
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.7)'}}>
              <div style={{width:36,height:36,border:`3px solid ${TEAL}`,borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
            </div>
          )}
        </>
      )}

      {phase==='error' && (
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32,textAlign:'center',background:'#0a0a14'}}>
          <div style={{fontWeight:700,fontSize:16,color:'#fff',marginBottom:8}}>Camera Not Available</div>
          <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',lineHeight:1.7,marginBottom:24,maxWidth:280}}>On iPhone: Settings → Safari → Camera → Allow, then reload.</div>
          <button onClick={()=>{stop();onClose()}} style={{background:'rgba(255,255,255,0.08)',color:'rgba(255,255,255,0.6)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,padding:'10px 24px',fontSize:13,cursor:'pointer'}}>Close</button>
        </div>
      )}

      {phase==='confirm' && (
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',background:'#fff'}}>
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'24px 20px'}}>
            <CheckCircle size={44} color={verified?GREEN:ORANGE} style={{marginBottom:12}}/>
            <div style={{fontWeight:700,fontSize:16,color:NAV,marginBottom:16}}>Verify the VIN</div>
            <div style={{width:'100%',maxWidth:380}}>
              <input value={vin} onChange={e=>{const nv=e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'').substring(0,17); setVin(nv); setVerified(passesCheckDigit(nv))}} maxLength={17} autoFocus
                style={{width:'100%',fontFamily:'monospace',fontSize:18,letterSpacing:2,padding:'12px 14px',border:`1.5px solid ${verified?GREEN:'#CBD5E0'}`,borderRadius:8,outline:'none',boxSizing:'border-box',color:NAV,fontWeight:800}}/>
              <div style={{fontSize:11,color:verified?GREEN:ORANGE,marginTop:5}}>
                {verified?'✓ Valid VIN — check digit passes':isValidVIN(vin)?'17 characters — check digit failed, verify each character':`${vin.length}/17 characters`}
              </div>
            </div>
          </div>
          <div style={{padding:'12px 20px calc(20px + env(safe-area-inset-bottom))',display:'flex',gap:10}}>
            <button onClick={rescan} style={{flex:1,background:'#EDF2F7',border:'none',borderRadius:8,padding:'14px',fontSize:13,fontWeight:600,color:'#4A5568',cursor:'pointer'}}>Scan Again</button>
            <button onClick={()=>{onVINDetected(vin.toUpperCase());onClose()}} disabled={!vin||vin.length<10}
              style={{flex:2,background:vin.length>=10?NAV:'#CBD5E0',color:'#fff',border:'none',borderRadius:8,padding:'14px',fontSize:14,fontWeight:700,cursor:vin.length>=10?'pointer':'not-allowed'}}>Use This VIN →</button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg);}} @keyframes rock{0%,100%{transform:rotate(-12deg);}50%{transform:rotate(78deg);}}`}</style>
    </div>
  )
}
