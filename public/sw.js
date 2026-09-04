// Dieser Service Worker raeumt sich selbst ab.
//
// Frueher hat er die Programmoberflaeche zwischengespeichert, damit die Booth
// einen kurzen WLAN-Aussetzer uebersteht. Der Preis war zu hoch: Nach einem
// Update lieferte er die alte Seite aus, und war der Server nicht erreichbar,
// zeigte er eine Booth, die zwar aussah wie immer, aber nichts konnte - keine
// Einstellungen, kein Speichern, keine Kamera. Ein ehrlicher Fehler ist an der
// Stelle mehr wert als eine Seite, die Betrieb vortaeuscht.
//
// Die Datei bleibt bestehen, damit Browser mit alter Registrierung sie noch
// abholen und sich abmelden.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});
