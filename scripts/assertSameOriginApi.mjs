/**
 * Build-time guard for `VITE_FORCE_EXTERNAL_API`.
 *
 * `src/config/apiBaseUrl.js` treats `VITE_FORCE_EXTERNAL_API=true` as "ignore the
 * hostname and talk to the Heroku origin directly", which makes every request the
 * app sends cross-origin. The CSP that `vercel.json` ships pins
 * `connect-src 'self'`, so on that configuration every one of those requests is
 * blocked by the browser: no login, no read, no write, and nothing in the build
 * output says why. It fails silently and totally, which is why it gets a guard
 * rather than a comment.
 *
 * The flag has no effect anywhere it can be watched, either: `shouldUseSameOriginApi()`
 * already returns false for `localhost` and every non-production hostname, so the
 * only environments it changes are the ones behind the CSP. Failing at config load -
 * build and dev alike - costs nothing where it does nothing and saves a deployment
 * where it would have blanked the site.
 *
 * Docs: `docs/DEPLOYMENT.md` §2.
 */

const FLAG = 'VITE_FORCE_EXTERNAL_API';

const isSet = (value) => typeof value === 'string' && value.trim().toLowerCase() === 'true';

/** True when the environment forces the external API base URL. */
export const forceExternalApiIsSet = (env = process.env) => isSet(env?.[FLAG]);

/**
 * Throws when the build would produce an app the shipped CSP then blocks.
 *
 * `env` is a parameter so a test can drive this directly instead of by setting a
 * variable and re-running the build.
 */
export const assertApiBaseIsSameOriginSafe = (env = process.env) => {
  if (!forceExternalApiIsSet(env)) {
    return true;
  }

  throw new Error(
    `${FLAG}=${env[FLAG]} makes API_BASE_URL the external origin, and every request then cross-origin, ` +
      `which "connect-src 'self'" in vercel.json blocks. Unset it and let the rewrites in ` +
      `vercel.json proxy the API on the same origin - see docs/DEPLOYMENT.md.`,
  );
};
