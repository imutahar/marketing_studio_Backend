// Shared generation domain — mirrors the frontend's GenerationRequest so the
// two repos speak the same language.

export type GenerationMode = 'image' | 'video';

export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

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
  options: string[];
  attachments: AttachmentInput[];
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
  status: JobStatus;
  capability: Capability;
  request: GenerationRequest;
  provider: string;
  outputs: GenerationOutput[];
  error?: string;
  /** Optional owning project. */
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Derive the capability from the request shape (input present ⇒ image-to-*). */
export function resolveCapability(request: GenerationRequest): Capability {
  const hasImageInput = request.attachments?.some((a) => Boolean(a.url));
  if (request.mode === 'video') {
    return hasImageInput ? 'image-to-video' : 'text-to-video';
  }
  return hasImageInput ? 'image-to-image' : 'text-to-image';
}
