/**
 * Contract for the offline queue: what happens to a mutation the device cannot send,
 * and what happens to it when the connection comes back.
 *
 * Nothing here is a stand-in for the code under test. Each boot spawns
 * `test/security/offlineQueueHarness.mjs`, which mirrors the real modules out of `src/`
 * - `api.js`, `utils/offlineStorage.js`, `utils/syncQueue.js`,
 * `components/OfflineIndicator.jsx` - into `node_modules/.cache/offline-queue-mirror/`
 * and runs them against a fake browser: a `window` that dispatches real events, the
 * `navigator.onLine` flag `api.js` reads, Web Storage, and a fake IndexedDB the real
 * `idb` package drives. The only faked boundary is the network, recorded on the real
 * axios instance's adapter - the transport every request `src/api.js` sends goes
 * through - so what the report shows is the request the interceptors actually built,
 * and the queue is read back through the real storage module rather than asserted by
 * copy.
 *
 * The scenarios below are the user's: go offline, upload a file, come back. The
 * assertions are on post-state - what reached the transport, what is left in the queue,
 * what the user was told, and what the indicator renders - not on the shape of the code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_SYNC_ATTEMPTS } from '../../src/utils/offlineStorage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = path.join(ROOT, 'test', 'security', 'offlineQueueHarness.mjs');

const SERVER_ERROR = { transport: { status: 500 } };

/**
 * The upload `Home.jsx` and `PaymentProcessing.jsx` make: an .xlsx under `POST /upload`.
 * The bytes are readable here so the test can prove the queued copy is the same file
 * rather than a placeholder that happens to have the right field name.
 */
const UPLOAD = {
  filename: 'bookings.xlsx',
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const rows = 'GR-1001,Recipient Name,+1-555-0100\nGR-1002,Other Recipient,+1-555-0101\n';

const formDataStep = {
  do: 'request',
  method: 'post',
  url: '/upload',
  headers: {
    'Content-Type': 'multipart/form-data',
    // The queue sanitizes credentials out of a stored entry, so the request carries
    // one: a test that sends nothing cannot tell whether it is stripped or unused.
    Authorization: 'Bearer session-token',
  },
  formData: [
    { name: 'file', file: { ...UPLOAD, data: Buffer.from(rows, 'utf8').toString('base64') } },
    { name: 'note', value: 'monthly import' },
  ],
};

const decoded = (base64) => Buffer.from(base64, 'base64').toString('utf8');

/** A field of a stored or sent multipart body, so name, type and bytes are all checked. */
const field = (fields, name) => {
  const found = fields.find((entry) => entry.name === name);
  assert.ok(found, `the "${name}" field is missing from ${JSON.stringify(fields)}`);
  return found;
};

/** Performs `steps` against the shipped modules and reports what they did. */
function run(steps, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-queue-'));
  const scenarioPath = path.join(directory, 'scenario.json');
  const mirror = path.join(ROOT, 'node_modules', '.cache', 'offline-queue-mirror');

  try {
    fs.writeFileSync(scenarioPath, JSON.stringify({ online: false, ...options, steps }));

    const child = spawnSync(process.execPath, [HARNESS, scenarioPath, ROOT], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });

    assert.strictEqual(child.status, 0, `queue run exited ${child.status}: ${child.stderr}`);

    const report = JSON.parse(
      child.stdout
        .split('\n')
        .filter((line) => line.startsWith('__RESULT__'))
        .pop()
        .slice('__RESULT__'.length),
    );
    assert.equal(report.harnessError, null, `the harness itself failed: ${report.harnessError}`);
    return report;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(mirror, { recursive: true, force: true });
  }
}

const last = (report) => report.snapshots[report.snapshots.length - 1];
const after = (report, doStep) => report.snapshots.filter((snapshot) => snapshot.do === doStep).pop();

const callResult = (report) => {
  const [rejected] = report.rejections;
  assert.ok(rejected, 'the api call produced no result at all');
  return rejected;
};

const queuedEntry = (report) => {
  const entry = last(report).queue[0];
  assert.ok(entry, 'nothing is in the offline queue, so there is no queued change to assert about');
  return entry;
};

const offlineNote = { do: 'request', method: 'post', url: '/api/notes', data: { title: 'quarterly summary' } };
const reconnect = { do: 'event', name: 'online' };
const pastTheBackoff = { do: 'advance', ms: 200000 };

/**
 * One queued note against a server that rejects it, reconnected five times with the
 * clock moved past each backoff, then reconnected once more to prove the entry is spent.
 */
const exhaustedSteps = [
  { do: 'online', value: false },
  offlineNote,
  { do: 'attach-engine' },
  { do: 'online', value: true },
  reconnect,
  // Still inside the backoff of the first attempt: the queue must not be hammered.
  { do: 'flush' },
  pastTheBackoff,
  reconnect,
  pastTheBackoff,
  reconnect,
  pastTheBackoff,
  reconnect,
  pastTheBackoff,
  reconnect,
  { do: 'render' },
  pastTheBackoff,
  reconnect,
];

// ---------------------------------------------------------------------------
// Queueing an upload while offline
// ---------------------------------------------------------------------------

test('an offline upload is stored in a form the queue can hold, and is not sent', () => {
  const report = run([{ do: 'online', value: false }, formDataStep]);

  const rejected = callResult(report);
  assert.equal(rejected.isQueued, true, 'the upload was not reported as queued');
  assert.match(
    rejected.message,
    /saved locally and will sync when you are back online/,
    'the user was not told the change is waiting for the connection',
  );

  // Not vacuous: the same upload is sent by the reconnect test below, so an empty
  // transport list here is a decision and not a run that could never send anything.
  assert.deepStrictEqual(report.requests, [], 'the upload was sent while the device is offline');

  const entry = queuedEntry(report);
  assert.equal(entry.url, '/upload');
  assert.equal(entry.method, 'post');
  assert.equal(entry.attempts, 0, 'a newly queued change must not start life with spent attempts');

  // FormData is not structured-cloneable. It is stored as its fields instead, and the
  // file is the same file: an entry that could not rebuild this body would replay a
  // redacted placeholder at the API.
  const fields = entry.data?.__offlineFormData;
  assert.ok(Array.isArray(fields), `the queued payload is not a stored form: ${JSON.stringify(entry.data)}`);
  assert.deepStrictEqual(
    [field(fields, 'file').filename, field(fields, 'file').type],
    [UPLOAD.filename, UPLOAD.type],
    'the queued upload lost its file name or type',
  );
  assert.equal(decoded(field(fields, 'file').data), rows, 'the queued file is not the file that was uploaded');
  assert.equal(field(fields, 'note').value, 'monthly import', 'the queued upload lost its other field');

  assert.equal(entry.headers.Authorization, undefined, 'the queue persisted the bearer token to disk');
});

test('a queued change announces itself to the application', () => {
  // The indicator is mounted, so the engine that drives it is listening: the count the
  // user is shown comes from the event the queue dispatches, not from a re-read.
  const report = run([{ do: 'online', value: false }, { do: 'attach-engine' }, formDataStep]);

  assert.ok(
    report.events.some((event) => event.type === 'sync-queue-updated'),
    `the queue was updated but no event announced it: ${JSON.stringify(report.events)}`,
  );
  assert.equal(last(report).state.pending, 1, 'the published pending count does not match the queue');
});

// ---------------------------------------------------------------------------
// The promise on the queue: reconnect sends it
// ---------------------------------------------------------------------------

test('reconnecting replays the queued upload as the request it was', () => {
  const report = run([
    { do: 'online', value: false },
    formDataStep,
    { do: 'attach-engine' },
    { do: 'online', value: true },
    reconnect,
  ]);

  assert.deepStrictEqual(
    report.requests.map(({ method, url, body }) => ({ method, url, kind: body.kind })),
    [{ method: 'post', url: '/upload', kind: 'form-data' }],
    'the reconnect did not send the queued upload, so "will sync when you are back online" is still false',
  );

  const [request] = report.requests;
  assert.equal(request.syncRequest, true, 'the replay must bypass the offline interceptor that queued it');
  assert.deepStrictEqual(
    [field(request.body.entries, 'file').filename, field(request.body.entries, 'file').type],
    [UPLOAD.filename, UPLOAD.type],
    'the replayed upload lost its file name or type',
  );
  assert.equal(decoded(field(request.body.entries, 'file').data), rows, 'the replayed file lost its contents on the way out');
  assert.equal(field(request.body.entries, 'note').value, 'monthly import', 'the replayed upload lost its other field');

  assert.deepStrictEqual(last(report).queue, [], 'the queued upload survived its own replay');
  assert.equal(last(report).state.pending, 0, 'the indicator would still be counting a change that was sent');
});

// ---------------------------------------------------------------------------
// A payload the queue cannot hold
// ---------------------------------------------------------------------------

test('a change the queue cannot hold is refused instead of lost, and the user is told why', () => {
  const report = run([
    { do: 'online', value: false },
    { do: 'request', method: 'post', url: '/api/notes', data: { title: 'quarterly' }, unclonable: true },
  ]);

  assert.deepStrictEqual(
    report.requests,
    [],
    'the change was sent while the device is offline, which is the failure that used to lose it',
  );

  const rejected = callResult(report);
  assert.equal(rejected.isUnqueued, true, 'the change was not reported as unqueued, so the caller cannot tell');
  assert.notEqual(rejected.isQueued, true, 'an unqueued change must not also claim to be queued');
  assert.match(rejected.message, /could not be saved on this device/, 'the user was not told why it was refused');
  assert.match(rejected.message, /was not sent/, 'the message did not say the change never left the device');
  assert.doesNotMatch(
    rejected.message,
    /will sync/,
    'the message promised a sync for a change that is not in the queue',
  );

  assert.deepStrictEqual(last(report).queue, [], 'a refused change still occupies a slot in the queue');
});

// ---------------------------------------------------------------------------
// A queue entry that can never succeed
// ---------------------------------------------------------------------------

test('an entry that keeps failing stops after the attempt cap instead of retrying forever', () => {
  const report = run(exhaustedSteps, SERVER_ERROR);

  const insideBackoff = after(report, 'flush');
  assert.equal(insideBackoff.requests.length, 1, 'a second attempt went out while the first was still backing off');

  const spent = after(report, 'render');
  assert.equal(
    spent.requests.length,
    MAX_SYNC_ATTEMPTS,
    `expected ${MAX_SYNC_ATTEMPTS} attempts and no more, got ${spent.requests.length}`,
  );
  for (const request of spent.requests) {
    assert.equal(request.url, '/api/notes', 'the replay sent something other than the queued change');
  }

  // The change is not dropped (dropping it is the other way to lose it), and it is
  // marked spent so nothing tries it again.
  const entry = spent.queue[0];
  assert.ok(entry, 'the failed change vanished from the queue rather than being reported');
  assert.equal(entry.failed, true, 'the entry was left looking pending after it had spent its attempts');
  assert.equal(entry.attempts, MAX_SYNC_ATTEMPTS, 'the attempt count does not match the attempts that were made');
  assert.match(String(entry.lastError), /500/, 'the failure reason was not recorded for the user');

  // One more reconnect after the cap: the entry is spent, not merely unlucky.
  assert.equal(last(report).requests.length, MAX_SYNC_ATTEMPTS, 'a spent entry was retried again');
  assert.equal(last(report).state.failures.length, 1, 'the spent entry is not surfaced to the user');
  assert.equal(last(report).state.pending, 0, 'the spent entry is still counted as pending');
});

test('a spent entry is shown to the user, not just logged', () => {
  const report = run(exhaustedSteps, SERVER_ERROR);

  const markup = after(report, 'render').markup;
  assert.ok(markup, 'the indicator rendered nothing, so the user sees no failure at all');
  assert.match(markup, /POST \/api\/notes/, 'the rendered failure does not say which change was lost');
  assert.match(markup, /1 change could not be sent/, 'the rendered failure does not say what happened');
  assert.match(markup, /has not reached the server/, 'the rendered failure does not say the change never sent');
  assert.match(markup, /Retry now/, 'the rendered failure offers the user no way forward');
});

test('the user can put a spent entry back into play', () => {
  const report = run([{ do: 'online', value: true }, { do: 'retry-failed' }], {
    seed: {
      queue: [
        {
          url: '/api/notes',
          method: 'post',
          data: { title: 'quarterly summary' },
          params: null,
          headers: {},
          timestamp: 0,
          attempts: MAX_SYNC_ATTEMPTS,
          lastAttemptAt: 0,
          lastError: 'the server answered 500',
          failed: true,
        },
      ],
    },
  });

  const seeded = report.snapshots[0];
  assert.equal(seeded.state.failures.length, 1, 'a spent entry is not surfaced before anything tries it again');

  assert.deepStrictEqual(
    report.requests.map(({ method, url, body }) => ({ method, url, body: body.value })),
    [{ method: 'post', url: '/api/notes', body: { title: 'quarterly summary' } }],
    'retrying a spent entry did not send it, or sent it as something else',
  );
  assert.deepStrictEqual(last(report).queue, [], 'the entry the user retried was not removed after it sent');
  assert.equal(last(report).state.failures.length, 0, 'the indicator still reports a failure that was resolved');
});
