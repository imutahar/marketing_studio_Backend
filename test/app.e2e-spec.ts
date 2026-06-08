import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface JobResponse {
  id: string;
  status: string;
  capability: string;
  outputs: { type: string; url: string }[];
}

describe('Marketing Studio backend (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/health → ok', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        expect((res.body as { status: string }).status).toBe('ok');
      });
  });

  it('POST /api/generations → queues a job that completes', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/generations')
      .send({
        mode: 'video',
        prompt: 'إعلان فيديو لمنتج',
        options: { duration: '12 ث', ratio: '9:16', resolution: '1080p' },
      })
      .expect(202);

    const job = create.body as JobResponse;
    expect(job.id).toBeDefined();
    expect(job.capability).toBe('text-to-video');
    expect(['queued', 'processing']).toContain(job.status);

    const final = await pollUntilDone(app, job.id);
    expect(final.status).toBe('succeeded');
    expect(final.outputs).toHaveLength(1);
    expect(final.outputs[0].type).toBe('video');
  }, 10000);

  it('POST /api/generations with an image → image-to-video', async () => {
    const dataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC';
    const create = await request(app.getHttpServer())
      .post('/api/generations')
      .send({
        mode: 'video',
        prompt: 'حوّل صورة المنتج إلى فيديو',
        attachments: [
          {
            slotId: 'product',
            kind: 'product',
            fileName: 'p.png',
            url: dataUri,
          },
        ],
      })
      .expect(202);

    expect((create.body as JobResponse).capability).toBe('image-to-video');
  });

  it('POST /api/generations → rejects invalid mode', () => {
    return request(app.getHttpServer())
      .post('/api/generations')
      .send({ mode: 'gif', prompt: 'x' })
      .expect(400);
  });
});

async function pollUntilDone(
  app: INestApplication<App>,
  id: string,
): Promise<JobResponse> {
  for (let i = 0; i < 20; i++) {
    const res = await request(app.getHttpServer())
      .get(`/api/generations/${id}`)
      .expect(200);
    const job = res.body as JobResponse;
    if (job.status === 'succeeded' || job.status === 'failed') {
      return job;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('job did not finish in time');
}
