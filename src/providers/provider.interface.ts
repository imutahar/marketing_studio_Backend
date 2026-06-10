import {
  Capability,
  GenerationOutput,
  GenerationRequest,
} from '../common/generation.types';

export interface GenerationContext {
  jobId: string;
  capability: Capability;
  request: GenerationRequest;
}

/**
 * A generation backend (mock, BytePlus/Seedance, Google, …). Adding a provider
 * means implementing this interface and registering it — no changes elsewhere.
 */
export interface GenerationProvider {
  /** Stable identifier, e.g. 'mock', 'byteplus'. */
  readonly name: string;

  /** Whether this provider can handle the given capability. */
  supports(capability: Capability): boolean;

  /** Run generation; resolve with outputs when complete, reject on failure. */
  generate(ctx: GenerationContext): Promise<GenerationOutput[]>;

  /** Whether this provider supports the cheap 480p draft → promote flow. */
  supportsDraft?(): boolean;

  /** Whether the active video model supports the `camera_fixed` param. */
  supportsCameraFixed?(): boolean;

  /**
   * Create a 480p draft and resolve once it has succeeded. Returns the draft
   * task id (used later to promote) plus the preview video url.
   */
  createDraft?(
    ctx: GenerationContext,
  ): Promise<{ draftTaskId: string; previewUrl: string }>;

  /**
   * Promote a previously created draft to a full render at the user's target
   * resolution, re-running full inference. Resolves with the final outputs.
   */
  promoteDraft?(
    ctx: GenerationContext,
    draftTaskId: string,
  ): Promise<GenerationOutput[]>;
}

/** DI token for the registered provider list. */
export const GENERATION_PROVIDERS = Symbol('GENERATION_PROVIDERS');
