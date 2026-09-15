
// Service Worker TURFEX PWA — v2 (cache invalidation aggressive)
// Stratégie :
//  - Network-first pour index.html et /api/ (toujours frais, fallback cache si offline)
//  - Cache-first pour les assets versionnés /static/* (immutable, hashes uniques)
//  - skipWaiting + clients.claim → nouvelle version active dès l'install
//  - Force le reload de tous les onglets quand le SW change

const CACHE_VERSION = "turfex-v6";
const HTML_CACHE = `${CACHE_VERSION}-html`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

self.addEventListener("install", (event) => {
  // Force le SW nouveau à devenir actif immédiatement (sans attendre fermeture des onglets)
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Supprime tous les caches non-current (purge old versions)
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => !n.startsWith(CACHE_VERSION))
          .map((n) => caches.delete(n))
      );
      // Prend le contrôle de tous les onglets ouverts immédiatement
      await self.clients.claim();
      // Notifie tous les clients qu'une nouvelle version est active → reload auto
      const clientsList = await self.clients.matchAll({ type: "window" });
      clientsList.forEach((client) => {
        client.postMessage({ type: "SW_UPDATED", version: CACHE_VERSION });
      });
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1. API : network-first court timeout, fallback cache
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Cache OK responses for offline fallback
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 2. Assets versionnés (/static/, hashes uniques) : cache-first (immutable)
  if (url.pathname.startsWith("/static/") || /\.[a-f0-9]{8,}\.(js|css|woff2?|png|svg|jpg|webp)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // 3. HTML / navigation / index : NETWORK-FIRST (toujours frais, fallback cache si offline)
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(HTML_CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // 4. Autre (fonts externes, images sans hash, etc.) : network-first léger
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type !== "opaque" && !url.protocol.startsWith("chrome-extension")) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// Notifications cliquées
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});

// Notifications déclenchées depuis le client
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === "SHOW_NOTIFICATION") {
    const { title, body, icon, tag, data } = event.data.payload || {};
    self.registration.showNotification(title || "TURFEX", {
      body: body || "",
      icon: icon || "/icon-192.png",
      badge: "/icon-192.png",
      tag: tag || "turfex-notif",
      data: data || {},
      vibrate: [200, 100, 200],
      requireInteraction: false,
    });
  }
});

