/**
 * Cupo de favores — módulo (Fases 2–4)
 * Integración: window.CupoFavores.init({ root, getClient, getUser })
 */
(function (global) {
  "use strict";

  const QUOTA_MIN = 1;
  const QUOTA_MAX = 20;
  const QUOTA_DEFAULT = 4;
  const SAVED_FLASH_MS = 2200;
  const DAY_TOAST_MS = 3200;

  const MODALITIES = ["TC", "RM", "Ecografía", "Rx", "Mamografía", "Otro"];
  const PATIENT_REF_MAX = 32;
  const REQUESTER_MAX = 120;
  const NOTE_MAX = 500;
  const MODALITY_OTHER_MAX = 80;
  const MSG_PAST_STUDY_DATE =
    "No se puede registrar un favor en una fecha pasada. Seleccioná la fecha de hoy o una posterior";
  const MSG_INVALID_STUDY_DATE = "Indicá una fecha válida con formato DD/MM/AAAA.";

  const MONTH_NAMES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const DOW_HEADERS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  let rootEl = null;
  let mounted = false;
  let deps = null;

  let confirmedQuota = QUOTA_DEFAULT;
  let displayQuota = QUOTA_DEFAULT;
  let controlsEnabled = false;
  let loadingQuota = false;

  let saveChain = Promise.resolve();
  let pendingSaveValue = null;
  let saving = false;
  let savedFlashTimer = null;
  let quotaLoadToken = 0;

  let viewYear = 0;
  let viewMonth = 0;
  let selectedYMD = "";
  let favorEntries = [];
  let entriesLoading = false;
  let entriesError = null;
  let entriesLoadToken = 0;

  let requesterNames = [];
  let requesterLoadToken = 0;

  let elFeedback = null;
  let elValue = null;
  let btnMinus = null;
  let btnPlus = null;
  let elCalMount = null;

  let elModalOverlay = null;
  let elModalForm = null;
  let elModalTitle = null;
  let elModalError = null;
  let elModalStudyDateDisplay = null;
  let elModalStudyDateNative = null;
  let elModalStudyDatePick = null;
  let elModalStudyDateError = null;
  let elModalModality = null;
  let elModalModalityOtherWrap = null;
  let elModalModalityOther = null;
  let elModalPatientRef = null;
  let elModalRequester = null;
  let elModalNote = null;
  let elModalSave = null;
  let elModalDelete = null;
  let elModalCancel = null;
  let elRequesterDatalist = null;

  let modalMode = null;
  let modalEditingId = null;
  let modalInitialSnapshot = "";
  let modalOpen = false;
  let entrySaving = false;
  let dayToast = { text: "", kind: "" };
  let dayToastTimer = null;

  function client() {
    return deps?.getClient?.() || null;
  }

  function userId() {
    return deps?.getUser?.()?.id || null;
  }

  function escapeHTML(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clampQuota(n) {
    return Math.min(QUOTA_MAX, Math.max(QUOTA_MIN, n));
  }

  function activeQuota() {
    return displayQuota;
  }

  function dateFromYMD(ymd) {
    const norm = normalizeStudyDateYMD(ymd);
    const p = norm.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function ymdFromLocalDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  /** Fecha YYYY-MM-DD en Europe/Madrid (alineada con favor_operative_date_madrid en BD). */
  function operativeTodayYMD() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year").value;
    const m = parts.find((p) => p.type === "month").value;
    const d = parts.find((p) => p.type === "day").value;
    return `${y}-${m}-${d}`;
  }

  function todayYMD() {
    return operativeTodayYMD();
  }

  function normalizeStudyDateYMD(value) {
    const str = String(value ?? "").trim();
    const m = str.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : str.slice(0, 10);
  }

  function compareYMD(a, b) {
    const da = normalizeStudyDateYMD(a);
    const db = normalizeStudyDateYMD(b);
    if (da === db) return 0;
    return da < db ? -1 : 1;
  }

  function dateCategory(ymd) {
    const t = operativeTodayYMD();
    const c = compareYMD(ymd, t);
    if (c < 0) return "past";
    if (c === 0) return "today";
    return "future";
  }

  function canDeleteEntry(ymd) {
    return compareYMD(normalizeStudyDateYMD(ymd), operativeTodayYMD()) >= 0;
  }

  function canEditStudyDate(ymd) {
    return compareYMD(normalizeStudyDateYMD(ymd), operativeTodayYMD()) > 0;
  }

  function canInsertStudyDate(ymd) {
    return compareYMD(normalizeStudyDateYMD(ymd), operativeTodayYMD()) >= 0;
  }

  function addDaysYMD(ymd, days) {
    const d = dateFromYMD(ymd);
    d.setDate(d.getDate() + days);
    return ymdFromLocalDate(d);
  }

  function mondayOfWeekYMD(ymd) {
    const d = dateFromYMD(ymd);
    const dow = d.getDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + offset);
    return ymdFromLocalDate(d);
  }

  function sundayOfWeekYMD(ymd) {
    return addDaysYMD(mondayOfWeekYMD(ymd), 6);
  }

  function formatDM(ymd) {
    const d = dateFromYMD(ymd);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function formatDMY(ymd) {
    const d = dateFromYMD(ymd);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }

  function parseDisplayDateDMY(str) {
    const t = String(str ?? "").trim();
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return ymdFromLocalDate(d);
  }

  function setStudyDateFormValue(ymd) {
    const norm = normalizeStudyDateYMD(ymd);
    if (elModalStudyDateDisplay) {
      elModalStudyDateDisplay.value = norm ? formatDMY(norm) : "";
    }
    if (elModalStudyDateNative) elModalStudyDateNative.value = norm || "";
  }

  function getStudyDateYMDFromForm() {
    const fromDisplay = parseDisplayDateDMY(elModalStudyDateDisplay?.value);
    if (fromDisplay) return fromDisplay;
    const fromNative = normalizeStudyDateYMD(elModalStudyDateNative?.value);
    if (fromNative && /^\d{4}-\d{2}-\d{2}$/.test(fromNative)) return fromNative;
    return "";
  }

  function setStudyDateFieldError(msg) {
    if (elModalStudyDateError) elModalStudyDateError.textContent = msg || "";
    if (elModalStudyDateDisplay) {
      elModalStudyDateDisplay.setAttribute("aria-invalid", msg ? "true" : "false");
    }
  }

  function clearStudyDateFieldError() {
    setStudyDateFieldError("");
  }

  function setStudyDateInputsEnabled(enabled) {
    if (elModalStudyDateDisplay) elModalStudyDateDisplay.readOnly = !enabled;
    if (elModalStudyDatePick) elModalStudyDatePick.style.display = enabled ? "inline-flex" : "none";
  }

  function openStudyDatePicker() {
    if (!elModalStudyDateNative || elModalStudyDateDisplay?.readOnly) return;
    let ymd = getStudyDateYMDFromForm();
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) ymd = operativeTodayYMD();
    elModalStudyDateNative.min = modalMode === "add" ? operativeTodayYMD() : operativeTodayYMD();
    elModalStudyDateNative.value = ymd;
    if (typeof elModalStudyDateNative.showPicker === "function") {
      try {
        elModalStudyDateNative.showPicker();
        return;
      } catch (_) {
        /* fallback */
      }
    }
    elModalStudyDateNative.focus();
    elModalStudyDateNative.click();
  }

  function logSupabaseError(context, error) {
    if (!error) return;
    console.warn("[CupoFavores]", context, {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
  }

  function mapSupabaseError(error, operation) {
    const raw = String(error?.message || "");
    const code = String(error?.code || "");
    const rlsLike =
      /row-level security policy/i.test(raw) ||
      code === "42501" ||
      /permission denied/i.test(raw);

    if (operation === "insert" && rlsLike) {
      return MSG_PAST_STUDY_DATE;
    }
    if (operation === "delete" && rlsLike) {
      return "No se puede eliminar este favor. Solo podés eliminar favores de hoy o con fecha futura.";
    }
    if (operation === "update" && /study_date no puede modificarse/i.test(raw)) {
      return "No podés cambiar la fecha de este favor.";
    }
    if (operation === "update" && rlsLike) {
      return "No se pudo actualizar el favor. Verificá la fecha y tus permisos.";
    }
    if (/violates check constraint/i.test(raw)) {
      return "Algunos datos no cumplen las reglas del sistema. Revisá modalidad y textos.";
    }
    if (/JWT expired|Invalid Refresh Token|session/i.test(raw)) {
      return "Tu sesión expiró. Volvé a iniciar sesión.";
    }
    return "No se pudo completar la operación. Intentá de nuevo.";
  }

  function ymdInMonth(ymd, year, month) {
    const d = dateFromYMD(ymd);
    return d.getFullYear() === year && d.getMonth() === month;
  }

  function getVisibleGridRange(year, month) {
    const firstOfMonth = ymdFromLocalDate(new Date(year, month, 1));
    const lastOfMonth = ymdFromLocalDate(new Date(year, month + 1, 0));
    const gridStart = mondayOfWeekYMD(firstOfMonth);
    const gridEnd = sundayOfWeekYMD(lastOfMonth);
    return { gridStart, gridEnd };
  }

  function buildWeeksForView(year, month) {
    const { gridStart, gridEnd } = getVisibleGridRange(year, month);
    const weeks = [];
    let monday = gridStart;
    while (monday <= gridEnd) {
      const days = [];
      for (let i = 0; i < 7; i++) days.push(addDaysYMD(monday, i));
      weeks.push({ monday, days });
      monday = addDaysYMD(monday, 7);
    }
    return weeks;
  }

  function countByDay(entries) {
    const map = new Map();
    for (const e of entries) {
      const k = e.study_date;
      if (!k) continue;
      map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  }

  function countByWeek(entries) {
    const map = new Map();
    for (const e of entries) {
      const k = mondayOfWeekYMD(e.study_date);
      map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  }

  function weekUsedForDate(entries, ymd, excludeId) {
    const mon = mondayOfWeekYMD(ymd);
    let n = 0;
    for (const e of entries) {
      if (excludeId && e.id === excludeId) continue;
      if (mondayOfWeekYMD(e.study_date) === mon) n++;
    }
    return n;
  }

  function weekStats(used, quota) {
    const q = clampQuota(quota);
    return {
      used,
      available: Math.max(0, q - used),
      excess: Math.max(0, used - q),
    };
  }

  function weekStatusClass(used, quota) {
    if (used > quota) return "cupo-week--over";
    if (used >= quota) return "cupo-week--full";
    return "cupo-week--ok";
  }

  function normalizeRequesterKey(name) {
    return String(name ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function mergeRequesterNamesFromEntries(entries) {
    const seen = new Map();
    for (const name of requesterNames) {
      const k = normalizeRequesterKey(name);
      if (k) seen.set(k, String(name).trim().replace(/\s+/g, " "));
    }
    for (const e of entries) {
      const raw = String(e.requester ?? "").trim().replace(/\s+/g, " ");
      const k = normalizeRequesterKey(raw);
      if (k && !seen.has(k)) seen.set(k, raw);
    }
    requesterNames = Array.from(seen.values()).sort((a, b) =>
      a.localeCompare(b, "es", { sensitivity: "base" })
    );
    refreshRequesterDatalist();
  }

  function refreshRequesterDatalist() {
    if (!elRequesterDatalist) return;
    elRequesterDatalist.innerHTML = requesterNames
      .map((n) => `<option value="${escapeHTML(n)}"></option>`)
      .join("");
  }

  function setFeedback(text, kind) {
    if (!elFeedback) return;
    elFeedback.textContent = text || "";
    elFeedback.classList.remove("is-saving", "is-ok", "is-error");
    if (kind) elFeedback.classList.add(kind);
  }

  function setDayToast(text, kind) {
    dayToast = { text: text || "", kind: kind || "" };
    if (dayToastTimer) clearTimeout(dayToastTimer);
    if (text) {
      dayToastTimer = setTimeout(() => {
        dayToast = { text: "", kind: "" };
        renderCalendarUI();
      }, DAY_TOAST_MS);
    }
    renderCalendarUI();
  }

  function updateStepperUI() {
    if (elValue) elValue.textContent = String(displayQuota);
    if (btnMinus) btnMinus.disabled = !controlsEnabled || loadingQuota || saving || displayQuota <= QUOTA_MIN;
    if (btnPlus) btnPlus.disabled = !controlsEnabled || loadingQuota || saving || displayQuota >= QUOTA_MAX;
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
      '<div id="cupoCalMount" class="cupo-cal-mount"></div>' +
      "</section>";

    elFeedback = root.querySelector("#cupoQuotaFeedback");
    elValue = root.querySelector("#cupoQuotaValue");
    btnMinus = root.querySelector("#cupoQuotaMinus");
    btnPlus = root.querySelector("#cupoQuotaPlus");
    elCalMount = root.querySelector("#cupoCalMount");

    btnMinus.addEventListener("click", () => adjustQuota(-1));
    btnPlus.addEventListener("click", () => adjustQuota(1));
    ensureModal();
  }

  function ensureModal() {
    if (elModalOverlay) return;

    elModalOverlay = document.createElement("div");
    elModalOverlay.id = "cupoFavorModal";
    elModalOverlay.className = "cupo-favor-modal-overlay";
    elModalOverlay.setAttribute("aria-hidden", "true");
    elModalOverlay.innerHTML =
      '<div class="modal-box cupo-favor-modal-box" role="dialog" aria-modal="true" aria-labelledby="cupoFavorModalTitle">' +
      '<h3 class="modal-title" id="cupoFavorModalTitle">Añadir favor</h3>' +
      '<form class="cupo-favor-form" id="cupoFavorForm" novalidate>' +
      "<label for=\"cupoFavorStudyDateDisplay\">Fecha del estudio</label>" +
      '<div class="cupo-favor-date-row">' +
      '<input type="text" id="cupoFavorStudyDateDisplay" inputmode="numeric" autocomplete="off" ' +
      'placeholder="DD/MM/AAAA" spellcheck="false" aria-describedby="cupoFavorStudyDateError cupoFavorStudyDateHint" required />' +
      '<button type="button" class="btn small ghost" id="cupoFavorStudyDatePick" aria-label="Abrir calendario">📅</button>' +
      '<input type="date" id="cupoFavorStudyDateNative" class="cupo-favor-date-native" tabindex="-1" aria-hidden="true" />' +
      "</div>" +
      '<p class="cupo-favor-field-error" id="cupoFavorStudyDateError" role="alert"></p>' +
      '<p class="cupo-favor-date-hint" id="cupoFavorStudyDateHint">Formato: DD/MM/AAAA</p>' +
      "<label for=\"cupoFavorModality\">Modalidad</label>" +
      '<select id="cupoFavorModality" required>' +
      MODALITIES.map((m) => `<option value="${m}">${m}</option>`).join("") +
      "</select>" +
      '<div id="cupoFavorModalityOtherWrap" style="display:none">' +
      "<label for=\"cupoFavorModalityOther\">Especificar modalidad (Otro)</label>" +
      '<input type="text" id="cupoFavorModalityOther" maxlength="' +
      MODALITY_OTHER_MAX +
      '" autocomplete="off" />' +
      "</div>" +
      "<label for=\"cupoFavorPatientRef\">Referencia del paciente (iniciales o código breve)</label>" +
      '<input type="text" id="cupoFavorPatientRef" maxlength="' +
      PATIENT_REF_MAX +
      '" required autocomplete="off" />' +
      "<label for=\"cupoFavorRequester\">Solicitante</label>" +
      '<input type="text" id="cupoFavorRequester" list="cupoRequesterList" maxlength="' +
      REQUESTER_MAX +
      '" required autocomplete="off" />' +
      '<datalist id="cupoRequesterList"></datalist>' +
      "<label for=\"cupoFavorNote\">Observaciones (opcional)</label>" +
      '<textarea id="cupoFavorNote" maxlength="' + NOTE_MAX + '"></textarea>' +
      '<p class="cupo-favor-form-error" id="cupoFavorFormError" role="alert"></p>' +
      '<div class="cupo-favor-modal-actions">' +
      '<button type="button" class="btn danger ghost" id="cupoFavorDelete" style="display:none;margin-right:auto">Eliminar</button>' +
      '<button type="button" class="btn ghost" id="cupoFavorCancel">Cancelar</button>' +
      '<button type="submit" class="btn primary" id="cupoFavorSave">Guardar</button>' +
      "</div></form></div>";

    document.body.appendChild(elModalOverlay);

    elModalForm = elModalOverlay.querySelector("#cupoFavorForm");
    elModalTitle = elModalOverlay.querySelector("#cupoFavorModalTitle");
    elModalError = elModalOverlay.querySelector("#cupoFavorFormError");
    elModalStudyDateDisplay = elModalOverlay.querySelector("#cupoFavorStudyDateDisplay");
    elModalStudyDateNative = elModalOverlay.querySelector("#cupoFavorStudyDateNative");
    elModalStudyDatePick = elModalOverlay.querySelector("#cupoFavorStudyDatePick");
    elModalStudyDateError = elModalOverlay.querySelector("#cupoFavorStudyDateError");
    elModalModality = elModalOverlay.querySelector("#cupoFavorModality");
    elModalModalityOtherWrap = elModalOverlay.querySelector("#cupoFavorModalityOtherWrap");
    elModalModalityOther = elModalOverlay.querySelector("#cupoFavorModalityOther");
    elModalPatientRef = elModalOverlay.querySelector("#cupoFavorPatientRef");
    elModalRequester = elModalOverlay.querySelector("#cupoFavorRequester");
    elModalNote = elModalOverlay.querySelector("#cupoFavorNote");
    elModalSave = elModalOverlay.querySelector("#cupoFavorSave");
    elModalDelete = elModalOverlay.querySelector("#cupoFavorDelete");
    elModalCancel = elModalOverlay.querySelector("#cupoFavorCancel");
    elRequesterDatalist = elModalOverlay.querySelector("#cupoRequesterList");

    elModalModality.addEventListener("change", updateModalityOtherVisibility);
    if (elModalStudyDatePick) {
      elModalStudyDatePick.addEventListener("click", () => openStudyDatePicker());
    }
    if (elModalStudyDateNative) {
      elModalStudyDateNative.addEventListener("change", () => {
        setStudyDateFormValue(elModalStudyDateNative.value);
        clearStudyDateFieldError();
      });
    }
    if (elModalStudyDateDisplay) {
      elModalStudyDateDisplay.addEventListener("input", () => clearStudyDateFieldError());
      elModalStudyDateDisplay.addEventListener("blur", () => {
        const ymd = getStudyDateYMDFromForm();
        if (ymd) setStudyDateFormValue(ymd);
      });
    }
    elModalCancel.addEventListener("click", () => requestCloseModal());
    elModalOverlay.addEventListener("click", (ev) => {
      if (ev.target === elModalOverlay) requestCloseModal();
    });
    elModalDelete.addEventListener("click", () => confirmDeleteEntry());
    elModalForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      submitFavorForm();
    });

    if (!global.__cupoFavorModalEscBound) {
      global.__cupoFavorModalEscBound = true;
      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && modalOpen) {
          ev.preventDefault();
          requestCloseModal();
        }
      });
    }
  }

  function updateModalityOtherVisibility() {
    const isOtro = elModalModality?.value === "Otro";
    if (elModalModalityOtherWrap) {
      elModalModalityOtherWrap.style.display = isOtro ? "block" : "none";
    }
    if (!isOtro && elModalModalityOther) elModalModalityOther.value = "";
  }

  function formSnapshot() {
    return JSON.stringify({
      study_date: getStudyDateYMDFromForm() || elModalStudyDateDisplay?.value || "",
      modality: elModalModality?.value || "",
      modality_other: elModalModalityOther?.value || "",
      patient_ref: elModalPatientRef?.value || "",
      requester: elModalRequester?.value || "",
      note: elModalNote?.value || "",
    });
  }

  function isModalDirty() {
    return modalOpen && formSnapshot() !== modalInitialSnapshot;
  }

  function setModalError(msg, asWarning) {
    if (!elModalError) return;
    elModalError.textContent = msg || "";
    elModalError.style.color = asWarning ? "var(--warn)" : msg ? "var(--danger)" : "";
  }

  function readFormPayload() {
    const study_date = getStudyDateYMDFromForm();
    const modality = elModalModality?.value || "";
    const modality_other = (elModalModalityOther?.value || "").trim();
    const patient_ref = (elModalPatientRef?.value || "").trim().replace(/\s+/g, " ");
    const requester = (elModalRequester?.value || "").trim().replace(/\s+/g, " ");
    const noteRaw = elModalNote?.value ?? "";
    const note = noteRaw.trim() ? noteRaw.trim() : null;
    return { study_date, modality, modality_other, patient_ref, requester, note };
  }

  function applyValidationFailure(result) {
    clearStudyDateFieldError();
    setModalError("");
    if (!result) return;
    if (result.field === "study_date") {
      setStudyDateFieldError(result.message);
      elModalStudyDateDisplay?.focus();
      return;
    }
    setModalError(result.message);
  }

  function validatePayload(payload, options) {
    const { allowEditDate, originalStudyDate, isNewInsert } = options;
    const studyYMD = normalizeStudyDateYMD(payload.study_date);
    if (!studyYMD || !/^\d{4}-\d{2}-\d{2}$/.test(studyYMD)) {
      return { field: "study_date", message: MSG_INVALID_STUDY_DATE };
    }
    if (isNewInsert && !canInsertStudyDate(studyYMD)) {
      return { field: "study_date", message: MSG_PAST_STUDY_DATE };
    }
    if (!allowEditDate && originalStudyDate && studyYMD !== normalizeStudyDateYMD(originalStudyDate)) {
      return { field: "study_date", message: "No podés cambiar la fecha de este favor." };
    }
    if (!MODALITIES.includes(payload.modality)) return { field: null, message: "Seleccioná una modalidad válida." };
    if (payload.modality === "Otro") {
      if (!payload.modality_other) return { field: null, message: "Especificá la modalidad «Otro»." };
      if (payload.modality_other.length > MODALITY_OTHER_MAX) {
        return {
          field: null,
          message: `La modalidad «Otro» no puede superar ${MODALITY_OTHER_MAX} caracteres.`,
        };
      }
    } else if (payload.modality_other) {
      return { field: null, message: "La modalidad adicional solo aplica si elegís «Otro»." };
    }
    if (!payload.patient_ref) return { field: null, message: "La referencia del paciente es obligatoria." };
    if (payload.patient_ref.length > PATIENT_REF_MAX) {
      return { field: null, message: `La referencia no puede superar ${PATIENT_REF_MAX} caracteres.` };
    }
    if (!payload.requester) return { field: null, message: "El solicitante es obligatorio." };
    if (payload.requester.length > REQUESTER_MAX) {
      return { field: null, message: `El solicitante no puede superar ${REQUESTER_MAX} caracteres.` };
    }
    if (payload.note && payload.note.length > NOTE_MAX) {
      return { field: null, message: `Las observaciones no pueden superar ${NOTE_MAX} caracteres.` };
    }
    return null;
  }

  function openAddModal() {
    ensureModal();
    if (!controlsEnabled || entriesLoading || entrySaving) return;
    if (!userId() || !client()) {
      setDayToast("Iniciá sesión para registrar favores.", "is-error");
      return;
    }
    modalMode = "add";
    modalEditingId = null;
    elModalTitle.textContent = "Añadir favor";
    setStudyDateFormValue(selectedYMD || todayYMD());
    setStudyDateInputsEnabled(true);
    elModalModality.value = "TC";
    elModalModalityOther.value = "";
    elModalPatientRef.value = "";
    elModalRequester.value = "";
    elModalNote.value = "";
    updateModalityOtherVisibility();
    elModalDelete.style.display = "none";
    clearStudyDateFieldError();
    setModalError("");
    modalInitialSnapshot = formSnapshot();
    modalOpen = true;
    elModalOverlay.classList.add("open");
    elModalOverlay.setAttribute("aria-hidden", "false");
    elModalStudyDateDisplay?.focus();
  }

  function openEditModal(entry) {
    ensureModal();
    if (!entry?.id || entrySaving) return;
    modalMode = "edit";
    modalEditingId = entry.id;
    elModalTitle.textContent = "Editar favor";
    const entryDate = normalizeStudyDateYMD(entry.study_date);
    setStudyDateFormValue(entryDate);
    setStudyDateInputsEnabled(canEditStudyDate(entryDate));
    elModalModality.value = entry.modality || "TC";
    elModalModalityOther.value = entry.modality_other || "";
    elModalPatientRef.value = entry.patient_ref || "";
    elModalRequester.value = entry.requester || "";
    elModalNote.value = entry.note || "";
    updateModalityOtherVisibility();
    elModalDelete.style.display = canDeleteEntry(entryDate) ? "inline-flex" : "none";
    clearStudyDateFieldError();
    setModalError("");
    modalInitialSnapshot = formSnapshot();
    modalOpen = true;
    elModalOverlay.classList.add("open");
    elModalOverlay.setAttribute("aria-hidden", "false");
    elModalPatientRef.focus();
  }

  function closeModalImmediate() {
    if (!elModalOverlay) return;
    modalOpen = false;
    modalMode = null;
    modalEditingId = null;
    elModalOverlay.classList.remove("open");
    elModalOverlay.setAttribute("aria-hidden", "true");
    setModalError("");
    clearStudyDateFieldError();
    entrySaving = false;
    if (elModalSave) {
      elModalSave.disabled = false;
      elModalSave.textContent = "Guardar";
    }
  }

  function requestCloseModal() {
    if (entrySaving) return;
    if (isModalDirty()) {
      const ok = global.confirm("Hay cambios sin guardar. ¿Descartarlos?");
      if (!ok) return;
    }
    closeModalImmediate();
  }

  function setEntrySaving(on) {
    entrySaving = on;
    if (elModalSave) {
      elModalSave.disabled = on;
      elModalSave.textContent = on ? "Guardando…" : "Guardar";
    }
    if (elModalDelete) elModalDelete.disabled = on;
    if (elModalCancel) elModalCancel.disabled = on;
  }

  async function submitFavorForm() {
    if (entrySaving) return;
    const uid = userId();
    const sb = client();
    if (!uid || !sb) {
      setModalError("Sesión no válida. Volvé a iniciar sesión.");
      return;
    }

    const original =
      modalMode === "edit"
        ? favorEntries.find((e) => e.id === modalEditingId)
        : null;
    const allowEditDate = original ? canEditStudyDate(original.study_date) : true;
    clearStudyDateFieldError();
    setModalError("");

    const payload = readFormPayload();
    const validation = validatePayload(payload, {
      allowEditDate,
      originalStudyDate: original?.study_date,
      isNewInsert: modalMode === "add",
    });
    if (validation) {
      applyValidationFailure(validation);
      return;
    }

    const row = {
      study_date: allowEditDate
        ? normalizeStudyDateYMD(payload.study_date)
        : normalizeStudyDateYMD(original.study_date),
      modality: payload.modality,
      modality_other: payload.modality === "Otro" ? payload.modality_other : null,
      patient_ref: payload.patient_ref,
      requester: payload.requester,
      note: payload.note,
    };

    const quota = activeQuota();
    const usedBefore = weekUsedForDate(favorEntries, row.study_date, modalMode === "edit" ? modalEditingId : null);
    const willExceed = usedBefore + 1 > quota;
    if (willExceed) {
      setModalError(
        `Aviso: esta semana superará el cupo (${usedBefore + 1}/${quota}). Podés guardar igualmente.`,
        true
      );
    } else {
      setModalError("");
    }

    setEntrySaving(true);
    const reqUid = uid;

    try {
      if (modalMode === "add") {
        const { data, error } = await sb
          .from("favor_entries")
          .insert({ ...row, user_id: uid })
          .select("id,study_date,modality,modality_other,patient_ref,requester,note")
          .single();

        if (userId() !== reqUid) return;
        if (error) {
          logSupabaseError("insert favor_entries", error);
          const friendly = mapSupabaseError(error, "insert");
          if (friendly === MSG_PAST_STUDY_DATE) {
            applyValidationFailure({ field: "study_date", message: friendly });
          } else {
            setModalError(friendly);
          }
          return;
        }
        mergeRequesterNamesFromEntries([data]);
        closeModalImmediate();
        selectedYMD = row.study_date;
        await loadEntriesForVisibleRange();
        setDayToast("Favor registrado.", "is-ok");
      } else if (modalMode === "edit" && modalEditingId) {
        const { data, error } = await sb
          .from("favor_entries")
          .update(row)
          .eq("id", modalEditingId)
          .eq("user_id", uid)
          .select("id,study_date,modality,modality_other,patient_ref,requester,note")
          .maybeSingle();

        if (userId() !== reqUid) return;
        if (error) {
          logSupabaseError("update favor_entries", error);
          const friendly = mapSupabaseError(error, "update");
          if (friendly.includes("fecha")) {
            applyValidationFailure({ field: "study_date", message: friendly });
          } else {
            setModalError(friendly);
          }
          return;
        }
        if (!data) {
          setModalError("No se encontró el favor o no tenés permiso.");
          return;
        }
        mergeRequesterNamesFromEntries([data]);
        closeModalImmediate();
        selectedYMD = data.study_date;
        await loadEntriesForVisibleRange();
        setDayToast("Favor actualizado.", "is-ok");
      }
    } finally {
      setEntrySaving(false);
    }
  }

  async function confirmDeleteEntry() {
    if (entrySaving || modalMode !== "edit" || !modalEditingId) return;
    const entry = favorEntries.find((e) => e.id === modalEditingId);
    const entryDate = entry ? normalizeStudyDateYMD(entry.study_date) : "";
    if (!entry || !canDeleteEntry(entryDate)) {
      setModalError(
        "Solo se pueden eliminar favores de hoy o con fecha futura (referencia Europe/Madrid)."
      );
      return;
    }

    const mod =
      entry.modality === "Otro" && entry.modality_other
        ? `Otro (${entry.modality_other})`
        : entry.modality;
    const msg =
      `¿Eliminar el favor del ${formatDMY(entryDate)}?\n` +
      `${mod} — ${entry.patient_ref} — ${entry.requester}`;
    if (!global.confirm(msg)) return;

    const uid = userId();
    const sb = client();
    if (!uid || !sb) {
      setModalError("Sesión no válida.");
      return;
    }

    setEntrySaving(true);
    const reqUid = uid;
    const deletedDate = entryDate;

    try {
      const { data, error } = await sb
        .from("favor_entries")
        .delete()
        .eq("id", modalEditingId)
        .eq("user_id", uid)
        .select("id");

      if (userId() !== reqUid) return;
      if (error) {
        logSupabaseError("delete favor_entries", error);
        setModalError(mapSupabaseError(error, "delete"));
        return;
      }
      if (!data?.length) {
        setModalError(
          "No se pudo eliminar: solo favores de hoy o futuros (Europe/Madrid), o la fila ya no existe."
        );
        return;
      }
      closeModalImmediate();
      selectedYMD = deletedDate;
      await loadEntriesForVisibleRange();
      setDayToast("Favor eliminado.", "is-ok");
    } finally {
      setEntrySaving(false);
    }
  }

  function renderCalendarUI() {
    if (!elCalMount) return;

    const quota = activeQuota();
    const weekMonday = mondayOfWeekYMD(selectedYMD || todayYMD());
    const weekSunday = sundayOfWeekYMD(selectedYMD || todayYMD());
    const wUsed = countByWeek(favorEntries).get(weekMonday) || 0;
    const stats = weekStats(wUsed, quota);

    const dayCounts = countByDay(favorEntries);
    const weekCounts = countByWeek(favorEntries);
    const weeks = buildWeeksForView(viewYear, viewMonth);

    let gridHtml =
      '<div class="cupo-cal-section">' +
      '<div class="cupo-week-summary">' +
      `<p class="cupo-week-summary-title">Semana del ${formatDMY(weekMonday)} al ${formatDMY(weekSunday)}</p>` +
      '<div class="cupo-week-summary-stats">' +
      `<span class="cupo-stat"><strong>Utilizados:</strong> ${wUsed}</span>` +
      `<span class="cupo-stat"><strong>Disponibles:</strong> ${stats.available}</span>` +
      `<span class="cupo-stat"><strong>Exceso:</strong> ${stats.excess}</span>` +
      "</div></div>";

    if (entriesLoading) {
      gridHtml += '<p class="cupo-cal-msg muted">Cargando favores…</p>';
    } else if (entriesError) {
      gridHtml += `<p class="cupo-cal-msg cupo-cal-msg--error">${escapeHTML(entriesError)}</p>`;
    }

    gridHtml +=
      '<div class="cupo-cal-nav">' +
      `<button type="button" class="btn small" data-cal-nav="prev" aria-label="Mes anterior">‹</button>` +
      `<span class="cupo-cal-month-label">${MONTH_NAMES[viewMonth]} ${viewYear}</span>` +
      `<button type="button" class="btn small" data-cal-nav="next" aria-label="Mes siguiente">›</button>` +
      `<button type="button" class="btn small ghost" data-cal-nav="today">Hoy</button>` +
      "</div>";

    gridHtml += '<div class="cupo-cal-grid" role="grid" aria-label="Calendario mensual">';
    gridHtml += '<div class="cupo-cal-row cupo-cal-row--head" role="row">';
    for (const h of DOW_HEADERS) {
      gridHtml += `<div class="cupo-cal-cell cupo-cal-cell--head" role="columnheader">${h}</div>`;
    }
    gridHtml += "</div>";

    for (const week of weeks) {
      gridHtml += '<div class="cupo-cal-row" role="row">';
      for (const ymd of week.days) {
        const inMonth = ymdInMonth(ymd, viewYear, viewMonth);
        const cnt = dayCounts.get(ymd) || 0;
        const isSel = ymd === selectedYMD;
        let cls = "cupo-cal-cell cupo-cal-day";
        if (!inMonth) cls += " cupo-cal-day--outside";
        if (isSel) cls += " cupo-cal-day--selected";
        gridHtml +=
          `<button type="button" class="${cls}" data-ymd="${ymd}" role="gridcell">` +
          `<span class="cupo-cal-day-num">${dateFromYMD(ymd).getDate()}</span>` +
          (cnt > 0 ? `<span class="cupo-cal-day-count">${cnt}</span>` : "") +
          "</button>";
      }
      gridHtml += "</div>";
      const wCnt = weekCounts.get(week.monday) || 0;
      const wCls = weekStatusClass(wCnt, quota);
      gridHtml +=
        `<div class="cupo-cal-week-bar ${wCls}" role="status">` +
        `<span>${wCnt}/${quota} favores</span></div>`;
    }
    gridHtml += "</div>";

    const dayEntries = favorEntries.filter((e) => e.study_date === selectedYMD);
    gridHtml += '<div class="cupo-day-detail">';
    gridHtml += '<div class="cupo-day-detail-head">';
    gridHtml += `<h3 class="cupo-day-detail-title">Favores del ${formatDMY(selectedYMD || todayYMD())}</h3>`;
    gridHtml +=
      '<button type="button" class="btn small primary" id="cupoBtnAddFavor">+ Añadir favor</button>';
    gridHtml += "</div>";

    if (dayToast.text) {
      const tCls =
        dayToast.kind === "is-ok"
          ? "is-ok"
          : dayToast.kind === "is-warn"
            ? "is-warn"
            : dayToast.kind === "is-error"
              ? "is-error"
              : "";
      gridHtml += `<p class="cupo-day-toast ${tCls}" role="status">${escapeHTML(dayToast.text)}</p>`;
    }

    if (!entriesLoading && !entriesError && dayEntries.length === 0) {
      gridHtml += '<p class="muted">Sin favores registrados</p>';
    } else if (dayEntries.length > 0) {
      gridHtml += '<ul class="cupo-day-list">';
      for (const e of dayEntries) {
        const mod =
          e.modality === "Otro" && e.modality_other
            ? `Otro (${e.modality_other})`
            : e.modality;
        gridHtml +=
          `<li class="cupo-day-item" data-entry-id="${e.id}">` +
          `<div class="cupo-day-item-mod">${escapeHTML(mod)}</div>` +
          `<div class="cupo-day-item-ref">${escapeHTML(e.patient_ref)}</div>` +
          `<div class="cupo-day-item-req">${escapeHTML(e.requester)}</div>` +
          (e.note ? `<div class="cupo-day-item-note">${escapeHTML(e.note)}</div>` : "") +
          '<div class="cupo-day-item-actions">' +
          `<button type="button" class="btn small ghost" data-edit-favor="${e.id}">Editar</button>` +
          "</div></li>";
      }
      gridHtml += "</ul>";
    }
    gridHtml += "</div></div>";

    elCalMount.innerHTML = gridHtml;

    elCalMount.querySelectorAll("[data-ymd]").forEach((btn) => {
      btn.addEventListener("click", () => selectDay(btn.getAttribute("data-ymd")));
    });
    elCalMount.querySelectorAll("[data-cal-nav]").forEach((btn) => {
      btn.addEventListener("click", () => handleCalNav(btn.getAttribute("data-cal-nav")));
    });
    const btnAdd = elCalMount.querySelector("#cupoBtnAddFavor");
    if (btnAdd) btnAdd.addEventListener("click", () => openAddModal());
    elCalMount.querySelectorAll("[data-edit-favor]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-edit-favor");
        const entry = favorEntries.find((x) => x.id === id);
        if (entry) openEditModal(entry);
      });
    });
  }

  function selectDay(ymd) {
    if (!ymd) return;
    selectedYMD = ymd;
    renderCalendarUI();
  }

  function handleCalNav(action) {
    const t = todayYMD();
    if (action === "today") {
      const d = dateFromYMD(t);
      viewYear = d.getFullYear();
      viewMonth = d.getMonth();
      selectedYMD = t;
      loadEntriesForVisibleRange();
      return;
    }
    if (action === "prev") {
      viewMonth -= 1;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear -= 1;
      }
    } else if (action === "next") {
      viewMonth += 1;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear += 1;
      }
    }
    loadEntriesForVisibleRange();
  }

  function resetModuleState() {
    closeModalImmediate();
    confirmedQuota = QUOTA_DEFAULT;
    displayQuota = QUOTA_DEFAULT;
    controlsEnabled = false;
    loadingQuota = false;
    saveChain = Promise.resolve();
    pendingSaveValue = null;
    saving = false;
    favorEntries = [];
    entriesLoading = false;
    entriesError = null;
    requesterNames = [];
    dayToast = { text: "", kind: "" };
    if (savedFlashTimer) {
      clearTimeout(savedFlashTimer);
      savedFlashTimer = null;
    }
    if (dayToastTimer) {
      clearTimeout(dayToastTimer);
      dayToastTimer = null;
    }
    quotaLoadToken++;
    entriesLoadToken++;
    requesterLoadToken++;
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    selectedYMD = todayYMD();
  }

  async function loadQuotaFromDb() {
    const uid = userId();
    const sb = client();
    const token = ++quotaLoadToken;
    if (!uid || !sb) {
      setFeedback("Iniciá sesión para configurar tu cupo.", "is-error");
      updateStepperUI();
      return;
    }

    loadingQuota = true;
    controlsEnabled = false;
    setFeedback("Cargando cupo…", "");
    updateStepperUI();

    const { data, error } = await sb
      .from("favor_settings")
      .select("weekly_quota")
      .eq("user_id", uid)
      .maybeSingle();

    if (token !== quotaLoadToken) return;

    loadingQuota = false;
    if (error) {
      setFeedback("No se pudo cargar el cupo. Reintentá más tarde.", "is-error");
      updateStepperUI();
      renderCalendarUI();
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
    renderCalendarUI();
  }

  async function loadRequesterNamesFromDb() {
    const uid = userId();
    const sb = client();
    const token = ++requesterLoadToken;
    if (!uid || !sb) {
      requesterNames = [];
      refreshRequesterDatalist();
      return;
    }

    const { data, error } = await sb
      .from("favor_entries")
      .select("requester")
      .eq("user_id", uid)
      .order("updated_at", { ascending: false })
      .limit(400);

    if (token !== requesterLoadToken || userId() !== uid) return;
    if (error) return;
    mergeRequesterNamesFromEntries(Array.isArray(data) ? data : []);
  }

  async function loadEntriesForVisibleRange() {
    const uid = userId();
    const sb = client();
    const token = ++entriesLoadToken;
    const reqUid = uid;

    if (!uid || !sb) {
      favorEntries = [];
      entriesError = "Sin sesión activa.";
      renderCalendarUI();
      return;
    }

    const { gridStart, gridEnd } = getVisibleGridRange(viewYear, viewMonth);
    entriesLoading = true;
    entriesError = null;
    renderCalendarUI();

    const { data, error } = await sb
      .from("favor_entries")
      .select("id,study_date,modality,modality_other,patient_ref,requester,note")
      .eq("user_id", uid)
      .gte("study_date", gridStart)
      .lte("study_date", gridEnd)
      .order("study_date", { ascending: true });

    if (token !== entriesLoadToken || userId() !== reqUid) return;

    entriesLoading = false;
    if (error) {
      entriesError = "No se pudieron cargar los favores.";
      favorEntries = [];
    } else {
      favorEntries = (Array.isArray(data) ? data : []).map((e) => ({
        ...e,
        study_date: normalizeStudyDateYMD(e.study_date),
      }));
      entriesError = null;
      mergeRequesterNamesFromEntries(favorEntries);
    }
    renderCalendarUI();
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
            renderCalendarUI();
            if (savedFlashTimer) clearTimeout(savedFlashTimer);
            savedFlashTimer = setTimeout(() => {
              if (!saving && !loadingQuota) setFeedback("", "");
            }, SAVED_FLASH_MS);
          } else {
            displayQuota = confirmedQuota;
            setFeedback(
              "No se pudo guardar el cupo. " + (result.error || "Reintentá."),
              "is-error"
            );
          }
          updateStepperUI();
          renderCalendarUI();
        }
      })
      .catch(() => {
        saving = false;
        displayQuota = confirmedQuota;
        setFeedback("Error al guardar. Reintentá.", "is-error");
        updateStepperUI();
        renderCalendarUI();
      });
  }

  function adjustQuota(delta) {
    if (!controlsEnabled || loadingQuota || saving) return;
    const next = clampQuota(displayQuota + delta);
    if (next === displayQuota) return;
    displayQuota = next;
    updateStepperUI();
    renderCalendarUI();
    enqueueSave(next);
  }

  async function refreshModuleData() {
    const t = todayYMD();
    const d = dateFromYMD(t);
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    selectedYMD = t;
    await loadQuotaFromDb();
    await Promise.all([loadEntriesForVisibleRange(), loadRequesterNamesFromDb()]);
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
      refreshModuleData();
    },

    onHide() {
      requestCloseModal();
    },

    reset() {
      resetModuleState();
      mounted = false;
      rootEl = null;
      deps = null;
      elFeedback = null;
      elValue = null;
      btnMinus = null;
      btnPlus = null;
      elCalMount = null;
    },

    destroy() {
      closeModalImmediate();
      if (elModalOverlay?.parentNode) elModalOverlay.parentNode.removeChild(elModalOverlay);
      elModalOverlay = null;
      elModalForm = null;
      if (rootEl) rootEl.innerHTML = "";
      this.reset();
    },
  };

  global.CupoFavores = CupoFavores;
})(typeof window !== "undefined" ? window : globalThis);
