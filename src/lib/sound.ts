let ctx: AudioContext | undefined;

/** Short non-speech cues so a blind user knows a photo was taken and an answer arrived. */
const NOTES = {
  shutter: [880],
  done: [660, 990],
  error: [300, 200],
  listen: [520, 780],
  liveOn: [440, 660, 880],
  liveOff: [880, 660, 440],
  alarm: [988, 740, 988, 740],
} as const;

export function tone(kind: keyof typeof NOTES) {
  try {
    ctx ??= new AudioContext();
    const notes = NOTES[kind];
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
