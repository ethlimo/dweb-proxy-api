import { createBrowserConfig, createServiceWorker, resolveUrl } from "lib.js";

(async () => {
  if ("serviceWorker" in navigator) {
    const swContainer = navigator.serviceWorker as ServiceWorkerContainer;
    const controller = swContainer.controller;
    if (!controller) {
      await Promise.all(
        (await swContainer.getRegistrations()).map((registration) => {
          return registration.unregister().then((success) => {
            if (success) {
              console.log("Unregistered service worker", registration.scope);
            } else {
              console.error(
                "Failed to unregister service worker",
                registration.scope,
              );
            }
          });
        }),
      );
    }

    const config = createBrowserConfig();
    const services = await createServiceWorker(config);
    const location = window.location.toString();
    const shouldReload = await resolveUrl(location, config, services).then(
      (x) => {
        if (
          x?._tag === "FetchableByUrl" ||
          x?._tag === "FetchableByVerifiedFetch"
        ) {
          return true;
        } else {
          console.error("Failed to resolve URL", location);
          return false;
        }
      },
    );

    try {
      const registration = await swContainer.register("/_limo_loader_sw.js", {
        scope: "/",
      });
      console.log("Service Worker registered with scope:", registration.scope);

      // Wait for the service worker to activate and control the page
      if (
        registration.active ||
        registration.waiting ||
        registration.installing
      ) {
        await new Promise((resolve) => {
          const onStateChange = (worker: ServiceWorker | null) => {
            if (worker?.state === "activated") {
              resolve(true);
            }
          };

          if (registration.active) {
            resolve(true);
          } else if (registration.installing) {
            registration.installing.addEventListener("statechange", (event) =>
              onStateChange(event.target as ServiceWorker),
            );
          } else if (registration.waiting) {
            registration.waiting.addEventListener("statechange", (event) =>
              onStateChange(event.target as ServiceWorker),
            );
          }
        });

        if (!(await navigator.serviceWorker.ready).active) {
          console.error("Service Worker failed to activate");
        } else if (shouldReload) {
          window.location.reload();
        }
      }
    } catch (error) {
      console.error("Service Worker registration failed:", error);
    }
  }
})();
