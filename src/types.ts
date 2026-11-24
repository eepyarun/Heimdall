export type Mode = 'describe' | 'read' | 'identify' | 'translate' | 'ask';
export type Privacy = 'private' | 'smart' | 'quality';
export type Confidence = 'high' | 'medium' | 'low';
export type Engine = 'on_device' | 'in_cloud';
export type Category = 'medicine' | 'money' | 'food' | 'product' | 'document' | 'other';

export interface Fact {
  label: string;
  value: string;
}

export interface VisionResult {
  /** What Heimdall says aloud first. Short, most important thing first. */
  speech: string;
  confidence: Confidence;
  /** One short camera instruction if the photo was poor ("Move closer"), otherwise empty. */
  tip: string;
  /** Anything dangerous in view (warning signs, hazard symbols, medicine warnings, allergens, expiry, physical hazards), most serious first. Spoken before everything else. */
  alerts: string[];
  category?: Category;
  name?: string;
  facts?: Fact[];
  /** Full transcription (Read) or original text (Translate). */
  text?: string;
  translation?: string;
  sourceLanguage?: string;
  /** Translate: each line of the original text with its translation, in reading order. */
  lines?: LinePair[];
}

export interface LinePair {
  original: string;
  translation: string;
}

export interface Attempt {
  engine: Engine;
  model: string;
  confidence?: Confidence;
  ms: number;
  reason: string;
}

export interface Answer {
  id: string;
  mode: Mode;
  question?: string;
  result: VisionResult;
  attempts: Attempt[];
  escalated: boolean;
  at: number;
  /** Produced by live narration rather than a single Look. */
  live?: boolean;
}

export interface SavedItem {
  id: string;
  name: string;
  category: Category;
  facts: Fact[];
  savedAt: number;
}
