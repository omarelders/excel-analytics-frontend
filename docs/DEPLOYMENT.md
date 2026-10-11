# Deployment: Gold Road frontend (`excel-analytics-frontend`)

Operator note for the branch `fix/security-remediation`. This file is the tracked
equivalent of the SDK ledger, which is gitignored: everything an operator needs to
deploy and to read the test gate is here.

---

## 1. `npm test` needs a build first, and fails without one

`npm test` runs `node --test "test/**/*.test.{mjs,js}"`. **13 of its checks hard-fail if
`npm run build` has not run** (13 of the 68 this branch ships) — they read
`dist/index.html`, `dist/assets/*` and `dist/sw.js`, and an unbuilt tree is a failure
rather than a skip (ruling R-F5): a gate that cannot fail is not a gate.

This is deliberate. **A fresh clone that runs `npm test` before `npm run build` looks
like a broken repository and is not one.** The failing names are the `dist/`-reading
checks in `test/security/vercel_headers.test.mjs` and
`test/security/service_worker.test.mjs` ("the built output contributes its own
references", "the emitted service worker is admitted by worker-src", the `dist/sw.js`
boots, and their relatives).

Run, in order:

```
npm run build     # vite build + the PWA service worker
npm test          # 60 checks, 0 expected failures
```

`node_modules` is required and must be installed on a machine with network access
(`npm install`). See §6 for the one package-file discrepancy that is still open.

### Running a single file

```powershell
node --test "test/security/offline_queue.test.mjs"
```

Each security suite spawns its own child process per scenario, so the whole suite is
slower than its check count suggests (roughly 25s with a build present).

---

## 2. Same-origin only: `connect-src 'self'` and the API base URL

`vercel.json` ships `Content-Security-Policy` with **`connect-src 'self'`**. Every
`fetch`, XHR and `api.get/post` call the app makes must therefore be **same-origin**.

`src/config/apiBaseUrl.js` is what makes that true: `API_BASE_URL` is `''` — so all
requests are root-relative — when the hostname is

- `roadtoonemillion.me`,
- `www.roadtoonemillion.me`, or
- any `*.vercel.app` preview.

On any of those, `vercel.json`'s **11 rewrites** forward the API on the same origin, so
the browser sees one origin and the CSP is satisfied. On any **other** host (a staging
domain, an IP, a `localhost` other than the Vite dev server), `API_BASE_URL` falls back
to `VITE_API_URL`, every call becomes cross-origin, and **every call is blocked by the
CSP**: the app loads and then cannot log in, read or write anything.

`VITE_FORCE_EXTERNAL_API=true` does the same thing on purpose and is **incompatible
with the shipped CSP**. Setting it produces exactly the silent total failure above, so
it is now a build error: `scripts/assertSameOriginApi.mjs` is called from
`vite.config.js` and fails the build with the reason. Do not set it, and do not "fix" a
blocked API by widening `connect-src` without re-running `npm test`
(`test/security/vercel_headers.test.mjs` pins every directive token-for-token, and
`test/security/api_config.test.mjs` proves the guard fires).

### `font-src https://fonts.gstatic.com`

`App.css` imports one stylesheet from Google Fonts, and the `@font-face` rules that
name the font files live inside that stylesheet — not in this repository. No local
reference can cover them, so `font-src` names the origin and the build needs
`fonts.gstatic.com` to be reachable from the deploying network at runtime. If that host
is blocked from a deployment environment, fonts fall back to the system stack; the app
still runs. It is the one documented exception in the "policy names no host the app
never loads" check.

---

## 3. The internal Heroku hostname in the rewrites

The 11 rewrite rules in `vercel.json` name
`https://our-shipping-app-8d9c08b8da37.herokuapp.com` as their destination. That is
**structural, not a leak to be scrubbed**: Vercel must be given an absolute destination
to proxy same-origin, and this is the only way the app can talk to the backend without a
cross-origin request. Removing it would break every API call, not tighten anything.
Known and accepted; out of scope for this branch.

---

## 4. Cross-user replay of the offline queue

`src/utils/offlineStorage.js` keeps mutations the device could not send. Each entry is
stamped with the session that queued it (`src/utils/sessionIdentity.js`, which reads the
same `user_data` the auth context writes). At replay, `flushSyncQueue()` compares the
stamp with the session that is current and **refuses to send an entry that belongs to
anyone else**; `AuthContext.login()` performs the same comparison at the moment the
identity changes and discards those entries outright. An explicit logout still wipes the
whole store.

What that guarantees: one user's queued request bodies cannot be delivered under
another user's session on a shared device. What it deliberately does not do: it does not
clear the queue on login, so a user who signs back in as themselves still gets their
queued changes sent — the "will sync when you are back online" promise.
`test/security/offline_queue.test.mjs` covers the change-of-user, the expired-session
and the same-user paths.

### Offline file uploads need a browser smoke test

When a queued entry's body is `FormData`, the request is rebuilt from the stored fields
(`fromQueueablePayload`) and the browser generates the multipart boundary on send. A
Node test cannot see the wire bytes, so a header/body mismatch on the replay path is not
detectable in this repo. **After deploying, upload a file while offline and let it
replay, in a real browser.** Pre-existing, identical on the send path, and not a
regression of this branch.

---

## 5. What the test gate covers

| Suite | What it holds |
|---|---|
| `test/security/vercel_headers.test.mjs` | Every header and every CSP directive, pinned token-for-token, and derived from the URLs the app and its build actually load |
| `test/security/service_worker.test.mjs` | The real worker (`src/sw.js` and the built `dist/sw.js`) booted against a fake ServiceWorkerGlobalScope: what it caches, what it refuses, what an activation leaves behind |
| `test/security/logout_purge.test.mjs` | The real `logout()`/`confirmLogout()` against stubbed `fetch`, asserted cache by cache, store by store |
| `test/security/offline_queue.test.mjs` | The real queue and replay: queueing, reconnect, the attempt cap, whose change it is, two flushes at once |
| `test/security/api_config.test.mjs` | The build-time guard that refuses an API base the CSP would block |

The harnesses (`*Harness.mjs`) mirror the modules under test out of `src/` with esbuild
and run them in a child process against a fake browser. They are stand-ins for the
browser, **not** for the code under test: the cache names, the purge, the queue, the
retry policy and the replay are all the shipped code.

---

## 6. `package-lock.json` is one step behind `package.json`

`package.json` declares `esbuild@^0.27.2` in `devDependencies` (it is used directly by
the test harnesses to mirror `src/`). The lockfile does not have that root edge yet.

**`npm install` on a machine with network access reconciles it.** Contrary to an earlier
note in the SDK ledger, `npm ci` does **not** break in the meantime: `npm ci --dry-run`
succeeds, `npm ls esbuild` resolves `0.27.2` at the root, and
`node_modules/esbuild` already exists as a transitive dependency of Vite. Do not hand-edit
`package-lock.json`.
