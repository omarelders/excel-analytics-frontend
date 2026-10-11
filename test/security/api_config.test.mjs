/**
 * Contract for the guard that keeps the API base URL compatible with the shipped CSP.
 *
 * `VITE_FORCE_EXTERNAL_API=true` points every request at the external origin, and
 * `vercel.json` pins `connect-src 'self'`, so the combination produces an app the
 * browser refuses to run: no login, no read, no write, and nothing in the build output
 * that says why. That failure is silent and total, so the check is a guard that stops
 * the build (`scripts/assertSameOriginApi.mjs`, called from `vite.config.js`) rather
 * than a comment.
 *
 * Both halves are exercised here: the guard's own decision as a unit, and the
 * configuration actually loading it - the second by importing the real
 * `vite.config.js` in a child process with the flag set and asserting it fails, and
 * without the flag and asserting it loads. A grep for the call site would prove only
 * that the text is somewhere in the file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = path.join(ROOT, 'vite.config.js');
const GUARD = path.join(ROOT, 'scripts', 'assertSameOriginApi.mjs');
const FLAG = 'VITE_FORCE_EXTERNAL_API';

/** Imports the real `vite.config.js` with `overrides` on top of the ambient environment. */
const loadBuildConfig = (overrides) => {
  const env = { ...process.env };
  delete env[FLAG];
  Object.assign(env, overrides);

  return spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(CONFIG).href)})`],
    { cwd: ROOT, encoding: 'utf8', env },
  );
};

// ---------------------------------------------------------------------------
// The guard as a unit
// ---------------------------------------------------------------------------

test('the guard fires on VITE_FORCE_EXTERNAL_API=true and names why', async () => {
  const { assertApiBaseIsSameOriginSafe } = await import(pathToFileURL(GUARD).href);

  assert.throws(
    () => assertApiBaseIsSameOriginSafe({ [FLAG]: 'true' }),
    (error) => {
      assert.match(error.message, new RegExp(FLAG), 'the message does not name the flag that caused it');
      assert.match(
        error.message,
        /connect-src 'self'/,
        'the message does not say which CSP directive blocks the resulting requests',
      );
      return true;
    },
  );

  // Only the value that turns the flag on turns it on. Vite treats any other string
  // as unset, and so does this.
  assert.strictEqual(assertApiBaseIsSameOriginSafe({ [FLAG]: 'false' }), true, 'a false flag should pass');
  assert.strictEqual(assertApiBaseIsSameOriginSafe({ [FLAG]: '1' }), true, 'a non-"true" value should pass');
  assert.strictEqual(assertApiBaseIsSameOriginSafe({}), true, 'an environment without the flag should pass');
});

// ---------------------------------------------------------------------------
// The build actually runs it
// ---------------------------------------------------------------------------

test('the build refuses to configure itself with the flag set', () => {
  const child = loadBuildConfig({ [FLAG]: 'true' });

  assert.notStrictEqual(child.status, 0, 'vite.config.js loaded with VITE_FORCE_EXTERNAL_API=true, so a build would ship an app the CSP blocks every request of');
  assert.match(
    child.stderr,
    /VITE_FORCE_EXTERNAL_API/,
    'the failure did not name the setting that caused it',
  );
  assert.match(child.stderr, /docs\/DEPLOYMENT\.md/, 'the failure did not point at the operator note that explains it');
});

test('the build config still loads when the flag is unset', () => {
  const child = loadBuildConfig({});

  assert.strictEqual(child.status, 0, `the build config failed to load: ${child.stderr}`);
});
