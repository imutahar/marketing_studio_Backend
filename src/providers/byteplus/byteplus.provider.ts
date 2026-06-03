import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationContext, GenerationProvider } from '../provider.interface';
import { Capability, GenerationOutput } from '../../common/generation.types';

/**
 * BytePlus (ModelArk / Seedance) provider.
 *
 * Implements ModelArk's API shape:
 *   - Image generation (sync):   POST {base}/images/generations
 *   - Video generation (async):  POST {base}/contents/generations/tasks
 *                                GET  {base}/contents/generations/tasks/{id}
 *
 * Verified against the ModelArk API:
 *   video model: seedance-1-0-pro-fast-251015 (params via --flags in the text)
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
      prompt: ctx.request.prompt,
      response_format: 'url',
      size: this.config.get<string>('BYTEPLUS_IMAGE_SIZE') ?? '2K',
      sequential_image_generation: 'disabled',
      watermark: false,
      stream: false,
    };
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
    const imageUrl = this.firstImageUrl(ctx);
    if (imageUrl)
      content.push({ type: 'image_url', image_url: { url: imageUrl } });

    const created = await this.post<CreateTaskResponse>(
      `${baseUrl}/contents/generations/tasks`,
      apiKey,
      { model, content },
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
        'seedance-1-0-pro-fast-251015'
      );
    }
    return (
      this.config.get<string>('BYTEPLUS_IMAGE_MODEL') ?? 'seedream-5-0-260128'
    );
  }

  private firstImageUrl(ctx: GenerationContext): string | undefined {
    return ctx.request.attachments.find((a) => Boolean(a.url))?.url;
  }

  /**
   * Append recognized Seedance parameters as command flags to the prompt.
   * Flag names follow ModelArk's text-command convention — verify against your
   * console and adjust this single mapping if needed.
   */
  private composeVideoPrompt(ctx: GenerationContext): string {
    const flags: string[] = [];
    for (const opt of ctx.request.options) {
      const duration = opt.match(/^(\d+)\s*(?:s|ث)$/); // "12s" or "12 ث"
      if (duration) flags.push(`--duration ${duration[1]}`);
      else if (/^\d+:\d+$/.test(opt)) flags.push(`--ratio ${opt}`);
      else if (/^\d+p$/i.test(opt)) flags.push(`--resolution ${opt}`);
    }
    return [ctx.request.prompt, ...flags].join(' ').trim();
  }

  private async post<T>(
    url: string,
    apiKey: string,
    body: unknown,
  ): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `BytePlus ${res.status} (POST ${url}): ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }

  private async get<T>(url: string, apiKey: string): Promise<T> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
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
  /** e.g. queued | running | succeeded | failed | cancelled */
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
