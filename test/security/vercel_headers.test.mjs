/**
 * Contract for the headers `vercel.json` puts on every response this app serves.
 *
 * These tests read the config the way the browser reads the headers it produces, not
 * the way a diff reads it: Permissions-Policy and Content-Security-Policy are parsed
 * into structured values, and every URL the application actually loads - taken from
 * `index.html`, `dist/index.html`, the built CSS and the application/built JS - is
 * checked against the directive that governs it. Symmetrically, every host the policy
 * names must be one of those URLs, so the policy cannot quietly widen.
 *
 * The deployed origin is not knowable from here, so a placeholder origin stands in for
 * `'self'`: every reference the app ships is root-relative, and a genuinely absolute
 * URL is the only case that needs a host-source of its own.
 *
 * Run `npm run build` first. Checks that read `dist/` skip and say why rather than
 * pass silently without it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Stand-in for the deployed origin. Root-relative references resolve here, so they are
// covered by 'self'; an absolute URL would need its own host-source in the policy.
const ORIGIN = 'https://goldroad.invalid';
const BASE = `${ORIGIN}/`;

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

const readText = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));
const posix = (relative) => relative.replaceAll('\\', '/');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

/** Every file under `src/` plus `index.html`, as `{ relative, text }`. */
function applicationSources() {
  const files = [];
  if (exists('src')) {
    files.push(...walk(path.join(ROOT, 'src')));
  }
  if (exists('index.html')) {
    files.push(path.join(ROOT, 'index.html'));
  }

  return files
    .map((file) => ({ relative: posix(path.relative(ROOT, file)), absolute: file }))
    .filter(({ relative }) => ['.js', '.jsx', '.mjs', '.css', '.html'].includes(path.extname(relative)))
    .map(({ relative, absolute }) => ({ relative, text: fs.readFileSync(absolute, 'utf8') }));
}

function builtAssetNames(extension) {
  const dir = path.join(ROOT, 'dist', 'assets');
  if (!exists('dist/assets')) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .map((name) => `dist/assets/${name}`);
}

const SOURCES = applicationSources();
const JS_SOURCES = SOURCES.filter(({ relative }) => /\.(?:js|jsx|mjs)$/.test(relative));
const CSS_FILES = [
  ...SOURCES.filter(({ relative }) => relative.endsWith('.css')).map(({ relative, text }) => ({ relative, text })),
  ...builtAssetNames('.css').map((relative) => ({ relative, text: readText(relative) })),
];
const JS_FILES = [
  ...JS_SOURCES,
  ...builtAssetNames('.js').map((relative) => ({ relative, text: readText(relative) })),
];

// ---------------------------------------------------------------------------
// What this app actually does - derived from the shipped files, not assumed
// ---------------------------------------------------------------------------

/** BarcodeScanner.jsx drives html5-qrcode, which opens a video track for it. */
const REQUESTS_CAMERA =
  JS_SOURCES.some(({ text }) => /html5-qrcode/.test(text)) ||
  JS_SOURCES.some(({ text }) => /getUserMedia\([\s\S]{0,240}?\bvideo\b/.test(text));

/** useAudioRecorder.js calls getUserMedia({ audio: ... }) directly. */
const REQUESTS_MICROPHONE = JS_SOURCES.some(({ text }) => /getUserMedia\([\s\S]{0,240}?\baudio\b/.test(text));

/** React `style={{...}}` attributes and OfflineIndicator's `<style>` element. */
const USES_INLINE_STYLES =
  SOURCES.some(({ text }) => /style=\{\{/.test(text)) || SOURCES.some(({ text }) => /<style[\s>]/.test(text));

/** Recorded notes are played from object URLs: useAudioRecorder builds one, Ideas plays it. */
const PLAYS_BLOB_MEDIA =
  JS_SOURCES.some(({ text }) => /URL\.createObjectURL\(/.test(text)) &&
  SOURCES.some(({ text }) => /<(?:audio|video)[\s>]/.test(text));

/** Stored notes are played from base64 data URLs: WaveformPlayer.jsx and Ideas.jsx. */
const PLAYS_DATA_MEDIA = SOURCES.some(({ text }) => /data:(?:audio|video)\//.test(text));

// ---------------------------------------------------------------------------
// The emitted service worker - read out of the build, not hardcoded
// ---------------------------------------------------------------------------

/** The service worker filename the PWA build emits (vite.config.js `filename`). */
const WORKER_FILENAME = (() => {
  assert.ok(exists('vite.config.js'), 'vite.config.js must exist');
  const match = /filename:\s*['"]([^'"]+)['"]/.exec(readText('vite.config.js'));
  assert.ok(match, 'vite.config.js must configure the PWA plugin with a service worker filename');
  return match[1];
})();

/** Does any built asset register that worker script? */
function registersWorkerFromBuiltBundle() {
  if (!exists('dist/assets')) {
    return null;
  }
  const quoted = new RegExp(`["'\`]\\/${WORKER_FILENAME.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&')}["'\`]`);
  return JS_FILES.filter((file) => file.relative.startsWith('dist/')).find((file) => quoted.test(file.text)) ?? null;
}

// ---------------------------------------------------------------------------
// Header model
// ---------------------------------------------------------------------------

const config = JSON.parse(readText('vercel.json'));

function headerValues(key) {
  assert.ok(Array.isArray(config.headers), 'vercel.json must have a headers array');
  const rule = config.headers.find((candidate) => candidate.source === '/(.*)');
  assert.ok(rule, 'vercel.json must keep a header rule for source "/(.*)"');

  const values = rule.headers.filter((header) => header.key.toLowerCase() === key.toLowerCase()).map((h) => h.value);
  assert.ok(values.length > 0, `vercel.json must set a ${key} header`);
  return values;
}

/** The single value Vercel sets for `key` (there must be exactly one). */
function headerValue(key) {
  const values = headerValues(key);
  assert.strictEqual(values.length, 1, `${key} must be set exactly once, got ${values.length}`);
  return values[0];
}

function parsePermissionsPolicy(value) {
  const features = new Map();
  for (const item of value.split(',')) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    const match = /^([a-zA-Z-]+)\s*(?:=\s*\(([^)]*)\))?$/.exec(trimmed);
    assert.ok(match, `unparsable Permissions-Policy feature: "${trimmed}"`);
    const [, feature, origins] = match;
    // A bare feature name means "allowed everywhere", never an allowlist.
    const allowlist = origins === undefined ? ['*'] : origins.trim().split(/\s+/).filter(Boolean);
    features.set(feature.toLowerCase(), new Set(allowlist));
  }
  return features;
}

const parsed = {};

function permissions() {
  parsed.permissions ??= parsePermissionsPolicy(headerValue('Permissions-Policy'));
  return parsed.permissions;
}

function parseCsp(value) {
  const directives = new Map();
  for (const raw of value.split(';')) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    const [name, ...tokens] = trimmed.split(/\s+/);
    const key = name.toLowerCase();
    directives.set(key, [...(directives.get(key) ?? []), ...tokens]);
  }
  return directives;
}

function csp() {
  parsed.csp ??= parseCsp(headerValue('Content-Security-Policy'));
  return parsed.csp;
}

/** Keyword sources name no URL, so they are exempt from the minimality check below. */
const KEYWORD_SOURCES = new Set([
  "'self'",
  "'none'",
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'strict-dynamic'",
  "'unsafe-hashes'",
  "'report-sample'",
  "'unsafe-allow-redirects'",
]);

/** True when one CSP source-expression admits `url`. */
function sourceAdmits(expression, url) {
  if (KEYWORD_SOURCES.has(expression)) {
    // Keyword sources govern non-URL resources; only 'self' matches a URL.
    return expression === "'self'" && url.origin === ORIGIN;
  }
  if (expression === '*') {
    return url.protocol !== 'blob:' && url.protocol !== 'filesystem:';
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:$/.test(expression)) {
    return url.protocol === expression.toLowerCase();
  }

  const separator = expression.indexOf('://');
  if (separator === -1) {
    return false;
  }
  const scheme = expression.slice(0, separator).toLowerCase();
  if (url.protocol !== `${scheme}:` || url.origin === 'null') {
    return false; // data: and blob: never match a host-source
  }

  const rest = expression.slice(separator + 3);
  const slash = rest.indexOf('/');
  const hostPort = slash === -1 ? rest : rest.slice(0, slash);
  const pathPart = slash === -1 ? '' : rest.slice(slash);
  const colon = hostPort.indexOf(':');
  const host = colon === -1 ? hostPort : hostPort.slice(0, colon);
  const port = colon === -1 ? null : hostPort.slice(colon + 1);

  if (port !== null && port !== '*' && port !== url.port) {
    return false;
  }
  const normalizedHost = host.toLowerCase();
  const matchesHost =
    normalizedHost === url.hostname.toLowerCase() ||
    (normalizedHost.startsWith('*.') && url.hostname.toLowerCase().endsWith(`.${normalizedHost.slice(2)}`));
  if (!matchesHost) {
    return false;
  }
  return !pathPart || url.pathname.startsWith(pathPart.replace(/\/$/, ''));
}

/** Resolve a reference the way the browser would against the deployed origin. */
const toUrl = (reference) => new URL(reference, BASE);

/**
 * Tokens for `directive`, falling back to `default-src` the way a browser does when a
 * fetch directive is not declared. Every directive this app needs is declared
 * explicitly (asserted below), so the fallback never decides a real check.
 */
function directiveTokens(directive) {
  return csp().get(directive) ?? csp().get('default-src') ?? [];
}

function directiveAdmits(directive, url) {
  return directiveTokens(directive).some((expression) => sourceAdmits(expression, url));
}

// ---------------------------------------------------------------------------
// Every URL the app loads, tagged with the directive that governs it
// ---------------------------------------------------------------------------

/** `as` attribute of a preload link, mapped to the directive that governs the resource. */
const PRELOAD_DIRECTIVES = {
  script: 'script-src',
  style: 'style-src',
  font: 'font-src',
  image: 'img-src',
  audio: 'media-src',
  video: 'media-src',
  fetch: 'connect-src',
  worker: 'worker-src',
};

const REFERENCES = collectReferences();

function collectReferences() {
  const references = [];

  const add = (raw, directive, where) => {
    // A template expression is collapsed to nothing: `${API_BASE_URL}` is '' on the
    // Vercel host (src/config/apiBaseUrl.js), so those calls resolve root-relative.
    const value = raw.replace(/\$\{[^}]*\}/g, '').trim();
    if (!value || value.startsWith('#')) {
      return;
    }
    let url;
    try {
      url = toUrl(value);
    } catch {
      assert.fail(`unparsable reference in ${where}: ${value}`);
    }
    references.push({ reference: value, url, directive, where });
  };

  // --- HTML ---------------------------------------------------------------
  const htmlFiles = ['index.html'];
  if (exists('dist/index.html')) {
    htmlFiles.push('dist/index.html');
  }
  assert.ok(htmlFiles.length > 0, 'no HTML found to inspect');

  for (const file of htmlFiles) {
    const html = readText(file);
    const attribute = (tag, name) => new RegExp(`<${tag}\\b[^>]*?\\b${name}\\s*=\\s*["']([^"']+)["']`, 'gi');

    for (const match of html.matchAll(attribute('script', 'src'))) {
      add(match[1], 'script-src', `${file} <script src>`);
    }
    for (const match of html.matchAll(attribute('img', 'src'))) {
      add(match[1], 'img-src', `${file} <img src>`);
    }
    for (const [tag, directive] of [
      ['audio', 'media-src'],
      ['video', 'media-src'],
      ['track', 'media-src'],
      ['source', 'media-src'],
      ['iframe', 'frame-src'],
      ['object', 'object-src'],
      ['embed', 'object-src'],
    ]) {
      for (const match of html.matchAll(attribute(tag, 'src'))) {
        add(match[1], directive, `${file} <${tag} src>`);
      }
    }
    for (const match of html.matchAll(attribute('object', 'data'))) {
      add(match[1], 'object-src', `${file} <object data>`);
    }
    for (const match of html.matchAll(attribute('base', 'href'))) {
      add(match[1], 'base-uri', `${file} <base href>`);
    }
    for (const match of html.matchAll(/<form\b[^>]*?\baction\s*=\s*["']([^"']+)["']/gi)) {
      add(match[1], 'form-action', `${file} <form action>`);
    }

    for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
      const tag = match[0];
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
      const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (!href || !rel) {
        continue;
      }
      const rels = rel[1].toLowerCase().split(/\s+/);
      const as = /\bas\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
      if (rels.includes('stylesheet')) {
        add(href[1], 'style-src', `${file} <link rel=stylesheet>`);
      } else if (rels.includes('manifest')) {
        add(href[1], 'manifest-src', `${file} <link rel=manifest>`);
      } else if (rels.includes('serviceworker')) {
        add(href[1], 'worker-src', `${file} <link rel=serviceworker>`);
      } else if (rels.includes('preconnect') || rels.includes('dns-prefetch')) {
        add(href[1], 'connect-src', `${file} <link rel=${rel[1]}>`);
      } else if (rels.includes('preload') || rels.includes('prefetch') || rels.includes('modulepreload')) {
        const directive = PRELOAD_DIRECTIVES[as] ?? 'default-src';
        add(href[1], directive, `${file} <link rel=${rel[1]} as=${as}>`);
      } else {
        // icons, apple-touch-icon, maskable
        add(href[1], 'img-src', `${file} <link rel=${rel[1]}>`);
      }
    }
  }

  // --- CSS -----------------------------------------------------------------
  for (const { relative, text } of CSS_FILES) {
    const fontFaces = [...text.matchAll(/@font-face\s*\{[\s\S]*?\}/gi)].map((match) => match[0]);
    for (const match of fontFaces.join('\n').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      add(match[1], 'font-src', `${relative} @font-face url()`);
    }
    for (const match of text.matchAll(/@import\s*(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/gi)) {
      add(match[1], 'style-src', `${relative} @import`);
    }
    const withoutImports = text.replace(/@import[^;]*;/gi, '');
    const outsideFontFaces = fontFaces.reduce((remaining, block) => remaining.replace(block, ''), withoutImports);
    for (const match of outsideFontFaces.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      add(match[1], 'img-src', `${relative} url()`);
    }
  }

  // --- Runtime calls in application and built code ---------------------------
  const callSites = [
    [/\bfetch\(\s*[`"']([^`"']*)[`"']/g, 'connect-src'],
    [/\bapi\.(?:get|post|put|patch|delete|head|options)\(\s*[`"']([^`"']*)[`"']/g, 'connect-src'],
    [/\bnew\s+Audio\(\s*[`"']([^`"']*)[`"']/g, 'media-src'],
    [/\bnew\s+Image\(\s*[`"']([^`"']*)[`"']/g, 'img-src'],
    [/\bnew\s+EventSource\(\s*[`"']([^`"']*)[`"']/g, 'connect-src'],
    [/\bnew\s+WebSocket\(\s*[`"']([^`"']*)[`"']/g, 'connect-src'],
    [/\b(?:audio|video)\.src\s*=\s*[`"']([^`"']*)[`"']/g, 'media-src'],
    [/\bimport\(\s*["']([^"']+)["']\s*\)/g, 'script-src'],
  ];
  for (const { relative, text } of JS_FILES) {
    for (const [pattern, directive] of callSites) {
      for (const match of text.matchAll(pattern)) {
        add(match[1], directive, `${relative} runtime call`);
      }
    }
  }

  // --- The service worker the build emits -----------------------------------
  const workerFile = posix(path.posix.join('dist', WORKER_FILENAME));
  if (exists(workerFile)) {
    add(`/${WORKER_FILENAME}`, 'worker-src', `${workerFile} (registered by the built bundle)`);
  }

  // --- Needs that are object URLs rather than literals ----------------------
  if (PLAYS_DATA_MEDIA) {
    add('data:audio/webm;base64,', 'media-src', 'base64 data URL played by WaveformPlayer/Ideas');
  }
  if (PLAYS_BLOB_MEDIA) {
    add('blob:goldroad.invalid/recording', 'media-src', 'URL.createObjectURL playback in Ideas');
  }

  return references;
}

// ---------------------------------------------------------------------------
// Scope: the headers keep applying to every path
// ---------------------------------------------------------------------------

test('the header rule still applies to every path', () => {
  assert.deepStrictEqual(
    config.headers.map((rule) => rule.source),
    ['/(.*)'],
  );
});

test('the pre-existing headers keep their hardened values', () => {
  assert.strictEqual(headerValue('X-Content-Type-Options'), 'nosniff');
  assert.strictEqual(headerValue('X-Frame-Options'), 'DENY');
  assert.strictEqual(headerValue('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.strictEqual(headerValue('X-XSS-Protection'), '0');
});

test('Strict-Transport-Security keeps max-age and includeSubDomains but drops preload', () => {
  const parts = headerValue('Strict-Transport-Security').split(';').map((part) => part.trim().toLowerCase());

  const maxAge = /^max-age=(\d+)$/.exec(parts.find((part) => part.startsWith('max-age=')) ?? '');
  assert.ok(maxAge, 'max-age must be present');
  assert.ok(Number(maxAge[1]) >= 15552000, `max-age must keep at least 180 days, got ${maxAge[1]}`);

  assert.ok(parts.includes('includesubdomains'), 'includeSubDomains must be kept');
  assert.ok(!parts.includes('preload'), 'preload must be removed - the submission is irreversible');
});

// ---------------------------------------------------------------------------
// Permissions-Policy
// ---------------------------------------------------------------------------

test('Permissions-Policy allows camera and microphone for self, restoring both features', () => {
  const allowlist = (feature) => permissions().get(feature) ?? new Set();

  // Guards: the features the policy must permit are the features the app uses.
  assert.ok(REQUESTS_CAMERA, 'the app must still request the camera (barcode scanner)');
  assert.ok(REQUESTS_MICROPHONE, 'the app must still request the microphone (voice notes)');

  for (const feature of ['camera', 'microphone']) {
    assert.deepStrictEqual(
      [...allowlist(feature)].sort(),
      ['self'],
      `${feature} must be allowlisted for self only, got: ${[...allowlist(feature)].join(' ') || '(nothing)'}`,
    );
  }
});

test('Permissions-Policy disables the powerful features the app does not use', () => {
  const disabled = (feature) => permissions().has(feature) && permissions().get(feature).size === 0;

  for (const feature of [
    'geolocation',
    'usb',
    'serial',
    'bluetooth',
    'payment',
    'display-capture',
    'idle-detection',
    'magnetometer',
    'gyroscope',
    'accelerometer',
  ]) {
    assert.ok(disabled(feature), `${feature} must be disabled explicitly`);
  }
});

test('Permissions-Policy is a deliberate allowlist, not a blanket denial', () => {
  const allowed = [...permissions().entries()]
    .filter(([, allowlist]) => allowlist.size > 0)
    .map(([feature]) => feature)
    .sort();

  assert.deepStrictEqual(allowed, ['camera', 'microphone']);
});

// ---------------------------------------------------------------------------
// Content-Security-Policy - shape
// ---------------------------------------------------------------------------

test('a Content-Security-Policy is set on every response', () => {
  assert.ok(headerValue('Content-Security-Policy').trim().length > 0);
  assert.ok(csp().size > 0, 'the policy must contain directives');
});

test('script-src allows the app shell and nothing wider', () => {
  const tokens = directiveTokens('script-src');

  assert.ok(tokens.includes("'self'"), `script-src must allow the app shell, got: ${tokens.join(' ')}`);
  for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", '*', 'https:', 'http:', 'data:']) {
    assert.ok(!tokens.includes(forbidden), `script-src must not permit ${forbidden}`);
  }
});

test('nothing ships an inline script, so script-src can stay "self"', () => {
  const htmlFiles = ['index.html'];
  if (exists('dist/index.html')) {
    htmlFiles.push('dist/index.html');
  }
  assert.ok(htmlFiles.length > 0, 'no HTML found to inspect');

  for (const file of htmlFiles) {
    for (const match of readText(file).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      assert.strictEqual(match[1].trim().length, 0, `${file} ships an inline <script> block`);
    }
  }
});

test('style-src permits the built stylesheet, the inline styles and the one external sheet', () => {
  const tokens = directiveTokens('style-src');

  assert.ok(tokens.includes("'self'"), `style-src must allow the built stylesheet, got: ${tokens.join(' ')}`);
  assert.ok(!tokens.includes('*'), 'style-src must not be a wildcard');
  assert.ok(!tokens.includes('https:'), 'style-src must not be scheme-wide');
  assert.ok(!tokens.includes('http:'), 'style-src must not be scheme-wide');

  // React `style={{...}}` attributes and OfflineIndicator's <style> element cannot
  // carry a nonce, so 'unsafe-inline' is required here and only here: script-src
  // above forbids it outright.
  assert.ok(USES_INLINE_STYLES, 'the app must still use inline styles for this to be meaningful');
  assert.ok(tokens.includes("'unsafe-inline'"), "style-src must permit the app's inline style attributes and <style> element");

  // App.css imports one external stylesheet; it is the only reason style-src names a host.
  const imported = REFERENCES.filter(
    ({ directive, url }) => directive === 'style-src' && url.origin !== ORIGIN && url.protocol === 'https:',
  );
  assert.ok(imported.length > 0, 'the imported stylesheet reference was not collected');
  for (const { url, where } of imported) {
    assert.ok(directiveAdmits('style-src', url), `style-src must admit ${url.href} (from ${where})`);
  }
});

test('worker-src permits the service worker and nothing wider', () => {
  const tokens = directiveTokens('worker-src');

  assert.ok(tokens.includes("'self'"), `worker-src must be 'self', got: ${tokens.join(' ')}`);
  for (const forbidden of ['*', "'unsafe-inline'", 'https:', 'http:', 'data:', 'blob:']) {
    assert.ok(!tokens.includes(forbidden), `worker-src must not permit ${forbidden}`);
  }
});

test('connect-src admits the same-origin API and nothing wider', () => {
  const tokens = directiveTokens('connect-src');

  assert.ok(tokens.includes("'self'"), `connect-src must allow the same-origin API, got: ${tokens.join(' ')}`);
  for (const forbidden of ['*', 'https:', 'http:', 'data:', 'blob:']) {
    assert.ok(!tokens.includes(forbidden), `connect-src must not permit ${forbidden}`);
  }
});

test('the directives this app needs are all declared explicitly, not inherited', () => {
  const declared = [...csp().keys()];

  for (const directive of [
    'default-src',
    'script-src',
    'style-src',
    'img-src',
    'font-src',
    'media-src',
    'connect-src',
    'worker-src',
    'manifest-src',
    'object-src',
    'frame-src',
    'base-uri',
    'form-action',
    'frame-ancestors',
  ]) {
    assert.ok(csp().has(directive), `${directive} must be declared explicitly (declared: ${declared.join(', ')})`);
  }
});

test('default-src is "self" so nothing falls back to an open policy', () => {
  const tokens = csp().get('default-src') ?? [];

  assert.deepStrictEqual([...tokens].sort(), ["'self'"]);
});

test('the lockdown directives are present and restrictive', () => {
  assert.deepStrictEqual(csp().get('object-src'), ["'none'"]);
  assert.deepStrictEqual(csp().get('frame-src'), ["'none'"]);
  assert.deepStrictEqual(csp().get('base-uri'), ["'self'"]);
  assert.deepStrictEqual(csp().get('frame-ancestors'), ["'none'"]);
});

// ---------------------------------------------------------------------------
// Content-Security-Policy - mechanical compatibility
// ---------------------------------------------------------------------------

test('every URL the app references is admitted by the directive that governs it', () => {
  assert.ok(REFERENCES.length > 0, 'no references collected - the compatibility check is vacuous');

  const rejected = REFERENCES.filter(({ directive, url }) => !directiveAdmits(directive, url));
  assert.deepStrictEqual(
    rejected.map(({ directive, where, url }) => `${directive} blocks ${url.href} (from ${where})`),
    [],
  );
});

test('the compatibility check covers the asset classes the source contributes', () => {
  const seen = new Set(REFERENCES.map(({ directive }) => directive));

  for (const directive of ['script-src', 'style-src', 'img-src', 'media-src', 'connect-src']) {
    assert.ok(seen.has(directive), `no ${directive} reference was collected - the check above is vacuous`);
  }
});

test('the built output contributes its own references', (t) => {
  if (!exists('dist/index.html')) {
    t.skip('dist/ is missing - run npm run build so the built HTML, CSS and worker can be checked');
    return;
  }

  const built = REFERENCES.filter(({ where }) => where.startsWith('dist/'));

  assert.ok(
    built.some(({ directive }) => directive === 'script-src'),
    'the built HTML/JS must contribute script references',
  );
  assert.ok(
    built.some(({ directive }) => directive === 'style-src'),
    'the built HTML/CSS must contribute stylesheet references',
  );
  assert.ok(
    built.some(({ directive }) => directive === 'manifest-src'),
    'the built HTML must contribute the web app manifest',
  );
  assert.ok(
    built.some(({ directive }) => directive === 'worker-src'),
    'the build must contribute the service worker it registers',
  );
});

test('the emitted service worker is admitted by worker-src', (t) => {
  if (!exists(`dist/${WORKER_FILENAME}`)) {
    t.skip(`dist/${WORKER_FILENAME} is missing - run npm run build so the emitted worker can be checked`);
    return;
  }

  const registeredFrom = registersWorkerFromBuiltBundle();
  assert.ok(
    registeredFrom,
    `no built asset registers "/${WORKER_FILENAME}", so the worker would never install`,
  );

  const worker = toUrl(`/${WORKER_FILENAME}`);
  assert.ok(
    directiveAdmits('worker-src', worker),
    `worker-src must admit the emitted worker ${worker.href}`,
  );
});

test('the policy names no host or scheme the app never loads', () => {
  const used = new Set();
  for (const { directive, url } of REFERENCES) {
    for (const expression of directiveTokens(directive)) {
      if (sourceAdmits(expression, url)) {
        used.add(expression);
      }
    }
  }

  // The one documented exception: `font-src https://fonts.gstatic.com` is required by
  // the stylesheet App.css imports, which serves its @font-face files from that origin.
  // Those files are not in this repository, so no local reference can cover it.
  const DOCUMENTED_EXCEPTIONS = new Set(['https://fonts.gstatic.com']);

  const unused = [];
  for (const [directive, tokens] of csp()) {
    for (const expression of tokens) {
      if (KEYWORD_SOURCES.has(expression) || DOCUMENTED_EXCEPTIONS.has(expression)) {
        continue;
      }
      if (!used.has(expression)) {
        unused.push(`${directive} ${expression}`);
      }
    }
  }

  assert.deepStrictEqual(unused, []);
});
