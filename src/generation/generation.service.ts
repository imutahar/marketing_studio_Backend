import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { JobStore } from './job.store';
import { ProviderRegistry } from '../providers/provider.registry';
import { GenerationProvider } from '../providers/provider.interface';
import { CreateGenerationDto } from './dto/create-generation.dto';
import { UsageService } from '../usage/usage.service';
import {
  GenerationRequest,
  Job,
  resolveCapability,
} from '../common/generation.types';

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
  ) {}

  /** Create a job and kick off generation asynchronously (clients poll status). */
  create(dto: CreateGenerationDto): Job {
    const request: GenerationRequest = {
      mode: dto.mode,
      prompt: dto.prompt,
      options: dto.options ?? [],
      attachments: dto.attachments ?? [],
    };

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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Job ${jobId} failed: ${message}`);
      this.store.update(jobId, { status: 'failed', error: message });
    }
  }

  /** Token cost of a job: images flat, videos scale with duration. */
  private tokenCost(job: Job): number {
    if (job.request.mode === 'video') {
      return videoSeconds(job.request.options) * VIDEO_TOKENS_PER_SECOND;
    }
    return IMAGE_TOKEN_COST;
  }
}

/** Extract the selected video duration (seconds) from the options, if any. */
function videoSeconds(options: string[]): number {
  for (const opt of options) {
    const match = opt.match(/^(\d+)\s*(?:s|ث)$/);
    if (match) return Number(match[1]);
  }
  return DEFAULT_VIDEO_SECONDS;
}
