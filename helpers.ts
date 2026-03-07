import * as coda from "@codahq/packs-sdk";

/**
 * Canonical Sandcastle middleware URL used by the Pack.
 * Keep the deployment target centralized here so the Pack host allowlist
 * and all API callers stay in sync.
 */
export const MIDDLEWARE_BASE_URL = "https://middleware-psi-five.vercel.app";
export const MIDDLEWARE_HOSTNAME = MIDDLEWARE_BASE_URL.replace(
  /^https?:\/\//,
  ""
).replace(/\/.*$/, "");

/**
 * Builds a full middleware API URL.
 */
export function apiUrl(path: string, query?: Record<string, string>): string {
  const url = `${MIDDLEWARE_BASE_URL}${path}`;
  if (query) {
    return coda.withQueryParams(url, query);
  }
  return url;
}
