import { Injectable } from '@nestjs/common';
import { Job, JobStatus } from '../common/generation.types';

/** Max jobs retained in memory; oldest are evicted past this cap. */
const MAX_JOBS = 200;

/** Terminal statuses after which the original request no longer needs its
 * (potentially large, base64 data-URI) attachment urls retained. */
const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'succeeded',
  'failed',
]);

/**
 * In-memory job store. Swap for Redis/Postgres later by reimplementing this
 * class behind the same methods — nothing else needs to change.
 */
@Injectable()
export class JobStore {
  private readonly jobs = new Map<string, Job>();

  create(job: Job): Job {
    this.jobs.set(job.id, job);
    this.evict();
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
    if (TERMINAL_STATUSES.has(updated.status)) {
      stripInlineAttachments(updated);
    }
    this.jobs.set(id, updated);
    return updated;
  }

  list(): Job[] {
    return Array.from(this.jobs.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  /** Evict the oldest jobs until the map is within MAX_JOBS. Map preserves
   * insertion order, so the first key is the oldest.
   *
   * TODO(persistence): eviction is purely insertion-order, so once MAX_JOBS
   * newer jobs exist, a still-actively-polled (non-terminal) job could in
   * principle be evicted out from under its poller. The Redis/Postgres swap
   * should preserve in-flight jobs — e.g. evict by terminal-state + age rather
   * than pure insertion order — so only finished jobs are reclaimed. */
  private evict(): void {
    while (this.jobs.size > MAX_JOBS) {
      const oldest = this.jobs.keys().next();
      if (oldest.done) break;
      this.jobs.delete(oldest.value);
    }
  }
}

/**
 * Drop large inline data-URI attachment urls once a job is terminal — nothing
 * downstream reads `request.attachments[].url` after completion (the provider
 * only reads them during processing). Mutates the (already-cloned) job in place.
 */
function stripInlineAttachments(job: Job): void {
  for (const attachment of job.request.attachments) {
    if (attachment.url?.startsWith('data:')) {
      attachment.url = '[stripped]';
    }
  }
}
