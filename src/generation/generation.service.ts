import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { JobStore } from './job.store';
import { ProviderRegistry } from '../providers/provider.registry';
import { GenerationProvider } from '../providers/provider.interface';
import { CreateGenerationDto } from './dto/create-generation.dto';
import { UsageService } from '../usage/usage.service';
import { ProjectsService } from '../projects/projects.service';
import {
  GenerationRequest,
  Job,
  resolveCapability,
} from '../common/generation.types';
import { parseDurationSeconds } from '../common/duration';
import { Asset } from './asset.types';

const IMAGE_TOKEN_COST = 20;
const VIDEO_TOKENS_PER_SECOND = 10;
const DEFAULT_VIDEO_SECONDS = 10;

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private readonly store: JobStore,
    private readonly registry: ProviderRegistry,
    private readonly usage: UsageService,
    private readonly projects: ProjectsService,
  ) {}

  /** Create a job and kick off generation asynchronously (clients poll status). */
  create(dto: CreateGenerationDto): Job {
    const request = this.applyProjectContext(dto);

    const capability = resolveCapability(request);
    const provider = this.registry.resolve(capability);
    const now = new Date().toISOString();

    const job: Job = {
      id: randomUUID(),
      status: 'queued',
      capability,
      request,
      provider: provider.name,
      outputs: [],
      projectId: dto.projectId,
      createdAt: now,
      updatedAt: now,
    };
    this.store.create(job);

    // Fire-and-forget: clients poll GET /generations/:id for progress.
    void this.run(job.id, provider);

    return job;
  }

  get(id: string): Job {
    const job = this.store.get(id);
    if (!job) throw new NotFoundException(`Generation "${id}" not found.`);
    return job;
  }

  list(): Job[] {
    return this.store.list();
  }

  listByProject(projectId: string): Job[] {
    return this.store.list().filter((j) => j.projectId === projectId);
  }

  /** Flatten every successful output into a global asset library, newest first. */
  listAssets(): Asset[] {
    const assets: Asset[] = [];
    for (const job of this.store.list()) {
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

    this.store.update(jobId, { status: 'processing' });
    try {
      const outputs = await provider.generate({
        jobId,
        capability: job.capability,
        request: job.request,
      });
      this.store.update(jobId, { status: 'succeeded', outputs });
      this.usage.consume(this.tokenCost(job)); // only successful jobs cost tokens
      if (job.projectId) {
        this.projects.recordGeneration(job.projectId, outputs[0]?.url);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Job ${jobId} failed: ${message}`);
      this.store.update(jobId, { status: 'failed', error: message });
    }
  }

  /**
   * Fold the project's brand kit into the request so the AI always honors it.
   * Instructions are prepended to the prompt (reliable, model-agnostic).
   */
  private applyProjectContext(dto: CreateGenerationDto): GenerationRequest {
    let prompt = dto.prompt;
    if (dto.projectId) {
      const project = this.projects.tryGet(dto.projectId);
      if (project?.instructions) {
        prompt = `${project.instructions}\n\n${prompt}`;
      }
    }
    return {
      mode: dto.mode,
      prompt,
      options: dto.options ?? [],
      attachments: dto.attachments ?? [],
      negativePrompt: dto.negativePrompt,
      seed: dto.seed,
      cameraFixed: dto.cameraFixed,
    };
  }

  /** Token cost of a job: images flat, videos scale with duration. */
  private tokenCost(job: Job): number {
    if (job.request.mode === 'video') {
      const seconds =
        parseDurationSeconds(job.request.options) ?? DEFAULT_VIDEO_SECONDS;
      return seconds * VIDEO_TOKENS_PER_SECOND;
    }
    return IMAGE_TOKEN_COST;
  }
}
