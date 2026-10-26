// Script clásico (no módulo). Cubre dos casos en los que la app saldría en blanco sin explicación:
//  1) Se abre con doble clic (file://): los módulos ES quedan bloqueados por CORS.
//  2) El navegador es demasiado antiguo para los estilos (light-dark(): Chrome/Edge 123, Safari/iOS 17.5).
if (location.protocol === 'file:') {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.style.overflow = 'auto';
    document.body.innerHTML = `
      <main style="max-width:540px;margin:8vh auto;padding:0 24px;line-height:1.5">
        <h1 style="font-size:26px;margin:0 0 6px;letter-spacing:-0.02em">Esta página no se puede abrir con doble clic</h1>
        <p style="margin:0 0 20px;opacity:.7">Es parte de una extensión de navegador (o de una web) y necesita instalarse o publicarse.</p>
        <p style="margin:0 0 6px"><b>Extensión de escritorio (Chrome / Edge):</b></p>
        <ol style="padding-left:22px;margin:0 0 20px">
          <li>Abre <b>chrome://extensions</b> (o <b>edge://extensions</b>) escribiéndolo en la barra de direcciones.</li>
          <li>Activa <b>Modo de desarrollador</b>.</li>
          <li>Pulsa <b>Cargar descomprimida</b> y elige <b>la carpeta</b> del proyecto (la que contiene <code>manifest.json</code>).</li>
          <li>Abre la app desde el icono de la extensión; el botón <b>↗</b> la abre completa.</li>
        </ol>
        <p style="margin:0 0 6px"><b>iPhone / web:</b> publica la carpeta <code>web</code> en un alojamiento con HTTPS y ábrela desde Safari.</p>
        <p style="margin:12px 0 0;opacity:.6;font-size:13px">Más detalles en README.md.</p>
      </main>`;
  });
} else if (window.CSS && CSS.supports && !CSS.supports('color', 'light-dark(red, blue)')) {
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;inset:0 0 auto 0;z-index:99;padding:12px 16px;background:#ff9500;color:#000;font:600 14px system-ui;text-align:center';
    bar.textContent = 'Tu navegador es demasiado antiguo: actualiza Chrome/Edge (123+) o iOS (17.5+) para ver bien la app.';
    document.body.append(bar);
  });
}
