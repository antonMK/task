// Registra el service worker (uso sin conexión). Solo en HTTPS o localhost.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // Si ya había una versión instalada y se activa otra nueva, recarga una vez para usar la nueva
  // (la primera instalación no recarga).
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) location.reload();
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
