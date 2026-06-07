# Marketing Studio — Backend

NestJS (TypeScript) API for the Marketing Studio. It turns a product asset +
prompt into an AI-generated image or video ad, behind a **provider abstraction**
so generation engines can be swapped/added without touching the rest of the app.

## Architecture

```
POST /api/generations                 ProvidersModule
  └─ GenerationService.create()         ├─ GenerationProvider (interface)
        ├─ resolveCapability()          ├─ MockProvider      (default, no creds)
        ├─ ProviderRegistry.resolve()   └─ ByteplusProvider  (Seedance, skeleton)
        ├─ JobStore.create()           ProviderRegistry picks one per capability
        └─ run() ── provider.generate() ── updates JobStore
GET /api/generations/:id  → poll job status until succeeded/failed
```

- **Capabilities**: `text-to-image`, `text-to-video`, `image-to-image`,
  `image-to-video` — derived from the request (image attachment ⇒ image-to-\*).
- **Jobs** are created immediately (`202`) and run asynchronously; clients poll.
- **JobStore** is in-memory for now — swap for Redis/Postgres behind the same
  methods later.

## Adding a provider

Implement `GenerationProvider` (`name`, `supports(capability)`, `generate(ctx)`)
and register it in `providers.module.ts`. That's it.

The **BytePlus (Seedance)** adapter is scaffolded in
`src/providers/byteplus/` — fill in the two marked API calls, set the env vars,
and switch `GENERATION_PROVIDER=byteplus`.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/generations` | Start a job → `202` with the queued job |
| `GET` | `/api/generations` | List jobs |
| `GET` | `/api/generations/:id` | Get job status + outputs |

Create body:
```json
{
  "mode": "video",
  "prompt": "إعلان فيديو لمنتج العناية",
  "options": ["12s", "9:16"],
  "attachments": [{ "slotId": "product", "kind": "product", "url": "https://..." }]
}
```

## Configuration

Copy `.env.example` → `.env`. Key vars: `PORT` (default 3001), `CORS_ORIGINS`
(default `http://localhost:3000`), `GENERATION_PROVIDER` (`mock` | `byteplus`),
and the `BYTEPLUS_*` credentials.

## Scripts

```bash
npm run start:dev   # watch mode
npm run build       # compile to dist/
npm run start:prod  # run compiled
npm test            # unit tests
npm run test:e2e    # end-to-end (create → poll → result)
npm run lint        # eslint
```

## Deploy (Railway)

The backend runs long-lived async jobs with an in-memory store, so it needs an
**always-on host** (not serverless). `railway.json` configures it:

- **Build:** `npm run build` (Nixpacks)
- **Start:** `npm run start:prod` (`node dist/main`)
- **Health check:** `/api/health`
- Binds `0.0.0.0` and reads the `PORT` Railway injects — don't set `PORT` yourself.

**Set these env vars in the Railway service** (Variables tab):

| Var | Value |
| --- | --- |
| `GENERATION_PROVIDER` | `byteplus` |
| `BYTEPLUS_API_KEY` | your ModelArk key |
| `CORS_ORIGINS` | the deployed frontend origin(s), e.g. `https://marketingstudio-ten.vercel.app` |

Then point the **frontend** at the backend: set `NEXT_PUBLIC_API_URL` in Vercel to
the Railway public URL and redeploy.

> ⚠️ State is in-memory — run a **single instance** for now (don't scale
> horizontally until the JobStore moves to Postgres/Redis). See Phase 2.

