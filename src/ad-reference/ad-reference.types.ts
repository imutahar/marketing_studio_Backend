export type AdReferenceStatus = 'analyzing' | 'ready' | 'failed';

export interface AdShot {
  index: number;
  start: number;
  end: number;
  /** hook | demo | benefit | cta | … */
  type: string;
  visual: string;
  spoken: string;
  onScreenText: string;
}

export interface AdScript {
  durationSec: number;
  aspectRatio: string;
  shots: AdShot[];
}

export interface AdReference {
  id: string;
  status: AdReferenceStatus;
  /** 0–100 analysis progress. */
  progress: number;
  referenceVideoUrl: string;
  productImage?: string;
  avatarImage?: string;
  avatarName?: string;
  script?: AdScript;
  error?: string;
  /** Set once a generation has been kicked off from this reference. */
  generationId?: string;
  createdAt: string;
  updatedAt: string;
}
