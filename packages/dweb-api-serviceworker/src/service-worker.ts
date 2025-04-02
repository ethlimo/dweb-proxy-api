import {
  contentTypeParser,
  createBrowserConfig,
  createServiceWorker,
  resolveUrl,
} from "lib.js";
import { createHeliaHTTP } from "@helia/http";
import { VerifiedFetch, createVerifiedFetch } from "@helia/verified-fetch";

self.addEventListener("install", (event) => {
  (event as any).waitUntil((self as any).skipWaiting());
});

self.addEventListener("activate", (event) => {
  (event as any).waitUntil((self as any).clients.claim());
});

var verifiedFetch: null | VerifiedFetch = null;

const innerEventHandler = async (event: any): Promise<Response> => {
  const config = createBrowserConfig();
  const services = await createServiceWorker(config);
  const { logger } = services;
  if (config.verifiedFetch && verifiedFetch === null) {
    logger.info("Creating verified fetch", {
      origin: "service-worker-fetch",
      trace: "service-worker",
    });

    //TODO: this needs to have configuration options
    verifiedFetch = await createVerifiedFetch(await createHeliaHTTP(), {
      contentTypeParser,
    });
  }
  let url = new URL(event.request.url);
  if (!process.env.SW_BUNDLE_PUBLIC_URL) {
    throw "SW_BUNDLE_PUBLIC_URL not set";
  }
  const SW_BUNDLE_PUBLIC_URL = new URL(process.env.SW_BUNDLE_PUBLIC_URL);

  if (
    (url.hostname === SW_BUNDLE_PUBLIC_URL.hostname ||
      url.hostname.endsWith("." + SW_BUNDLE_PUBLIC_URL.hostname)) &&
    (url.pathname === "/_limo_loader_main.js" ||
      url.pathname === "/_limo_loader_worker.js")
  ) {
    logger.info("Serving bundle", {
      origin: "service-worker-fetch",
      trace: "service-worker",
      context: {
        url: url.toString(),
      },
    });
    const request = new Request(event.request);
    return fetch(request);
  }

  const resolvedUrl = await resolveUrl(url.toString(), config, services);
  if (!resolvedUrl) {
    const response = new Response(undefined, {
      status: 404,
      statusText: "ENS name doesn't exist",
    });

    return response;
  } else if (resolvedUrl._tag === "UrlIsNotEnsName") {
    return fetch(event.request.url, prepareFetchInit(event, false));
  } else if (resolvedUrl._tag === "FetchableByUrl") {
    logger.info("Fetching", {
      origin: "service-worker-fetch",
      trace: "service-worker",
      context: {
        url: resolvedUrl.url.toString(),
      },
    });
    const new_location = new URL(resolvedUrl.url);
    new_location.pathname = url.pathname;
    new_location.search = url.search;
    new_location.searchParams.delete("limoCacheBuster");
    url = new_location;
    const newRequest = prepareFetchUrl(event, url, false);
    return fetch(newRequest.url, newRequest.requestInit);
  } else if (resolvedUrl._tag === "FetchableByVerifiedFetch") {
    if (verifiedFetch === null) {
      throw new Error("verifiedFetch is not set");
    }
    logger.info("Verified fetch", {
      origin: "service-worker-fetch",
      trace: "service-worker",
      context: {
        url: resolvedUrl.hostname,
      },
    });
    console.log("Verified fetch", resolvedUrl.hostname);
    var ret = await verifiedFetch(
      resolvedUrl.hostname,
      prepareFetchInit(event, false),
    );
    var old_ret = ret;
    do {
      old_ret = ret;
      if (ret.redirected) {
        ret = await verifiedFetch(ret.url, prepareFetchInit(event, false));
      }
      if (
        ret.status === 301 ||
        ret.status === 302 ||
        ret.status === 303 ||
        ret.status === 307 ||
        ret.status === 308
      ) {
        ret = await verifiedFetch(
          ret.headers.get("Location") as string,
          prepareFetchInit(event, false),
        );
      }
    } while (old_ret !== ret);

    console.log(ret);

    return ret;
  }

  // This is a totality check to ensure that we are handling all cases
  // it should always be of type never
  const totalityCheck = resolvedUrl;
  return totalityCheck;
};

self.addEventListener("fetch", (event: any) => {
  event.respondWith(innerEventHandler(event));
});
function prepareFetchUrl(
  event: any,
  url: URL,
  allowCredentials: boolean = true,
) {
  const requestInit = prepareFetchInit(event, allowCredentials);
  // Create a new request with the updated URL
  const newRequest = { url, requestInit };

  console.log("Responding with", newRequest);
  return newRequest;
}

function prepareFetchInit(event: any, allowCredentials: boolean) {
  return {
    method: event.request.method,
    headers: event.request.headers,
    mode: "cors" as RequestMode,
    credentials: allowCredentials ? event.request.credentials : "omit",
    redirect: event.request.redirect,
    referrer: event.request.referrer,
    body: event.request.body,
    cache: event.request.cache,
    integrity: event.request.integrity,
    keepalive: event.request.keepalive,
    duplex: event.request.duplex ?? "half",
  };
}
