import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Part } from 'firebase/ai';
import { toJpegPart } from '../lib/vision';

export interface CameraHandle {
  capture: (maxSide?: number) => Promise<Part | null>;
  /** Tiny grayscale thumbnail used to tell whether the view changed, without calling any AI. */
  signature: () => Uint8Array | null;
  isLive: () => boolean;
}

const SIG_W = 24;
const SIG_H = 18;

export const Camera = forwardRef<CameraHandle, { frozen: string | null }>(function Camera({ frozen }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const sigCanvas = useRef<HTMLCanvasElement | null>(null);
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
    capture: async (maxSide?: number) => {
      const v = video.current;
      if (!v || status !== 'live' || !v.videoWidth) return null;
      return toJpegPart(v, v.videoWidth, v.videoHeight, maxSide);
    },
    signature: () => {
      const v = video.current;
      if (!v || status !== 'live' || !v.videoWidth) return null;
      sigCanvas.current ??= Object.assign(document.createElement('canvas'), { width: SIG_W, height: SIG_H });
      const ctx = sigCanvas.current.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(v, 0, 0, SIG_W, SIG_H);
      const px = ctx.getImageData(0, 0, SIG_W, SIG_H).data;
      const out = new Uint8Array(SIG_W * SIG_H);
      for (let i = 0; i < out.length; i++) out[i] = (px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2]) / 10;
      return out;
    },
    isLive: () => status === 'live',
  }));

  return (
    <div className="camera" aria-hidden={status === 'live' && !frozen}>
      <video ref={video} playsInline muted className={frozen ? 'hidden' : ''} />
      {frozen && <img src={frozen} alt="The photo Heimdall is looking at" />}
      {status !== 'live' && !frozen && (
        <div className="camera-msg">
          {status === 'starting' && 'Starting camera…'}
          {status === 'blocked' && 'Camera permission is blocked. Allow camera access in your browser settings, or use “Photo”.'}
          {status === 'none' && 'No camera found. Use “Photo” or try a sample.'}
        </div>
      )}
    </div>
  );
});
