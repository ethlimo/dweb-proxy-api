import { AsyncLocalStorage } from "node:async_hooks";

// Limits which hosts global fetch may talk to while `fn` runs.
//
// This exists for @web3-name-sdk: it builds its viem clients internally
// and doesn't let us pass options, and viem follows CCIP-read
// (OffchainLookup) urls by default with a plain fetch, no checks on the
// address and no timeout. The resolver contract, and therefore those
// urls, are chosen by the name owner. Inside `fn` only the given RPC
// endpoints can be reached, so the SDK still works but any other request
// fails.
//
// The restriction only applies inside the AsyncLocalStorage context of
// `fn`, every other fetch in the process is left alone.

const allowedOrigins = new AsyncLocalStorage<Set<string>>();
let installed = false;

const originOf = (input: string | URL | Request) =>
  new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  ).origin;

function install() {
  if (installed) return;
  installed = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const allowed = allowedOrigins.getStore();
    if (allowed) {
      let origin: string;
      try {
        origin = originOf(input);
      } catch (e) {
        return Promise.reject(e);
      }
      if (!allowed.has(origin)) {
        return Promise.reject(
          new Error(`fetch to ${origin} is not allowed in this context`),
        );
      }
    }
    return originalFetch(input, init);
  };
}

export function onlyFetchFrom<T>(
  endpoints: string[],
  fn: () => Promise<T>,
): Promise<T> {
  install();
  return allowedOrigins.run(new Set(endpoints.map(originOf)), fn);
}
