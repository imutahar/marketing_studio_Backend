import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationContext, GenerationProvider } from '../provider.interface';
import { Capability, GenerationOutput } from '../../common/generation.types';
import { parseDurationSeconds } from '../../common/duration';

/**
 * Per-request HTTP timeout. The video poll has its own wall-clock deadline
 * between polls (pollTimeoutMs), but a SINGLE hung fetch must not block
 * indefinitely and pin a job in 'processing' forever. Kept well under the
 * poll cadence so a stuck request fails fast and the loop can recover.
 * Note: image generation (Seedream) is synchronous — the POST stays open
 * until the image is ready, which at 4K can take ~30-60s — so this must be
 * generous enough for the largest image size.
 */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * BytePlus (ModelArk / Seedance) provider.
 *
 * Implements ModelArk's API shape:
 *   - Image generation (sync):   POST {base}/images/generations
 *   - Video generation (async):  POST {base}/contents/generations/tasks
 *                                GET  {base}/contents/generations/tasks/{id}
 *
 * Verified against the ModelArk API:
 *   video model: seedance-1-5-pro-251215 (params via --flags in the text)
 *   image model: seedream-5-0-260128
 * Both are env-overridable (BYTEPLUS_VIDEO_MODEL / BYTEPLUS_IMAGE_MODEL); only
 * BYTEPLUS_API_KEY is required.
 *
 * IMPORTANT — image inputs: ModelArk's image_url expects a *publicly reachable*
 * URL (e.g. object storage). A base64 data URI may be rejected. For local
 * testing of image-to-video with an uploaded photo, the image must be hosted
 * somewhere BytePlus can fetch (TOS upload is the planned next step).
 */
@Injectable()
export class ByteplusProvider implements GenerationProvider {
  readonly name = 'byteplus';
  private readonly logger = new Logger(ByteplusProvider.name);

  private readonly defaultEndpoint =
    'https://ark.ap-southeast.bytepluses.com/api/v3';
  private readonly pollIntervalMs = 5000;
  private readonly pollTimeoutMs = 10 * 60 * 1000;

  constructor(private readonly config: ConfigService) {}

  supports(capability: Capability): boolean {
    return (
      [
        'text-to-image',
        'image-to-image',
        'text-to-video',
        'image-to-video',
      ] as Capability[]
    ).includes(capability);
  }

  async generate(ctx: GenerationContext): Promise<GenerationOutput[]> {
    const apiKey = this.config.get<string>('BYTEPLUS_API_KEY');
    if (!apiKey) {
      throw new Error(
        'BytePlus provider is not configured: set BYTEPLUS_API_KEY to enable real generation.',
      );
    }
    const baseUrl = (
      this.config.get<string>('BYTEPLUS_ENDPOINT') ?? this.defaultEndpoint
    ).replace(/\/$/, '');

    return ctx.request.mode === 'video'
      ? this.generateVideo(ctx, baseUrl, apiKey)
      : this.generateImage(ctx, baseUrl, apiKey);
  }

  // ── Image (synchronous) ────────────────────────────────────────────────
  private async generateImage(
    ctx: GenerationContext,
    baseUrl: string,
    apiKey: string,
  ): Promise<GenerationOutput[]> {
    const model = this.resolveModel('image');
    const body: Record<string, unknown> = {
      model,
      prompt: this.composeImagePrompt(ctx),
      response_format: 'url',
      size: this.config.get<string>('BYTEPLUS_IMAGE_SIZE') ?? '2K',
      sequential_image_generation: 'disabled',
      watermark: false,
      stream: false,
    };
    if (ctx.request.seed !== undefined) body.seed = ctx.request.seed;
    const imageUrl = this.firstImageUrl(ctx);
    if (imageUrl) body.image = imageUrl; // image-to-image reference

    const res = await this.post<ImageGenerationResponse>(
      `${baseUrl}/images/generations`,
      apiKey,
      body,
    );
    const url = res.data?.[0]?.url;
    if (!url) throw new Error('BytePlus image generation returned no url.');
    return [{ type: 'image', url }];
  }

  // ── Video (async task + poll) ──────────────────────────────────────────
  private async generateVideo(
    ctx: GenerationContext,
    baseUrl: string,
    apiKey: string,
  ): Promise<GenerationOutput[]> {
    const model = this.resolveModel('video');

    const content: TaskContentPart[] = [
      { type: 'text', text: this.composeVideoPrompt(ctx) },
    ];
    for (const url of this.referenceImages(ctx)) {
      content.push({ type: 'image_url', image_url: { url } });
    }

    const created = await this.post<CreateTaskResponse>(
      `${baseUrl}/contents/generations/tasks`,
      apiKey,
      // generate_audio defaults to true on Seedance 1.5-Pro (and ~doubles token
      // cost), so always send it explicitly — off unless the user opted in.
      { model, content, generate_audio: ctx.request.generateAudio ?? false },
    );
    this.logger.log(
      `BytePlus video task ${created.id} created (job ${ctx.jobId}).`,
    );

    const videoUrl = await this.pollVideoTask(baseUrl, apiKey, created.id);
    return [{ type: 'video', url: videoUrl }];
  }

  private async pollVideoTask(
    baseUrl: string,
    apiKey: string,
    taskId: string,
  ): Promise<string> {
    const deadline = Date.now() + this.pollTimeoutMs;
    while (Date.now() < deadline) {
      const task = await this.get<TaskStatusResponse>(
        `${baseUrl}/contents/generations/tasks/${taskId}`,
        apiKey,
      );
      switch (task.status) {
        case 'succeeded':
          if (!task.content?.video_url) {
            throw new Error(
              'BytePlus task succeeded but returned no video_url.',
            );
          }
          return task.content.video_url;
        case 'failed':
        case 'cancelled':
        case 'expired':
          throw new Error(
            `BytePlus task ${task.status}: ${task.error?.message ?? 'no detail'}`,
          );
        default:
          await delay(this.pollIntervalMs);
      }
    }
    throw new Error('BytePlus video task timed out.');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  /** Model id for the kind, env-overridable; defaults to the verified ids. */
  private resolveModel(kind: 'image' | 'video'): string {
    if (kind === 'video') {
      return (
        this.config.get<string>('BYTEPLUS_VIDEO_MODEL') ??
        'seedance-1-5-pro-251215'
      );
    }
    return (
      this.config.get<string>('BYTEPLUS_IMAGE_MODEL') ?? 'seedream-5-0-260128'
    );
  }

  /** Prefer the product image as the reference; fall back to any attachment. */
  private firstImageUrl(ctx: GenerationContext): string | undefined {
    const withUrl = ctx.request.attachments.filter((a) => Boolean(a.url));
    const product = withUrl.find((a) => a.kind === 'product');
    return (product ?? withUrl[0])?.url;
  }

  /** The selected character/avatar name, if any (kind === 'character'). */
  private characterName(ctx: GenerationContext): string | undefined {
    return ctx.request.attachments.find((a) => a.kind === 'character')
      ?.fileName;
  }

  /**
   * Reference images for video: product first (primary subject), then the
   * character/avatar so it can appear as the presenter. Sending both depends
   * on the model supporting multiple references — disable with
   * BYTEPLUS_INCLUDE_CHARACTER_IMAGE=false if it errors.
   */
  private referenceImages(ctx: GenerationContext): string[] {
    const atts = ctx.request.attachments;
    const product = atts.find((a) => a.kind === 'product' && a.url)?.url;
    const character = atts.find((a) => a.kind === 'character' && a.url)?.url;
    const includeCharacter =
      this.config.get<string>('BYTEPLUS_INCLUDE_CHARACTER_IMAGE') !== 'false';

    const images: string[] = [];
    if (product) images.push(product);
    if (includeCharacter && character && character !== product) {
      images.push(character);
    }
    if (images.length === 0) {
      const fallback = atts.find((a) => a.url)?.url;
      if (fallback) images.push(fallback);
    }
    return images;
  }

  /**
   * Append recognized Seedance parameters as command flags to the prompt.
   * Flag names follow ModelArk's text-command convention — verify against your
   * console and adjust this single mapping if needed.
   */
  private composeVideoPrompt(ctx: GenerationContext): string {
    const flags: string[] = [];
    const descriptors: string[] = [];
    for (const opt of ctx.request.options) {
      const duration = parseDurationSeconds([opt]); // "12s" or "12 ث"
      if (duration !== undefined) flags.push(`--duration ${duration}`);
      else if (/^\d+:\d+$/.test(opt)) flags.push(`--ratio ${opt}`);
      else if (/^\d+p$/i.test(opt)) flags.push(`--resolution ${opt}`);
      else descriptors.push(opt); // style descriptors, e.g. نوع الفيديو
    }

    // Fold the chosen character/avatar into the prompt so it shapes the video.
    const character = this.characterName(ctx);
    if (character) descriptors.push(`يقدّمه ${character}`);
    if (ctx.request.negativePrompt)
      descriptors.push(`تجنّب: ${ctx.request.negativePrompt}`);

    // Advanced settings → Seedance flags.
    if (ctx.request.cameraFixed !== undefined) {
      flags.push(`--camerafixed ${ctx.request.cameraFixed}`);
    }
    if (ctx.request.seed !== undefined)
      flags.push(`--seed ${ctx.request.seed}`);

    return [styleText(ctx.request.prompt, descriptors), ...flags]
      .join(' ')
      .trim();
  }

  /** Image prompt enriched with the selected options (language, format, …). */
  private composeImagePrompt(ctx: GenerationContext): string {
    const descriptors = [...ctx.request.options];
    if (ctx.request.negativePrompt)
      descriptors.push(`تجنّب: ${ctx.request.negativePrompt}`);
    return styleText(ctx.request.prompt, descriptors);
  }

  private async post<T>(
    url: string,
    apiKey: string,
    body: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `BytePlus request timed out after ${REQUEST_TIMEOUT_MS}ms (POST ${url}).`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(
        `BytePlus ${res.status} (POST ${url}): ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }

  private async get<T>(url: string, apiKey: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `BytePlus request timed out after ${REQUEST_TIMEOUT_MS}ms (GET ${url}).`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(
        `BytePlus ${res.status} (GET ${url}): ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }
}

interface CreateTaskResponse {
  id: string;
}

interface TaskStatusResponse {
  id: string;
  /** queued | running | succeeded | failed | cancelled | expired */
  status: string;
  content?: { video_url?: string };
  error?: { message?: string };
}

interface ImageGenerationResponse {
  data?: { url?: string }[];
}

type TaskContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Append non-empty style descriptors (نوع الفيديو, language, …) to a prompt. */
function styleText(prompt: string, descriptors: string[]): string {
  const extras = descriptors.filter((d) => d && d.trim().length > 0);
  return extras.length ? `${prompt} — ${extras.join('، ')}` : prompt;
}
