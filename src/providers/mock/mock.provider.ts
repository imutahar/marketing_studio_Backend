import { Injectable, Logger } from '@nestjs/common';
import { GenerationContext, GenerationProvider } from '../provider.interface';
import { GenerationOutput } from '../../common/generation.types';

/** A well-known sample video used as a placeholder result. */
const SAMPLE_VIDEO =
  'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

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
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
