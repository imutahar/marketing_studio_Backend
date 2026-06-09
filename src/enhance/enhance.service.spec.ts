import { EnhanceService } from './enhance.service';
import { PromptEnhancer } from './enhance.types';

function makeService(enhancer: Partial<PromptEnhancer>): EnhanceService {
  return new EnhanceService({
    isConfigured: () => true,
    enhance: jest.fn(),
    ...enhancer,
  });
}

describe('EnhanceService', () => {
  it('rejects an empty prompt with no product (400)', async () => {
    const svc = makeService({ enhance: jest.fn() });
    await expect(svc.enhance({ prompt: '   ', mode: 'image' })).rejects.toThrow(
      'اكتب وصفًا',
    );
  });

  it('reports unavailable + throws 503 when the vendor is not configured', async () => {
    const svc = makeService({ isConfigured: () => false });
    expect(svc.isAvailable()).toBe(false);
    await expect(
      svc.enhance({ prompt: 'عطر فاخر', mode: 'image' }),
    ).rejects.toThrow('غير مفعّلة');
  });

  it('returns cleaned text (strips wrapping quotes + echoed label)', async () => {
    const enhance = jest
      .fn()
      .mockResolvedValue('الوصف: "عطر فاخر في ضوء ذهبي"');
    const svc = makeService({ enhance });
    const out = await svc.enhance({ prompt: 'عطر', mode: 'image' });
    expect(out).toBe('عطر فاخر في ضوء ذهبي');
    expect(enhance).toHaveBeenCalledTimes(1);
  });

  it('builds an English-only instruction for an instructional English prompt', async () => {
    const enhance = jest.fn().mockResolvedValue('A beach ad at golden hour');
    const svc = makeService({ enhance });
    await svc.enhance({
      prompt: 'get me a good ad for the beach with offer 1 to 1',
      mode: 'video',
    });
    const [system] = enhance.mock.calls[0] as [string, string];
    expect(system).toContain('English only');
    expect(system).not.toMatch(/[؀-ۿ]/); // no Arabic anywhere in the instruction
  });

  it('keeps Arabic for an Arabic prompt', async () => {
    const enhance = jest.fn().mockResolvedValue('مشهد شاطئي');
    const svc = makeService({ enhance });
    await svc.enhance({ prompt: 'إعلان للشاطئ', mode: 'video' });
    const [system] = enhance.mock.calls[0] as [string, string];
    expect(system).toContain('بالعربية');
  });

  it('passes English output through and strips an English label prefix', async () => {
    const enhance = jest
      .fn()
      .mockResolvedValue('Prompt: "A luxury perfume bottle in golden light"');
    const svc = makeService({ enhance });
    const out = await svc.enhance({ prompt: 'perfume ad', mode: 'image' });
    expect(out).toBe('A luxury perfume bottle in golden light');
  });

  it('allows an empty prompt when a product is attached', async () => {
    const enhance = jest.fn().mockResolvedValue('لقطة احترافية للمنتج');
    const svc = makeService({ enhance });
    const out = await svc.enhance({
      prompt: '',
      mode: 'video',
      productName: 'عطر الورد',
    });
    expect(out).toBe('لقطة احترافية للمنتج');
    // The product name should reach the rewriter (2nd arg = user message).
    expect(enhance).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('عطر الورد'),
    );
  });

  it('wraps a vendor failure in a friendly 503', async () => {
    const enhance = jest.fn().mockRejectedValue(new Error('boom'));
    const svc = makeService({ enhance });
    await expect(svc.enhance({ prompt: 'عطر', mode: 'image' })).rejects.toThrow(
      'تعذّر تحسين الوصف',
    );
  });
});
