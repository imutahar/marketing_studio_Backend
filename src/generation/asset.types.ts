import { GenerationMode } from '../common/generation.types';

/** A single generated output, flattened across all generations. */
export interface Asset {
  id: string;
  type: GenerationMode;
  url: string;
  prompt: string;
  projectId?: string;
  createdAt: string;
}
