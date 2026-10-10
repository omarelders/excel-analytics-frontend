/**
 * Boots a real service worker module inside a Node process and replays a scripted
 * scenario against it, so `test/security/service_worker.test.mjs` can assert on
 * what the worker this app ships actually does.
 *
 * This file is a stand-in for the browser, not for the worker under test. It
 * provides:
 *
 * - a `self` that records the event listeners the worker registers,
 * - `caches` and a fake IndexedDB that store what they are handed and return it,
 * - a `fetch` that answers from the scenario's canned response list,
 *
 * and then dispatches real `FetchEvent` / `ActivateEvent` objects through the
 * listeners the worker registered. Nothing here decides whether a response is
 * cacheable, which route owns a request, or when a cache may be emptied: those
 * decisions are made by the workbox modules the worker imports (the router, the
 * strategies, the cacheable-response and expiration plugins) and by `src/sw.js`
 * itself. The one deliberate emulation is `OpaqueResponse`, because Node's
 * `Response` constructor refuses the status 0 a browser produces for a
 * cross-origin `no-cors` reply.
 *
 * Run it as a child process - one process per boot - so every scenario starts
 * from workbox's pristine module state: `registerRoute` appends to a singleton
 * router, which two boots in one process would otherwise share.
 *
 * Usage: node test/security/serviceWorkerHarness.mjs <scenario.json> <entry file>
 * Output: a JSON report on the final line, prefixed with `__RESULT__`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [scenarioPath, entryPath] = process.argv.slice(2);
const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));

const ORIGIN = scenario.origin ?? 'https://goldroad.invalid';
const SCOPE = scenario.scope ?? `${ORIGIN}/`;

/** Which step the harness is running, for correlating cache writes with it. */
let currentStep = 'boot';

// ---------------------------------------------------------------------------
// Cache Storage
// ---------------------------------------------------------------------------

const EMPTY_BODY = '';

class FakeCache {
  constructor(name, store) {
    this.name = name;
    this._store = store;
  }

  async put(request, response) {
    const url = typeof request === 'string' ? new URL(request, SCOPE).href : request.url;
    const entry = {
      url,
      status: response.status,
      type: response.type,
      contentType: response.headers.get('content-type'),
      body: await response.text(),
    };
    log('put', this.name, url);
    this._store.set(url, entry);
  }

  async match(request) {
    const url = typeof request === 'string' ? new URL(request, SCOPE).href : request.url;
    const entry = this._store.get(url);
    if (!entry) {
      return undefined;
    }
    return new Response(entry.body === EMPTY_BODY ? null : entry.body, {
      status: entry.status,
      headers: { 'content-type': entry.contentType ?? 'text/plain' },
    });
  }

  async delete(request) {
    const url = typeof request === 'string' ? new URL(request, SCOPE).href : request.url;
    const existed = this._store.delete(url);
    if (existed) {
      log('delete-entry', this.name, url);
    }
    return existed;
  }

  async keys() {
    return [...this._store.keys()].map((url) => new Request(url));
  }
}

const cacheStores = new Map();
const cacheOperations = [];

function log(action, cache, url) {
  cacheOperations.push({ step: currentStep, action, cache, url });
}

const storeFor = (name) => {
  if (!cacheStores.has(name)) {
    cacheStores.set(name, new Map());
  }
  return cacheStores.get(name);
};

const caches = {
  async open(name) {
    log('open', name);
    return new FakeCache(name, storeFor(name));
  },
  async keys() {
    return [...cacheStores.keys()];
  },
  async has(name) {
    return cacheStores.has(name);
  },
  async delete(name) {
    log('delete-cache', name);
    return cacheStores.delete(name);
  },
  async match(request, options) {
    const names = options?.cacheName ? [options.cacheName] : [...cacheStores.keys()];
    for (const name of names) {
      const response = await new FakeCache(name, storeFor(name)).match(request);
      if (response) {
        return response;
      }
    }
    return undefined;
  },
};

const snapshotCaches = () =>
  Object.fromEntries(
    [...cacheStores.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, entries]) => [name, [...entries.values()]]),
  );

// ---------------------------------------------------------------------------
// IndexedDB
//
// workbox-expiration keeps its timestamps here. This is a stand-in for browser
// storage: it holds rows in a Map and hands them back. It decides nothing about
// which entry is the oldest or when a cache overflows - the real
// CacheTimestampsModel and CacheExpiration code runs against it.
// ---------------------------------------------------------------------------

class FakeIDBRequest extends EventTarget {
  constructor() {
    super();
    this.result = undefined;
    this.error = undefined;
  }

  _succeed(result) {
    this.result = result;
    this.dispatchEvent(new Event('success'));
  }

  _fail(error) {
    this.error = error;
    this.dispatchEvent(new Event('error'));
  }
}

class IDBCursor {
  constructor(rows, position, request) {
    this._rows = rows;
    this._position = position;
    this._request = request;
  }

  get value() {
    return this._rows[this._position];
  }

  get key() {
    return this._rows[this._position]?.id;
  }

  /** Answers the next row on the same request, or `null` past the last one. */
  continue() {
    // Real IDB answers a continue on a later task, so the caller has a chance to
    // attach its listener to this request before the result arrives.
    const position = this._position + 1;
    queueMicrotask(() => {
      if (position >= this._rows.length) {
        this._request._succeed(null);
        return;
      }
      this._request._succeed(new IDBCursor(this._rows, position, this._request));
    });
    return undefined;
  }
}

class IDBIndex {
  constructor(store, name, keyPath) {
    this.name = name;
    this.store = store;
    this.keyPath = keyPath;
  }

  /** Rows in (index value, primary key) order; `prev` reverses that. */
  rows(direction) {
    const rows = [...this.store.records.values()].sort((left, right) => {
      const byIndex = left[this.keyPath] < right[this.keyPath] ? -1 : left[this.keyPath] > right[this.keyPath] ? 1 : 0;
      return byIndex !== 0 ? byIndex : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
    return direction === 'prev' ? rows.reverse() : rows;
  }

  openCursor(range = null, direction = 'next') {
    const request = new FakeIDBRequest();
    const rows = this.rows(direction);
    queueMicrotask(() => {
      request._succeed(rows.length ? new IDBCursor(rows, 0, request) : null);
    });
    return request;
  }

  async get(key) {
    return this.rows('next').find((row) => row[this.keyPath] === key);
  }
}

class IDBObjectStore {
  constructor(database, name, options) {
    this.name = name;
    this.database = database;
    this.keyPath = options?.keyPath;
    this.indexNames = [];
    this.records = new Map();
    this._indexes = new Map();
    database._stores.set(name, this);
  }

  createIndex(name, keyPath) {
    this._indexes.set(name, new IDBIndex(this, name, keyPath));
    this.indexNames = [...this._indexes.keys()];
    return this._indexes.get(name);
  }

  index(name) {
    const index = this._indexes.get(name);
    if (!index) {
      throw new Error(`no index named ${name}`);
    }
    return index;
  }

  _request(value) {
    const request = new FakeIDBRequest();
    queueMicrotask(() => request._succeed(value));
    return request;
  }

  get(key) {
    return this._request(this.records.get(key));
  }

  getAll() {
    return this._request([...this.records.values()]);
  }

  count() {
    return this._request(this.records.size);
  }

  put(value) {
    return this._commit(value, () => this.records.set(value[this.keyPath], value));
  }

  delete(key) {
    return this._commit(undefined, () => this.records.delete(key));
  }

  clear() {
    return this._commit(undefined, () => this.records.clear());
  }

  _commit(value, apply) {
    const request = new FakeIDBRequest();
    queueMicrotask(() => {
      apply();
      request._succeed(value);
    });
    return request;
  }
}

class IDBTransaction extends EventTarget {
  constructor(database, storeNames) {
    super();
    this.database = database;
    this.storeNames = storeNames;
  }

  objectStore(name) {
    const store = this.database._stores.get(name);
    if (!store) {
      throw new Error(`no object store named ${name}`);
    }
    return store;
  }

  /**
   * A transaction commits once the microtasks it started have run, so `done`
   * resolves on the next macrotask rather than at creation.
   */
  settle() {
    if (this._settled) {
      return;
    }
    this._settled = true;
    setTimeout(() => this.dispatchEvent(new Event('complete')), 0);
  }
}

class IDBDatabase extends EventTarget {
  constructor(name, version) {
    super();
    this.name = name;
    this.version = version;
    this._stores = new Map();
  }

  get objectStoreNames() {
    return [...this._stores.keys()];
  }

  createObjectStore(name, options = {}) {
    return new IDBObjectStore(this, name, options);
  }

  transaction(storeNames, mode = 'readonly') {
    const transaction = new IDBTransaction(this, Array.isArray(storeNames) ? storeNames : [storeNames]);
    transaction.settle();
    return transaction;
  }
}

const databases = new Map();

const fakeIndexedDB = {
  open(name, version = 1) {
    const request = new FakeIDBRequest();
    let database = databases.get(name);
    let upgrade = false;
    if (!database) {
      database = new IDBDatabase(name, version);
      databases.set(name, database);
      upgrade = true;
    } else if (database.version < version) {
      database.version = version;
      upgrade = true;
    }

    queueMicrotask(() => {
      if (upgrade) {
        request.result = database;
        request.transaction = database.transaction([], 'versionchange');
        request.dispatchEvent(new Event('upgradeneeded'));
      }
      request.result = database;
      request._succeed(database);
    });
    return request;
  },
  deleteDatabase(name) {
    const request = new FakeIDBRequest();
    queueMicrotask(() => {
      databases.delete(name);
      request._succeed(undefined);
    });
    return request;
  },
};

Object.assign(globalThis, {
  IDBRequest: FakeIDBRequest,
  IDBCursor,
  IDBIndex,
  IDBObjectStore,
  IDBTransaction,
  IDBDatabase,
});

// ---------------------------------------------------------------------------
// The ServiceWorkerGlobalScope
// ---------------------------------------------------------------------------

const listeners = new Map();
const skipWaitingCalls = [];

const location = {
  href: SCOPE,
  origin: ORIGIN,
  protocol: `${new URL(SCOPE).protocol}:`,
  host: new URL(SCOPE).host,
  hostname: new URL(SCOPE).hostname,
  pathname: '/',
  toString() {
    return this.href;
  },
};
const registration = { scope: SCOPE };

const harnessSelf = {
  addEventListener(type, callback) {
    if (!listeners.has(type)) {
      listeners.set(type, new Set());
    }
    listeners.get(type).add(callback);
  },
  removeEventListener(type, callback) {
    listeners.get(type)?.delete(callback);
  },
  skipWaiting() {
    skipWaitingCalls.push(currentStep);
  },
  clients: { claim: async () => {} },
  location,
  registration,
  caches,
  // What the build injects into src/sw.js; an empty list means "precache nothing".
  __WB_MANIFEST: [],
};

Object.assign(globalThis, {
  self: harnessSelf,
  location,
  registration,
  caches,
  indexedDB: fakeIndexedDB,
  addEventListener: (type, callback) => harnessSelf.addEventListener(type, callback),
  removeEventListener: (type, callback) => harnessSelf.removeEventListener(type, callback),
  skipWaiting: () => harnessSelf.skipWaiting(),
});

// ---------------------------------------------------------------------------
// Canned responses
// ---------------------------------------------------------------------------

/**
 * What a browser hands back for a cross-origin `no-cors` fetch: status 0, type
 * 'opaque', no readable headers or body. Node refuses to construct a Response
 * like that, so the accessors are overridden - `clone()` too, because the spec
 * keeps the type and status across a clone.
 */
class OpaqueResponse extends Response {
  get status() {
    return 0;
  }

  get type() {
    return 'opaque';
  }

  clone() {
    return new OpaqueResponse();
  }
}

const cannedResponses = new Map();
for (const canned of scenario.responses ?? []) {
  cannedResponses.set(canned.url, canned);
}

const materializeResponse = (canned) => {
  const headers = { 'content-type': canned.contentType ?? 'text/plain', ...(canned.headers ?? {}) };
  if (canned.opaque) {
    return new OpaqueResponse(EMPTY_BODY, { status: 200, headers: { 'content-type': headers['content-type'] } });
  }
  return new Response(canned.body ?? EMPTY_BODY, { status: canned.status ?? 200, headers });
};

// A stand-in for the network: it answers from the scenario's canned responses and
// refuses - like a browser that cannot reach the origin - anything unlisted.
// Every attempt is recorded, so the test can prove the worker never reaches for a
// cross-origin resource: the CSP this app ships allows `connect-src 'self'` only.
const fetchCalls = [];

globalThis.fetch = async (request) => {
  const url = typeof request === 'string' ? request : request.url;
  fetchCalls.push({ step: currentStep, url });
  const canned = cannedResponses.get(url);
  if (!canned) {
    throw new TypeError(`fetch failed: no canned response for ${url}`);
  }
  return materializeResponse(canned);
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

class FakeExtendableEvent extends EventTarget {
  constructor(type) {
    super();
    this.type = type;
    this.pending = [];
  }

  waitUntil(promise) {
    this.pending.push(promise);
  }
}

class FakeFetchEvent extends FakeExtendableEvent {
  constructor(type, { request }) {
    super(type);
    this.request = request;
    this.respondWithCalled = false;
    this.responded = undefined;
  }

  respondWith(promise) {
    this.respondWithCalled = true;
    this.responded = promise;
  }
}

globalThis.ExtendableEvent = FakeExtendableEvent;
globalThis.FetchEvent = FakeFetchEvent;

// ---------------------------------------------------------------------------
// Requests, seeding and dispatching
// ---------------------------------------------------------------------------

const makeRequest = ({ url, method = 'GET', destination = '' }) => {
  const request = new Request(url, { method });
  // Node's Request has no notion of a destination; the worker's routes match on
  // it, so it is attached the way the browser would have set it.
  Object.defineProperty(request, 'destination', { value: destination, configurable: true });
  return request;
};

const seedCaches = async () => {
  for (const seed of scenario.seed ?? []) {
    const cache = await caches.open(seed.cache);
    for (const entry of seed.entries ?? []) {
      await cache.put(new Request(entry.url), materializeResponse(entry));
    }
  }
};

const emit = async (type, event) => {
  for (const callback of [...(listeners.get(type) ?? [])]) {
    callback(event);
  }
  await Promise.allSettled(event.pending);
};

const describeResponse = async (response) => {
  let body = null;
  try {
    body = await response.text();
  } catch {
    body = null;
  }
  return { status: response.status, type: response.type, body };
};

const runStep = async (step) => {
  currentStep = `${step.kind}:${step.url ?? ''}`;
  if (step.kind === 'fetch') {
    const event = new FakeFetchEvent('fetch', { request: makeRequest(step) });
    await emit('fetch', event);
    const record = { ...step, handled: event.respondWithCalled };
    if (event.respondWithCalled) {
      try {
        record.response = await describeResponse(await event.responded);
      } catch (error) {
        record.error = String(error?.message ?? error);
      }
    }
    return record;
  }
  if (step.kind === 'activate') {
    const event = new FakeFetchEvent('activate', { request: new Request(SCOPE, { method: 'GET' }) });
    await emit('activate', event);
    return { ...step, handled: (listeners.get('activate')?.size ?? 0) > 0 };
  }
  throw new Error(`unknown step kind: ${step.kind}`);
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const steps = [];
const unhandled = [];
process.on('unhandledRejection', (error) => unhandled.push(String(error?.message ?? error)));

try {
  await seedCaches();
  // Boot the real worker: everything above is the environment it expects.
  await import(pathToFileURL(path.resolve(entryPath)).href);
  for (const step of scenario.steps ?? []) {
    steps.push(await runStep(step));
  }
} catch (error) {
  unhandled.push(`harness: ${String(error?.stack ?? error)}`);
}

const report = {
  entry: path.basename(entryPath),
  origin: ORIGIN,
  scope: SCOPE,
  steps,
  caches: snapshotCaches(),
  operations: cacheOperations,
  fetchCalls,
  skipWaiting: skipWaitingCalls,
  unhandled,
};

process.stdout.write(`__RESULT__${JSON.stringify(report)}\n`);
