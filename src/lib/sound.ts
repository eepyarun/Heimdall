let ctx: AudioContext | undefined;

/** Short non-speech cues so a blind user knows a photo was taken and an answer arrived. */
export function tone(kind: 'shutter' | 'done' | 'error') {
  try {
    ctx ??= new AudioContext();
    const notes = kind === 'shutter' ? [880] : kind === 'done' ? [660, 990] : [300, 200];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx!.currentTime + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.15, ctx!.currentTime + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx!.currentTime + i * 0.09 + 0.08);
      o.connect(g).connect(ctx!.destination);
      o.start(ctx!.currentTime + i * 0.09);
      o.stop(ctx!.currentTime + i * 0.09 + 0.09);
    });
  } catch {
    /* audio unavailable */
  }
}
