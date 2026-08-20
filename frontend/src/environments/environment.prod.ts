/**
 * Production build. Every URL is relative on purpose — the deployed app never names its own backend.
 *
 * Whatever origin serves index.html also answers /api, /hubs and /uploads. That is true in both
 * supported deployments:
 *
 *   - the .NET API serves the built SPA out of wwwroot, so there is only ever one origin; or
 *   - a static host (Vercel, Netlify) serves the SPA and proxies those three prefixes to the API.
 *
 * Either way the browser only ever talks to the origin it loaded from, which means no CORS
 * preflight, no mixed-content warning, and no rebuild when the API moves. The backend's address
 * becomes a deployment detail rather than something compiled into the bundle.
 */
export const environment = {
  apiUrl: '/api',
  filesUrl: '',
  hubUrl: '/hubs',
};
