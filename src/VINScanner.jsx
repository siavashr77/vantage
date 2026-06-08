import { useState, useEffect, useRef } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { X, CheckCircle, AlertCircle } from 'lucide-react'

const NAV='#1C2D5E', TEAL='#00B4A6', GREEN='#1A7A4A', ORANGE='#C05621', RL='#FF3B30'

function isValidVIN(v){
  return !!(v && v.length===17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(v.toUpperCase()))
}

function extractVIN(text){
  const c = text.toUpperCase()
    .replace(/\s+/g,'').replace(/O/g,'0').replace(/I/g,'1').replace(/Q/g,'0')
    .replace(/[^A-HJ-NPR-Z0-9]/g,'')
  for(let i=0; i<=c.length-17; i++){
    const s=c.substring(i,i+17)
    if(isValidVIN(s)) return s
  }
  const m=c.match(/[A-HJ-NPR-Z0-9]{10,17}/g)
  return m ? m.reduce((a,b)=>a.length>b.length?a:b,'') : c.substring(0,17)
}

export default function VINScanner({ onVINDetected, onClose }){
  const [phase, setPhase] = useState('scanning')
  const [vin, setVin] = useState('')
  const [hint, setHint] = useState('Aim at the VIN barcode on the door jamb')
  const [manualVin, setManualVin] = useState('')
  const [showManual, setShowManual] = useState(false)

  const videoRef = useRef(null)
  const readerRef = useRef(null)
  const controlsRef = useRef(null)
  const detectedRef = useRef(false)

  // ── Start ZXing as soon as component mounts ───────────────────────
  useEffect(()=>{
    if(phase !== 'scanning') return

    detectedRef.current = false
    const reader = new BrowserMultiFormatReader()
    readerRef.current = reader

    // decodeFromVideoDevice(deviceId, videoElement, callback)
    // deviceId = undefined means "use default/rear camera"
    reader.decodeFromVideoDevice(
      undefined,
      videoRef.current,
      (result, error, controls) => {
        // Save controls reference for cleanup
        if(controls && !controlsRef.current){
          controlsRef.current = controls
        }

        if(detectedRef.current) return

        if(result){
          const raw = result.getText()
          // Clean and validate
          const cleaned = raw.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'')
          const candidate = isValidVIN(cleaned) ? cleaned : extractVIN(raw)

          if(isValidVIN(candidate)){
            detectedRef.current = true
            stop()
            setVin(candidate)
            setPhase('confirm')
            setHint('Barcode read successfully')
          } else if(cleaned.length > 6){
            setHint(`Reading... (${cleaned.length} chars)`)
          }
        }
      }
    ).catch(err => {
      console.error('Scanner error:', err)
      setPhase('error')
    })

    return () => stop()
  }, [phase])

  function stop(){
    if(controlsRef.current){
      try{ controlsRef.current.stop() }catch{}
      controlsRef.current = null
    }
  }

  function restart(){
    detectedRef.current = false
    setVin('')
    setHint('Aim at the VIN barcode on the door jamb')
    setShowManual(false)
    setManualVin('')
    stop()
    setPhase('idle')
    setTimeout(()=> setPhase('scanning'), 100)
  }

  function useManual(){
    if(manualVin.length >= 10){
      stop()
      setVin(manualVin)
      setPhase('confirm')
      setHint('Entered manually')
    }
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:9999,display:'flex',flexDirection:'column',background:'#000'}}>

      {/* Header */}
      <div style={{background:NAV,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
        <div>
          <div style={{fontWeight:800,fontSize:15,color:'#fff'}}>Scan VIN</div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',marginTop:1}}>Point at door jamb barcode — auto-detects</div>
        </div>
        <button onClick={()=>{stop();onClose()}}
          style={{background:'rgba(255,255,255,0.12)',border:'none',borderRadius:8,width:36,height:36,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <X size={18} color="#fff"/>
        </button>
      </div>

      {/* Camera — always in DOM so ref works */}
      <div style={{flex:1,position:'relative',overflow:'hidden',display:phase==='confirm'||phase==='error'?'none':'block',background:'#000'}}>
        <video
          ref={videoRef}
          style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}
          autoPlay playsInline muted
        />

        {phase==='scanning' && (
          <div style={{position:'absolute',inset:0,pointerEvents:'none'}}>
            {/* Dim top/bottom */}
            <div style={{position:'absolute',top:0,left:0,right:0,height:'33%',background:'rgba(0,0,0,0.55)'}}/>
            <div style={{position:'absolute',bottom:'120px',left:0,right:0,height:'34%',background:'rgba(0,0,0,0.55)'}}/>

            {/* Scan zone */}
            <div style={{position:'absolute',top:'33%',left:'5%',right:'5%',height:'34%',border:`1.5px solid rgba(255,59,48,0.6)`,borderRadius:6}}>
              {/* Corners */}
              {[
                {top:-2,left:-2,borderTop:`3px solid ${RL}`,borderLeft:`3px solid ${RL}`},
                {top:-2,right:-2,borderTop:`3px solid ${RL}`,borderRight:`3px solid ${RL}`},
                {bottom:-2,left:-2,borderBottom:`3px solid ${RL}`,borderLeft:`3px solid ${RL}`},
                {bottom:-2,right:-2,borderBottom:`3px solid ${RL}`,borderRight:`3px solid ${RL}`},
              ].map((s,i)=>(
                <div key={i} style={{position:'absolute',width:20,height:20,...s}}/>
              ))}
              {/* Static red line */}
              <div style={{
                position:'absolute',top:'50%',left:'3%',right:'3%',
                height:2,transform:'translateY(-50%)',
                background:`linear-gradient(to right,transparent,${RL} 15%,${RL} 85%,transparent)`,
                boxShadow:`0 0 8px ${RL},0 0 20px ${RL}66`,
              }}/>
            </div>

            {/* Hint */}
            <div style={{position:'absolute',bottom:0,left:0,right:0,background:'linear-gradient(to top,rgba(0,0,0,0.9),transparent)',padding:'28px 20px 16px',textAlign:'center'}}>
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

      {/* Manual entry — shown below camera during scanning */}
      {(phase==='scanning'||phase==='idle') && (
        <div style={{background:'rgba(0,0,0,0.92)',padding:'12px 16px',flexShrink:0}}>
          {!showManual ? (
            <button onClick={()=>setShowManual(true)}
              style={{width:'100%',background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,padding:'11px',fontSize:13,fontWeight:500,color:'rgba(255,255,255,0.6)',cursor:'pointer'}}>
              Can't scan? Type VIN manually
            </button>
          ) : (
            <div style={{display:'flex',gap:8}}>
              <input
                value={manualVin}
                onChange={e=>setManualVin(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'').substring(0,17))}
                placeholder="Enter 17-character VIN"
                maxLength={17}
                autoFocus
                style={{flex:1,padding:'10px 12px',background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.2)',borderRadius:7,fontSize:13,fontFamily:'monospace',letterSpacing:1,color:'#fff',outline:'none'}}
              />
              <button onClick={useManual} disabled={manualVin.length<10}
                style={{background:manualVin.length>=10?NAV:'rgba(255,255,255,0.1)',color:'#fff',border:'none',borderRadius:7,padding:'10px 16px',fontSize:13,fontWeight:700,cursor:manualVin.length>=10?'pointer':'not-allowed',flexShrink:0}}>
                Use →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {phase==='error' && (
        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32,textAlign:'center',background:'#0a0a14'}}>
          <AlertCircle size={44} color={RL} style={{marginBottom:14}}/>
          <div style={{fontWeight:700,fontSize:16,color:'#fff',marginBottom:8}}>Camera Not Available</div>
          <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',lineHeight:1.7,marginBottom:24,maxWidth:280}}>
            If on iPhone: Settings → Safari → Camera → Allow.
            Then reload this page.
          </div>
          <div style={{width:'100%',maxWidth:320,marginBottom:16}}>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8}}>Enter VIN manually instead:</div>
            <div style={{display:'flex',gap:8}}>
              <input value={manualVin} onChange={e=>setManualVin(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'').substring(0,17))}
                placeholder="17-character VIN" maxLength={17}
                style={{flex:1,padding:'10px 12px',background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.2)',borderRadius:7,fontSize:13,fontFamily:'monospace',letterSpacing:1,color:'#fff',outline:'none'}}/>
              <button onClick={useManual} disabled={manualVin.length<10}
                style={{background:manualVin.length>=10?NAV:'rgba(255,255,255,0.1)',color:'#fff',border:'none',borderRadius:7,padding:'10px 16px',fontSize:13,fontWeight:700,cursor:manualVin.length>=10?'pointer':'not-allowed'}}>
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

      {/* Confirm */}
      {phase==='confirm' && (
        <div style={{flex:1,display:'flex',flexDirection:'column',background:'#fff'}}>
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'24px 20px'}}>
            <CheckCircle size={44} color={GREEN} style={{marginBottom:12}}/>
            <div style={{fontWeight:700,fontSize:16,color:NAV,marginBottom:16}}>{hint}</div>
            <div style={{background:'#F7F8FC',border:`1.5px solid ${isValidVIN(vin)?GREEN:'#E2E8F0'}`,borderRadius:10,padding:'14px 18px',marginBottom:14,width:'100%',maxWidth:360}}>
              <div style={{fontSize:10,fontWeight:600,color:'#718096',letterSpacing:1.5,textTransform:'uppercase',marginBottom:6}}>VIN</div>
              <div style={{fontFamily:'monospace',fontSize:19,fontWeight:800,color:NAV,letterSpacing:1.5,wordBreak:'break-all'}}>{vin}</div>
              {!isValidVIN(vin) && <div style={{fontSize:11,color:ORANGE,marginTop:6}}>⚠ Please verify this VIN</div>}
            </div>
            <div style={{width:'100%',maxWidth:360}}>
              <div style={{fontSize:11,fontWeight:600,color:'#718096',marginBottom:5}}>Edit if needed</div>
              <input value={vin} onChange={e=>setVin(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'').substring(0,17))} maxLength={17}
                style={{width:'100%',fontFamily:'monospace',fontSize:16,letterSpacing:2,padding:'10px 14px',border:`1.5px solid ${isValidVIN(vin)?GREEN:'#CBD5E0'}`,borderRadius:8,outline:'none',boxSizing:'border-box',color:NAV,fontWeight:700}}/>
              <div style={{fontSize:11,color:isValidVIN(vin)?GREEN:ORANGE,marginTop:4}}>
                {isValidVIN(vin) ? '✓ Valid VIN — 17 characters' : `${vin.length}/17 characters`}
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
