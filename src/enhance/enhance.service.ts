import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PROMPT_ENHANCER } from './enhance.types';
import type { EnhanceRequest, PromptEnhancer } from './enhance.types';

/** Toolbar keys worth feeding the rewriter as light context (Arabic labels). */
const CONTEXT_LABELS: Record<string, string> = {
  format: 'الصيغة',
  imageType: 'النمط',
  ratio: 'الأبعاد',
};

@Injectable()
export class EnhanceService {
  private readonly logger = new Logger(EnhanceService.name);

  constructor(
    @Inject(PROMPT_ENHANCER) private readonly enhancer: PromptEnhancer,
  ) {}

  /** Whether the feature is usable (vendor configured). Drives the UI gate. */
  isAvailable(): boolean {
    return this.enhancer.isConfigured();
  }

  async enhance(req: EnhanceRequest): Promise<string> {
    const prompt = req.prompt?.trim() ?? '';
    const productName = req.productName?.trim();
    if (!prompt && !productName) {
      throw new BadRequestException('اكتب وصفًا أو أرفق منتجًا أولًا.');
    }
    if (!this.enhancer.isConfigured()) {
      throw new ServiceUnavailableException(
        'ميزة تحسين الوصف غير مفعّلة حاليًا.',
      );
    }

    const system = this.systemPrompt(req.mode);
    const user = this.userMessage(prompt, productName, req.options);
    try {
      const raw = await this.enhancer.enhance(system, user);
      return this.clean(raw);
    } catch (err) {
      this.logger.error(
        `Enhance failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException('تعذّر تحسين الوصف، حاول مجددًا.');
    }
  }

  /** Mode-aware Arabic system instruction. */
  private systemPrompt(mode: 'image' | 'video'): string {
    const medium = mode === 'video' ? 'فيديو إعلاني قصير' : 'صورة إعلانية';
    const motion =
      mode === 'video'
        ? ' أضف أيضًا حركة الكاميرا والإيقاع والانتقالات بما يناسب فيديو قصير.'
        : '';
    return [
      'أنت خبير في كتابة أوصاف بصرية لإعلانات المنتجات.',
      `أعد صياغة وصف المستخدم ليصبح وصفًا واحدًا غنيًا ودقيقًا لتوليد ${medium} احترافي.`,
      'اكتب بالعربية الفصحى فقط.',
      'أضف تفاصيل المشهد والإضاءة والتكوين والزاوية والمزاج بما يخدم المنتج.' +
        motion,
      'حافظ على نيّة المستخدم والمنتج المذكور، ولا تخترع أسعارًا أو ادعاءات أو علامات تجارية.',
      'أعد الوصف فقط (جملة أو جملتين، في حدود ٤٥ كلمة) دون مقدمات أو عناوين أو علامات اقتباس.',
    ].join(' ');
  }

  /** Compact user message: the draft + a few context lines. */
  private userMessage(
    prompt: string,
    productName: string | undefined,
    options: Record<string, string> | undefined,
  ): string {
    const lines: string[] = [];
    lines.push(
      prompt
        ? `الوصف: ${prompt}`
        : 'الوصف: (لا يوجد — اكتب وصفًا مناسبًا للمنتج)',
    );
    if (productName) lines.push(`المنتج: ${productName}`);
    for (const [key, label] of Object.entries(CONTEXT_LABELS)) {
      const value = options?.[key]?.trim();
      if (value) lines.push(`${label}: ${value}`);
    }
    return lines.join('\n');
  }

  /** Strip wrapping quotes and a leading "الوصف:" the model may echo back. */
  private clean(text: string): string {
    let out = text.trim().replace(/^الوصف\s*[:：]\s*/u, '');
    out = out.replace(/^["'«“”]+|["'«“”]+$/gu, '').trim();
    return out;
  }
}
