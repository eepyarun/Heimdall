import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Part } from 'firebase/ai';
import { toJpegPart } from '../lib/vision';

export interface CameraHandle {
  capture: () => Promise<Part | null>;
}

export const Camera = forwardRef<CameraHandle, { frozen: string | null }>(function Camera({ frozen }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'live' | 'blocked' | 'none'>('starting');

  useEffect(() => {
    let stream: MediaStream | undefined;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('none');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => undefined);
        }
        setStatus('live');
      })
      .catch((e) => setStatus(e?.name === 'NotAllowedError' ? 'blocked' : 'none'));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  useImperativeHandle(ref, () => ({
    capture: async () => {
      const v = video.current;
      if (!v || status !== 'live' || !v.videoWidth) return null;
      return toJpegPart(v, v.videoWidth, v.videoHeight);
    },
  }));

  return (
    <div className="camera" aria-hidden={status === 'live' && !frozen}>
      <video ref={video} playsInline muted className={frozen ? 'hidden' : ''} />
      {frozen && <img src={frozen} alt="The photo Heimdall is looking at" />}
      {status !== 'live' && !frozen && (
        <div className="camera-msg">
          {status === 'starting' && 'Starting camera…'}
          {status === 'blocked' && 'Camera permission is blocked. Allow camera access in your browser settings, or use “Choose photo”.'}
          {status === 'none' && 'No camera found. Use “Choose photo” or a sample.'}
        </div>
      )}
    </div>
  );
});
