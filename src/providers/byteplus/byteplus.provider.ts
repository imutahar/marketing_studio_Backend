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
 * Documented Seedance value sets. Video params are sent in the structured task
 * body, which ModelArk validates strictly — so a value outside these sets (e.g.
 * a frontend "2:1" ratio the API doesn't support) is dropped rather than
 * failing the whole job; the model falls back to its default for that field.
 */
const ALLOWED_VIDEO_RESOLUTIONS = new Set(['480p', '720p', '1080p']);
const ALLOWED_VIDEO_RATIOS = new Set([
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
  '21:9',
  'adaptive',
]);

/** ModelArk accepts up to 14 reference images for image-to-image. */
const MAX_IMAGE_REFERENCES = 14;

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
    const { baseUrl, apiKey } = this.requireConfig();

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
      // The "format" select drives the real aspect ratio (Instagram post/story,
      // Facebook, banner). Falls back to the configured default size when no
      // recognized format is chosen.
      size:
        imageSizeForFormat(ctx.request.options.format) ??
        this.config.get<string>('BYTEPLUS_IMAGE_SIZE') ??
        '2K',
      watermark: false,
      stream: false,
    };
    if (ctx.request.seed !== undefined) body.seed = ctx.request.seed;
    // image-to-image: pass ALL references (product + brand/extra images), not
    // just the first. The API accepts a single url or an array (up to 14).
    const refs = this.imageReferenceUrls(ctx);
    if (refs.length === 1) body.image = refs[0];
    else if (refs.length > 1) body.image = refs;

    // Variations: ask for a SET of related images in one call. Seedream caps
    // input references + generated images at 15, so clamp accordingly.
    const requested = imageVariationCount(ctx.request.options.variations);
    const maxImages = Math.max(1, Math.min(requested, 15 - refs.length));
    if (maxImages > 1) {
      body.sequential_image_generation = 'auto';
      body.sequential_image_generation_options = { max_images: maxImages };
    } else {
      body.sequential_image_generation = 'disabled';
    }

    const res = await this.post<ImageGenerationResponse>(
      `${baseUrl}/images/generations`,
      apiKey,
      body,
    );
    // 'auto' returns a set; map every returned url to an output. The model may
    // return fewer than requested — render whatever it produced.
    const urls = (res.data ?? [])
      .map((d) => d.url)
      .filter((u): u is string => !!u);
    if (urls.length === 0)
      throw new Error('BytePlus image generation returned no url.');
    return urls.map((url) => ({ type: 'image', url }));
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

    // Resolution/ratio/duration/seed/camera_fixed go in the structured task
    // body (strictly validated by ModelArk) — NOT as --flags in the prompt
    // text, which silently ignored bad values and could be dropped entirely.
    const params = this.videoParams(ctx);
    const created = await this.post<CreateTaskResponse>(
      `${baseUrl}/contents/generations/tasks`,
      apiKey,
      // generate_audio defaults to true on Seedance 1.5-Pro (and ~doubles token
      // cost), so always send it explicitly — off unless the user opted in.
      {
        model,
        content,
        ...params,
        generate_audio: ctx.request.generateAudio ?? false,
      },
    );
    this.logger.log(
      `BytePlus video task ${created.id} created (job ${ctx.jobId}).`,
    );

    const videoUrl = await this.pollVideoTask(baseUrl, apiKey, created.id);
    return [{ type: 'video', url: videoUrl }];
  }

  // ── Draft mode (480p preview → promote → full render) ──────────────────
  supportsDraft(): boolean {
    return true;
  }

  /**
   * Create a cheap 480p draft. Same content + structured params as
   * generateVideo, EXCEPT resolution is forced out (ModelArk errors if a draft
   * carries any non-480p resolution) and `draft: true` is sent top-level. Polls
   * to succeeded and returns the draft task id (for promotion) + preview url.
   */
  async createDraft(
    ctx: GenerationContext,
  ): Promise<{ draftTaskId: string; previewUrl: string }> {
    const { baseUrl, apiKey } = this.requireConfig();
    const model = this.resolveModel('video');

    const content: TaskContentPart[] = [
      { type: 'text', text: this.composeVideoPrompt(ctx) },
    ];
    for (const url of this.referenceImages(ctx)) {
      content.push({ type: 'image_url', image_url: { url } });
    }

    // Drafts are 480p-only: drop any resolution the user picked; keep
    // ratio/duration/seed/camera_fixed and generate_audio.
    const params = this.videoParams(ctx);
    delete params.resolution;

    const created = await this.post<CreateTaskResponse>(
      `${baseUrl}/contents/generations/tasks`,
      apiKey,
      {
        model,
        content,
        ...params,
        generate_audio: ctx.request.generateAudio ?? false,
        draft: true,
      },
    );
    this.logger.log(
      `BytePlus draft task ${created.id} created (job ${ctx.jobId}).`,
    );

    const previewUrl = await this.pollVideoTask(baseUrl, apiKey, created.id);
    return { draftTaskId: created.id, previewUrl };
  }

  /**
   * Promote a draft to a full render. A NEW task that references the draft via
   * a `draft_task` content part and inherits model/prompt/image/seed/ratio/
   * duration/generate_audio from it; we override resolution (the user's target,
   * default 720p) and watermark. Re-runs full inference (billed normally).
   */
  async promoteDraft(
    ctx: GenerationContext,
    draftTaskId: string,
  ): Promise<GenerationOutput[]> {
    const { baseUrl, apiKey } = this.requireConfig();
    const model = this.resolveModel('video');

    const target =
      (this.videoParams(ctx).resolution as string | undefined) ?? '720p';

    const created = await this.post<CreateTaskResponse>(
      `${baseUrl}/contents/generations/tasks`,
      apiKey,
      {
        model,
        content: [
          { type: 'draft_task', draft_task: { id: draftTaskId } },
        ] as TaskContentPart[],
        resolution: target,
        watermark: false,
      },
    );
    this.logger.log(
      `BytePlus promote task ${created.id} from draft ${draftTaskId} ` +
        `(job ${ctx.jobId}, ${target}).`,
    );

    const videoUrl = await this.pollVideoTask(baseUrl, apiKey, created.id);
    return [{ type: 'video', url: videoUrl }];
  }

  /** Resolve API key + base URL, throwing if BytePlus is unconfigured. */
  private requireConfig(): { baseUrl: string; apiKey: string } {
    const apiKey = this.config.get<string>('BYTEPLUS_API_KEY');
    if (!apiKey) {
      throw new Error(
        'BytePlus provider is not configured: set BYTEPLUS_API_KEY to enable real generation.',
      );
    }
    const baseUrl = (
      this.config.get<string>('BYTEPLUS_ENDPOINT') ?? this.defaultEndpoint
    ).replace(/\/$/, '');
    return { baseUrl, apiKey };
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

  /**
   * All reference image URLs for image-to-image, product first (primary
   * subject) then the rest — deduped and capped at the API's 14-image limit.
   */
  private imageReferenceUrls(ctx: GenerationContext): string[] {
    const withUrl = ctx.request.attachments.filter((a) => Boolean(a.url));
    const ordered = [
      ...withUrl.filter((a) => a.kind === 'product'),
      ...withUrl.filter((a) => a.kind !== 'product'),
    ];
    const urls: string[] = [];
    for (const a of ordered) {
      if (a.url && !urls.includes(a.url)) urls.push(a.url);
      if (urls.length >= MAX_IMAGE_REFERENCES) break;
    }
    return urls;
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
   * Descriptive video prompt text only (style chips, presenter, negative cue).
   * Numeric parameters (resolution/ratio/duration/seed/camera_fixed) are NOT
   * embedded here — they go in the structured task body via videoParams().
   */
  private composeVideoPrompt(ctx: GenerationContext): string {
    const o = ctx.request.options;
    // Keyed options: every entry EXCEPT the structured video-param keys is a
    // style descriptor (its value is folded into the prompt). e.g. نوع الفيديو
    const descriptors: string[] = Object.entries(o)
      .filter(([k]) => !['duration', 'ratio', 'resolution'].includes(k))
      .map(([, v]) => v);

    // Fold the chosen character/avatar into the prompt so it shapes the video.
    const character = this.characterName(ctx);
    if (character) descriptors.push(`يقدّمه ${character}`);
    if (ctx.request.negativePrompt)
      descriptors.push(`تجنّب: ${ctx.request.negativePrompt}`);

    return styleText(ctx.request.prompt, descriptors);
  }

  /**
   * Structured Seedance parameters for the task body. ModelArk validates these
   * strictly (the legacy --flag text silently ignored bad values), so only emit
   * values inside the documented allowed sets; everything else is dropped and
   * the model uses its default for that field.
   */
  private videoParams(ctx: GenerationContext): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    const o = ctx.request.options;
    // Read structured params by their select-id key (not by guessing from a
    // positional list); out-of-range values are dropped so the model defaults.
    const duration = parseDurationSeconds(o.duration); // "12s" or "12 ث"
    if (duration !== undefined) params.duration = duration;
    if (o.ratio && ALLOWED_VIDEO_RATIOS.has(o.ratio)) params.ratio = o.ratio;
    const res = o.resolution?.toLowerCase();
    if (res && ALLOWED_VIDEO_RESOLUTIONS.has(res)) params.resolution = res;
    if (ctx.request.cameraFixed !== undefined) {
      params.camera_fixed = ctx.request.cameraFixed;
    }
    if (ctx.request.seed !== undefined) params.seed = ctx.request.seed;
    return params;
  }

  /** Image prompt enriched with the selected options (language, format, …). */
  private composeImagePrompt(ctx: GenerationContext): string {
    const o = ctx.request.options;
    // Option values become style descriptors (imageType, …) EXCEPT keys that
    // drive real parameters rather than prompt text:
    //  - "language"   → a clear text-rendering instruction (below)
    //  - "format"     → the real image size/aspect
    //  - "variations" → the number of images requested
    const structuralKeys = new Set(['language', 'format', 'variations']);
    const descriptors = Object.entries(o)
      .filter(([key]) => !structuralKeys.has(key))
      .map(([, value]) => value);

    const languageRule = imageTextLanguageRule(o.language);
    if (languageRule) descriptors.push(languageRule);

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
  /** True when the task was created as a 480p draft. */
  draft?: boolean;
  error?: { message?: string };
}

interface ImageGenerationResponse {
  data?: { url?: string }[];
}

type TaskContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'draft_task'; draft_task: { id: string } };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Append non-empty style descriptors (نوع الفيديو, language, …) to a prompt. */
function styleText(prompt: string, descriptors: string[]): string {
  const extras = descriptors.filter((d) => d && d.trim().length > 0);
  return extras.length ? `${prompt} — ${extras.join('، ')}` : prompt;
}

/**
 * How many image variations the "عدد الصور" select asks for. Seedream returns a
 * SET of related images in one call via `sequential_image_generation: auto`;
 * each generated image bills separately. Unknown/missing → 1 (single image).
 */
function imageVariationCount(value: string | undefined): number {
  switch (value) {
    case 'صورتان':
      return 2;
    case '٤ صور':
      return 4;
    case 'صورة واحدة':
    default:
      return 1;
  }
}

/**
 * Map the image "format" (platform target) to a real Seedream `size` (WxH), so
 * picking "ستوري انستجرام" actually produces a 9:16 image instead of the default
 * square. Dimensions are clean aspect ratios kept inside Seedream's bounds
 * (total pixels [1280×720, 4096×4096], each side ≤ 4096). Returns undefined for
 * an unknown/missing format so the caller falls back to the configured default.
 */
function imageSizeForFormat(value: string | undefined): string | undefined {
  switch (value) {
    case 'صورة انستجرام': // Instagram post — 1:1 square
      return '2048x2048';
    case 'ستوري انستجرام': // Instagram/Snap story — 9:16 vertical
      return '2304x4096';
    case 'منشور فيسبوك': // Facebook feed ad — 4:5 portrait (best-performing feed ratio)
      return '2048x2560';
    case 'بنر إعلاني': // Wide ad banner — 16:9 landscape
      return '4096x2304';
    default:
      return undefined;
  }
}

/**
 * Turn the image "language" option into a clear text-rendering instruction so
 * the model actually honors it (a bare "نص عربي" token in the prompt is a weak
 * signal). "بدون نص" suppresses on-image text entirely — often the cleanest
 * look for product ads, and it sidesteps unreliable Arabic text rendering.
 */
function imageTextLanguageRule(value: string | undefined): string | undefined {
  switch (value) {
    case 'نص عربي':
      return 'أي نص يظهر في الصورة يجب أن يكون باللغة العربية وواضحًا وصحيحًا';
    case 'نص إنجليزي':
      return 'any text shown in the image must be in clear, correct English';
    case 'بدون نص':
      return 'بدون أي نصوص أو كتابات أو حروف في الصورة';
    default:
      return undefined;
  }
}
