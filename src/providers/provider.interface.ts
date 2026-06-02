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
}

/** DI token for the registered provider list. */
export const GENERATION_PROVIDERS = Symbol('GENERATION_PROVIDERS');
