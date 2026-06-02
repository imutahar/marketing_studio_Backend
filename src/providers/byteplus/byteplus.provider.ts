import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationContext, GenerationProvider } from '../provider.interface';
import { Capability, GenerationOutput } from '../../common/generation.types';

/**
 * BytePlus (Seedance) provider — SKELETON, ready to flip on.
 *
 * To enable real generation:
 *   1. Set BYTEPLUS_API_KEY (+ BYTEPLUS_ENDPOINT / model envs).
 *   2. Set GENERATION_PROVIDER=byteplus.
 *   3. Implement the two marked API calls below (create task + poll task).
 *
 * Until implemented it advertises support but throws a clear error, so a
 * misconfiguration is obvious rather than silent.
 */
@Injectable()
export class ByteplusProvider implements GenerationProvider {
  readonly name = 'byteplus';
  private readonly logger = new Logger(ByteplusProvider.name);

  constructor(private readonly config: ConfigService) {}

  supports(capability: Capability): boolean {
    // Seedance covers text/image → image/video.
    return (
      [
        'text-to-image',
        'image-to-image',
        'text-to-video',
        'image-to-video',
      ] as Capability[]
    ).includes(capability);
  }

  generate(ctx: GenerationContext): Promise<GenerationOutput[]> {
    const apiKey = this.config.get<string>('BYTEPLUS_API_KEY');
    if (!apiKey) {
      return Promise.reject(
        new Error(
          'BytePlus provider is not configured: set BYTEPLUS_API_KEY to enable real generation.',
        ),
      );
    }

    // const endpoint = this.config.get<string>('BYTEPLUS_ENDPOINT');
    // const model = this.pickModel(ctx.capability);
    //
    // TODO(1): create a generation task
    //   POST `${endpoint}/.../tasks`
    //   body: { model, prompt: ctx.request.prompt, image: <ref from attachments>, ... }
    //   → { task_id }
    //
    // TODO(2): poll until the task succeeds
    //   GET `${endpoint}/.../tasks/${task_id}` until status === 'succeeded'
    //   → map output urls to GenerationOutput[]
    this.logger.warn(`BytePlus not implemented yet (job ${ctx.jobId}).`);
    return Promise.reject(
      new Error('BytePlus integration not implemented yet.'),
    );
  }

  /** Maps a capability to the BytePlus model id to use (fill in real ids). */
  private pickModel(capability: Capability): string {
    const isVideo = capability.endsWith('video');
    return isVideo
      ? (this.config.get<string>('BYTEPLUS_VIDEO_MODEL') ?? 'seedance-video')
      : (this.config.get<string>('BYTEPLUS_IMAGE_MODEL') ?? 'seedream-image');
  }
}
