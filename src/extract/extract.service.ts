import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { load, type CheerioAPI } from 'cheerio';
import { ProductInfo } from './extract.types';

const TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;
const USER_AGENT =
  'Mozilla/5.0 (compatible; MarketingStudioBot/1.0; +https://salla.sa)';

/** Fetches a product page and extracts title / description / price / images. */
@Injectable()
export class ExtractService {
  private readonly logger = new Logger(ExtractService.name);

  async extract(rawUrl: string): Promise<ProductInfo> {
    const url = this.validateUrl(rawUrl);
    const html = await this.fetchHtml(url);
    return this.parseHtml(html, url);
  }

  /** Parse already-fetched HTML (separated for testability). */
  parseHtml(html: string, base: URL): ProductInfo {
    const $ = load(html);
    const ld = this.parseJsonLd($);
    const meta = this.parseMeta($);

    const title =
      ld.title || meta.title || $('title').first().text().trim() || 'منتج';

    const description =
      ld.description ||
      meta.description ||
      $('meta[name="description"]').attr('content') ||
      undefined;

    const images = this.resolveImages(
      [...ld.images, ...meta.images, ...this.fallbackImages($)],
      base,
    );

    return {
      title: collapse(title),
      description: description ? collapse(description) : undefined,
      price: ld.price ?? meta.price,
      currency: ld.currency ?? meta.currency,
      images,
      sourceUrl: base.toString(),
    };
  }

  // ── URL safety ─────────────────────────────────────────────────────────
  private validateUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      throw new BadRequestException('رابط غير صالح.');
    }
    return this.assertSafeUrl(url);
  }

  /** Enforce http(s) + non-private host on a parsed URL. Single source of
   * truth, reused for both the original request and any redirect target. */
  private assertSafeUrl(url: URL): URL {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException('يُسمح بروابط http(s) فقط.');
    }
    if (isPrivateHost(url.hostname)) {
      throw new BadRequestException('هذا الرابط غير مسموح به.');
    }
    return url;
  }

  private async fetchHtml(startUrl: URL): Promise<string> {
    let url = startUrl;
    // One overall deadline shared by every hop, so a redirect chain can't
    // stretch the total time to MAX_REDIRECTS × TIMEOUT_MS.
    const deadline = Date.now() + TIMEOUT_MS;
    for (let hop = 0; ; hop++) {
      const res = await this.fetchOnce(url, deadline);
      // Manually follow redirects so each target is re-validated (a redirect
      // to a private/metadata IP would otherwise bypass the SSRF guard).
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          throw new ServiceUnavailableException(
            `تعذّر الوصول للصفحة (رمز ${res.status}).`,
          );
        }
        if (hop >= MAX_REDIRECTS) {
          throw new ServiceUnavailableException('تعذّر قراءة الرابط.');
        }
        url = this.resolveRedirect(location, url);
        continue;
      }
      if (!res.ok) {
        throw new ServiceUnavailableException(
          `تعذّر الوصول للصفحة (رمز ${res.status}).`,
        );
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('html')) {
        throw new UnprocessableEntityException('الرابط ليس صفحة ويب.');
      }
      return await readCapped(res, MAX_BYTES);
    }
  }

  /** Resolve and re-validate a redirect Location against the same guard. */
  private resolveRedirect(location: string, base: URL): URL {
    let target: URL;
    try {
      target = new URL(location, base);
    } catch {
      throw new BadRequestException('رابط غير صالح.');
    }
    return this.assertSafeUrl(target);
  }

  /** A single fetch hop, aborted at the shared `deadline` (epoch ms) and with
   * no auto-redirects. The remaining time — not a fresh TIMEOUT_MS — bounds
   * this hop, so the whole redirect chain stays within one overall budget. */
  private async fetchOnce(url: URL, deadline: number): Promise<Response> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new ServiceUnavailableException('انتهت مهلة قراءة الصفحة.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      return await fetch(url.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ServiceUnavailableException('انتهت مهلة قراءة الصفحة.');
      }
      if (
        err instanceof ServiceUnavailableException ||
        err instanceof UnprocessableEntityException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      this.logger.warn(`Fetch failed for ${url.toString()}: ${String(err)}`);
      throw new ServiceUnavailableException('تعذّر قراءة الرابط.');
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Parsers ────────────────────────────────────────────────────────────
  private parseJsonLd($: CheerioAPI): {
    title: string;
    description: string;
    price?: string;
    currency?: string;
    images: string[];
  } {
    const out = {
      title: '',
      description: '',
      price: undefined as string | undefined,
      currency: undefined as string | undefined,
      images: [] as string[],
    };

    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).contents().text();
      if (!raw.trim()) return;
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      const product = flattenLd(data).find(isProduct);
      if (!product) return;

      out.title ||= asString(product.name) ?? '';
      out.description ||= asString(product.description) ?? '';
      out.images.push(...toImageUrls(product.image));

      const offer = asRecord(asArray(product.offers)[0]);
      if (offer) {
        out.price ??= asString(offer.price) ?? asString(offer.lowPrice);
        out.currency ??= asString(offer.priceCurrency);
      }
    });

    return out;
  }

  private parseMeta($: CheerioAPI): {
    title?: string;
    description?: string;
    price?: string;
    currency?: string;
    images: string[];
  } {
    const meta = (key: string): string | undefined =>
      $(`meta[property="${key}"]`).attr('content') ??
      $(`meta[name="${key}"]`).attr('content') ??
      undefined;

    const images = [
      meta('og:image'),
      meta('og:image:secure_url'),
      meta('twitter:image'),
    ].filter((s): s is string => Boolean(s));

    return {
      title: meta('og:title') ?? meta('twitter:title'),
      description: meta('og:description') ?? meta('twitter:description'),
      price: meta('product:price:amount') ?? meta('og:price:amount'),
      currency: meta('product:price:currency') ?? meta('og:price:currency'),
      images,
    };
  }

  /** Last-resort page <img> sources, junk-filtered and ranked by size. */
  private fallbackImages($: CheerioAPI): string[] {
    const candidates: { src: string; score: number }[] = [];
    $('img[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (!src || src.startsWith('data:') || isJunkImage(src)) return;
      const w = Number($(el).attr('width')) || 0;
      const h = Number($(el).attr('height')) || 0;
      candidates.push({ src, score: w * h });
    });
    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((c) => c.src);
  }

  private resolveImages(candidates: string[], base: URL): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const candidate of candidates) {
      try {
        const abs = new URL(candidate, base).toString();
        if (!/^https?:\/\//i.test(abs) || seen.has(abs)) continue;
        seen.add(abs);
        out.push(abs);
      } catch {
        // skip invalid
      }
    }
    return out;
  }
}

/** Heuristic: skip logos, icons, payment badges, sprites, svgs. */
function isJunkImage(url: string): boolean {
  return /logo|icon|sprite|favicon|placeholder|loading|spinner|avatar|badge|payment|visa|master(card)?|mada|apple-?pay|\.svg(\?|$)/i.test(
    url,
  );
}

// ── Untyped-JSON helpers (keep parsing type-safe) ──────────────────────────
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function flattenLd(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    out.push(record);
    if ('@graph' in record) visit(record['@graph']);
  };
  visit(data);
  return out;
}

function isProduct(record: Record<string, unknown>): boolean {
  const type = record['@type'];
  if (typeof type === 'string') return type.toLowerCase().includes('product');
  if (Array.isArray(type)) {
    return type.some(
      (t) => typeof t === 'string' && t.toLowerCase().includes('product'),
    );
  }
  return false;
}

function toImageUrls(value: unknown): string[] {
  return asArray(value)
    .map((item) => {
      if (typeof item === 'string') return item;
      const record = asRecord(item);
      return record ? asString(record.url) : undefined;
    })
    .filter((s): s is string => Boolean(s));
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Read a response body up to `maxBytes`, then stop. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        break;
      }
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (
    h === '::1' ||
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe80')
  ) {
    return true;
  }
  return false;
}
