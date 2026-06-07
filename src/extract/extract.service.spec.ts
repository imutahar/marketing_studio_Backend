import { BadRequestException } from '@nestjs/common';
import { ExtractService } from './extract.service';

describe('ExtractService.parseHtml', () => {
  const service = new ExtractService();
  const base = new URL('https://shop.example.sa/products/aloe-wash');

  it('prefers JSON-LD Product data', () => {
    const html = `<!doctype html><html><head>
      <title>Fallback title</title>
      <meta property="og:image" content="/og.jpg" />
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"غسول الألوفيرا",
       "description":"غسول لطيف","image":["/img/main.jpg"],
       "offers":{"@type":"Offer","price":"35.00","priceCurrency":"SAR"}}
      </script>
    </head><body></body></html>`;

    const info = service.parseHtml(html, base);
    expect(info.title).toBe('غسول الألوفيرا');
    expect(info.price).toBe('35.00');
    expect(info.currency).toBe('SAR');
    expect(info.images[0]).toBe('https://shop.example.sa/img/main.jpg');
  });

  it('falls back to OpenGraph when no JSON-LD', () => {
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="منتج OG" />
      <meta property="og:description" content="وصف OG" />
      <meta property="og:image" content="https://cdn.example.sa/og.png" />
      <meta property="product:price:amount" content="129" />
      <meta property="product:price:currency" content="SAR" />
    </head><body></body></html>`;

    const info = service.parseHtml(html, base);
    expect(info.title).toBe('منتج OG');
    expect(info.description).toBe('وصف OG');
    expect(info.price).toBe('129');
    expect(info.images).toContain('https://cdn.example.sa/og.png');
  });

  it('handles @graph and resolves relative images', () => {
    const html = `<script type="application/ld+json">
      {"@graph":[{"@type":"WebSite"},{"@type":"Product","name":"حقيبة","image":"/a/b.jpg"}]}
      </script>`;
    const info = service.parseHtml(html, base);
    expect(info.title).toBe('حقيبة');
    expect(info.images[0]).toBe('https://shop.example.sa/a/b.jpg');
  });

  it('falls back to <img> but skips logos/icons and ranks by size', () => {
    const html = `<html><body>
      <img src="/assets/logo.png" width="120" height="40" />
      <img src="/img/small.jpg" width="50" height="50" />
      <img src="/img/hero.jpg" width="800" height="800" />
      <img src="/icons/visa.svg" />
    </body></html>`;
    const info = service.parseHtml(html, base);
    expect(info.images[0]).toBe('https://shop.example.sa/img/hero.jpg');
    expect(info.images).not.toContain(
      'https://shop.example.sa/assets/logo.png',
    );
    expect(info.images).not.toContain('https://shop.example.sa/icons/visa.svg');
  });
});

describe('ExtractService.extract (redirect SSRF guard)', () => {
  const service = new ExtractService();
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects a redirect whose Location points at a private/metadata host and does not follow it', async () => {
    // First (and only legitimate) hop: a public URL that 302s to the cloud
    // metadata IP. The redirect target must never be fetched.
    const fetchMock: jest.MockedFunction<typeof fetch> = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce({
        status: 302,
        ok: false,
        headers: new Headers({ location: 'http://169.254.169.254/' }),
      } as Response);
    global.fetch = fetchMock;

    await expect(
      service.extract('https://shop.example.sa/products/aloe-wash'),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The private redirect target was guarded out, so fetch ran exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://shop.example.sa/products/aloe-wash',
    );
  });
});
