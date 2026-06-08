// Shared generation domain — mirrors the frontend's GenerationRequest so the
// two repos speak the same language.

export type GenerationMode = 'image' | 'video';

export type JobStatus =
  | 'queued'
  | 'processing'
  | 'draft_ready'
  | 'succeeded'
  | 'failed';

export type AttachmentKind = 'product' | 'character' | 'image';

export interface AttachmentInput {
  slotId: string;
  kind: AttachmentKind;
  fileName?: string;
  /** Public URL or data URI of the uploaded asset (absent for text-only). */
  url?: string;
}

export interface GenerationRequest {
  mode: GenerationMode;
  prompt: string;
  /**
   * Toolbar selections keyed by select id (e.g. `duration`, `ratio`,
   * `resolution`, or any style descriptor key). Keyed (not positional) so a
   * chip reorder can't silently shift a value into the wrong slot.
   */
  options: Record<string, string>;
  attachments: AttachmentInput[];
  /** Advanced settings. */
  negativePrompt?: string;
  seed?: number;
  cameraFixed?: boolean;
  /** Video only: generate synced audio (voice/SFX/music). Default off. */
  generateAudio?: boolean;
  /**
   * Video only (user opt-in): run the cheap 480p "draft" first and pause at
   * draft_ready for approval before the full render. Seedance 1.5-Pro only.
   */
  draft?: boolean;
}

/** What kind of generation this is — drives model/provider selection. */
export type Capability =
  | 'text-to-image'
  | 'text-to-video'
  | 'image-to-image'
  | 'image-to-video';

export interface GenerationOutput {
  type: GenerationMode;
  url: string;
}

export interface Job {
  id: string;
  /** Owning tenant. Single hard-coded owner today (see DEFAULT_OWNER). */
  ownerId: string;
  status: JobStatus;
  capability: Capability;
  request: GenerationRequest;
  provider: string;
  outputs: GenerationOutput[];
  error?: string;
  /** Draft mode: the ModelArk draft task id (valid 7 days), used to promote. */
  draftTaskId?: string;
  /** Draft mode: durable URL of the 480p preview shown before approval. */
  draftPreviewUrl?: string;
  /** Optional owning project. */
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Coerce a raw `options` payload into the keyed object the pipeline expects.
 *
 * Rollout safety: this deploys BEFORE the new frontend, so old clients may
 * still POST a positional `string[]`. We tolerate that without crashing or
 * 400ing — a non-null, non-Array object is used as-is (values coerced to
 * strings); ANYTHING else (legacy array, null, string, number, …) collapses to
 * `{}`, so video params just fall back to model defaults for the brief window.
 */
export function normalizeOptions(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = typeof value === 'string' ? value : String(value);
  }
  return out;
}

/** Derive the capability from the request shape (input present ⇒ image-to-*). */
export function resolveCapability(request: GenerationRequest): Capability {
  const hasImageInput = request.attachments?.some((a) => Boolean(a.url));
  if (request.mode === 'video') {
    return hasImageInput ? 'image-to-video' : 'text-to-video';
  }
  return hasImageInput ? 'image-to-image' : 'text-to-image';
}
