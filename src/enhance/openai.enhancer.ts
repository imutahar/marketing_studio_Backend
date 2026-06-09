import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromptEnhancer } from './enhance.types';

/** OpenAI chat-completions endpoint (also the shape ModelArk/others mimic). */
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 15_000;
/** Cheap, strong-Arabic default; override with OPENAI_ENHANCE_MODEL. */
const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * {@link PromptEnhancer} backed by OpenAI. Requires OPENAI_API_KEY; when unset
 * the feature self-disables (the service reports it unavailable and the UI
 * hides the button) rather than erroring at call time.
 */
@Injectable()
export class OpenAiEnhancer implements PromptEnhancer {
  private readonly logger = new Logger(OpenAiEnhancer.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('OPENAI_API_KEY');
  }

  async enhance(system: string, user: string): Promise<string> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
    const model =
      this.config.get<string>('OPENAI_ENHANCE_MODEL') ?? DEFAULT_MODEL;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.7,
          max_tokens: 400,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`OpenAI request timed out after ${TIMEOUT_MS}ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('OpenAI returned no content.');
    return content;
  }
}
