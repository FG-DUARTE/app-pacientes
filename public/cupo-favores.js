/**
 * Cupo de favores — módulo (Fase 1: shell UI)
 * Integración: window.CupoFavores.init({ root, getClient, getUser })
 */
(function (global) {
  "use strict";

  let rootEl = null;
  let mounted = false;
  let deps = null;

  function renderPlaceholder(root) {
    root.innerHTML =
      '<section class="cupo-favores-card card" aria-labelledby="cupoFavoresHeading">' +
      '<h2 id="cupoFavoresHeading" class="cupo-favores-title">Cupo de favores</h2>' +
      '<p class="cupo-favores-lead">Organizá los estudios que incorporás a tu agenda y controlá tu disponibilidad semanal</p>' +
      '<div class="cupo-favores-status pill" role="status">' +
      "El módulo está preparado. Próximamente podrás registrar y consultar tus favores" +
      "</div>" +
      "</section>";
  }

  const CupoFavores = {
    /**
     * @param {{ root: HTMLElement, getClient: () => unknown, getUser: () => { id?: string } | null }} options
     */
    init(options) {
      if (!options?.root) return;
      deps = {
        getClient: options.getClient || (() => null),
        getUser: options.getUser || (() => null),
      };
      rootEl = options.root;
      if (!mounted) {
        renderPlaceholder(rootEl);
        mounted = true;
      }
    },

    /** Ocultar/mostrar lo gestiona app.html; útil en fases futuras */
    onShow() {},

    onHide() {},

    reset() {
      mounted = false;
      rootEl = null;
      deps = null;
    },

    destroy() {
      if (rootEl) rootEl.innerHTML = "";
      this.reset();
    },
  };

  global.CupoFavores = CupoFavores;
})(typeof window !== "undefined" ? window : globalThis);
