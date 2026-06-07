#!/usr/bin/env node
/**
 * Phase 0 smoke test — prove REAL AI generation end-to-end.
 *
 * Fires a text-only generation at the running backend and polls until it
 * finishes, then prints the output URL(s). Text-only on purpose: it exercises
 * the real Byteplus (Seedance/Seedream) pipeline WITHOUT needing object storage
 * for input images (ModelArk requires public input URLs — that's Phase 1).
 *
 * Usage:
 *   1. Put a real key in .env:  GENERATION_PROVIDER=byteplus  BYTEPLUS_API_KEY=...
 *   2. Start the backend:       npm run start:dev
 *   3. Run the smoke test:      npm run smoke              (image, fastest)
 *                               npm run smoke -- --mode video
 *                               npm run smoke -- --prompt "a sports car ad" --mode video
 *
 * Flags:
 *   --mode <image|video>   what to generate (default: image)
 *   --prompt "<text>"      the prompt (default: a sensible demo prompt)
 *   --api <baseUrl>        backend API base (default: http://localhost:3001/api)
 *   --timeout <seconds>    max wait before giving up (default: 600)
 *   --interval <seconds>   poll interval (default: 3)
 */

const args = parseArgs(process.argv.slice(2));
const API = (args.api || process.env.SMOKE_API || 'http://localhost:3001/api').replace(/\/$/, '');
const MODE = args.mode === 'video' ? 'video' : 'image';
const PROMPT =
  args.prompt ||
  (MODE === 'video'
    ? 'A cinematic 5-second product ad: a sleek perfume bottle on marble, soft studio light, slow push-in.'
    : 'A premium product photo of a sleek perfume bottle on marble under soft studio light, high detail.');
const TIMEOUT_MS = (Number(args.timeout) || 600) * 1000;
const INTERVAL_MS = (Number(args.interval) || 3) * 1000;

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const log = (...a) => console.log(...a);
const ok = (s) => log(C.green('✓'), s);
const info = (s) => log(C.cyan('•'), s);
const warn = (s) => log(C.yellow('!'), s);
const fail = (s) => log(C.red('✗'), s);

async function main() {
  log(C.bold('\n  Marketing Studio — Byteplus smoke test\n'));
  info(`API:    ${API}`);
  info(`Mode:   ${MODE}`);
  info(`Prompt: ${C.dim(PROMPT)}\n`);

  // 1. Preflight — is the backend up?
  try {
    const res = await fetch(`${API}/generations`, { method: 'GET' });
    if (!res.ok) throw new Error(`GET /generations -> ${res.status}`);
    ok('Backend is reachable.');
  } catch (err) {
    fail(`Backend not reachable at ${API}.`);
    log(C.dim(`    ${err.message}`));
    log(`\n  Start it first:  ${C.bold('npm run start:dev')}\n`);
    process.exit(1);
  }

  // 2. Kick off a text-only generation.
  const body = { mode: MODE, prompt: PROMPT };
  let job;
  try {
    const res = await fetch(`${API}/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status !== 202) {
      fail(`POST /generations -> ${res.status}`);
      log(C.dim(`    ${text}`));
      process.exit(1);
    }
    job = JSON.parse(text);
  } catch (err) {
    fail(`Failed to create generation: ${err.message}`);
    process.exit(1);
  }

  ok(`Job created: ${C.bold(job.id)}`);
  info(`Capability: ${job.capability}`);

  // 3. Are we actually hitting the real provider?
  if (job.provider === 'mock') {
    warn(
      'Provider is ' +
        C.bold('"mock"') +
        ' — this is SAMPLE media, not real AI output.',
    );
    log(
      C.dim(
        '    To generate for real, set GENERATION_PROVIDER=byteplus and\n' +
          '    BYTEPLUS_API_KEY in .env, then restart the backend and re-run.',
      ),
    );
  } else {
    ok(`Provider is ${C.bold(`"${job.provider}"`)} — generating for real.`);
  }

  // 4. Poll to completion.
  const started = Date.now();
  let last = '';
  process.stdout.write(`\n  ${C.dim('polling')} `);
  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(INTERVAL_MS);
    let cur;
    try {
      const res = await fetch(`${API}/generations/${job.id}`);
      if (!res.ok) throw new Error(`GET -> ${res.status}`);
      cur = await res.json();
    } catch (err) {
      process.stdout.write(C.yellow('?'));
      continue;
    }
    if (cur.status !== last) {
      process.stdout.write(`\n  ${C.dim(elapsed(started))} ${statusDot(cur.status)} ${cur.status}`);
      last = cur.status;
    } else {
      process.stdout.write(C.dim('.'));
    }

    if (cur.status === 'succeeded') {
      log('\n');
      ok(C.bold(`Done in ${elapsed(started)}.`));
      const outs = cur.outputs || [];
      if (!outs.length) {
        warn('Succeeded but returned no outputs.');
      } else {
        log(`\n  ${C.bold('Output:')}`);
        for (const o of outs) log(`    [${o.type}] ${C.green(o.url)}`);
      }
      log(
        C.dim(
          `\n  Open the URL above to inspect quality.` +
            (cur.provider !== 'mock'
              ? ' Note: Byteplus URLs may expire — Phase 1 (R2 storage) makes them durable.'
              : ''),
        ) + '\n',
      );
      process.exit(0);
    }
    if (cur.status === 'failed') {
      log('\n');
      fail(`Generation failed: ${cur.error || '(no error message)'}`);
      log(
        C.dim(
          '    Common causes: bad/expired BYTEPLUS_API_KEY, wrong BYTEPLUS_ENDPOINT\n' +
            '    region, or an unavailable model id. Check the backend logs.',
        ) + '\n',
      );
      process.exit(1);
    }
  }

  log('\n');
  fail(`Timed out after ${Math.round(TIMEOUT_MS / 1000)}s (still ${last || 'pending'}).`);
  log(C.dim('    Video can take minutes — retry with --timeout 900 if needed.\n'));
  process.exit(1);
}

function statusDot(s) {
  if (s === 'succeeded') return C.green('●');
  if (s === 'failed') return C.red('●');
  if (s === 'processing') return C.cyan('●');
  return C.yellow('●');
}
function elapsed(since) {
  const s = Math.round((Date.now() - since) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

main().catch((err) => {
  fail(`Unexpected error: ${err.message}`);
  process.exit(1);
});
