import { Injectable, Logger } from '@nestjs/common';
import { GenerationContext, GenerationProvider } from '../provider.interface';
import { GenerationOutput } from '../../common/generation.types';

/** A well-known sample video used as a placeholder result. */
const SAMPLE_VIDEO = 'https://www.w3schools.com/html/mov_bbb.mp4';

/**
 * Mock provider — supports every capability and returns placeholder media after
 * a short delay. Lets the whole flow (create → poll → result) work end-to-end
 * with no external credentials.
 */
@Injectable()
export class MockProvider implements GenerationProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockProvider.name);

  supports(): boolean {
    return true; // mock handles every capability
  }

  async generate(ctx: GenerationContext): Promise<GenerationOutput[]> {
    this.logger.log(`Generating ${ctx.capability} for job ${ctx.jobId}`);
    await delay(2500);

    if (ctx.request.mode === 'video') {
      return [{ type: 'video', url: SAMPLE_VIDEO }];
    }
    const seed = ctx.jobId.slice(0, 8);
    return [
      { type: 'image', url: `https://picsum.photos/seed/${seed}/720/1280` },
    ];
  }

  // ── Draft mode ─────────────────────────────────────────────────────────
  supportsDraft(): boolean {
    return true;
  }

  /** Fake 480p draft so the two-phase flow works with no external provider. */
  async createDraft(
    ctx: GenerationContext,
  ): Promise<{ draftTaskId: string; previewUrl: string }> {
    this.logger.log(`Creating mock draft for job ${ctx.jobId}`);
    await delay(1500);
    return { draftTaskId: `mock-draft-${ctx.jobId}`, previewUrl: SAMPLE_VIDEO };
  }

  /** Promote the mock draft to a "full" render (same sample video). */
  async promoteDraft(
    ctx: GenerationContext,
    draftTaskId: string,
  ): Promise<GenerationOutput[]> {
    this.logger.log(`Promoting mock draft ${draftTaskId} for job ${ctx.jobId}`);
    await delay(1500);
    return [{ type: 'video', url: SAMPLE_VIDEO }];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
