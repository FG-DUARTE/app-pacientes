/**
 * Cupo de favores — módulo (Fases 2–3)
 * Integración: window.CupoFavores.init({ root, getClient, getUser })
 */
(function (global) {
  "use strict";

  const QUOTA_MIN = 1;
  const QUOTA_MAX = 20;
  const QUOTA_DEFAULT = 4;
  const SAVED_FLASH_MS = 2200;
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

  let elFeedback = null;
  let elValue = null;
  let btnMinus = null;
  let btnPlus = null;
  let elCalMount = null;

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
    const p = String(ymd).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function ymdFromLocalDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function todayYMD() {
    return ymdFromLocalDate(new Date());
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

  function setFeedback(text, kind) {
    if (!elFeedback) return;
    elFeedback.textContent = text || "";
    elFeedback.classList.remove("is-saving", "is-ok", "is-error");
    if (kind) elFeedback.classList.add(kind);
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
      `<p class="cupo-week-summary-title">Semana del ${formatDM(weekMonday)} al ${formatDM(weekSunday)}</p>` +
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
    gridHtml += `<h3 class="cupo-day-detail-title">Favores del ${formatDM(selectedYMD || todayYMD())}</h3>`;
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
          "<li class=\"cupo-day-item\">" +
          `<div class="cupo-day-item-mod">${escapeHTML(mod)}</div>` +
          `<div class="cupo-day-item-ref">${escapeHTML(e.patient_ref)}</div>` +
          `<div class="cupo-day-item-req">${escapeHTML(e.requester)}</div>` +
          (e.note ? `<div class="cupo-day-item-note">${escapeHTML(e.note)}</div>` : "") +
          "</li>";
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
    if (savedFlashTimer) {
      clearTimeout(savedFlashTimer);
      savedFlashTimer = null;
    }
    quotaLoadToken++;
    entriesLoadToken++;
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
      favorEntries = Array.isArray(data) ? data : [];
      entriesError = null;
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
    await loadEntriesForVisibleRange();
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
      elCalMount = null;
    },

    destroy() {
      if (rootEl) rootEl.innerHTML = "";
      this.reset();
    },
  };

  global.CupoFavores = CupoFavores;
})(typeof window !== "undefined" ? window : globalThis);
