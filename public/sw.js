// Service worker minimal : rend l'app installable sans mettre en cache les données.
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", () => {});
