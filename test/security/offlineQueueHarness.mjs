/**
 * Boots the real offline queue - `src/api.js`, `src/utils/offlineStorage.js`,
 * `src/utils/syncQueue.js` and `src/components/OfflineIndicator.jsx` - inside a Node
 * process and replays a scripted scenario against it, so
 * `test/security/offline_queue.test.mjs` can assert on what the shipped code does.
 *
 * This file is a stand-in for the browser, not for the code under test. It provides:
 *
 * - a `window` that dispatches and listens for the real `online`, `offline` and
 *   `sync-queue-updated` events,
 * - a `navigator` whose `onLine` the scenario drives, the same flag `src/api.js` reads
 *   before it decides to queue a mutation,
 * - `localStorage` and a fake IndexedDB the real `idb` package drives, so the queue is
 *   read and written by `src/utils/offlineStorage.js`'s own code,
 * - a transport stub on the real axios instance - the adapter, which is the boundary
 *   every request `src/api.js` sends goes through - that records the fully built
 *   request and answers from the scenario,
 *
 * and then runs the scenario's steps: a request through the real `api`, a reconnect,
 * a flush, a render of the real `OfflineIndicator`. Nothing here decides whether a
 * payload can be queued, what a retry costs, when an entry is spent, or what the user
 * is told: those are the decisions `src/` makes, and this harness only reports what
 * happened.
 *
 * `src/` is written in JSX and imports `import.meta.env`, neither of which Node can load
 * as-is, so the modules on this path are copied out with esbuild into
 * `node_modules/.cache/offline-queue-mirror/`, which keeps the import graph and rewrites
 * nothing but the JSX, the injected `import.meta.env` and the relative specifiers (Node's
 * ESM loader wants the extension spelled out). The copy is rebuilt from source on every
 * boot, so it is the source under test.
 *
 * Run it as a child process: one process per scenario, so each starts from empty storage
 * and a pristine copy of the modules.
 *
 * Usage: node test/security/offlineQueueHarness.mjs <scenario.json> <repo root>
 * Output: a JSON report on the final line, prefixed with `__RESULT__`.
 *
 * Scenario keys:
 * - `origin` (default https://goldroad.invalid),
 * - `clock` (default 0): the value `flushSyncQueue` is given for "now", so the retry
 *   backoff is exercised without waiting for it,
 * - `transport` ({ status, networkError }): what the stub answers,
 * - `seed.queue`: entries to write into the queue before the steps run,
 * - `steps`: the run.
 *
 * Step kinds: `online`, `request`, `flush`, `retry-failed`, `attach-engine`, `event`,
 * `advance`, `render`. The queue, the published sync state, every request the transport
 * saw, every rejection `api` produced and every window event are snapshotted after each
 * step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const [scenarioPath, rootArg] = process.argv.slice(2);
const ROOT = path.resolve(rootArg || process.cwd());
const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));

const ORIGIN = scenario.origin ?? 'https://goldroad.invalid';
const SCOPE = `${ORIGIN}/`;

const MIRROR = path.join(ROOT, 'node_modules', '.cache', 'offline-queue-mirror');

/** The modules on the offline queue path, in dependency order. */
const MODULES = [
  'src/config/apiBaseUrl.js',
  'src/utils/offlineStorage.js',
  'src/utils/syncQueue.js',
  'src/api.js',
  'src/components/OfflineIndicator.jsx',
];

/**
 * Node's ESM loader wants the extension a relative import spells out, so every
 * `../foo` in a copy is pointed at `../foo.mjs`, the name the copy is written
 * under. Mechanical, and it is the only edit besides the JSX itself.
 */
const RELATIVE_SPECIFIER = /(\bfrom\s*|import\s*\(\s*)(['"])(\.\.?\/[^'"]+)\2/g;

const withExtensions = (code) =>
  code.replace(RELATIVE_SPECIFIER, (match, keyword, quote, specifier) => `${keyword}${quote}${specifier}.mjs${quote}`);

const mirrorModules = () => {
  for (const relative of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    const { code } = esbuild.transformSync(source, {
      loader: relative.endsWith('.jsx') ? 'jsx' : 'js',
      format: 'esm',
      jsx: 'automatic',
      // `apiBaseUrl.js` reads Vite's injected import.meta.env, which has no
      // meaning outside a build.
      define: { 'import.meta.env': JSON.stringify({ VITE_API_URL: '' }) },
    });
    const target = path.join(MIRROR, relative).replace(/\.jsx?$/, '.mjs');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, withExtensions(code));
  }
  return path.join(MIRROR, 'src/api.mjs');
};

// ---------------------------------------------------------------------------
// Web Storage
// ---------------------------------------------------------------------------

const createStorage = () => {
  const entries = new Map();
  return {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
    clear: () => entries.clear(),
    key: (index) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
    snapshot: () => Object.fromEntries(entries),
  };
};

const localStorage = createStorage();

// ---------------------------------------------------------------------------
// The browser window and the connectivity flag
//
// `window` is a real EventTarget, so the `online` event the driver dispatches reaches
// the listeners `src/utils/syncQueue.js` registered through the same path a browser
// uses. `navigator.onLine` is what `src/api.js` reads to decide a device is offline.
// ---------------------------------------------------------------------------

const navigatorRef = { onLine: scenario.online ?? false };

Object.defineProperty(globalThis, 'navigator', { value: navigatorRef, configurable: true });

const window = new EventTarget();
window.location = { href: SCOPE, hostname: new URL(SCOPE).hostname, origin: ORIGIN };
window.navigator = navigatorRef;
window.localStorage = localStorage;

Object.assign(globalThis, { window, localStorage });

/** Which step the harness is on, and the clock a flush is told is "now". */
let currentStep = 'boot';
let clock = scenario.clock ?? 0;

/** Every event the application dispatches, so the report shows what the UI was told. */
const events = [];
const EVENT_TYPES = ['online', 'offline', 'sync-queue-updated'];

for (const type of EVENT_TYPES) {
  window.addEventListener(type, () => events.push({ step: currentStep, type }));
}

const setOnline = (value) => {
  navigatorRef.onLine = value;
};

// ---------------------------------------------------------------------------
// IndexedDB
//
// `src/utils/offlineStorage.js` opens the database through the real `idb` package, so
// this stand-in only has to hold the rows the way a browser does: the upgrade callback,
// the store names, the auto-increment key and what is read or cleared are all the real
// module's own doing.
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
}

/** Real `objectStoreNames` is a DOMStringList; `idb` and the source read it. */
const stringList = (values) => {
  const list = [...values];
  list.contains = (value) => values.includes(value);
  return list;
};

class IDBObjectStore {
  constructor(database, name, options) {
    this.keyPath = options?.keyPath;
    this.nextKey = options?.autoIncrement ? 1 : undefined;
    this.records = new Map();
    database._stores.set(name, this);
  }

  _request(value) {
    const request = new FakeIDBRequest();
    queueMicrotask(() => request._succeed(value));
    return request;
  }

  /** Real stores generate the key when a keyPath is less specific than the record. */
  _assignKey(value) {
    if (this.keyPath) {
      if (value[this.keyPath] === undefined && this.nextKey !== undefined) value[this.keyPath] = this.nextKey++;
      return value[this.keyPath];
    }
    if (value.id === undefined && this.nextKey !== undefined) value.id = this.nextKey++;
    return value.id;
  }

  add(value) {
    const request = new FakeIDBRequest();
    if (this.records.has(this._assignKey(value))) {
      queueMicrotask(() => {
        request.error = new Error(`Key ${value[this.keyPath ?? 'id']} already exists in the object store`);
        request.dispatchEvent(new Event('error'));
      });
      return request;
    }
    return this.put(value);
  }

  put(value) {
    this.records.set(this._assignKey(value), value);
    return this._request(undefined);
  }

  count() {
    return this._request(this.records.size);
  }

  delete(key) {
    const request = new FakeIDBRequest();
    queueMicrotask(() => {
      this.records.delete(key);
      request._succeed(undefined);
    });
    return request;
  }

  getAll() {
    return this._request([...this.records.values()]);
  }

  clear() {
    this.records.clear();
    return this._request(undefined);
  }
}

class IDBTransaction extends EventTarget {
  constructor(database, storeNames) {
    super();
    this.database = database;
    this.storeNames = storeNames;
    this.mode = 'readonly';
  }

  get objectStoreNames() {
    return stringList(this.storeNames);
  }

  objectStore(name) {
    const store = this.database._stores.get(name);
    if (!store) throw new Error(`no object store named ${name}`);
    return store;
  }

  /** A transaction commits once the microtasks it started have run. */
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
    return stringList([...this._stores.keys()]);
  }

  createObjectStore(name, options = {}) {
    return new IDBObjectStore(this, name, options);
  }

  transaction(storeNames, mode = 'readonly') {
    const transaction = new IDBTransaction(this, Array.isArray(storeNames) ? storeNames : [storeNames]);
    transaction.mode = mode;
    transaction.settle();
    return transaction;
  }
}

const databases = new Map();

/** `idb` probes the global constructors to decide what it can wrap. */
class IDBIndex {}
class IDBCursor {}

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
};

Object.assign(globalThis, {
  indexedDB: fakeIndexedDB,
  IDBRequest: FakeIDBRequest,
  IDBTransaction,
  IDBObjectStore,
  IDBDatabase,
  IDBIndex,
  IDBCursor,
});

// ---------------------------------------------------------------------------
// The transport
//
// The adapter on the real axios instance is the boundary every request in `src/api.js`
// goes through, so recording there sees a request after the interceptors have built it -
// body, method, headers and all - and answers it the way the network would.
// ---------------------------------------------------------------------------

/** Base64 in bounded chunks, the same way the source does it for a queued file. */
const toBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const describeBody = async (data) => {
  if (data === undefined || data === null) {
    return { kind: 'empty' };
  }
  if (typeof FormData !== 'undefined' && data instanceof FormData) {
    const entries = [];
    for (const [name, value] of data.entries()) {
      entries.push(
        typeof value === 'string'
          ? { name, kind: 'string', value }
          : { name, kind: 'file', filename: value.name, type: value.type, data: await toBase64(value) },
      );
    }
    return { kind: 'form-data', entries };
  }
  if (typeof data === 'string') {
    try {
      return { kind: 'json', value: JSON.parse(data) };
    } catch {
      return { kind: 'string', value: data };
    }
  }
  return { kind: 'json', value: data };
};

const requests = [];
const rejections = [];
const transport = scenario.transport ?? {};
const transportStatus = transport.status ?? 200;
const transportNetworkError = transport.networkError === true;

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Lets the microtasks the queue and the engine run on finish before the next step. */
const settle = async (rounds = 20) => {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const requestBody = (spec) => {
  if (spec.formData) {
    const form = new FormData();
    for (const field of spec.formData) {
      form.append(
        field.name,
        field.file
          ? new File([Uint8Array.from(atob(field.file.data), (character) => character.charCodeAt(0))], field.file.filename, {
              type: field.file.type,
            })
          : field.value,
      );
    }
    return form;
  }
  // A value the structured clone algorithm refuses, standing in for anything a page can
  // hand axios that IndexedDB will not store (a callback, a symbol, a class instance).
  if (spec.unclonable) {
    return { ...(spec.data ?? {}), onQueued: () => {} };
  }
  return spec.data;
};

const snapshotState = async (getSyncQueue, getSyncState) => ({
  queue: (await getSyncQueue()).map((entry) => ({ ...entry })),
  state: (() => {
    const { failures, ...rest } = getSyncState();
    return { ...rest, failures: failures.map((entry) => ({ ...entry })) };
  })(),
  localStorage: localStorage.snapshot(),
});

const snapshots = [];

const run = async () => {
  const { default: api } = await import(pathToFileURL(mirrorModules()).href);
  const storage = await import(pathToFileURL(path.join(MIRROR, 'src/utils/offlineStorage.mjs')).href);
  const { flushSyncQueue, retryFailedSyncQueue, refreshSyncState, attachSyncEngine, getSyncState } = await import(
    pathToFileURL(path.join(MIRROR, 'src/utils/syncQueue.mjs')).href
  );
  const { default: OfflineIndicator } = await import(
    pathToFileURL(path.join(MIRROR, 'src/components/OfflineIndicator.mjs')).href
  );

  api.defaults.adapter = async (config) => {
    requests.push({
      method: config.method,
      url: config.url,
      params: config.params ?? null,
      headers: { ...config.headers },
      syncRequest: config._isSyncRequest === true,
      body: await describeBody(config.data),
    });

    if (transportNetworkError) {
      throw new TypeError('connect ECONNREFUSED 127.0.0.1:443');
    }

    const body = transportStatus >= 400 ? { detail: `the server answered ${transportStatus}` } : { ok: true };
    // The shape `dispatchRequest` expects back: a plain response object it can rewrite,
    // the way the http and xhr adapters hand one over.
    const response = {
      data: JSON.stringify(body),
      status: transportStatus,
      statusText: transportStatus >= 400 ? 'Internal Server Error' : 'OK',
      headers: { 'content-type': 'application/json' },
      config,
      request: {},
    };

    if (transportStatus >= 400) {
      // Settling an error response is the adapter's job, so the stub does it too.
      const error = new Error(`Request failed with status code ${transportStatus}`);
      error.isAxiosError = true;
      error.config = config;
      error.response = response;
      throw error;
    }

    return response;
  };

  // Written as they are given, so a scenario can start from an entry that has already
  // spent its attempts rather than from one the queue has just accepted.
  for (const entry of scenario.seed?.queue ?? []) {
    await storage.updateSyncQueueItem(entry);
  }
  await refreshSyncState();

  const clockNow = () => clock;
  const flushWithClock = (options = {}) => flushSyncQueue({ ...options, now: clockNow });

  /** One step, and the state it left behind. */
  const step = async (current) => {
    currentStep = current.do;
    let markup = null;

    switch (current.do) {
      case 'online':
        setOnline(current.value !== false);
        break;

      case 'request': {
        const config = {
          method: current.method ?? 'post',
          url: current.url,
          headers: current.headers ?? { 'Content-Type': 'application/json' },
        };
        if (current.formData || current.data !== undefined || current.unclonable) {
          config.data = requestBody(current);
        }
        try {
          await api.request(config);
          rejections.push({ step: current.do, outcome: 'sent', url: current.url });
        } catch (error) {
          rejections.push({
            step: current.do,
            outcome: 'rejected',
            url: current.url,
            isQueued: error?.isQueued === true,
            isUnqueued: error?.isUnqueued === true,
            isOffline: error?.isOffline === true,
            message: error?.message ?? String(error),
          });
        }
        break;
      }

      case 'flush':
        await flushWithClock();
        break;

      case 'retry-failed':
        await retryFailedSyncQueue({ now: clockNow });
        break;

      case 'attach-engine':
        // The clock is injected the way the scenario injects it everywhere else, so the
        // backoff this engine's flush sees is the one under test.
        attachSyncEngine({ flush: flushWithClock, refresh: refreshSyncState });
        await refreshSyncState();
        break;

      case 'event':
        await window.dispatchEvent(new Event(current.name));
        // The engine's handlers are async: a reconnect flushes the queue after the
        // dispatch returns.
        await settle(current.rounds ?? 20);
        break;

      case 'advance':
        clock += current.ms ?? 0;
        break;

      case 'render':
        markup = renderToStaticMarkup(createElement(OfflineIndicator));
        break;

      default:
        throw new Error(`unknown step: ${current.do}`);
    }

    await settle(2);
    const snapshot = await snapshotState(storage.getSyncQueue, getSyncState);
    snapshots.push({ do: current.do, ...current, markup, ...snapshot, requests: [...requests] });
  };

  for (const current of scenario.steps ?? []) {
    await step(current);
  }
}

try {
  await run();
} catch (error) {
  snapshots.push({ harnessError: String(error?.stack ?? error) });
}

const report = {
  origin: ORIGIN,
  clock,
  transport,
  snapshots,
  rejections,
  events,
  requests,
  harnessError: snapshots.find((snapshot) => snapshot.harnessError)?.harnessError ?? null,
};

// Written synchronously and exited, because the sync engine the component attaches keeps
// an interval alive that would otherwise hold this process open forever.
fs.writeSync(1, `__RESULT__${JSON.stringify(report)}\n`);
process.exit(0);
