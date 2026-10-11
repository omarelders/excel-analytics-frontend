/**
 * Contract for the logout purge: what it clears, what it must not clear, and
 * what it is allowed to do when the server refuses to end the session.
 *
 * Nothing here is a stand-in for the code under test. Each boot spawns
 * `test/security/logoutHarness.mjs`, which renders the real
 * `src/context/AuthContext.jsx` into a fake browser window - `caches`, Web
 * Storage and an IndexedDB the real `idb` package drives - seeds it with the
 * actual caches the service worker owns, and then calls the real `logout()`
 * against a stubbed `fetch`. `fetch` is the only boundary that is faked: the
 * cache names, the caches themselves and the purge are the shipped ones, and
 * the post-state is asserted cache by cache.
 *
 * The caches these tests seed are the ones `src/sw.js` writes - `api-cache`,
 * `image-cache`, `font-cache`, `static-resources`, `sw-migrations` - plus the
 * workbox precache that has to survive a logout, because it is what lets the
 * PWA boot with no network. The list comes from `src/utils/cachePurge.js`, so a
 * cache the worker gains and the purge does not is caught by the last test in
 * this file rather than by somebody remembering.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_CACHE_NAMES, WORKBOX_PRECACHE_PREFIX } from '../../src/utils/cachePurge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = path.join(ROOT, 'test', 'security', 'logoutHarness.mjs');

/** The origin the harness stands in for, the same one the CSP tests use. */
const ORIGIN = 'https://goldroad.invalid';
const SCOPE = `${ORIGIN}/`;

/** workbox-precaching builds its cache name out of the registration scope. */
const PRECACHE = `${WORKBOX_PRECACHE_PREFIX}v2-${SCOPE}`;

/**
 * The migration marker key, read out of `src/sw.js` rather than written here,
 * so bumping `CACHE_SCHEMA_VERSION` moves this seed with it instead of leaving
 * a marker the real worker no longer writes.
 */
const migrationMarker = () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/sw.js'), 'utf8');
  const version = source.match(/CACHE_SCHEMA_VERSION\s*=\s*(\d+)\s*;/)?.[1];
  assert.ok(version, 'could not read CACHE_SCHEMA_VERSION out of src/sw.js');
  return `${ORIGIN}/schema-v${version}`;
};

/** What an authenticated session leaves behind, cache by cache. */
const SEEDED_ENTRIES = {
  'api-cache': [`${ORIGIN}/statuses`],
  'image-cache': [`${ORIGIN}/img/logo.png`],
  'font-cache': [`${ORIGIN}/fonts/roboto-latin.woff2`],
  'static-resources': [`${ORIGIN}/assets/app-1.js`],
  // The migration marker `src/sw.js` writes on the first activation.
  'sw-migrations': [migrationMarker()],
  [PRECACHE]: [`${ORIGIN}/`, `${ORIGIN}/assets/index-abc123.js`],
};

const SEEDED_STORAGE = {
  user_data: '{"id":7,"username":"auditor","email":"auditor@example.invalid"}',
  authToken: 'session-token',
  contentCalendarData: '[{"id":1,"customer":"Customer Name"}]',
  ideasNotesData: '{"ideas":"Customer follow-up"}',
};

/** One pending offline mutation, in the shape `src/api.js` writes it. */
const SEEDED_SYNC_QUEUE = [
  {
    url: '/api/shipments',
    method: 'POST',
    data: { id: 'GR-1001', recipient: 'Recipient Name', phone: '+1-555-0100' },
    headers: { Authorization: 'Bearer session-token' },
  },
];

/** A cache this application does not own: another library writing under this origin. */
const FOREIGN_CACHE = 'some-other-library-cache';

const scenario = (fetch) => ({
  origin: ORIGIN,
  fetch,
  seed: {
    localStorage: SEEDED_STORAGE,
    sessionStorage: { app_opened: 'true' },
    syncQueue: SEEDED_SYNC_QUEUE,
    cacheEntries: SEEDED_ENTRIES,
  },
});

/**
 * Boots the real logout path against one scenario and returns its report. One
 * process per boot, so each starts from empty storage and a pristine copy of
 * the modules mirrored out of `src/`.
 */
function logout(fetch, buildScenario = scenario) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logout-purge-'));
  const scenarioPath = path.join(directory, 'scenario.json');
  const mirror = path.join(ROOT, 'node_modules', '.cache', 'logout-purge-mirror');

  try {
    fs.writeFileSync(scenarioPath, JSON.stringify(buildScenario(fetch)));

    const child = spawnSync(process.execPath, [HARNESS, scenarioPath, ROOT], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });

    assert.strictEqual(child.status, 0, `logout run exited ${child.status}: ${child.stderr}`);

    const report = child.stdout
      .split('\n')
      .filter((line) => line.startsWith('__RESULT__'))
      .pop();
    assert.ok(report, `logout run produced no report: ${child.stdout.slice(0, 2000)}`);

    const parsed = JSON.parse(report.slice('__RESULT__'.length));
    assert.equal(parsed.harnessError, undefined, `the harness itself failed: ${parsed.harnessError}`);
    return parsed;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(mirror, { recursive: true, force: true });
  }
}

const entriesIn = (report, cacheName) => report.caches[cacheName];
const deleted = (report, cacheName) => report.operations.some((operation) => operation.action === 'delete-cache' && operation.cache === cacheName);

// ---------------------------------------------------------------------------
// The success path
// ---------------------------------------------------------------------------

test('a completed logout clears every application cache and keeps the precache that boots the PWA offline', () => {
  const report = logout({ status: 200 });

  assert.equal(report.logoutError, null, 'a successful logout must not reject');

  // Not vacuous: this seeds exactly the caches the purge enumerates plus the
  // precache, so "every cache is gone" below is a decision about caches that
  // were really there rather than a boot that seeded nothing.
  assert.deepStrictEqual(
    Object.keys(report.seeded.cacheEntries).sort(),
    [...APP_CACHE_NAMES, PRECACHE].sort(),
    'SEEDED_ENTRIES and APP_CACHE_NAMES have drifted apart - the test must seed every cache the purge enumerates, and only that set plus the precache',
  );

  for (const name of APP_CACHE_NAMES) {
    assert.ok(
      report.seeded.cacheEntries[name]?.length,
      `${name} was seeded with no entries, so asserting it is gone proves nothing`,
    );
    assert.equal(
      entriesIn(report, name),
      undefined,
      `${name} still exists after logout: it held ${JSON.stringify(report.seeded.cacheEntries[name])}`,
    );
    assert.ok(deleted(report, name), `${name} was never deleted, so whatever it held is still on disk`);
  }

  // The one cache family that has to survive, entries included.
  assert.deepStrictEqual(
    entriesIn(report, PRECACHE),
    SEEDED_ENTRIES[PRECACHE],
    'the workbox precache was not left intact, so the PWA cannot boot offline after a logout',
  );
  assert.ok(!deleted(report, PRECACHE), 'the precache was deleted outright');
  assert.ok(
    !APP_CACHE_NAMES.some((name) => name.startsWith(WORKBOX_PRECACHE_PREFIX)),
    'the purge must not enumerate a cache it is supposed to preserve',
  );

  // The rest of the post-state: Web Storage, the offline queue, and the call
  // that has to have ended the session on the server before any of it is wiped.
  assert.deepStrictEqual(
    report.fetchCalls,
    [{ url: '/api/auth/logout', method: 'POST', credentials: 'include' }],
    'logout did not end the session on the server, so the local purge erased data over a live cookie',
  );

  assert.deepStrictEqual(
    Object.keys(report.seeded.localStorage).sort(),
    Object.keys(SEEDED_STORAGE).sort(),
    'the run did not seed the localStorage keys this test asserts about',
  );
  assert.deepStrictEqual(report.localStorage, {}, 'localStorage still holds keys after a successful logout');
  assert.deepStrictEqual(report.sessionStorage, {}, 'sessionStorage still holds keys after a successful logout');

  assert.equal(report.seeded.syncQueue.length, 1, 'the pending offline mutation was not seeded');
  assert.deepStrictEqual(report.syncQueue, [], 'the pending offline queue survived the logout');
});

test('the purge is scoped by name, so a cache this application does not own is left alone', () => {
  // "Delete every cache under this origin except the precache" is the tempting
  // simplification, and it would break a library that also caches here. The
  // purge enumerates what the service worker owns and nothing else.
  const report = logout({ status: 200 }, (fetch) => {
    const seeded = scenario(fetch);
    seeded.seed.cacheEntries = {
      ...SEEDED_ENTRIES,
      [FOREIGN_CACHE]: [`${ORIGIN}/third-party/thing.json`],
    };
    return seeded;
  });

  assert.ok(
    report.seeded.cacheEntries[FOREIGN_CACHE]?.length,
    'the foreign cache was not seeded, so asserting it survives proves nothing',
  );
  assert.ok(!deleted(report, FOREIGN_CACHE), 'the purge deleted a cache this application does not own');
  assert.deepStrictEqual(
    entriesIn(report, FOREIGN_CACHE),
    [`${ORIGIN}/third-party/thing.json`],
    'a cache the service worker does not write did not survive the logout',
  );

  // Not vacuous: the same boot still cleared everything this app does own.
  for (const name of APP_CACHE_NAMES) {
    assert.equal(entriesIn(report, name), undefined, `${name} survived the boot that also seeded a foreign cache`);
  }
});

test('the logout purge re-arms the schema migration for the next activation', () => {
  // `src/sw.js` records the migration in `sw-migrations` and runs the legacy
  // purge only when the marker for the current schema version is missing.
  // Clearing the cache with the rest of the purge means the next activation
  // migrates again, so the marker cannot outlive the purge it describes.
  const report = logout({ status: 200 });

  assert.ok(
    report.seeded.cacheEntries['sw-migrations'],
    'the migration marker cache was not seeded, so this proves nothing',
  );
  assert.equal(entriesIn(report, 'sw-migrations'), undefined, 'the migration marker survived the logout purge');
  assert.ok(deleted(report, 'sw-migrations'), 'the migration marker cache was never deleted');
});

// ---------------------------------------------------------------------------
// The failed-server-logout path
// ---------------------------------------------------------------------------

/** What must be untouched when the server did not end the session. */
const assertNothingWasErased = (report) => {
  assert.deepStrictEqual(report.caches, report.seeded.cacheEntries, 'a failed logout still changed Cache Storage');
  assert.deepStrictEqual(
    report.operations.filter((operation) => operation.action === 'delete-cache'),
    [],
    'a failed logout still deleted a cache',
  );
  assert.deepStrictEqual(report.localStorage, SEEDED_STORAGE, 'a failed logout still erased localStorage');
  assert.deepStrictEqual(report.sessionStorage, { app_opened: 'true' }, 'a failed logout still erased sessionStorage');
  assert.deepStrictEqual(report.syncQueue, report.seeded.syncQueue, 'a failed logout still dropped the offline queue');
};

test('a logout the server never received leaves the session and the device alone', () => {
  const report = logout({ networkError: true });

  assert.match(
    report.logoutError ?? '',
    /could not be reached/,
    'the failure was not surfaced to the caller, so nothing told the user they are still signed in',
  );
  assertNothingWasErased(report);
});

test('a server that refuses the logout does not present a logged-out state', () => {
  const report = logout({ status: 500 });

  assert.match(report.logoutError ?? '', /\(500\)/, 'the 500 was swallowed instead of surfaced');
  assertNothingWasErased(report);
});

test('a 401 from the logout endpoint is reconciled: there is no session left, so the purge runs', () => {
  // 401 is the server stating the session is already gone. Purging is then the
  // correct outcome; treating it as "the logout failed" would strand a user
  // whose cookie is dead on a page that still looks signed in.
  const report = logout({ status: 401 });

  assert.equal(report.logoutError, null, 'a 401 must be reconciled, not surfaced as a failure');

  for (const name of APP_CACHE_NAMES) {
    assert.equal(entriesIn(report, name), undefined, `${name} survived a logout the server confirmed was final`);
  }
  assert.deepStrictEqual(entriesIn(report, PRECACHE), SEEDED_ENTRIES[PRECACHE], 'the precache was not preserved');
  assert.deepStrictEqual(report.syncQueue, [], 'the offline queue survived the reconciled logout');
});

// ---------------------------------------------------------------------------
// The enumeration
// ---------------------------------------------------------------------------

test('the purge names every cache the service worker names', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/sw.js'), 'utf8');

  // Every `cacheName:` a workbox strategy is configured with, and every
  // `const ..._CACHE_NAME = '...'` the worker opens by hand.
  const declared = [
    ...[...source.matchAll(/cacheName:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
    ...[...source.matchAll(/const\s+\w*CACHE_NAME\w*\s*=\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
  ];

  assert.ok(
    declared.length >= APP_CACHE_NAMES.length,
    `src/sw.js declared ${declared.length} caches (${JSON.stringify(declared)}); expected at least ${APP_CACHE_NAMES.length}`,
  );

  for (const name of declared) {
    assert.ok(
      APP_CACHE_NAMES.includes(name),
      `src/sw.js writes a cache called ${name} that the logout purge does not clear - add it to APP_CACHE_NAMES in src/utils/cachePurge.js`,
    );
  }

  for (const name of APP_CACHE_NAMES) {
    assert.ok(
      declared.includes(name),
      `the purge clears ${name}, which src/sw.js does not name - a cache deleted that the worker never wrote, or a name that has drifted`,
    );
  }
});

