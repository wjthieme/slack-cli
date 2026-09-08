import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

import { DEBUG, debug } from "./debug.js";

/**
 * If only `ALL_PROXY` / `all_proxy` is set (common in terminals), copy it to
 * `http_proxy` / `https_proxy` so undici's EnvHttpProxyAgent sees it.
 */
function applyAllProxyFallback(): void {
  const all =
    process.env.all_proxy?.trim() ||
    process.env.ALL_PROXY?.trim() ||
    "";
  if (!all) return;
  const hasHttps =
    Boolean(process.env.https_proxy?.trim()) || Boolean(process.env.HTTPS_PROXY?.trim());
  const hasHttp =
    Boolean(process.env.http_proxy?.trim()) || Boolean(process.env.HTTP_PROXY?.trim());
  if (!hasHttps) process.env.https_proxy = all;
  if (!hasHttp) process.env.http_proxy = all;
}

function proxyVarsPresent(): boolean {
  applyAllProxyFallback();
  return (
    Boolean(process.env.http_proxy?.trim()) ||
    Boolean(process.env.HTTP_PROXY?.trim()) ||
    Boolean(process.env.https_proxy?.trim()) ||
    Boolean(process.env.HTTPS_PROXY?.trim())
  );
}

/**
 * Wire global `fetch` (Node's undici-backed implementation) to honor
 * `http_proxy`, `https_proxy`, `no_proxy`, `all_proxy`, and uppercase variants.
 */
export function applyTerminalProxyToGlobalFetch(): void {
  if (!proxyVarsPresent()) return;
  setGlobalDispatcher(new EnvHttpProxyAgent());
  if (DEBUG) {
    debug("proxy: global fetch dispatcher set to EnvHttpProxyAgent");
  }
}

applyTerminalProxyToGlobalFetch();
