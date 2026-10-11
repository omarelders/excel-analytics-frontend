/**
 * Contract for the service worker this app ships: what it may cache, how far a
 * cache is allowed to grow, and what it does to Cache Storage when it activates.
 *
 * Neither the worker nor its rules are re-implemented here. Every test boots the
 * real module - `src/sw.js`, and the built `dist/sw.js` the PWA plugin emits -
 * inside `test/security/serviceWorkerHarness.mjs`, which stands in for the
 * ServiceWorkerGlobalScope: a `self` that records the listeners the worker
 * registers, `caches` and a fake IndexedDB that store what they are handed and
 * return it, and a `fetch` that answers canned responses. Real `FetchEvent`s and
 * `ActivateEvent`s are then dispatched through the listeners the worker itself
 * registered, and the assertions are made on what actually reached the fake
 * caches. The router, the strategies and the cacheable-response / expiration
 * plugins are the real ones from the installed `workbox-*` packages, so a
 * response is stored only when that worker decides it is cacheable, and it stays
 * until that worker's plugin evicts it.
 *
 * Run `npm run build` first: the checks that boot `dist/sw.js` read the build,
 * and **fail** (not skip) without one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = path.join(ROOT, 'test', 'security', 'serviceWorkerHarness.mjs');

/** Stand-in for the deployed origin, the same one `vercel_headers.test.mjs` uses. */
const ORIGIN = 'https://goldroad.invalid';
const CROSS_ORIGIN = 'https://cdn.example.com';

/** The runtime caches the worker owns, by the names `src/sw.js` hands to workbox. */
const API_CACHE = 'api-cache';
const IMAGE_CACHE = 'image-cache';
const STATIC_CACHE = 'static-resources';
const MIGRATION_CACHE = 'sw-migrations';

/** The requests that carry PII: shipments, financial data, notes, uploads. */
const SENSITIVE_PATHS = [
  '/shipments',
  '/shipments/GR-1001',
  '/shipments/GR-1001/status',
  '/api/shipments',
  '/api/analytics?from=2024-01-01',
  '/payments',
  '/notes',
  '/notes/42',
  '/upload',
];

/**
 * The migration marker key, read out of `src/sw.js` rather than written here, so
 * bumping `CACHE_SCHEMA_VERSION` moves this test with it instead of failing it
 * for a version that is no longer the one being asserted. `dist/sw.js` is built
 * from the same source, which is what the boot of `dist/sw.js` then proves.
 */
const markerUrl = () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/sw.js'), 'utf8');
  const version = source.match(/CACHE_SCHEMA_VERSION\s*=\s*(\d+)\s*;/)?.[1];
  assert.ok(version, 'could not read CACHE_SCHEMA_VERSION out of src/sw.js');
  return `${ORIGIN}/schema-v${version}`;
};

const IMAGE_LIMIT = 50;
const STATIC_LIMIT = 50;

const url = (pathname) => `${ORIGIN}${pathname}`;
const canned = (pathname, extra = {}) => ({ url: url(pathname), status: 200, body: `body:${pathname}`, ...extra });

/** The worker in source, and the worker the build actually serves. */
const WORKERS = [
  { entry: 'src/sw.js', label: 'src/sw.js' },
  { entry: 'dist/sw.js', label: 'dist/sw.js' },
];

// ---------------------------------------------------------------------------
// Booting the worker
// ---------------------------------------------------------------------------

/**
 * Boots `entry` (a path relative to the repo root) against a scenario in a fresh
 * child process and returns its report. One process per boot, because workbox
 * keeps a module-level router that two boots in one process would share.
 */
function boot(entry, scenario) {
  const entryPath = path.resolve(ROOT, entry);
  assert.ok(
    fs.existsSync(entryPath),
    `${entry} is missing - run \`npm run build\` first. These tests boot the worker the build emits, so an unbuilt tree gives no signal and is a failure rather than a skip.`,
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-scenario-'));
  const scenarioPath = path.join(directory, 'scenario.json');
  try {
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario));

    const child = spawnSync(process.execPath, [HARNESS, scenarioPath, entryPath], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    assert.strictEqual(child.status, 0, `boot of ${entry} exited ${child.status}: ${child.stderr}`);

    const report = child.stdout
      .split('\n')
      .filter((line) => line.startsWith('__RESULT__'))
      .pop();
    assert.ok(report, `boot of ${entry} produced no report: ${child.stdout.slice(0, 2000)}`);

    const parsed = JSON.parse(report.slice('__RESULT__'.length));
    assert.deepStrictEqual(parsed.unhandled, [], `boot of ${entry} reported unhandled errors`);
    return parsed;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const entriesIn = (report, cacheName) => report.caches[cacheName] ?? [];
const storedUrls = (report) => Object.values(report.caches).flatMap((entries) => entries.map((entry) => entry.url));
const cacheOps = (report, action, cacheName) =>
  report.operations.filter((operation) => operation.action === action && operation.cache === cacheName);
const stepFor = (report, url) => report.steps.find((step) => step.url === url);

test('the build emits the service worker these tests boot', () => {
  for (const { entry } of WORKERS.filter((worker) => worker.entry !== 'src/sw.js')) {
    assert.ok(
      fs.existsSync(path.join(ROOT, entry)),
      `${entry} is missing - run \`npm run build\` first. These tests check the worker the build emits, so an unbuilt tree gives no signal and is a failure rather than a skip.`,
    );
  }
});

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

for (const { entry, label } of WORKERS) {
  test(`${label} never writes a sensitive path to Cache Storage`, () => {
    const report = boot(entry, {
      responses: [...SENSITIVE_PATHS.map((pathname) => canned(pathname)), canned('/statuses')],
      steps: [
        ...SENSITIVE_PATHS.map((pathname) => ({ kind: 'fetch', url: url(pathname), destination: '' })),
        { kind: 'fetch', url: url('/statuses'), destination: '' },
        { kind: 'fetch', url: url('/statuses'), method: 'POST', destination: '' },
      ],
    });

    const cached = storedUrls(report).filter((cachedUrl) =>
      SENSITIVE_PATHS.some((pathname) => cachedUrl.startsWith(url(pathname))),
    );
    assert.deepStrictEqual(cached, [], `sensitive responses reached Cache Storage: ${cached.join(', ')}`);

    // Not vacuous: the same boot caches the one endpoint that may be cached, so
    // "nothing sensitive was stored" above is a decision and not a broken run.
    assert.deepStrictEqual(
      entriesIn(report, API_CACHE).map((entry) => entry.url),
      [url('/statuses')],
      'the allowlisted GET must still be cached, or the check above proved nothing',
    );

    const post = report.steps.find((step) => step.method === 'POST');
    assert.ok(post, 'the POST step was not run');
    assert.strictEqual(post.handled, false, 'a POST must not be turned into a cached response');
  });
}

test('the worker asks the network for nothing the shipped CSP would block', () => {
  for (const { entry } of WORKERS) {
    const report = boot(entry, {
      responses: [
        canned('/statuses'),
        canned('/img/logo.png', { contentType: 'image/png' }),
        { url: `${CROSS_ORIGIN}/pixel.png`, status: 200, contentType: 'image/png', body: 'pixel' },
        { url: `${CROSS_ORIGIN}/tracker.js`, status: 200, contentType: 'text/javascript', body: 'tracker' },
        { url: `${CROSS_ORIGIN}/theme.css`, status: 200, contentType: 'text/css', body: 'theme' },
        { url: `${CROSS_ORIGIN}/font.woff2`, status: 200, contentType: 'font/woff2', body: 'font' },
      ],
      steps: [
        { kind: 'fetch', url: url('/statuses'), destination: '' },
        { kind: 'fetch', url: url('/img/logo.png'), destination: 'image' },
        { kind: 'fetch', url: `${CROSS_ORIGIN}/pixel.png`, destination: 'image' },
        { kind: 'fetch', url: `${CROSS_ORIGIN}/tracker.js`, destination: 'script' },
        { kind: 'fetch', url: `${CROSS_ORIGIN}/theme.css`, destination: 'style' },
        { kind: 'fetch', url: `${CROSS_ORIGIN}/font.woff2`, destination: 'font' },
      ],
    });

    const crossOrigin = report.fetchCalls.filter((call) => !call.url.startsWith(`${ORIGIN}/`));
    assert.deepStrictEqual(
      crossOrigin.map((call) => call.url),
      [],
      `${entry} fetched a cross-origin URL. \`connect-src 'self'\` (vercel.json) governs the worker's own fetches too, so that request can only fail.`,
    );

    assert.deepStrictEqual(
      [entriesIn(report, IMAGE_CACHE).length, entriesIn(report, STATIC_CACHE).length],
      [1, 0],
      `only the same-origin image may be cached; caches: ${JSON.stringify(report.caches)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// A deletion guard
//
// Everything above boots the worker and asserts what it did. This one can only be a
// source-text check: it protects against code coming *back*, and dead code that never
// runs leaves no post-state to assert. `verify_security.mjs` was deleted because it
// claimed to be a behavioural check and was not one; this is the same mechanism with
// its nature stated, and the behaviour it used to describe is covered above.
// ---------------------------------------------------------------------------

test('DELETION GUARD (source text, not behaviour): the worker does not regain the exclusion list that read like protection', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/sw.js'), 'utf8');

  assert.ok(!/EXCLUDED_CACHE_ROUTES|isExcludedRoute/.test(source), 'the unreachable exclusion list is back in src/sw.js');
  assert.ok(!/SAFE_API_PREFIXES|isSafeApiPath/.test(source), 'the old "safe path" name is back, describing a blocklist that no longer exists');
  assert.ok(/CACHEABLE_API_PREFIXES/.test(source), 'src/sw.js no longer names its allowlist of cacheable API paths');
});

// ---------------------------------------------------------------------------
// Images and static assets
// ---------------------------------------------------------------------------

for (const { entry, label } of WORKERS) {
  test(`${label} caches a same-origin image and leaves a cross-origin one to the browser`, () => {
    const report = boot(entry, {
      responses: [
        canned('/img/logo.png', { contentType: 'image/png' }),
        { url: `${CROSS_ORIGIN}/pixel.png`, status: 200, opaque: true, contentType: 'image/png' },
      ],
      steps: [
        { kind: 'fetch', url: url('/img/logo.png'), destination: 'image' },
        { kind: 'fetch', url: `${CROSS_ORIGIN}/pixel.png`, destination: 'image' },
      ],
    });

    assert.deepStrictEqual(
      entriesIn(report, IMAGE_CACHE).map((entry) => entry.url),
      [url('/img/logo.png')],
      `a same-origin image must be cached; image-cache holds ${JSON.stringify(storedUrls(report))}`,
    );

    // The origin check has to stop the request, not merely stop the write: a
    // claimed cross-origin request would be answered by the worker's own fetch,
    // which the shipped `connect-src 'self'` blocks.
    const crossOrigin = stepFor(report, `${CROSS_ORIGIN}/pixel.png`);
    assert.strictEqual(crossOrigin.handled, false, `${label} claimed a cross-origin image request`);
    assert.deepStrictEqual(storedUrls(report), [url('/img/logo.png')], 'nothing cross-origin may be stored');
  });
}

for (const { entry, label } of WORKERS) {
  test(`${label} caches a same-origin asset and leaves a cross-origin one to the browser`, () => {
    const report = boot(entry, {
      responses: [
        canned('/assets/app-1.js', { contentType: 'text/javascript' }),
        canned('/styles/app-1.css', { contentType: 'text/css' }),
        { url: `${CROSS_ORIGIN}/tracker.js`, status: 200, contentType: 'text/javascript', body: 'tracker' },
        { url: `${CROSS_ORIGIN}/theme.css`, status: 200, contentType: 'text/css', body: 'theme' },
      ],
      steps: [
        { kind: 'fetch', url: url('/assets/app-1.js'), destination: 'script' },
        { kind: 'fetch', url: url('/styles/app-1.css'), destination: 'style' },
        { kind: 'fetch', url: `${CROSS_ORIGIN}/tracker.js`, destination: 'script' },
        { kind: 'fetch', url: `${CROSS_ORIGIN}/theme.css`, destination: 'style' },
      ],
    });

    assert.deepStrictEqual(
      entriesIn(report, STATIC_CACHE).map((entry) => entry.url).sort(),
      [url('/assets/app-1.js'), url('/styles/app-1.css')].sort(),
      `same-origin scripts and styles must be cached; static-resources holds ${JSON.stringify(entriesIn(report, STATIC_CACHE).map((e) => e.url))}`,
    );

    for (const host of [CROSS_ORIGIN]) {
      assert.strictEqual(stepFor(report, `${host}/tracker.js`).handled, false, `${label} claimed a cross-origin script`);
      assert.strictEqual(stepFor(report, `${host}/theme.css`).handled, false, `${label} claimed a cross-origin stylesheet`);
    }
    assert.deepStrictEqual(
      storedUrls(report).filter((storedUrl) => storedUrl.startsWith(`${CROSS_ORIGIN}/`)),
      [],
      'nothing cross-origin may be stored',
    );
  });
}

for (const { entry, label } of WORKERS) {
  test(`${label} refuses to cache an unreadable (opaque) response from a route it owns`, () => {
    // A browser only produces a status 0 response for a cross-origin no-cors
    // fetch, so this drives the status check with same-origin URLs: the routes
    // own the requests, and the responses are the ones they cannot read.
    const report = boot(entry, {
      responses: [
        { url: url('/img/logo.png'), status: 200, opaque: true, contentType: 'image/png' },
        { url: url('/assets/app-1.js'), status: 200, opaque: true, contentType: 'text/javascript' },
      ],
      steps: [
        { kind: 'fetch', url: url('/img/logo.png'), destination: 'image' },
        { kind: 'fetch', url: url('/assets/app-1.js'), destination: 'script' },
      ],
    });

    for (const step of report.steps) {
      assert.strictEqual(step.handled, true, `${step.url} should be owned by the worker for this test to prove anything`);
    }
    assert.deepStrictEqual(entriesIn(report, IMAGE_CACHE), [], 'an unreadable response was written to image-cache');
    assert.deepStrictEqual(entriesIn(report, STATIC_CACHE), [], 'an unreadable response was written to static-resources');
  });
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

const firstActivation = () => ({
  // What an earlier build of this worker may already have written to Cache
  // Storage, before the allowlist existed.
  seed: [{ cache: API_CACHE, entries: [canned('/shipments', { body: 'legacy PII' })] }],
  responses: [canned('/statuses')],
  steps: [
    { kind: 'fetch', url: url('/statuses'), destination: '' },
    { kind: 'activate' },
  ],
});

const laterActivations = () => ({
  responses: [canned('/statuses')],
  steps: [
    { kind: 'fetch', url: url('/statuses'), destination: '' },
    { kind: 'activate' },
    { kind: 'fetch', url: url('/statuses'), destination: '' },
    { kind: 'activate' },
    { kind: 'activate' },
  ],
});

for (const { entry, label } of WORKERS) {
  test(`${label} runs the legacy purge on the first activation after a schema version`, () => {
    const report = boot(entry, firstActivation());
    const [fetch, activate] = report.steps;

    assert.strictEqual(fetch.handled, true, 'the cached fetch was not handled');
    assert.deepStrictEqual(
      entriesIn(report, API_CACHE).map((entry) => entry.url),
      [],
      'the first activation must leave nothing of what a previous build stored in api-cache',
    );

    const purges = cacheOps(report, 'delete-cache', API_CACHE);
    assert.strictEqual(purges.length, 1, `expected exactly one legacy purge, got ${purges.length}:\n${JSON.stringify(purges)}`);
    assert.ok(purges[0].step.startsWith('activate'), 'the purge must happen during an activation');
  });
}

for (const { entry, label } of WORKERS) {
  test(`${label} leaves the runtime cache alone on a later activation`, () => {
    const report = boot(entry, laterActivations());
    const [, , second, ...rest] = report.steps;

    assert.strictEqual(second.handled, true, 'the re-fetch after activation was not handled');
    assert.deepStrictEqual(
      entriesIn(report, API_CACHE).map((entry) => entry.url),
      [url('/statuses')],
      'the runtime api-cache must keep what the allowlisted route stored in it',
    );

    assert.strictEqual(
      cacheOps(report, 'delete-cache', API_CACHE).length,
      1,
      `the legacy purge must run exactly once across the whole run; cache operations:\n${JSON.stringify(report.operations)}`,
    );
    assert.strictEqual(rest.length, 2, 'the last two steps must be activations');
  });
}

for (const { entry, label } of WORKERS) {
  test(`${label} records its migration once, keyed on the cache schema version`, () => {
    const report = boot(entry, laterActivations());

    assert.deepStrictEqual(
      entriesIn(report, MIGRATION_CACHE).map((entry) => entry.url),
      [markerUrl()],
      'the marker for the current schema version must be stored exactly once',
    );
    assert.deepStrictEqual(
      Object.keys(report.caches).sort(),
      [API_CACHE, MIGRATION_CACHE, 'workbox-precache-v2-https://goldroad.invalid/'].sort(),
      'the worker must not write any other cache',
    );
  });
}

// ---------------------------------------------------------------------------
// Bounded caches
// ---------------------------------------------------------------------------

for (const { entry, label } of WORKERS) {
  test(`${label} keeps static-resources inside its ExpirationPlugin limit`, () => {
    const responses = Array.from({ length: STATIC_LIMIT + 2 }, (_, index) =>
      canned(`/assets/app-${index + 1}.js`, { contentType: 'text/javascript' }),
    );
    const report = boot(entry, {
      responses,
      steps: responses.map((entry) => ({ kind: 'fetch', url: entry.url, destination: 'script' })),
    });

    const entries = entriesIn(report, STATIC_CACHE);
    assert.ok(entries.length > 0, `no script was cached at all: ${JSON.stringify(report.caches)}`);
    assert.ok(
      entries.length <= STATIC_LIMIT,
      `static-resources grew to ${entries.length} entries, over the ${STATIC_LIMIT} its ExpirationPlugin allows`,
    );
    assert.ok(
      cacheOps(report, 'delete-entry', STATIC_CACHE).length > 0,
      'the cache filled and then stopped, but nothing was ever evicted - the bound is not being enforced',
    );
  });
}

for (const { entry, label } of WORKERS) {
  test(`${label} keeps image-cache inside its ExpirationPlugin limit`, () => {
    const responses = Array.from({ length: IMAGE_LIMIT + 2 }, (_, index) =>
      canned(`/img/logo-${index + 1}.png`, { contentType: 'image/png' }),
    );
    const report = boot(entry, {
      responses,
      steps: responses.map((entry) => ({ kind: 'fetch', url: entry.url, destination: 'image' })),
    });

    const entries = entriesIn(report, IMAGE_CACHE);
    assert.ok(entries.length > 0, `no image was cached at all: ${JSON.stringify(report.caches)}`);
    assert.ok(
      entries.length <= IMAGE_LIMIT,
      `image-cache grew to ${entries.length} entries, over the ${IMAGE_LIMIT} its ExpirationPlugin allows`,
    );
    assert.ok(
      cacheOps(report, 'delete-entry', IMAGE_CACHE).length > 0,
      'the cache filled and then stopped, but nothing was ever evicted - the bound is not being enforced',
    );
  });
}
