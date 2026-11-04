import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';

export default function CameraReader({ onRead }: { onRead: (value: string) => void }) {
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onRead);
  useEffect(() => { callback.current = onRead; }, [onRead]);
  useEffect(() => {
    if (!open || !video.current) return;
    let active = true, completed = false;
    let stop: (() => void) | undefined;
    import('@zxing/browser').then(({ BrowserMultiFormatReader }) => new BrowserMultiFormatReader().decodeFromVideoDevice(undefined, video.current!, (result) => {
      if (result && active && !completed) { completed = true; callback.current(result.getText()); setOpen(false); }
    })).then((controls) => { if (active) stop = () => controls.stop(); else controls.stop(); }).catch(() => { if (active) { setError('Câmera indisponível. Confira a permissão e use HTTPS ou localhost.'); setOpen(false); } });
    return () => { active = false; stop?.(); };
  }, [open]);
  return <div><button type="button" className="button secondary" onClick={() => { setError(''); setOpen(!open); }}><Camera size={16}/>{open ? 'Fechar câmera' : 'Ler com a câmera'}</button>{open && <video className="camera-preview" ref={video} autoPlay muted playsInline/>}{error && <p role="alert" className="module-error">{error}</p>}</div>;
}
