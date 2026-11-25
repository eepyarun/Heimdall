import { getGenerativeModel, type GenerativeModel, type Part } from 'firebase/ai';
import { firebase } from './firebase';
import { config } from './config';
import { canRunPrivately, isDeviceDisabled, onDeviceOptions } from './device';
import { chooseRoute, cleanAlerts, isBusyError, modelChain, normalizeConfidence, shouldEscalate, type RouteMode } from './policy';
import type { Answer, Attempt, Engine, Mode, Privacy, SavedItem, VisionResult } from '../types';

export const LANGUAGES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  ja: 'Japanese',
  hi: 'Hindi',
  ar: 'Arabic',
  fr: 'French',
  de: 'German',
  zh: 'Chinese (Simplified)',
  pt: 'Portuguese',
  ko: 'Korean',
  ta: 'Tamil',
};

/** BCP-47 tags for speech synthesis / recognition. */
export const SPEECH_LANG: Record<string, string> = {
  en: 'en-US', es: 'es-ES', ja: 'ja-JP', hi: 'hi-IN', ar: 'ar-SA', fr: 'fr-FR', de: 'de-DE', zh: 'zh-CN', pt: 'pt-BR', ko: 'ko-KR', ta: 'ta-IN',
};

// ---------- models ----------

const models = new Map<string, GenerativeModel>();

function model(mode: RouteMode, lang: string, schema: Record<string, unknown>, cloudModel: string): GenerativeModel {
  const effective: RouteMode = isDeviceDisabled() ? 'only_in_cloud' : mode;
  const key = `${effective}|${lang}|${cloudModel}|${JSON.stringify(schema)}`;
  let m = models.get(key);
  if (!m) {
    m = getGenerativeModel(firebase().ai, {
      mode: effective,
      onDeviceParams: {
        createOptions: { ...onDeviceOptions(lang), temperature: 0.2, topK: 3 } as never,
        promptOptions: { responseConstraint: schema },
      },
      inCloudParams: {
        model: cloudModel,
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseJsonSchema: schema },
      },
    });
    models.set(key, m);
  }
  return m;
}

/** Start the Gemini Nano download and load it into memory so the first real request is fast. Call from a user gesture. */
export async function warmUp(onProgress?: (p: number) => void) {
  const m = getGenerativeModel(firebase().ai, { mode: 'prefer_on_device', onDeviceParams: { createOptions: onDeviceOptions('en') as never } });
  try {
    await m.initializeDeviceModel(onProgress);
    if (await canRunPrivately()) await m.generateContent('Reply with the single word OK.');
  } catch (e) {
    console.warn('On-device warm-up skipped', e);
  }
}

// ---------- images ----------

export async function toJpegPart(source: CanvasImageSource & { width?: number; height?: number }, w: number, h: number, maxSide = 1024): Promise<Part> {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  return { type: 'inlineData', inlineData: { data, mimeType: 'image/jpeg' } } as Part;
}

export async function fileToPart(file: File): Promise<Part> {
  const bmp = await createImageBitmap(file);
  return toJpegPart(bmp, bmp.width, bmp.height);
}

export function partToDataUrl(part: Part): string {
  const d = (part as { inlineData: { data: string; mimeType: string } }).inlineData;
  return `data:${d.mimeType};base64,${d.data}`;
}

// ---------- prompts & schemas ----------

const str = { type: 'string' };
const strList = { type: 'array', items: str };
const facts = { type: 'array', items: { type: 'object', properties: { label: str, value: str }, required: ['label', 'value'] } };
const base = {
  alerts: strList,
  speech: str,
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  tip: str,
};
const baseRequired = ['alerts', 'speech', 'confidence', 'tip'];

const SCHEMAS: Record<Mode, Record<string, unknown>> = {
  describe: { type: 'object', properties: base, required: baseRequired },
  read: { type: 'object', properties: { ...base, text: str }, required: [...baseRequired, 'text'] },
  identify: {
    type: 'object',
    properties: {
      ...base,
      category: { type: 'string', enum: ['medicine', 'money', 'food', 'product', 'document', 'other'] },
      name: str,
      facts,
    },
    required: [...baseRequired, 'category', 'name', 'facts'],
  },
  translate: {
    type: 'object',
    properties: {
      ...base,
      sourceLanguage: str,
      text: str,
      translation: str,
      lines: { type: 'array', items: { type: 'object', properties: { original: str, translation: str }, required: ['original', 'translation'] } },
    },
    required: [...baseRequired, 'sourceLanguage', 'text', 'translation', 'lines'],
  },
  ask: { type: 'object', properties: base, required: baseRequired },
};

const WORDS: Record<Mode, number> = { describe: 40, read: 70, identify: 40, translate: 70, ask: 45 };

interface PromptExtras {
  /** Live narration: what Heimdall said about the previous frame. */
  live?: boolean;
  previous?: string;
  /** Follow-up questions: Heimdall's last answer about this scene. */
  context?: string;
}

function liveRules(previous: string | undefined) {
  return `
LIVE MODE: the camera is on continuously and the person hears short updates while they move or pan.
- Previously you said: "${previous || '(nothing yet)'}".
- speech: at most 20 words, only what is NEW or newly important since then. Do not repeat earlier information.
- alerts: still list every danger in view, even if mentioned before; the app avoids repeating them aloud.
- If nothing meaningful changed, speech MUST be an empty string "".
- tip: an empty string unless the camera shows nothing useful (covered, black, or pointing at the floor or ceiling).`;
}

function prompt(mode: Mode, lang: string, question: string | undefined, saved: SavedItem[], x: PromptExtras = {}) {
  const followUp = x.context && mode === 'ask' ? `\n- Earlier you told them: "${x.context}". Use it if the question refers to it.` : '';
  return basePrompt(mode, lang, question, saved, x) + followUp + (x.live ? liveRules(x.previous) : '');
}

function basePrompt(mode: Mode, lang: string, question: string | undefined, saved: SavedItem[], x: PromptExtras) {
  const langName = LANGUAGES[lang] ?? 'English';
  const rules = `You are Heimdall, a privacy-first camera guide. Your user may be blind or have low vision, be older, or simply prefer not to send photos to the cloud. They took this photo and need a clear spoken description.
Rules:
- Write "speech" in ${langName}. It is read aloud: at most ${x.live ? 20 : WORDS[mode]} words, the most important thing first, plain words, no markdown or lists.
- Never guess. If something is blurry, cut off, too dark, or too small to read, say so plainly.
- confidence: "high" only if you are sure; "medium" if part of it is unclear; "low" if the photo is too poor to be sure.
- tip: if the photo is poor, one short instruction to fix it, such as "Move the camera closer", "Add more light", or "Tilt the camera down". Otherwise an empty string.
- alerts: SAFETY FIRST. Check the whole photo for anything that warns of danger, whatever the task. Each alert is a short phrase in ${langName}, most serious first:
  warning or danger signs ("Danger", "Caution", "Do not enter", "High voltage", "Road work ahead", "Wet floor"); hazard symbols (poison, flammable, corrosive, biohazard, radiation);
  medicine and product warnings ("May cause drowsiness", "Do not take with alcohol", "Do not use if pregnant", "Keep out of reach of children"); allergens; an expiry date that has passed (today is ${new Date().toDateString()});
  physical dangers near the person (stairs, curbs, traffic, holes, sharp edges, hot surfaces, open doors) with a clock direction and rough distance in steps, like "Stairs going down at 12 o'clock, 3 steps".
  Copy printed warnings exactly. Never invent a danger. [] if there is none.
- alerts are read aloud before speech, so do not repeat them in speech.`;

  switch (mode) {
    case 'describe':
      return `${rules}
Task: describe what is in front of them so they can act safely.
- speech: the main objects and layout, with clock directions ("at 2 o'clock") and rough distance in steps. Describe people only by what they are doing; never identify anyone.`;
    case 'read':
      return `${rules}
Task: read the text in the photo.
- text: transcribe ALL readable text exactly as written, in reading order, keeping line breaks. Do not translate it.
- speech: first say what it is in a few words (a letter, a medicine label, a screen, a sign), then the most important part: for mail, who it is from and what it asks; for a screen, the main message; for a short sign, the whole sign.`;
    case 'identify':
      return `${rules}
Task: identify the main item they are holding or pointing the camera at.
- category: medicine, money, food, product, document, or other.
- name: what it is. For money, the denomination and currency, like "20 US dollars".
- facts: the details that matter, copied exactly from the label. Medicine: drug name, strength, directions, expiry date. Food: product, best-before date, allergens. Product: brand, product, size, key instructions.
- For medicine, confidence is "high" only if the drug name AND strength are clearly readable.${
        saved.length
          ? `\n- The user has saved these items: ${saved.map((s) => s.name).join('; ')}. If this is one of them, start speech with "This is your saved ${'<name>'}".`
          : ''
      }`;
    case 'translate':
      return `${rules}
Task: find the foreign-language text (sign, menu, label, notice) and translate it into ${langName}.
- sourceLanguage: the language of the original text, in English.
- text: the original text exactly. translation: the full translation in ${langName}.
- lines: the original text line by line, in reading order, each line copied exactly (including prices) with its ${langName} translation.
- speech: a natural spoken summary of what it says, entirely in ${langName}; never read the original words aloud. For menus, the translated dishes and prices.`;
    case 'ask':
      return `${rules}
Task: answer this question about the photo: "${question ?? ''}"
- speech: a direct, specific answer. If the photo does not show the answer, say so and suggest how to point the camera.`;
  }
}

function parse(raw: string): VisionResult {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  const r = JSON.parse(cleaned) as Partial<VisionResult>;
  return {
    ...r,
    speech: (r.speech ?? '').trim(),
    alerts: cleanAlerts(r.alerts),
    confidence: normalizeConfidence(r.confidence),
    tip: (r.tip ?? '').trim(),
  } as VisionResult;
}

// ---------- running ----------

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(`No answer after ${ms / 1000}s`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

/** Private mode cannot fall back to the cloud, so it tells the user instead of waiting forever. */
export class OnDeviceTooSlow extends Error {
  constructor() {
    super('On-device AI is taking too long. Private mode stays on-device and offline; switch to Smart mode in Settings to let the cloud help.');
  }
}

const ON_DEVICE_TIMEOUT_MS = 30_000;
const PRIVATE_TIMEOUT_MS = 60_000;
const LIVE_ON_DEVICE_TIMEOUT_MS = 12_000;
/** Per cloud model; a stalled model is treated like a busy one and the next backup is tried. */
const CLOUD_TIMEOUT_MS = 40_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function attempt(
  mode: Mode,
  route: RouteMode,
  lang: string,
  cloudModel: string,
  text: string,
  image: Part,
  timeoutMs: number,
  onRetry?: () => void,
): Promise<{ result: VisionResult; engine: Engine; ms: number; model: string }> {
  const cloudOnly = route === 'only_in_cloud' || route === 'prefer_in_cloud';
  const cfg = config();
  const tries = modelChain(cloudModel, [cfg.verifyModel, ...cfg.backupModels, cfg.cloudModel]);
  const t0 = performance.now();
  let res: Awaited<ReturnType<GenerativeModel['generateContent']>> | undefined;
  let used = cloudModel;
  for (let i = 0; i < tries.length; i++) {
    used = tries[i];
    const call = model(route, lang, SCHEMAS[mode], used).generateContent([text, image]);
    try {
      res = await withTimeout(call, timeoutMs);
      break;
    } catch (e) {
      const retry = isBusyError(e) || (cloudOnly && e instanceof TimeoutError);
      if (!retry || i === tries.length - 1) throw e;
      onRetry?.();
      if (tries[i + 1] === used) await sleep(800);
    }
  }
  if (!res) throw new Error('No answer');
  const engine: Engine = res.response.inferenceSource === 'on_device' ? 'on_device' : 'in_cloud';
  const raw = res.response.text();
  let result: VisionResult;
  try {
    result = parse(raw);
  } catch {
    result = { speech: raw.slice(0, 400), confidence: 'low', tip: '', alerts: [] };
  }
  return { result, engine, ms: Math.round(performance.now() - t0), model: used };
}

export interface SeeOptions {
  mode: Mode;
  image: Part;
  privacy: Privacy;
  lang: string;
  question?: string;
  saved: SavedItem[];
  live?: boolean;
  previous?: string;
  context?: string;
  /** Spoken progress while waiting, e.g. when Heimdall switches from on-device to cloud. */
  onProgress?: (message: string) => void;
}

export async function see(o: SeeOptions): Promise<Answer> {
  const cfg = config();
  const deviceReady = await canRunPrivately(o.lang);
  const route = chooseRoute({
    mode: o.mode,
    privacy: o.privacy,
    lang: o.lang,
    deviceReady,
    onDeviceLanguages: cfg.onDeviceLanguages,
    languageName: LANGUAGES[o.lang] ?? o.lang,
  });
  const text = prompt(o.mode, o.lang, o.question, o.saved, o);
  const attempts: Attempt[] = [];

  const onDeviceFirst = deviceReady && route.mode === 'prefer_on_device';
  const timeout = o.live
    ? onDeviceFirst || route.mode === 'only_on_device'
      ? LIVE_ON_DEVICE_TIMEOUT_MS
      : CLOUD_TIMEOUT_MS
    : route.mode === 'only_on_device'
      ? PRIVATE_TIMEOUT_MS
      : onDeviceFirst
        ? ON_DEVICE_TIMEOUT_MS
        : CLOUD_TIMEOUT_MS;
  const busyNote = () => o.onProgress?.('The cloud is busy. Trying another model.');

  let first: Awaited<ReturnType<typeof attempt>> | null = null;
  try {
    const cloudModel = o.privacy === 'quality' ? cfg.verifyModel : cfg.cloudModel;
    first = await attempt(o.mode, route.mode, o.lang, cloudModel, text, o.image, timeout, busyNote);
  } catch (e) {
    if (!(e instanceof TimeoutError)) throw e;
    // A slow live frame is simply skipped; the next frame will be newer anyway.
    if (o.live) return answer(o, { speech: '', confidence: 'low', tip: '', alerts: [] }, [], false);
    if (route.mode === 'only_on_device') throw new OnDeviceTooSlow();
    if (!onDeviceFirst) throw new Error('Cloud AI unavailable: no answer in time');
    o.onProgress?.('On-device AI is taking too long. Switching to cloud AI.');
    attempts.push({ engine: 'on_device', model: 'Gemini Nano', ms: ON_DEVICE_TIMEOUT_MS, reason: 'On-device AI was too slow, so Heimdall asked the cloud instead' });
  }

  if (first) {
    attempts.push({
      engine: first.engine,
      model: first.engine === 'on_device' ? 'Gemini Nano' : first.model,
      confidence: first.result.confidence,
      ms: first.ms,
      reason: first.engine === 'on_device' ? route.why : route.mode === 'prefer_on_device' ? 'On-device AI not available here, so the cloud answered' : route.why,
    });
    const escalate = shouldEscalate({
      privacy: o.privacy,
      live: o.live,
      answeredOnDevice: first.engine === 'on_device',
      confidence: first.result.confidence,
      category: first.result.category,
      escalateAt: cfg.escalateAt,
      escalateMedicineAt: cfg.escalateMedicineAt,
    });
    if (!escalate) return answer(o, first.result, attempts, false);
  }

  let verified: Awaited<ReturnType<typeof attempt>>;
  try {
    verified = await attempt(o.mode, 'only_in_cloud', o.lang, cfg.verifyModel, text, o.image, CLOUD_TIMEOUT_MS, busyNote);
  } catch (e) {
    // The on-device answer is still better than nothing; the trail shows the double-check failed.
    if (!first) throw e;
    attempts.push({ engine: 'in_cloud', model: cfg.verifyModel, ms: 0, reason: 'The cloud double-check could not be reached, so this is the on-device answer' });
    return answer(o, first.result, attempts, false);
  }
  attempts.push({
    engine: 'in_cloud',
    model: verified.model,
    confidence: verified.result.confidence,
    ms: verified.ms,
    reason: first
      ? `On-device AI was ${first.result.confidence === 'low' ? 'unsure' : 'not certain'}${first.result.category === 'medicine' ? ' about a medicine' : ''}, so Heimdall double-checked with a stronger cloud model`
      : 'Answered by the cloud after the on-device timeout',
  });
  return answer(o, verified.result, attempts, !!first);
}

/** User explicitly asks for a cloud double-check (e.g. from Private mode). */
export async function verifyInCloud(o: SeeOptions, prev: Answer): Promise<Answer> {
  const cfg = config();
  const text = prompt(o.mode, o.lang, o.question, o.saved, o);
  const v = await attempt(o.mode, 'only_in_cloud', o.lang, cfg.verifyModel, text, o.image, CLOUD_TIMEOUT_MS);
  return answer(
    o,
    v.result,
    [...prev.attempts, { engine: 'in_cloud', model: v.model, confidence: v.result.confidence, ms: v.ms, reason: 'You asked for a cloud double-check of this photo' }],
    true,
  );
}

function answer(o: SeeOptions, result: VisionResult, attempts: Attempt[], escalated: boolean): Answer {
  return { id: crypto.randomUUID(), mode: o.mode, question: o.question, result, attempts, escalated, at: Date.now(), live: o.live };
}
