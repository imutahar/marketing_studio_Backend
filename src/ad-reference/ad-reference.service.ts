import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GenerationService } from '../generation/generation.service';
import {
  CreateAdReferenceDto,
  GenerateAdReferenceDto,
  UpdateScriptDto,
} from './dto/ad-reference.dto';
import { AdReference, AdScript } from './ad-reference.types';

/** Progress checkpoints reported during (mock) analysis — mirrors Higgsfield. */
const ANALYSIS_STEPS = [8, 31, 54, 78, 100];
const STEP_DELAY_MS = 700;

/**
 * "Ad Reference": analyze a reference ad video into an editable shot-by-shot
 * script, then generate a new video from it (reusing the generation pipeline).
 *
 * The analyzer is mocked (returns a structured script with realistic
 * progress); swap `analyze()` for a real video-understanding model later.
 */
@Injectable()
export class AdReferenceService {
  private readonly logger = new Logger(AdReferenceService.name);
  private readonly store = new Map<string, AdReference>();

  constructor(private readonly generation: GenerationService) {}

  create(dto: CreateAdReferenceDto, ownerId: string): AdReference {
    const now = new Date().toISOString();
    const ref: AdReference = {
      id: randomUUID(),
      ownerId,
      status: 'analyzing',
      progress: 0,
      referenceVideoUrl: dto.referenceVideoUrl,
      productImage: dto.productImage,
      avatarImage: dto.avatarImage,
      avatarName: dto.avatarName,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(ref.id, ref);

    void this.analyze(ref.id); // fire-and-forget; client polls
    return ref;
  }

  get(id: string, ownerId: string): AdReference {
    const ref = this.store.get(id);
    if (!ref || ref.ownerId !== ownerId) {
      throw new NotFoundException(`Ad reference "${id}" not found.`);
    }
    return ref;
  }

  updateScript(id: string, dto: UpdateScriptDto, ownerId: string): AdReference {
    this.get(id, ownerId); // ensure it exists and belongs to the owner
    return this.update(id, { script: dto, status: 'ready' });
  }

  /** Kick off generation(s) from the (edited) script; reuses the gen pipeline. */
  generate(
    id: string,
    dto: GenerateAdReferenceDto,
    ownerId: string,
  ): { generationId: string; generationIds: string[] } {
    const ref = this.get(id, ownerId);
    if (!ref.script) {
      throw new BadRequestException('Script is not ready yet.');
    }

    const attachments: {
      slotId: string;
      kind: 'product' | 'character';
      fileName: string;
      url: string;
    }[] = [];
    if (ref.productImage) {
      attachments.push({
        slotId: 'product',
        kind: 'product',
        fileName: 'product',
        url: ref.productImage,
      });
    }
    if (ref.avatarImage) {
      attachments.push({
        slotId: 'character',
        kind: 'character',
        fileName: ref.avatarName ?? 'avatar',
        url: ref.avatarImage,
      });
    }

    // Honor the requested number of variations (validated 1–4); each is an
    // independent job through the existing single-generation path.
    const count = dto.variations ?? 1;
    const generationIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const generation = this.generation.create(
        {
          mode: 'video',
          prompt: scriptToPrompt(ref.script),
          projectId: dto.projectId,
          options: {
            resolution: dto.resolution ?? '720p',
            ratio: dto.aspectRatio ?? ref.script.aspectRatio,
          },
          attachments,
        },
        // Internal call: the generated jobs inherit the reference's owner.
        ref.ownerId,
      );
      generationIds.push(generation.id);
    }

    // `generationId` stays the first id for backward compatibility; the full
    // list is exposed additively via `generationIds`.
    this.update(id, {
      generationId: generationIds[0],
      generationIds,
    });
    return { generationId: generationIds[0], generationIds };
  }

  private async analyze(id: string): Promise<void> {
    try {
      for (const progress of ANALYSIS_STEPS) {
        await delay(STEP_DELAY_MS);
        this.update(id, { progress });
      }
      this.update(id, { status: 'ready', script: mockScript() });
      this.logger.log(`Ad reference ${id} analyzed.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.update(id, { status: 'failed', error: message });
    }
  }

  private update(id: string, patch: Partial<AdReference>): AdReference {
    // Internal mutator (runs server-side, e.g. from the async analyze loop), so
    // it reads straight from the store rather than the owner-scoped get().
    const existing = this.store.get(id);
    if (!existing) {
      throw new NotFoundException(`Ad reference "${id}" not found.`);
    }
    const updated: AdReference = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return updated;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mock analysis output — a generic high-converting UGC ad structure. */
function mockScript(): AdScript {
  return {
    durationSec: 15,
    aspectRatio: '9:16',
    shots: [
      {
        index: 0,
        start: 0,
        end: 3,
        type: 'hook',
        visual: 'يظهر المقدّم وهو يحمل المنتج أمام الكاميرا بتعبير متحمّس',
        spoken: 'افتتاحية قوية تجذب الانتباه في أول ثانيتين',
        onScreenText: 'انتظر حتى النهاية!',
      },
      {
        index: 1,
        start: 3,
        end: 8,
        type: 'demo',
        visual: 'عرض المنتج من زوايا متعددة مع إبراز التفاصيل والملمس',
        spoken: 'شرح سريع لمميزات المنتج وكيفية استخدامه',
        onScreenText: 'الأكثر مبيعًا',
      },
      {
        index: 2,
        start: 8,
        end: 12,
        type: 'benefit',
        visual: 'لقطة لنتيجة استخدام المنتج وردة فعل إيجابية من المقدّم',
        spoken: 'إبراز الفائدة الأساسية التي تهم العميل',
        onScreenText: 'نتائج حقيقية',
      },
      {
        index: 3,
        start: 12,
        end: 15,
        type: 'cta',
        visual: 'إغلاق على المنتج مع شعار المتجر ودعوة واضحة للشراء',
        spoken: 'اطلبه الآن قبل نفاد الكمية',
        onScreenText: 'اطلب الآن',
      },
    ],
  };
}

function scriptToPrompt(script: AdScript): string {
  const body = script.shots
    .map((s) => `(${s.type}) ${s.visual}. نص على الشاشة: ${s.onScreenText}`)
    .join(' ثم ');
  return `أنشئ إعلان فيديو بنفس بنية وإيقاع الإعلان المرجعي: ${body}`;
}
