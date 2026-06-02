import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { JobStore } from './job.store';
import { ProviderRegistry } from '../providers/provider.registry';
import { GenerationProvider } from '../providers/provider.interface';
import { CreateGenerationDto } from './dto/create-generation.dto';
import {
  GenerationRequest,
  Job,
  resolveCapability,
} from '../common/generation.types';

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private readonly store: JobStore,
    private readonly registry: ProviderRegistry,
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Job ${jobId} failed: ${message}`);
      this.store.update(jobId, { status: 'failed', error: message });
    }
  }
}
