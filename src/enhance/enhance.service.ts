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
type Lang = 'ar' | 'en';

/** Toolbar keys fed as light context, labelled per output language. */
const CONTEXT_KEYS = ['format', 'imageType', 'ratio'] as const;
const CONTEXT_LABELS: Record<Lang, Record<string, string>> = {
  ar: { format: 'الصيغة', imageType: 'النمط', ratio: 'الأبعاد' },
  en: { format: 'Format', imageType: 'Style', ratio: 'Aspect ratio' },
};

/**
 * Pin the output language deterministically by the dominant script, rather than
 * relying on the model to infer it (which a short/instructional English prompt
 * lost to the Arabic instructions). Empty/neutral → Arabic (the app default).
 */
function detectLanguage(text: string): Lang {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic === 0 && latin === 0) return 'ar';
  return arabic >= latin ? 'ar' : 'en';
}

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

    // Detect from the draft (or the product name when the draft is empty).
    const lang = detectLanguage(prompt || productName || '');
    const system = this.systemPrompt(req.mode, lang);
    const user = this.userMessage(lang, prompt, productName, req.options);
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

  /**
   * Mode-aware system instruction, written ENTIRELY in the target language so
   * nothing biases the output language back (the whole prompt is one language).
   */
  private systemPrompt(mode: 'image' | 'video', lang: Lang): string {
    if (lang === 'en') {
      const medium = mode === 'video' ? 'a short ad video' : 'an ad image';
      const motion =
        mode === 'video'
          ? ', plus camera movement, pacing and transitions suited to a short video'
          : '';
      return [
        'You are an expert at writing visual prompts for product ads.',
        `Rewrite the user's description into one rich, precise prompt to generate ${medium}.`,
        'IMPORTANT: write the entire output in English only.',
        `Stay strictly on the user's subject and the named product; enrich the details (scene, lighting, composition, angle, mood${motion}) without changing the idea or adding unrelated elements.`,
        'Do not invent prices, claims or brand names.',
        'Return only the prompt (one or two sentences, ~45 words max) with no preamble, headings or quotes.',
      ].join(' ');
    }
    const medium = mode === 'video' ? 'فيديو إعلاني قصير' : 'صورة إعلانية';
    const motion =
      mode === 'video'
        ? '، وحركة الكاميرا والإيقاع والانتقالات بما يناسب فيديو قصير'
        : '';
    return [
      'أنت خبير في كتابة أوصاف بصرية لإعلانات المنتجات.',
      `أعد صياغة وصف المستخدم ليصبح وصفًا واحدًا غنيًا ودقيقًا لتوليد ${medium} احترافي.`,
      'مهم: اكتب الناتج بالكامل بالعربية فقط.',
      `ابقَ ضمن موضوع المستخدم والمنتج المذكور تمامًا، وأَثرِ التفاصيل (المشهد، الإضاءة، التكوين، الزاوية، المزاج${motion}) دون تغيير الفكرة أو إضافة عناصر لا علاقة لها بالموضوع.`,
      'لا تخترع أسعارًا أو ادعاءات أو علامات تجارية.',
      'أعد الوصف فقط (جملة أو جملتين، في حدود ٤٥ كلمة) دون مقدمات أو عناوين أو علامات اقتباس.',
    ].join(' ');
  }

  /** Compact user message: the draft + a few context lines, labelled in `lang`. */
  private userMessage(
    lang: Lang,
    prompt: string,
    productName: string | undefined,
    options: Record<string, string> | undefined,
  ): string {
    const en = lang === 'en';
    const lines: string[] = [];
    lines.push(
      prompt
        ? `${en ? 'Description' : 'الوصف'}: ${prompt}`
        : en
          ? 'Description: (none — write a fitting ad description for the product)'
          : 'الوصف: (لا يوجد — اكتب وصفًا مناسبًا للمنتج)',
    );
    if (productName) lines.push(`${en ? 'Product' : 'المنتج'}: ${productName}`);
    for (const key of CONTEXT_KEYS) {
      const value = options?.[key]?.trim();
      if (value) lines.push(`${CONTEXT_LABELS[lang][key]}: ${value}`);
    }
    return lines.join('\n');
  }

  /** Strip wrapping quotes and a leading label (Arabic or English) echoed back. */
  private clean(text: string): string {
    let out = text
      .trim()
      .replace(/^(?:الوصف|الناتج|description|prompt)\s*[:：]\s*/iu, '');
    out = out.replace(/^["'«“”]+|["'«“”]+$/gu, '').trim();
    return out;
  }
}
