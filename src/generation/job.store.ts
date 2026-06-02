import { Injectable } from '@nestjs/common';
import { Job } from '../common/generation.types';

/**
 * In-memory job store. Swap for Redis/Postgres later by reimplementing this
 * class behind the same methods — nothing else needs to change.
 */
@Injectable()
export class JobStore {
  private readonly jobs = new Map<string, Job>();

  create(job: Job): Job {
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<Job>): Job | undefined {
    const existing = this.jobs.get(id);
    if (!existing) return undefined;
    const updated: Job = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(id, updated);
    return updated;
  }

  list(): Job[] {
    return Array.from(this.jobs.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
}
