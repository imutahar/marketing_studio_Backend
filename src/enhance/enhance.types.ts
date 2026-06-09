export interface EnhanceRequest {
  prompt: string;
  mode: 'image' | 'video';
  options?: Record<string, string>;
  productName?: string;
}

/**
 * A pluggable text rewriter. The enhancer vendor lives behind this seam so
 * swapping OpenAI for Skylark/Claude later is a single-provider change.
 */
export interface PromptEnhancer {
  /** Whether the vendor is configured (API key present). */
  isConfigured(): boolean;
  /** Rewrite `user` under the given `system` instruction; returns raw text. */
  enhance(system: string, user: string): Promise<string>;
}

/** DI token for the active {@link PromptEnhancer} implementation. */
export const PROMPT_ENHANCER = Symbol('PROMPT_ENHANCER');
