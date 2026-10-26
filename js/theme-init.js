// Aplica el tema guardado antes de pintar (evita el parpadeo). Debe ser un archivo externo: MV3 prohíbe scripts inline.
try {
  const theme = localStorage.getItem('gt_theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // localStorage no disponible: se usa el tema del sistema
}
