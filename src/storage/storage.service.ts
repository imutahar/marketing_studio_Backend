import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { put } from '@vercel/blob';

/** Wall-clock cap on a single durability fetch so a hung remote can't pin a job. */
const FETCH_TIMEOUT_MS = 30_000;

/** Map a mime/content-type to a sensible file extension; fall back to 'bin'. */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

function extFromMime(mime: string | undefined): string {
  if (!mime) return 'bin';
  // Strip any parameters (e.g. "image/jpeg; charset=...").
  const type = mime.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[type] ?? 'bin';
}

/**
 * Durable object storage backed by Vercel Blob.
 *
 * Two concerns:
 *   - INPUTS: ModelArk (BytePlus) needs publicly reachable image URLs; merchant
 *     uploads arrive as base64 `data:` URIs. We upload them to Blob and swap in
 *     the public URL before generation.
 *   - OUTPUTS: BytePlus output URLs expire (~24h). We re-host each generated
 *     asset on Blob so the ad library stays durable.
 *
 * Everything here is best-effort: if the token is absent (local/dev) or any
 * call fails, the original input is returned unchanged and the job proceeds.
 * No method throws.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly token?: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>('BLOB_READ_WRITE_TOKEN');
  }

  /** True iff a Blob token is configured. When false, callers skip all Blob work. */
  isEnabled(): boolean {
    return Boolean(this.token);
  }

  /**
   * Upload a base64 `data:` URI to Blob and return its public URL. If the input
   * is already an http(s) URL (or the token is missing) it is returned
   * unchanged. Never throws — on any error logs a warning and returns the input.
   */
  async uploadDataUri(dataUri: string, pathname: string): Promise<string> {
    if (!this.token) return dataUri;

    const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUri);
    if (!match || !dataUri.includes(';base64,')) {
      // Not a base64 data URI (already a hosted URL, or unsupported form).
      return dataUri;
    }

    const contentType = match[1] || 'application/octet-stream';
    const payload = match[2];

    try {
      const body = Buffer.from(payload, 'base64');
      const result = await put(
        `${pathname}.${extFromMime(contentType)}`,
        body,
        {
          access: 'public',
          token: this.token,
          contentType,
          addRandomSuffix: true,
        },
      );
      return result.url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(
        `Failed to upload data URI to Blob (${pathname}): ${message}`,
      );
      return dataUri;
    }
  }

  /**
   * Fetch a remote URL and re-host it on Blob, returning the durable public URL.
   * Durability is best-effort: on any error (or missing token) the ORIGINAL
   * remoteUrl is returned unchanged so the job still succeeds. Never throws.
   */
  async uploadFromUrl(remoteUrl: string, pathname: string): Promise<string> {
    if (!this.token) return remoteUrl;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(remoteUrl, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`fetch ${res.status} ${res.statusText}`);
      }
      const contentType =
        res.headers.get('content-type') ?? 'application/octet-stream';
      const body = Buffer.from(await res.arrayBuffer());
      const result = await put(
        `${pathname}.${extFromMime(contentType)}`,
        body,
        {
          access: 'public',
          token: this.token,
          contentType,
          addRandomSuffix: true,
        },
      );
      return result.url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(
        `Failed to re-host ${remoteUrl} on Blob (${pathname}): ${message}`,
      );
      return remoteUrl;
    } finally {
      clearTimeout(timer);
    }
  }
}
