/**
 * Boots the real `src/context/AuthContext.jsx` inside a Node process and runs
 * one logout scenario against it, so `test/security/logout_purge.test.mjs` can
 * assert on the post-state the actual logout function leaves behind.
 *
 * This file is a stand-in for the browser, not for the code under test. It
 * provides:
 *
 * - `localStorage`, `sessionStorage` and `caches` that store what they are
 *   handed and return it,
 * - a fake IndexedDB that the real `idb` package drives, so
 *   `clearOfflineStorage()` runs its own code against it,
 * - a `fetch` that answers from the scenario,
 *
 * and then renders the real provider through `react-dom/server`, reaches into
 * the context it published, and calls the real `logout()`. Nothing here decides
 * which cache is deleted, what is erased from storage, or whether a failed
 * logout is allowed to look successful: those are the decisions `src/` makes,
 * and this harness only reports what happened.
 *
 * `src/` is written in JSX and imports `import.meta.env`, neither of which Node
 * can load as-is, so the four modules on the logout path are copied out with
 * esbuild into `node_modules/.cache/logout-purge-mirror/`, which keeps the
 * import graph and rewrites nothing but the JSX, the injected `import.meta.env`
 * and the relative specifiers (Node's ESM loader wants the extension spelled
 * out). The copy is rebuilt from source on every boot, so it is the source
 * under test.
 *
 * Run it as a child process: one process per scenario, so each starts from
 * empty storage.
 *
 * Usage: node test/security/logoutHarness.mjs <scenario.json> <repo root>
 * Output: a JSON report on the final line, prefixed with `__RESULT__`.
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

const MIRROR = path.join(ROOT, 'node_modules', '.cache', 'logout-purge-mirror');

/** The modules on the logout path, in dependency order. */
const MODULES = [
  'src/utils/cachePurge.js',
  'src/utils/offlineStorage.js',
  'src/config/apiBaseUrl.js',
  'src/context/AuthContext.jsx',
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
  return path.join(MIRROR, 'src/context/AuthContext.mjs');
};

// ---------------------------------------------------------------------------
// Cache Storage
// ---------------------------------------------------------------------------

const cacheOperations = [];

const log = (action, cache, url) => cacheOperations.push({ action, cache, url });

class FakeCache {
  constructor(name, store) {
    this.name = name;
    this._store = store;
  }

  async put(request, response) {
    const url = typeof request === 'string' ? new URL(request, SCOPE).href : request.url;
    this._store.set(url, { url, body: await response.text() });
    log('put', this.name, url);
  }
}

const cacheStores = new Map();

const storeFor = (name) => {
  if (!cacheStores.has(name)) cacheStores.set(name, new Map());
  return cacheStores.get(name);
};

const caches = {
  async open(name) {
    log('open', name);
    return new FakeCache(name, storeFor(name));
  },
  /** Name-listing is what a purge that filters cache names reads. */
  async keys() {
    return [...cacheStores.keys()];
  },
  async delete(name) {
    log('delete-cache', name);
    return cacheStores.delete(name);
  },
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
const sessionStorage = createStorage();

// ---------------------------------------------------------------------------
// IndexedDB
//
// `src/utils/offlineStorage.js` opens the database through the real `idb`
// package, so this stand-in only has to hold the rows the way a browser does;
// the upgrade callback, the store names and what gets cleared are all the real
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

  /** Real transactions report a DOMStringList; `idb` reads it by index. */
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
    if (this._settled) return;
    this._settled = true;
    setTimeout(() => this.dispatchEvent(new Event('complete')), 0);
  }
}

class IDBDatabase extends EventTarget {
  constructor(name, version) {
    super();
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

// `idb` probes the global constructors to decide what it can wrap, so they have
// to exist even though this path uses no indexes or cursors.
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

// What the page-side logout path and the api config read from the window.
Object.assign(globalThis, {
  indexedDB: fakeIndexedDB,
  IDBRequest: FakeIDBRequest,
  IDBTransaction,
  IDBObjectStore,
  IDBDatabase,
  IDBIndex,
  IDBCursor,
  caches,
  localStorage,
  sessionStorage,
});

// A page's `window.caches` is the same object as the global `caches`, so a purge
// reads either. Node owns a global `navigator` already, so the page's copy is
// left pointing at it.
globalThis.window = { location: { href: SCOPE, hostname: new URL(SCOPE).hostname }, navigator: globalThis.navigator, caches };

// ---------------------------------------------------------------------------
// The network
// ---------------------------------------------------------------------------

const fetchCalls = [];

const describeCall = (request, options) => ({
  url: String(typeof request === 'string' ? request : request.url),
  method: (options?.method ?? (typeof request === 'object' ? request.method : undefined) ?? 'GET'),
  credentials: options?.credentials ?? (typeof request === 'object' ? request.credentials : undefined),
});

if (scenario.fetch?.networkError) {
  globalThis.fetch = async (request, options) => {
    fetchCalls.push(describeCall(request, options));
    throw new TypeError('fetch failed');
  };
} else {
  const status = scenario.fetch?.status ?? 200;
  globalThis.fetch = async (request, options) => {
    fetchCalls.push(describeCall(request, options));
    return new Response(status === 204 ? null : '', { status });
  };
}

// ---------------------------------------------------------------------------
// Seeding and the run
// ---------------------------------------------------------------------------

const seed = scenario.seed ?? {};

for (const [key, value] of Object.entries(seed.localStorage ?? {})) {
  localStorage.setItem(key, value);
}
for (const [key, value] of Object.entries(seed.sessionStorage ?? {})) {
  sessionStorage.setItem(key, value);
}

const report = {
  caches: {},
  logoutError: null,
  fetchCalls,
};

/** Cache names and their entry URLs, so the report can be asserted cache by cache. */
const snapshotCaches = () =>
  Object.fromEntries([...cacheStores.entries()].map(([name, entries]) => [name, [...entries.keys()]]));

const snapshotQueue = async (getSyncQueue) =>
  (await getSyncQueue()).map((entry) => ({ url: entry.url, method: entry.method }));

const run = async () => {
  // Boot the real modules against the environment above, then render the real
  // provider: `AuthProvider` reads storage while rendering, and the context it
  // publishes carries the logout function under test.
  const { AuthProvider, useAuth } = await import(pathToFileURL(mirrorModules()).href);
  const { addToSyncQueue, getSyncQueue } = await import(
    pathToFileURL(path.join(MIRROR, 'src/utils/offlineStorage.mjs')).href
  );

  let auth;
  function AuthProbe() {
    auth = useAuth();
    return null;
  }

  renderToStaticMarkup(createElement(AuthProvider, null, createElement(AuthProbe)));

  for (const request of seed.syncQueue ?? []) {
    await addToSyncQueue(request);
  }
  for (const [name, urls] of Object.entries(seed.cacheEntries ?? {})) {
    const cache = await caches.open(name);
    for (const url of urls) {
      await cache.put({ url }, new Response(url, { headers: { 'content-type': 'text/plain' } }));
    }
  }

  report.seeded = {
    localStorage: localStorage.snapshot(),
    sessionStorage: sessionStorage.snapshot(),
    syncQueue: await snapshotQueue(getSyncQueue),
    cacheEntries: snapshotCaches(),
  };

  cacheOperations.length = 0;

  try {
    await auth.logout();
  } catch (error) {
    report.logoutError = String(error?.message ?? error);
  }

  report.caches = snapshotCaches();
  report.operations = [...cacheOperations];
  report.localStorage = localStorage.snapshot();
  report.sessionStorage = sessionStorage.snapshot();
  report.syncQueue = await snapshotQueue(getSyncQueue);
};

try {
  await run();
} catch (error) {
  report.harnessError = String(error?.stack ?? error);
}

process.stdout.write(`__RESULT__${JSON.stringify(report)}\n`);
