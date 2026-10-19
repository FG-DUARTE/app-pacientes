/**
 * Cupo de favores — módulo
 * Integración: window.CupoFavores.init({ root, getClient, getUser })
 */
(function (global) {
  "use strict";

  const QUOTA_MIN = 1;
  const QUOTA_MAX = 20;
  const QUOTA_DEFAULT = 4;
  const SAVED_FLASH_MS = 2200;

  let rootEl = null;
  let mounted = false;
  let deps = null;

  let confirmedQuota = QUOTA_DEFAULT;
  let displayQuota = QUOTA_DEFAULT;
  let controlsEnabled = false;
  let loading = false;

  let saveChain = Promise.resolve();
  let pendingSaveValue = null;
  let saving = false;
  let savedFlashTimer = null;
  let loadToken = 0;

  let elFeedback = null;
  let elValue = null;
  let btnMinus = null;
  let btnPlus = null;

  function client() {
    return deps?.getClient?.() || null;
  }

  function userId() {
    return deps?.getUser?.()?.id || null;
  }

  function clampQuota(n) {
    return Math.min(QUOTA_MAX, Math.max(QUOTA_MIN, n));
  }

  function setFeedback(text, kind) {
    if (!elFeedback) return;
    elFeedback.textContent = text || "";
    elFeedback.classList.remove("is-saving", "is-ok", "is-error");
    if (kind) elFeedback.classList.add(kind);
  }

  function updateStepperUI() {
    if (elValue) elValue.textContent = String(displayQuota);
    if (btnMinus) btnMinus.disabled = !controlsEnabled || loading || saving || displayQuota <= QUOTA_MIN;
    if (btnPlus) btnPlus.disabled = !controlsEnabled || loading || saving || displayQuota >= QUOTA_MAX;
  }

  function renderShell(root) {
    root.innerHTML =
      '<section class="cupo-favores-card card" aria-labelledby="cupoFavoresHeading">' +
      '<h2 id="cupoFavoresHeading" class="cupo-favores-title">Cupo de favores</h2>' +
      '<p class="cupo-favores-lead">Organizá los estudios que incorporás a tu agenda y controlá tu disponibilidad semanal</p>' +
      '<div class="cupo-quota-block">' +
      '<p class="cupo-quota-label">Cupo semanal</p>' +
      '<div class="cupo-quota-row">' +
      '<div class="cupo-quota-stepper" role="group" aria-label="Cupo semanal">' +
      '<button type="button" id="cupoQuotaMinus" aria-label="Disminuir cupo">−</button>' +
      '<span class="cupo-quota-value" id="cupoQuotaValue" aria-live="polite">' +
      String(QUOTA_DEFAULT) +
      "</span>" +
      '<button type="button" id="cupoQuotaPlus" aria-label="Aumentar cupo">+</button>' +
      "</div></div>" +
      '<p class="cupo-quota-feedback" id="cupoQuotaFeedback" role="status"></p>' +
      "</div>" +
      '<div class="cupo-favores-status pill" style="margin-top:16px" role="status">' +
      "El módulo está preparado. Próximamente podrás registrar y consultar tus favores" +
      "</div>" +
      "</section>";

    elFeedback = root.querySelector("#cupoQuotaFeedback");
    elValue = root.querySelector("#cupoQuotaValue");
    btnMinus = root.querySelector("#cupoQuotaMinus");
    btnPlus = root.querySelector("#cupoQuotaPlus");

    btnMinus.addEventListener("click", () => adjustQuota(-1));
    btnPlus.addEventListener("click", () => adjustQuota(1));
  }

  function resetModuleState() {
    confirmedQuota = QUOTA_DEFAULT;
    displayQuota = QUOTA_DEFAULT;
    controlsEnabled = false;
    loading = false;
    saveChain = Promise.resolve();
    pendingSaveValue = null;
    saving = false;
    if (savedFlashTimer) {
      clearTimeout(savedFlashTimer);
      savedFlashTimer = null;
    }
    loadToken++;
  }

  async function loadQuotaFromDb() {
    const uid = userId();
    const sb = client();
    const token = ++loadToken;
    if (!uid || !sb) {
      setFeedback("Iniciá sesión para configurar tu cupo.", "is-error");
      updateStepperUI();
      return;
    }

    loading = true;
    controlsEnabled = false;
    setFeedback("Cargando cupo…", "");
    updateStepperUI();

    const { data, error } = await sb
      .from("favor_settings")
      .select("weekly_quota")
      .eq("user_id", uid)
      .maybeSingle();

    if (token !== loadToken) return;

    loading = false;
    if (error) {
      setFeedback("No se pudo cargar el cupo. Reintentá más tarde.", "is-error");
      updateStepperUI();
      return;
    }

    if (data && typeof data.weekly_quota === "number") {
      confirmedQuota = clampQuota(data.weekly_quota);
    } else {
      confirmedQuota = QUOTA_DEFAULT;
    }
    displayQuota = confirmedQuota;
    controlsEnabled = true;
    setFeedback("", "");
    updateStepperUI();
  }

  async function persistQuotaToDb(value) {
    const uid = userId();
    const sb = client();
    if (!uid || !sb) return { ok: false, error: "Sin sesión" };

    const { error } = await sb.from("favor_settings").upsert(
      { user_id: uid, weekly_quota: value },
      { onConflict: "user_id" }
    );

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  function enqueueSave(targetValue) {
    pendingSaveValue = targetValue;
    saveChain = saveChain
      .then(async () => {
        while (pendingSaveValue !== null) {
          const valueToWrite = pendingSaveValue;
          pendingSaveValue = null;
          saving = true;
          setFeedback("Guardando…", "is-saving");
          updateStepperUI();

          const result = await persistQuotaToDb(valueToWrite);

          if (pendingSaveValue !== null) continue;

          saving = false;
          if (result.ok) {
            confirmedQuota = valueToWrite;
            displayQuota = valueToWrite;
            setFeedback("Guardado", "is-ok");
            if (savedFlashTimer) clearTimeout(savedFlashTimer);
            savedFlashTimer = setTimeout(() => {
              if (!saving && !loading) setFeedback("", "");
            }, SAVED_FLASH_MS);
          } else {
            displayQuota = confirmedQuota;
            setFeedback(
              "No se pudo guardar el cupo. " + (result.error || "Reintentá."),
              "is-error"
            );
          }
          updateStepperUI();
        }
      })
      .catch(() => {
        saving = false;
        displayQuota = confirmedQuota;
        setFeedback("Error al guardar. Reintentá.", "is-error");
        updateStepperUI();
      });
  }

  function adjustQuota(delta) {
    if (!controlsEnabled || loading || saving) return;
    const next = clampQuota(displayQuota + delta);
    if (next === displayQuota) return;
    displayQuota = next;
    updateStepperUI();
    enqueueSave(next);
  }

  const CupoFavores = {
    init(options) {
      if (!options?.root) return;
      deps = {
        getClient: options.getClient || (() => null),
        getUser: options.getUser || (() => null),
      };
      rootEl = options.root;
      if (!mounted) {
        resetModuleState();
        renderShell(rootEl);
        mounted = true;
      }
    },

    onShow() {
      if (!mounted || !rootEl) return;
      loadQuotaFromDb();
    },

    onHide() {},

    reset() {
      resetModuleState();
      mounted = false;
      rootEl = null;
      deps = null;
      elFeedback = null;
      elValue = null;
      btnMinus = null;
      btnPlus = null;
    },

    destroy() {
      if (rootEl) rootEl.innerHTML = "";
      this.reset();
    },
  };

  global.CupoFavores = CupoFavores;
})(typeof window !== "undefined" ? window : globalThis);
