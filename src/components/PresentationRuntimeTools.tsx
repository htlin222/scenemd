import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CircleStop, Minus, Pencil, Plus, RotateCcw, Trash2, Video, VideoOff } from 'lucide-react'

interface Point { x: number; y: number }
interface InkPath { id: string; points: Point[] }

interface PresentationRuntimeToolsProps {
  sceneId: string
  zoom: number
  onZoomChange: (zoom: number) => void
}

function pathData(points: Point[]): string {
  if (!points.length) return ''
  return points.reduce((value, point, index) => `${value}${index ? ' L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`, '')
}

export function PresentationRuntimeTools({ sceneId, zoom, onZoomChange }: PresentationRuntimeToolsProps) {
  const [drawing, setDrawing] = useState(false)
  const [pathsByScene, setPathsByScene] = useState<Record<string, InkPath[]>>({})
  const [camera, setCamera] = useState(false)
  const [recording, setRecording] = useState(false)
  const [message, setMessage] = useState('')
  const activePathRef = useRef<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
  }, [])

  useEffect(() => {
    if (videoRef.current && cameraStreamRef.current) videoRef.current.srcObject = cameraStreamRef.current
  }, [camera])

  const point = (event: ReactPointerEvent<SVGSVGElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: ((event.clientX - rect.left) / rect.width) * 1000, y: ((event.clientY - rect.top) / rect.height) * 562.5 }
  }

  const startPath = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawing || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const id = crypto.randomUUID()
    activePathRef.current = id
    setPathsByScene((current) => ({ ...current, [sceneId]: [...(current[sceneId] ?? []), { id, points: [point(event)] }] }))
  }

  const extendPath = (event: ReactPointerEvent<SVGSVGElement>) => {
    const id = activePathRef.current
    if (!drawing || !id) return
    const next = point(event)
    setPathsByScene((current) => ({ ...current, [sceneId]: (current[sceneId] ?? []).map((path) => path.id === id ? { ...path, points: [...path.points, next] } : path) }))
  }

  const toggleCamera = async () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
      setCamera(false)
      return
    }
    try {
      cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      setCamera(true)
    } catch {
      setMessage('Camera permission was not granted')
    }
  }

  const toggleRecording = async () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      const chunks: Blob[] = []
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm' })
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }))
        const link = document.createElement('a')
        link.href = url
        link.download = `scenemd-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        recorderRef.current = null
        setRecording(false)
      }
      stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (recorder.state === 'recording') recorder.stop() }, { once: true })
      recorder.start(1000)
      setRecording(true)
    } catch {
      setMessage('Recording was cancelled')
    }
  }

  const paths = pathsByScene[sceneId] ?? []
  return <>
    <svg className={`presentation-ink${drawing ? ' is-drawing' : ''}`} viewBox="0 0 1000 562.5" preserveAspectRatio="none" onPointerDown={startPath} onPointerMove={extendPath} onPointerUp={() => { activePathRef.current = null }} onPointerCancel={() => { activePathRef.current = null }} aria-label="Presentation annotations">
      {paths.map((path) => <path key={path.id} d={pathData(path.points)} />)}
    </svg>
    {camera && <div className="presentation-camera"><video ref={videoRef} autoPlay muted playsInline /><span>Camera</span></div>}
    <div className="presentation-runtime-tools" aria-label="Presentation tools">
      <button className={drawing ? 'is-active' : ''} onClick={() => setDrawing((value) => !value)} aria-label="Toggle drawing"><Pencil size={16} /></button>
      <button onClick={() => setPathsByScene((current) => ({ ...current, [sceneId]: [] }))} disabled={!paths.length} aria-label="Clear annotations"><Trash2 size={16} /></button>
      <span />
      <button onClick={() => onZoomChange(Math.max(0.75, Number((zoom - 0.1).toFixed(2))))} aria-label="Zoom out"><Minus size={16} /></button>
      <small>{Math.round(zoom * 100)}%</small>
      <button onClick={() => onZoomChange(Math.min(1.5, Number((zoom + 0.1).toFixed(2))))} aria-label="Zoom in"><Plus size={16} /></button>
      <button onClick={() => onZoomChange(1)} disabled={zoom === 1} aria-label="Reset zoom"><RotateCcw size={15} /></button>
      <span />
      <button className={camera ? 'is-active' : ''} onClick={() => void toggleCamera()} aria-label={camera ? 'Turn camera off' : 'Turn camera on'}>{camera ? <VideoOff size={16} /> : <Video size={16} />}</button>
      <button className={recording ? 'is-recording' : ''} onClick={() => void toggleRecording()} aria-label={recording ? 'Stop recording' : 'Start recording'}>{recording ? <CircleStop size={16} /> : <span className="record-dot" />}</button>
    </div>
    {message && <button className="presentation-runtime-message" onClick={() => setMessage('')}>{message}</button>}
  </>
}
