import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { JobStore } from './job.store';
import { ProviderRegistry } from '../providers/provider.registry';
import { GenerationProvider } from '../providers/provider.interface';
import { CreateGenerationDto } from './dto/create-generation.dto';
import { UsageService } from '../usage/usage.service';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from '../storage/storage.service';
import {
  GenerationOutput,
  GenerationRequest,
  Job,
  normalizeOptions,
  resolveCapability,
} from '../common/generation.types';
import { parseDurationSeconds } from '../common/duration';
import { Semaphore } from '../common/semaphore';
import { Asset } from './asset.types';

const IMAGE_TOKEN_COST = 20;
const VIDEO_TOKENS_PER_SECOND = 10;
const DEFAULT_VIDEO_SECONDS = 10;
/** Drafts run a cheap 480p preview, so they cost a fraction of the full job. */
const DRAFT_COST_MULTIPLIER = 0.6;
/** A draft task id is valid for 7 days (ModelArk); after that, regenerate. */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Default hard daily cap on generations (cost backstop) when env is unset. */
const DEFAULT_MAX_GENERATIONS_PER_DAY = 200;
/**
 * Default cap on generations calling the provider at once; bounds simultaneous
 * paid BytePlus calls + long video poll loops. Extra jobs queue (stay 'queued').
 */
const DEFAULT_MAX_CONCURRENT_GENERATIONS = 4;

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  /** Hard daily cap on generations as a cost backstop. */
  private readonly maxGenerationsPerDay: number;
  /** In-memory daily counter (resets on restart; acceptable for a backstop). */
  private dailyUsage = { date: this.today(), count: 0 };

  /**
   * Bounds how many generations hit the provider at once (paid BytePlus calls +
   * long video poll loops). Extra jobs wait here and stay 'queued'. In-memory,
   * per instance.
   */
  private readonly limiter: Semaphore;

  constructor(
    private readonly store: JobStore,
    private readonly registry: ProviderRegistry,
    private readonly usage: UsageService,
    private readonly projects: ProjectsService,
    private readonly storage: StorageService,
    config: ConfigService,
  ) {
    this.maxGenerationsPerDay = Number(
      config.get('MAX_GENERATIONS_PER_DAY') ?? DEFAULT_MAX_GENERATIONS_PER_DAY,
    );
    this.limiter = new Semaphore(
      config.get<number>('MAX_CONCURRENT_GENERATIONS') ??
        DEFAULT_MAX_CONCURRENT_GENERATIONS,
    );
  }

  /**
   * Provider capabilities the composer needs up front — currently whether the
   * active video model supports the 480p draft preview (Seedance 2.0 doesn't),
   * so the UI can hide the draft toggle instead of showing a no-op.
   */
  capabilities(): { draft: boolean; cameraFixed: boolean; fastVideo: boolean } {
    const provider = this.registry.resolve('text-to-video');
    return {
      draft: provider.supportsDraft?.() ?? false,
      cameraFixed: provider.supportsCameraFixed?.() ?? false,
      fastVideo: provider.supportsFastVideo?.() ?? false,
    };
  }

  /** Create a job and kick off generation asynchronously (clients poll status). */
  create(dto: CreateGenerationDto, ownerId: string): Job {
    this.enforceDailyCap();

    const request = this.applyProjectContext(dto, ownerId);

    const capability = resolveCapability(request);
    const provider = this.registry.resolve(capability);
    const now = new Date().toISOString();

    const job: Job = {
      id: randomUUID(),
      ownerId,
      status: 'queued',
      capability,
      request,
      provider: provider.name,
      outputs: [],
      // No project chosen → land in the default workspace so it's never orphaned.
      projectId: dto.projectId ?? this.projects.defaultProjectId(),
      createdAt: now,
      updatedAt: now,
    };
    this.store.create(job);

    // Draft mode: video only, user opt-in, provider must support it. Kick off
    // the 480p preview instead of a single-shot render; the job pauses at
    // draft_ready until the client approves it.
    if (
      request.draft === true &&
      request.mode === 'video' &&
      provider.supportsDraft?.()
    ) {
      void this.runDraft(job.id, provider);
      return job;
    }

    // Fire-and-forget: clients poll GET /generations/:id for progress.
    void this.run(job.id, provider);

    return job;
  }

  get(id: string, ownerId: string): Job {
    const job = this.store.get(id);
    if (!job || job.ownerId !== ownerId) {
      throw new NotFoundException(`Generation "${id}" not found.`);
    }
    return job;
  }

  list(ownerId: string): Job[] {
    return this.store.list().filter((j) => j.ownerId === ownerId);
  }

  listByProject(projectId: string, ownerId: string): Job[] {
    return this.store
      .list()
      .filter((j) => j.ownerId === ownerId && j.projectId === projectId);
  }

  /**
   * Move a generation into a project ("save to project"). Validates the target
   * project exists, repoints the job, and records it so the project's
   * count/thumbnail reflect the move. Returns the updated job.
   */
  assignProject(id: string, projectId: string, ownerId: string): Job {
    const job = this.get(id, ownerId);
    if (!this.projects.tryGet(projectId, ownerId)) {
      throw new BadRequestException('Project not found.');
    }
    const updated = this.store.update(id, { projectId }) ?? job;
    this.projects.recordGeneration(projectId, job.outputs?.[0]?.url);
    return updated;
  }

  /** Flatten every successful output into a global asset library, newest first. */
  listAssets(ownerId: string): Asset[] {
    const assets: Asset[] = [];
    for (const job of this.store.list()) {
      if (job.ownerId !== ownerId) continue;
      if (job.status !== 'succeeded') continue;
      job.outputs.forEach((out, i) => {
        assets.push({
          id: `${job.id}:${i}`,
          type: out.type,
          url: out.url,
          prompt: job.request.prompt,
          projectId: job.projectId,
          createdAt: job.createdAt,
        });
      });
    }
    return assets;
  }

  private async run(
    jobId: string,
    provider: GenerationProvider,
  ): Promise<void> {
    const job = this.store.get(jobId);
    if (!job) return;

    // Wait for a provider slot before going 'processing' so queued jobs that
    // are still waiting stay 'queued' (making the status meaningful).
    await this.limiter.acquire();
    try {
      this.store.update(jobId, { status: 'processing' });
      // INPUTS: ModelArk needs publicly reachable image URLs. Merchant uploads
      // arrive as base64 data URIs, so re-host them on Blob (best-effort) and
      // swap the durable URL into the request the provider receives.
      if (this.storage.isEnabled()) {
        await this.persistInputs(jobId, job);
      }

      const rawOutputs = await provider.generate({
        jobId,
        capability: job.capability,
        request: job.request,
      });

      // OUTPUTS: BytePlus URLs expire (~24h). Re-host each on Blob so the ad
      // library stays durable; on any failure the original URL is preserved.
      const outputs = this.storage.isEnabled()
        ? await this.persistOutputs(jobId, rawOutputs)
        : rawOutputs;

      this.store.update(jobId, { status: 'succeeded', outputs });
      // only successful jobs cost tokens; images bill per produced variation
      this.usage.consume(this.tokenCost(job, outputs));
      if (job.projectId) {
        this.projects.recordGeneration(job.projectId, outputs[0]?.url);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Job ${jobId} failed: ${message}`);
      this.store.update(jobId, { status: 'failed', error: message });
    } finally {
      this.limiter.release();
    }
  }

  /**
   * Phase 1 of draft mode: create the cheap 480p preview and pause at
   * draft_ready. Persists the preview durably (BytePlus preview urls expire in
   * ~24h) and stores the draft task id so approve() can promote it later.
   * Charges a reduced draft cost (~0.6x the full job).
   */
  private async runDraft(
    jobId: string,
    provider: GenerationProvider,
  ): Promise<void> {
    const job = this.store.get(jobId);
    if (!job) return;

    // Wait for a provider slot before going 'processing' so queued jobs that
    // are still waiting stay 'queued' (making the status meaningful).
    await this.limiter.acquire();
    try {
      this.store.update(jobId, { status: 'processing' });
      if (this.storage.isEnabled()) {
        await this.persistInputs(jobId, job);
      }

      // Provider was already checked to support drafts in create(); the
      // optional-chaining keeps the type contract honest.
      if (!provider.createDraft) {
        throw new Error(`Provider ${provider.name} does not support drafts.`);
      }
      const { draftTaskId, previewUrl } = await provider.createDraft({
        jobId,
        capability: job.capability,
        request: job.request,
      });

      // BytePlus preview urls expire (~24h) — re-host so it survives until the
      // user gets around to approving.
      const durablePreview = this.storage.isEnabled()
        ? await this.storage.uploadFromUrl(
            previewUrl,
            `drafts/${jobId}/preview`,
          )
        : previewUrl;

      this.store.update(jobId, {
        status: 'draft_ready',
        draftTaskId,
        draftPreviewUrl: durablePreview,
      });
      // Drafts cost less than a full render.
      this.usage.consume(
        Math.round(this.tokenCost(job) * DRAFT_COST_MULTIPLIER),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Draft ${jobId} failed: ${message}`);
      this.store.update(jobId, { status: 'failed', error: message });
    } finally {
      this.limiter.release();
    }
  }

  /**
   * Phase 2 of draft mode: promote an approved draft to the full render at the
   * user's target resolution. Validates the draft state + 7-day window, then
   * runs the promotion fire-and-forget (like create()) so the client polls.
   */
  approve(id: string, ownerId: string): Job {
    const job = this.store.get(id);
    if (!job || job.ownerId !== ownerId) {
      throw new NotFoundException(`Generation "${id}" not found.`);
    }
    if (job.status !== 'draft_ready') {
      throw new BadRequestException(
        `Generation "${id}" is not awaiting approval (status: ${job.status}).`,
      );
    }
    if (!job.draftTaskId) {
      throw new BadRequestException(
        `Generation "${id}" has no draft task to promote.`,
      );
    }
    // The ModelArk draft task id is valid 7 days; past that, promotion fails.
    if (Date.now() - new Date(job.createdAt).getTime() > DRAFT_TTL_MS) {
      throw new BadRequestException('draft expired — regenerate');
    }

    // Re-resolve the provider by capability (same as create()).
    const provider = this.registry.resolve(job.capability);

    this.store.update(id, { status: 'processing' });
    const promoting = this.store.get(id) ?? job;

    // Fire-and-forget: client polls GET /generations/:id for the full render.
    void this.runPromotion(id, provider, job.draftTaskId);

    return promoting;
  }

  /** Background half of approve(): promote the draft and persist outputs. */
  private async runPromotion(
    jobId: string,
    provider: GenerationProvider,
    draftTaskId: string,
  ): Promise<void> {
    const job = this.store.get(jobId);
    if (!job) return;
    // approve() already set status to 'processing'; still gate the provider call
    // behind the limiter so promotions count against the concurrency budget.
    await this.limiter.acquire();
    try {
      if (!provider.promoteDraft) {
        throw new Error(`Provider ${provider.name} does not support drafts.`);
      }
      const rawOutputs = await provider.promoteDraft(
        { jobId, capability: job.capability, request: job.request },
        draftTaskId,
      );

      const outputs = this.storage.isEnabled()
        ? await this.persistOutputs(jobId, rawOutputs)
        : rawOutputs;

      this.store.update(jobId, { status: 'succeeded', outputs });
      // Promotion re-runs full inference — charge the full job cost.
      this.usage.consume(this.tokenCost(job));
      if (job.projectId) {
        this.projects.recordGeneration(job.projectId, outputs[0]?.url);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Promotion ${jobId} failed: ${message}`);
      this.store.update(jobId, { status: 'failed', error: message });
    } finally {
      this.limiter.release();
    }
  }

  /**
   * Re-host every base64 data-URI attachment on Blob and rewrite the request's
   * attachment urls to the durable public URLs (in place), then persist the
   * updated request back to the store. Best-effort: uploadDataUri never throws
   * and returns the original url on failure.
   */
  private async persistInputs(jobId: string, job: Job): Promise<void> {
    const attachments = job.request.attachments;
    await Promise.all(
      attachments.map(async (attachment) => {
        if (attachment.url?.startsWith('data:')) {
          attachment.url = await this.storage.uploadDataUri(
            attachment.url,
            `inputs/${jobId}/${attachment.slotId}`,
          );
        }
      }),
    );
    // Reflect the durable input URLs on the job record (merge patch).
    this.store.update(jobId, { request: job.request });
  }

  /**
   * Re-host every output on Blob, preserving each output's type. Best-effort:
   * uploadFromUrl never throws and returns the original url on failure.
   */
  private async persistOutputs(
    jobId: string,
    outputs: GenerationOutput[],
  ): Promise<GenerationOutput[]> {
    return Promise.all(
      outputs.map(async (out, i) => ({
        type: out.type,
        url: await this.storage.uploadFromUrl(out.url, `outputs/${jobId}/${i}`),
      })),
    );
  }

  /**
   * Fold the project's brand kit into the request so the AI always honors it.
   * Instructions are prepended to the prompt (reliable, model-agnostic).
   */
  private applyProjectContext(
    dto: CreateGenerationDto,
    ownerId: string,
  ): GenerationRequest {
    let prompt = dto.prompt;
    if (dto.projectId) {
      const project = this.projects.tryGet(dto.projectId, ownerId);
      if (project?.instructions) {
        prompt = `${project.instructions}\n\n${prompt}`;
      }
    }
    return {
      mode: dto.mode,
      prompt,
      options: normalizeOptions(dto.options),
      attachments: dto.attachments ?? [],
      negativePrompt: dto.negativePrompt,
      seed: dto.seed,
      cameraFixed: dto.cameraFixed,
      generateAudio: dto.generateAudio,
      draft: dto.draft,
      fast: dto.fast,
    };
  }

  /** Today's date as YYYY-MM-DD (UTC), used to bucket the daily counter. */
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Cost backstop: bound total generations/day regardless of caller. Resets the
   * counter when the day rolls over, then throws 429 once the cap is hit.
   * Counts every create() (image + video). In-memory; resets on restart.
   *
   * TODO(multitenancy): key the daily cap by ownerId so one tenant can't
   * exhaust another's budget; global single-owner counter is fine today.
   */
  private enforceDailyCap(): void {
    const today = this.today();
    if (this.dailyUsage.date !== today) {
      this.dailyUsage = { date: today, count: 0 };
    }
    if (this.dailyUsage.count >= this.maxGenerationsPerDay) {
      throw new HttpException(
        'Daily generation limit reached. Please try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.dailyUsage.count += 1;
  }

  /**
   * Token cost of a job: videos scale with duration; images bill per produced
   * image (variations return a set), falling back to a single image.
   */
  private tokenCost(job: Job, outputs?: GenerationOutput[]): number {
    if (job.request.mode === 'video') {
      const seconds =
        parseDurationSeconds(job.request.options.duration) ??
        DEFAULT_VIDEO_SECONDS;
      return seconds * VIDEO_TOKENS_PER_SECOND;
    }
    const count = Math.max(1, outputs?.length ?? 1);
    return IMAGE_TOKEN_COST * count;
  }
}
