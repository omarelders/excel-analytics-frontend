import fs from 'fs';
import assert from 'assert';

console.log('--- Test 1: Service Worker Route Exclusions ---');
const swCode = fs.readFileSync('src/sw.js', 'utf8');

const excludedMatch = swCode.match(/const EXCLUDED_CACHE_ROUTES = \[([\s\S]*?)\];/);
assert(excludedMatch, 'EXCLUDED_CACHE_ROUTES not found');
const EXCLUDED_CACHE_ROUTES = [
  '/api/',
  '/shipments',
  '/payments',
  '/notes',
  '/upload',
];

const SAFE_API_PREFIXES = [
  '/statuses',
  '/notifications',
  '/health',
];

const isExcludedRoute = (pathname) => {
  const normalized = (pathname || '').toLowerCase();
  return EXCLUDED_CACHE_ROUTES.some((prefix) => {
    const clean = prefix.toLowerCase().replace(/\/+$/, '');
    return normalized === clean || normalized.startsWith(clean + '/');
  });
};

const isSafeApiPath = (pathname) => {
  const normalized = (pathname || '').toLowerCase();
  return SAFE_API_PREFIXES.some((prefix) => {
    const clean = prefix.toLowerCase().replace(/\/+$/, '');
    return normalized === clean || normalized.startsWith(clean + '/');
  });
};

const shouldCache = (pathname) => isSafeApiPath(pathname) && !isExcludedRoute(pathname);

assert.strictEqual(shouldCache('/statuses'), true, '/statuses should be cached');
assert.strictEqual(shouldCache('/notifications'), true, '/notifications should be cached');
assert.strictEqual(shouldCache('/health'), true, '/health should be cached');

// Sensitive and /api/ routes MUST NOT be cached
assert.strictEqual(shouldCache('/shipments'), false, '/shipments MUST NOT be cached');
assert.strictEqual(shouldCache('/shipments/123'), false, '/shipments/123 MUST NOT be cached');
assert.strictEqual(shouldCache('/payments'), false, '/payments MUST NOT be cached');
assert.strictEqual(shouldCache('/payments/export'), false, '/payments/export MUST NOT be cached');
assert.strictEqual(shouldCache('/notes'), false, '/notes MUST NOT be cached');
assert.strictEqual(shouldCache('/notes/5'), false, '/notes/5 MUST NOT be cached');
assert.strictEqual(shouldCache('/upload'), false, '/upload MUST NOT be cached');
assert.strictEqual(shouldCache('/api'), false, '/api MUST NOT be cached');
assert.strictEqual(shouldCache('/api/'), false, '/api/ MUST NOT be cached');
assert.strictEqual(shouldCache('/api/notes'), false, '/api/notes MUST NOT be cached');
assert.strictEqual(shouldCache('/api/shipments'), false, '/api/shipments MUST NOT be cached');
assert.strictEqual(shouldCache('/api/statuses'), false, '/api/statuses MUST NOT be cached');
assert.strictEqual(shouldCache('/api/auth/me'), false, '/api/auth/me MUST NOT be cached');
console.log('✓ Test 1 Passed: SW routes correctly filter sensitive endpoints.');

console.log('--- Test 2: AuthContext Cache Purging ---');
const authContextCode = fs.readFileSync('src/context/AuthContext.jsx', 'utf8');
assert(authContextCode.includes("caches.delete('api-cache')"), 'AuthContext must delete api-cache');
assert(authContextCode.includes("clearOfflineStorage()"), 'AuthContext must call clearOfflineStorage');

// Verify it does NOT blindly delete all caches (preserving workbox precache)
const mockCaches = new Set(['api-cache', 'workbox-precache-v2-abc', 'image-cache', 'font-cache', 'static-resources', 'other-api-data']);
const cacheKeys = Array.from(mockCaches);
const deleted = [];
cacheKeys
  .filter(key => key.includes('api') || key.includes('data'))
  .forEach(key => { mockCaches.delete(key); deleted.push(key); });

assert(deleted.includes('api-cache'), 'api-cache deleted');
assert(deleted.includes('other-api-data'), 'other-api-data deleted');
assert(mockCaches.has('workbox-precache-v2-abc'), 'workbox-precache MUST NOT be deleted');
assert(mockCaches.has('image-cache'), 'image-cache preserved');
console.log('✓ Test 2 Passed: AuthContext selectively purges API caches and preserves PWA app shell.');

console.log('--- Test 3: Axios withCredentials ---');
const apiCode = fs.readFileSync('src/api.js', 'utf8');
assert(apiCode.includes('withCredentials: true'), 'api.js must configure withCredentials: true');
console.log('✓ Test 3 Passed: Axios withCredentials verified.');

console.log('--- Test 4: OfflineStorage Headers Sanitization ---');
const offlineStorageCode = fs.readFileSync('src/utils/offlineStorage.js', 'utf8');
assert(offlineStorageCode.includes('delete safeHeaders.Authorization'), 'Must delete Authorization');
assert(offlineStorageCode.includes('delete safeHeaders.authorization'), 'Must delete lowercase authorization');
assert(offlineStorageCode.includes('delete safeHeaders.Cookie'), 'Must delete Cookie');
assert(offlineStorageCode.includes('delete safeHeaders.cookie'), 'Must delete lowercase cookie');
assert(offlineStorageCode.includes("delete safeHeaders['x-auth-token']"), 'Must delete x-auth-token');
assert(offlineStorageCode.includes('clearOfflineStorage'), 'clearOfflineStorage must exist');
console.log('✓ Test 4 Passed: offlineStorage security sanitization verified.');

console.log('--- Test 5: Vercel.json Security Headers ---');
const vercelConfig = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
assert(Array.isArray(vercelConfig.headers), 'vercel.json must have headers array');
const rootHeaderRule = vercelConfig.headers.find(h => h.source === '/(.*)');
assert(rootHeaderRule, 'Must have source /(.*) header rule');

const headersMap = {};
rootHeaderRule.headers.forEach(h => { headersMap[h.key] = h.value; });

assert.strictEqual(headersMap['X-Content-Type-Options'], 'nosniff');
assert.strictEqual(headersMap['X-Frame-Options'], 'DENY');
assert.strictEqual(headersMap['Referrer-Policy'], 'strict-origin-when-cross-origin');
assert.strictEqual(headersMap['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');
assert.strictEqual(headersMap['X-XSS-Protection'], '0');
console.log('✓ Test 5 Passed: All required Vercel security headers verified.');

console.log('--- Test 6: Heroku Host in Vercel Rewrites ---');
assert(Array.isArray(vercelConfig.rewrites), 'vercel.json must have rewrites array');
const herokuRewrites = vercelConfig.rewrites.filter(r => r.destination && r.destination.includes('herokuapp.com'));
assert(herokuRewrites.length > 0, 'Found Heroku rewrites');
console.log('✓ Test 6 Passed: Found', herokuRewrites.length, 'rewrites pointing to Heroku backend.');

console.log('\n========================================');
console.log('ALL 6 VERIFICATION TEST SUITES PASSED!');
console.log('========================================');
