// content.js - jqGrid row colorer (replacement for XPath approach)
// Paste/replace this in your extension's content script.

(() => {
  // ========== CONFIG ==========
  const FRAME_NAME = "myframe"; // change if your iframe name differs
  const GRID_ID = "grid37";     // jqGrid table id (without '#')
  const PRIMARY_DEADLINE_COL = "resumedeadline";      // primary col name (colModel.name)
  const FALLBACK_DEADLINE_COL = "resumedeadline_st";  // fallback column
  // columns (colModel.name) you want colored for each row:
  const COLUMNS_TO_COLOR = [
    "companyname","view2","view3","designation","description",
    "ctc","Currency","view1","apply","resumedeadline_st",
    "resumedeadline","interview_date_confirmed","contract","view"
  ];

  const GREEN = "#a5fc03";
  const RED = "#fc2403";
  const YELLOW = "#ffe600";
  const BORDER = "#cccccc";
  const APPLIED_HEADER_TEXT = "application status"; // header label of the status column
  const APPLIED_VALUES = ["y", "yes", "applied"];    // cell values meaning "applied"

  // update intervals (ms)
  const FALLBACK_INTERVAL_MS = 2000; // periodic fallback update
  const BOOTSTRAP_ATTEMPTS = 20;
  const BOOTSTRAP_INTERVAL_MS = 300;

  // ========== STATE ==========
  let targetFrame = null;
  let fallbackInterval = null;
  let mutationObserver = null;
  let bootstrapHandle = null;

  // ========== UTIL ==========
  const log = (...a) => console.log("[grid-colorer]", ...a);
  const err = (...a) => console.error("[grid-colorer]", ...a);

  // Flexible date parser: supports "YYYY-MM-DD HH:MM" and "DD-MM-YYYY HH:MM"
  function parseFlexibleDate(str) {
    if (!str || typeof str !== "string") return null;
    const s = str.trim();
    // YYYY-MM-DD HH:MM
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/);
    if (iso) {
      const y = +iso[1], m = (+iso[2]) - 1, d = +iso[3];
      const hh = iso[4] ? +iso[4] : 0, mm = iso[5] ? +iso[5] : 0;
      return new Date(y, m, d, hh, mm).getTime();
    }
    // DD-MM-YYYY HH:MM
    const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:[T\s]+(\d{1,2}):(\d{2}))?/);
    if (dmy) {
      const d = +dmy[1], m = (+dmy[2]) - 1, y = +dmy[3];
      const hh = dmy[4] ? +dmy[4] : 0, mm = dmy[5] ? +dmy[5] : 0;
      return new Date(y, m, d, hh, mm).getTime();
    }
    return null;
  }

  // Given a row <tr>, return the <td> for a colName using aria-describedby
  function getTdForCol(tr, colName) {
    if (!tr || !colName) return null;
    try {
      return tr.querySelector(`td[aria-describedby="${GRID_ID}_${colName}"]`);
    } catch (e) {
      return null;
    }
  }

  // Apply colors to an array of tds (overrides inline styles)
  function applyColorsToTds(tds, isFuture, isApplied) {
    if (!tds || tds.length === 0) return;
    const bg = isApplied ? YELLOW : (isFuture ? GREEN : RED);
    tds.forEach(td => {
      if (!td) return;
      td.style.setProperty("background-color", bg, "important");
      td.style.setProperty("border-color", BORDER, "important");
    });
  }

  // Find the colModel name of the "Application Status" column from its header (th id is "<grid>_<name>")
  function getAppliedColName(doc) {
    const ths = doc.querySelectorAll(`#gview_${GRID_ID} .ui-jqgrid-labels th, #gbox_${GRID_ID} .ui-jqgrid-labels th`);
    for (const th of ths) {
      if ((th.textContent || "").trim().toLowerCase().includes(APPLIED_HEADER_TEXT)) {
        return (th.id || "").replace(new RegExp(`^${GRID_ID}_`), "") || null;
      }
    }
    return null;
  }

  function isRowApplied(tr) {
    const col = getAppliedColName(tr.ownerDocument);
    const td = col && getTdForCol(tr, col);
    if (!td) return false;
    const v = ((td.getAttribute("title") || "").trim() || (td.textContent || "").trim()).toLowerCase();
    return APPLIED_VALUES.includes(v);
  }

  // Color one row by its <tr> element
  function colorRowTr(tr) {
    if (!tr || !tr.id) return;
    // pick the deadline td (title attribute often contains the exact value)
    const deadlineTd = getTdForCol(tr, PRIMARY_DEADLINE_COL) || getTdForCol(tr, FALLBACK_DEADLINE_COL);
    const raw = (deadlineTd && ((deadlineTd.getAttribute("title") || "").trim() || (deadlineTd.textContent || "").trim())) || "";
    const parsed = parseFlexibleDate(raw);
    const now = Date.now();

    // gather the tds we want to color
    const tds = COLUMNS_TO_COLOR.map(col => getTdForCol(tr, col)).filter(Boolean);
    const applied = isRowApplied(tr);
    if (parsed === null && !applied) {
      // If you prefer to mark rows with no parse as expired/neutral, change here.
      return;
    }
    const isFuture = parsed !== null && parsed > now;
    applyColorsToTds(tds, isFuture, applied);
  }

  // Update all visible rows in the grid
  function updateAllRows() {
    try {
      if (!targetFrame) return;
      const doc = targetFrame.document;
      const table = doc.getElementById(GRID_ID);
      if (!table) return;
      // jqGrid places rows inside tbody — include rows with 'jqgrow' role/class
      const rows = Array.from(table.querySelectorAll("tbody tr.jqgrow, tbody tr[role='row']"));
      rows.forEach(tr => {
        // skip the special first placeholder row
        if (tr.classList.contains("jqgfirstrow")) return;
        if (!tr.id) return;
        colorRowTr(tr);
      });
    } catch (e) {
      err("updateAllRows failed:", e);
    }
  }

  // Attach MutationObserver to table (detect dynamic updates)
  function attachMutationObserver() {
    try {
      if (!targetFrame) return false;
      const doc = targetFrame.document;
      const table = doc.getElementById(GRID_ID);
      if (!table) return false;

      // disconnect previous if present
      if (mutationObserver) {
        try { mutationObserver.disconnect(); } catch (e) {}
        mutationObserver = null;
      }

      mutationObserver = new targetFrame.MutationObserver((mutationsList) => {
        // small debounce inside observer
        if (mutationObserver._debounce) return;
        mutationObserver._debounce = true;
        setTimeout(() => {
          mutationObserver._debounce = false;
          updateAllRows();
        }, 80);
      });

      mutationObserver.observe(table, { childList: true, subtree: true });
      log("MutationObserver attached to grid table.");
      return true;
    } catch (e) {
      err("attachMutationObserver failed:", e);
      return false;
    }
  }

  // Try to attach jqGrid 'gridComplete' event by adding a handler via the DOM (works if jQuery in page/iframe)
  function tryAttachJqGridEvent() {
    try {
      if (!targetFrame) return false;
      const jq = targetFrame.jq || targetFrame.jQuery;
      if (!jq || typeof jq !== "function") return false;
      const $grid = jq(`#${GRID_ID}`);
      if (!$grid || $grid.length === 0) return false;
      $grid.on("jqGridGridComplete", () => updateAllRows());
      log("Attached jqGrid 'gridComplete' handler.");
      return true;
    } catch (e) {
      // non-fatal
      return false;
    }
  }

  // Cleanup
  function cleanupAll() {
    try {
      if (bootstrapHandle) { clearInterval(bootstrapHandle); bootstrapHandle = null; }
      if (fallbackInterval) { clearInterval(fallbackInterval); fallbackInterval = null; }
      if (mutationObserver) { try { mutationObserver.disconnect(); } catch (e) {} mutationObserver = null; }
      // try to remove jq event
      try {
        if (targetFrame) {
          const jq = targetFrame.jq || targetFrame.jQuery;
          if (jq) {
            const $g = jq(`#${GRID_ID}`);
            if ($g && $g.length) { $g.off("jqGridGridComplete"); }
          }
        }
      } catch (e) { /* ignore */ }
      log("grid-colorer cleaned up.");
    } catch (e) {
      err("cleanupAll error:", e);
    }
  }

  // Expose stop function so you can stop it from console
  try { window.stopGridColoring = cleanupAll; } catch (e) { /* ignore */ }

  // Bootstrap attempts while iframe loads
  let attempts = 0;
  bootstrapHandle = setInterval(() => {
    attempts++;
    try {
      // locate iframe by its name
      targetFrame = window.frames[FRAME_NAME];
      if (!targetFrame) {
        // not found yet
        if (attempts > BOOTSTRAP_ATTEMPTS) {
          clearInterval(bootstrapHandle);
          bootstrapHandle = null;
          err(`Frame "${FRAME_NAME}" not found after ${attempts} attempts. Aborting bootstrap.`);
        }
        return;
      }
      // same-origin check
      try {
        // access the document to ensure it's same-origin
        const _ = targetFrame.document && targetFrame.document.readyState;
      } catch (e) {
        clearInterval(bootstrapHandle);
        bootstrapHandle = null;
        err("Cannot access iframe document (likely cross-origin). grid-colorer requires same-origin iframe.");
        return;
      }

      // At this point the frame is accessible. Run an immediate update and attach observers.
      updateAllRows();
      tryAttachJqGridEvent();
      attachMutationObserver();

      // fallback periodic update to handle missed cases
      fallbackInterval = setInterval(updateAllRows, FALLBACK_INTERVAL_MS);

      // success - stop bootstrap attempts
      clearInterval(bootstrapHandle);
      bootstrapHandle = null;
      log("grid-colorer bootstrapped successfully. Call stopGridColoring() from console to stop.");
    } catch (e) {
      err("Bootstrap attempt error:", e);
      if (attempts > BOOTSTRAP_ATTEMPTS) {
        clearInterval(bootstrapHandle);
        bootstrapHandle = null;
        err("Bootstrap attempts exhausted.");
      }
    }
  }, BOOTSTRAP_INTERVAL_MS);

})();
