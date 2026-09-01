import { debug } from "../debug/index.js";

export const PANEL_WORKSPACE_LAYOUT_VERSION = 1;
export const PANEL_WORKSPACE_STORAGE_KEY = "circle-grid.panel-workspace.v1";
export const PANEL_WORKSPACE_BREAKPOINT = 720;
export const PANEL_WORKSPACE_HEADER_HEIGHT = 40;
export const PANEL_WORKSPACE_GAP = 10;

export const DEFAULT_PANEL_SAFE_AREA = Object.freeze({
  top: 12,
  right: 12,
  bottom: 12,
  left: 12,
});

export const DEFAULT_PANEL_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "composition",
    title: "Composition",
    code: "CMP",
    column: "left",
    width: 288,
    expandedHeight: 272,
    resetLayout: true,
  }),
  Object.freeze({
    id: "interactive-flock",
    title: "Interactive Flock",
    code: "TAKE",
    column: "left",
    width: 340,
    expandedHeight: 486,
    mobileExpanded: true,
  }),
  Object.freeze({
    id: "fields",
    title: "Fields",
    code: "FLD",
    column: "right",
    width: 320,
    expandedHeight: 322,
  }),
  Object.freeze({
    id: "export",
    title: "Export",
    code: "OUT",
    column: "right",
    width: 288,
    expandedHeight: 392,
  }),
]);

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedViewport(viewport) {
  const width = finiteOr(viewport?.width, 0);
  const height = finiteOr(viewport?.height, 0);
  if (width <= 0 || height <= 0) {
    throw new RangeError("Panel workspace viewport width and height must be positive numbers.");
  }
  return { width, height };
}

function normalizedDefinitions(definitions) {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    throw new TypeError("Panel workspace definitions must be a non-empty array.");
  }
  const ids = new Set();
  return definitions.map((definition, index) => {
    const id = typeof definition?.id === "string" ? definition.id.trim() : "";
    if (!id || ids.has(id)) {
      throw new TypeError(`Panel workspace definition ${index} needs a unique id.`);
    }
    ids.add(id);
    return {
      ...definition,
      id,
      title: typeof definition.title === "string" && definition.title.trim()
        ? definition.title.trim()
        : id,
      code: typeof definition.code === "string" && definition.code.trim()
        ? definition.code.trim()
        : String(index + 1).padStart(2, "0"),
      column: definition.column === "right" ? "right" : "left",
      width: Math.max(1, finiteOr(definition.width, 288)),
      expandedHeight: Math.max(
        PANEL_WORKSPACE_HEADER_HEIGHT,
        finiteOr(definition.expandedHeight, 320),
      ),
    };
  });
}

function normalizedSafeArea(viewport, safeArea = DEFAULT_PANEL_SAFE_AREA) {
  const horizontalLimit = Math.max(0, viewport.width - 1);
  const verticalLimit = Math.max(0, viewport.height - 1);
  const left = clamp(Math.max(0, finiteOr(safeArea?.left, 0)), 0, horizontalLimit);
  const top = clamp(Math.max(0, finiteOr(safeArea?.top, 0)), 0, verticalLimit);
  const right = clamp(
    Math.max(0, finiteOr(safeArea?.right, 0)),
    0,
    Math.max(0, horizontalLimit - left),
  );
  const bottom = clamp(
    Math.max(0, finiteOr(safeArea?.bottom, 0)),
    0,
    Math.max(0, verticalLimit - top),
  );
  return { top, right, bottom, left };
}

export function panelWorkspaceViewportClass(viewport) {
  return normalizedViewport(viewport).width < PANEL_WORKSPACE_BREAKPOINT
    ? "compact"
    : "wide";
}

export function clampPanelRect(rect, viewportInput, safeAreaInput = DEFAULT_PANEL_SAFE_AREA) {
  const viewport = normalizedViewport(viewportInput);
  const safeArea = normalizedSafeArea(viewport, safeAreaInput);
  const availableWidth = Math.max(1, viewport.width - safeArea.left - safeArea.right);
  const availableHeight = Math.max(1, viewport.height - safeArea.top - safeArea.bottom);
  const width = Math.min(availableWidth, Math.max(1, finiteOr(rect?.width, 1)));
  const height = Math.min(availableHeight, Math.max(1, finiteOr(rect?.height, 1)));
  const maximumX = safeArea.left + availableWidth - width;
  const maximumY = safeArea.top + availableHeight - height;
  return {
    x: clamp(finiteOr(rect?.x, safeArea.left), safeArea.left, maximumX),
    y: clamp(finiteOr(rect?.y, safeArea.top), safeArea.top, maximumY),
    width,
    height,
  };
}

function desktopPanelLayout(definitions, viewport, safeArea) {
  const panels = {};
  const bottom = viewport.height - safeArea.bottom;
  for (const column of ["left", "right"]) {
    const columnPanels = definitions.filter(definition => definition.column === column);
    let y = safeArea.top;
    for (let index = 0; index < columnPanels.length; index += 1) {
      const definition = columnPanels[index];
      const remaining = columnPanels.length - index - 1;
      const reserved = remaining * (PANEL_WORKSPACE_HEADER_HEIGHT + PANEL_WORKSPACE_GAP);
      const availableHeight = Math.max(
        PANEL_WORKSPACE_HEADER_HEIGHT,
        bottom - y - reserved,
      );
      const collapsed = definition.expandedHeight > availableHeight;
      const estimatedHeight = collapsed
        ? PANEL_WORKSPACE_HEADER_HEIGHT
        : definition.expandedHeight;
      const rect = clampPanelRect({
        x: column === "right"
          ? viewport.width - safeArea.right - definition.width
          : safeArea.left,
        y,
        width: definition.width,
        height: estimatedHeight,
      }, viewport, safeArea);
      panels[definition.id] = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        collapsed,
        hidden: false,
        z: 40 + definitions.indexOf(definition),
        estimatedHeight: rect.height,
      };
      y += rect.height + PANEL_WORKSPACE_GAP;
    }
  }
  return panels;
}

function compactPanelLayout(definitions, viewport, safeArea) {
  const panels = {};
  const availableHeight = Math.max(
    1,
    viewport.height - safeArea.top - safeArea.bottom,
  );
  const gapsHeight = Math.max(0, definitions.length - 1) * PANEL_WORKSPACE_GAP;
  const headersHeight = definitions.length * PANEL_WORKSPACE_HEADER_HEIGHT;
  const bodyBudget = Math.max(0, availableHeight - gapsHeight - headersHeight);
  const expanded = definitions.find(definition => definition.mobileExpanded)
    ?? definitions[0];
  let y = safeArea.top;

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const collapsed = definition.id !== expanded.id;
    const desiredBodyHeight = Math.max(
      0,
      definition.expandedHeight - PANEL_WORKSPACE_HEADER_HEIGHT,
    );
    const estimatedHeight = PANEL_WORKSPACE_HEADER_HEIGHT
      + (collapsed ? 0 : Math.min(desiredBodyHeight, bodyBudget));
    const rect = clampPanelRect({
      x: safeArea.left,
      y,
      width: viewport.width - safeArea.left - safeArea.right,
      height: estimatedHeight,
    }, viewport, safeArea);
    panels[definition.id] = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      collapsed,
      hidden: false,
      z: 40 + index,
      estimatedHeight: rect.height,
    };
    y += rect.height + PANEL_WORKSPACE_GAP;
  }
  return panels;
}

export function createDefaultPanelWorkspaceLayout(
  viewportInput,
  {
    definitions: definitionInput = DEFAULT_PANEL_DEFINITIONS,
    safeArea: safeAreaInput = DEFAULT_PANEL_SAFE_AREA,
  } = {},
) {
  const viewport = normalizedViewport(viewportInput);
  const definitions = normalizedDefinitions(definitionInput);
  const safeArea = normalizedSafeArea(viewport, safeAreaInput);
  const viewportClass = panelWorkspaceViewportClass(viewport);
  const panels = viewportClass === "compact"
    ? compactPanelLayout(definitions, viewport, safeArea)
    : desktopPanelLayout(definitions, viewport, safeArea);
  return {
    version: PANEL_WORKSPACE_LAYOUT_VERSION,
    viewportClass,
    panels,
  };
}

function storedBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function resolvePanelWorkspaceLayout(
  stored,
  viewportInput,
  options = {},
) {
  const viewport = normalizedViewport(viewportInput);
  const definitions = normalizedDefinitions(
    options.definitions ?? DEFAULT_PANEL_DEFINITIONS,
  );
  const safeArea = normalizedSafeArea(
    viewport,
    options.safeArea ?? DEFAULT_PANEL_SAFE_AREA,
  );
  const defaults = createDefaultPanelWorkspaceLayout(viewport, {
    definitions,
    safeArea,
  });
  if (
    stored?.version !== PANEL_WORKSPACE_LAYOUT_VERSION
    || stored?.viewportClass !== defaults.viewportClass
    || !stored?.panels
    || typeof stored.panels !== "object"
  ) {
    return defaults;
  }

  const panels = {};
  for (const definition of definitions) {
    const fallback = defaults.panels[definition.id];
    const candidate = stored.panels[definition.id];
    if (!candidate || typeof candidate !== "object") {
      panels[definition.id] = fallback;
      continue;
    }
    const collapsed = storedBoolean(candidate.collapsed, fallback.collapsed);
    const estimatedHeight = collapsed
      ? PANEL_WORKSPACE_HEADER_HEIGHT
      : definition.expandedHeight;
    const rect = clampPanelRect({
      x: finiteOr(candidate.x, fallback.x),
      y: finiteOr(candidate.y, fallback.y),
      width: finiteOr(candidate.width, fallback.width),
      height: estimatedHeight,
    }, viewport, safeArea);
    panels[definition.id] = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      collapsed,
      hidden: storedBoolean(candidate.hidden, false),
      z: Math.max(1, Math.round(finiteOr(candidate.z, fallback.z))),
      estimatedHeight: rect.height,
    };
  }
  return { ...defaults, panels };
}

export function panelRectsForLayout(
  layout,
  definitionsInput = DEFAULT_PANEL_DEFINITIONS,
) {
  const definitions = normalizedDefinitions(definitionsInput);
  return definitions.map(definition => {
    const state = layout.panels[definition.id];
    return {
      id: definition.id,
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.estimatedHeight ?? (
        state.collapsed ? PANEL_WORKSPACE_HEADER_HEIGHT : definition.expandedHeight
      ),
    };
  });
}

export function loadPanelWorkspaceLayout({
  storage,
  storageKey = PANEL_WORKSPACE_STORAGE_KEY,
  viewport,
  definitions = DEFAULT_PANEL_DEFINITIONS,
  safeArea = DEFAULT_PANEL_SAFE_AREA,
}) {
  let stored = null;
  try {
    const serialized = storage?.getItem?.(storageKey);
    stored = serialized ? JSON.parse(serialized) : null;
  } catch {
    stored = null;
  }
  return resolvePanelWorkspaceLayout(stored, viewport, { definitions, safeArea });
}

export function savePanelWorkspaceLayout(
  storage,
  layout,
  storageKey = PANEL_WORKSPACE_STORAGE_KEY,
) {
  try {
    storage?.setItem?.(storageKey, JSON.stringify(layout));
    return Boolean(storage?.setItem);
  } catch {
    return false;
  }
}

export function snapshotPanelWorkspaceLayout(layout) {
  return {
    version: layout.version,
    viewportClass: layout.viewportClass,
    panels: Object.fromEntries(
      Object.entries(layout.panels).map(([id, state]) => [id, { ...state }]),
    ),
  };
}

function currentViewport(windowRef, documentRef) {
  return normalizedViewport({
    width: windowRef?.innerWidth ?? documentRef?.documentElement?.clientWidth,
    height: windowRef?.innerHeight ?? documentRef?.documentElement?.clientHeight,
  });
}

function readSafeArea(documentRef, windowRef) {
  const probe = documentRef.createElement("div");
  Object.assign(probe.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    paddingTop: "env(safe-area-inset-top)",
    paddingRight: "env(safe-area-inset-right)",
    paddingBottom: "env(safe-area-inset-bottom)",
    paddingLeft: "env(safe-area-inset-left)",
  });
  documentRef.body.append(probe);
  const computed = windowRef.getComputedStyle(probe);
  const inset = side => Math.max(0, Number.parseFloat(computed[`padding${side}`]) || 0);
  const safeArea = {
    top: DEFAULT_PANEL_SAFE_AREA.top + inset("Top"),
    right: DEFAULT_PANEL_SAFE_AREA.right + inset("Right"),
    bottom: DEFAULT_PANEL_SAFE_AREA.bottom + inset("Bottom"),
    left: DEFAULT_PANEL_SAFE_AREA.left + inset("Left"),
  };
  probe.remove();
  return safeArea;
}

function contentElement(value) {
  const element = value?.element ?? value;
  if (!element || typeof element !== "object" || !Number.isFinite(element.nodeType)) {
    throw new TypeError("Panel content must be a DOM node or a Tweakpane instance.");
  }
  return element;
}

export function createPanelWorkspace({
  document: documentRef = globalThis.document,
  window: windowRef = globalThis.window,
  mount = documentRef?.body,
  storage: storageInput,
  storageKey = PANEL_WORKSPACE_STORAGE_KEY,
  definitions: definitionInput = DEFAULT_PANEL_DEFINITIONS,
  onLayoutChange,
} = {}) {
  if (!documentRef?.createElement || !mount?.append) {
    throw new TypeError("createPanelWorkspace needs a document and mount element.");
  }
  let storage = storageInput;
  if (storage === undefined) {
    try {
      storage = windowRef?.localStorage;
    } catch {
      storage = null;
    }
  }
  const definitions = normalizedDefinitions(definitionInput);
  let viewport = currentViewport(windowRef, documentRef);
  let safeArea = readSafeArea(documentRef, windowRef);
  let layout = loadPanelWorkspaceLayout({
    storage,
    storageKey,
    viewport,
    definitions,
    safeArea,
  });
  let maximumZ = Math.max(...Object.values(layout.panels).map(state => state.z));
  let destroyed = false;

  const root = documentRef.createElement("section");
  root.className = "panel-workspace";
  root.setAttribute("aria-label", "Flight console panels");
  const records = new Map();
  const cleanups = [];

  function recordFor(id) {
    const record = records.get(id);
    if (!record) throw new RangeError(`Unknown panel "${id}".`);
    return record;
  }

  function notify(reason, id = "all") {
    const snapshot = snapshotPanelWorkspaceLayout(layout);
    savePanelWorkspaceLayout(storage, snapshot, storageKey);
    onLayoutChange?.(snapshot, { reason, id });
  }

  function applyRecord(record) {
    const state = layout.panels[record.definition.id];
    record.root.style.left = `${state.x}px`;
    record.root.style.top = `${state.y}px`;
    record.root.style.width = `${state.width}px`;
    record.root.style.zIndex = String(state.z);
    record.root.hidden = state.hidden;
    record.root.classList.toggle("is-collapsed", state.collapsed);
    record.body.hidden = state.collapsed;
    record.collapseButton.textContent = state.collapsed ? "+" : "−";
    record.collapseButton.setAttribute("aria-expanded", String(!state.collapsed));
    record.collapseButton.setAttribute(
      "aria-label",
      `${state.collapsed ? "Expand" : "Collapse"} ${record.definition.title} panel`,
    );
  }

  function actualRect(record) {
    const state = layout.panels[record.definition.id];
    const rect = record.root.getBoundingClientRect();
    return {
      x: state.x,
      y: state.y,
      width: rect.width || state.width,
      height: rect.height || state.estimatedHeight,
    };
  }

  function clampRecord(record) {
    const state = layout.panels[record.definition.id];
    const rect = clampPanelRect(actualRect(record), viewport, safeArea);
    state.x = rect.x;
    state.y = rect.y;
    state.width = rect.width;
    state.estimatedHeight = rect.height;
    applyRecord(record);
  }

  function bringToFront(id, { persist = true } = {}) {
    const record = recordFor(id);
    if (layout.panels[id].z === maximumZ) return maximumZ;
    maximumZ += 1;
    layout.panels[id].z = maximumZ;
    if (maximumZ > 1000) {
      const ordered = [...records.values()].sort((a, b) => (
        layout.panels[a.definition.id].z - layout.panels[b.definition.id].z
      ));
      ordered.forEach((item, index) => {
        layout.panels[item.definition.id].z = 40 + index;
      });
      maximumZ = 39 + ordered.length;
      ordered.forEach(applyRecord);
    } else {
      applyRecord(record);
    }
    if (persist) notify("focus", id);
    return layout.panels[id].z;
  }

  function setCollapsed(id, collapsed) {
    const record = recordFor(id);
    const state = layout.panels[id];
    const next = Boolean(collapsed);
    if (state.collapsed === next) return state.collapsed;
    state.collapsed = next;
    state.estimatedHeight = next
      ? PANEL_WORKSPACE_HEADER_HEIGHT
      : record.definition.expandedHeight;
    applyRecord(record);
    windowRef.requestAnimationFrame?.(() => {
      if (!destroyed) clampRecord(record);
    });
    notify("collapse", id);
    debug.config(
      "panel-workspace panel=%s collapsed=%s",
      id,
      next ? "yes" : "no",
    );
    return state.collapsed;
  }

  function setVisible(id, visible) {
    const record = recordFor(id);
    const state = layout.panels[id];
    state.hidden = !visible;
    applyRecord(record);
    notify("visibility", id);
    debug.config(
      "panel-workspace panel=%s visible=%s",
      id,
      state.hidden ? "no" : "yes",
    );
    return !state.hidden;
  }

  function movePanel(id, deltaX, deltaY, reason = "move") {
    const record = recordFor(id);
    const state = layout.panels[id];
    const rect = actualRect(record);
    const clamped = clampPanelRect({
      ...rect,
      x: state.x + deltaX,
      y: state.y + deltaY,
    }, viewport, safeArea);
    state.x = clamped.x;
    state.y = clamped.y;
    state.width = clamped.width;
    state.estimatedHeight = clamped.height;
    applyRecord(record);
    if (reason) notify(reason, id);
  }

  function attach(id, content, { replace = true } = {}) {
    const body = recordFor(id).body;
    if (content === null || content === undefined) {
      if (replace) body.replaceChildren();
      return body;
    }
    const element = contentElement(content);
    if (replace) body.replaceChildren(element);
    else body.append(element);
    return body;
  }

  function defaultLayoutWithCurrentVisibility() {
    const next = createDefaultPanelWorkspaceLayout(viewport, {
      definitions,
      safeArea,
    });
    for (const definition of definitions) {
      next.panels[definition.id].hidden = layout.panels[definition.id].hidden;
    }
    return next;
  }

  function resetLayout() {
    layout = defaultLayoutWithCurrentVisibility();
    maximumZ = Math.max(...Object.values(layout.panels).map(state => state.z));
    records.forEach(applyRecord);
    windowRef.requestAnimationFrame?.(() => {
      if (!destroyed) records.forEach(clampRecord);
    });
    notify("reset");
    debug.config(
      "panel-workspace reset mode=%s panels=%d",
      layout.viewportClass,
      definitions.length,
    );
    return snapshotPanelWorkspaceLayout(layout);
  }

  for (const definition of definitions) {
    const panel = documentRef.createElement("aside");
    panel.className = "panel-window";
    panel.dataset.panelId = definition.id;

    const header = documentRef.createElement("header");
    header.className = "panel-window-header";
    header.tabIndex = 0;
    header.setAttribute(
      "aria-label",
      `${definition.title} panel. Use arrow keys to reposition.`,
    );

    const code = documentRef.createElement("span");
    code.className = "panel-window-code";
    code.textContent = definition.code;
    code.setAttribute("aria-hidden", "true");

    const title = documentRef.createElement("h2");
    title.className = "panel-window-title";
    title.id = `panel-workspace-title-${definition.id}`;
    title.textContent = definition.title;
    panel.setAttribute("aria-labelledby", title.id);

    const controls = documentRef.createElement("div");
    controls.className = "panel-window-controls";
    if (definition.resetLayout) {
      const reset = documentRef.createElement("button");
      reset.type = "button";
      reset.className = "panel-window-action panel-window-reset";
      reset.textContent = "↺";
      reset.title = "Reset panel layout";
      reset.setAttribute("aria-label", "Reset panel layout");
      reset.addEventListener("click", resetLayout);
      controls.append(reset);
    }

    const collapseButton = documentRef.createElement("button");
    collapseButton.type = "button";
    collapseButton.className = "panel-window-action panel-window-collapse";
    controls.append(collapseButton);
    header.append(code, title, controls);

    const body = documentRef.createElement("div");
    body.className = "panel-window-body";
    body.id = `panel-workspace-body-${definition.id}`;
    collapseButton.setAttribute("aria-controls", body.id);
    panel.append(header, body);
    root.append(panel);

    const record = { definition, root: panel, header, body, collapseButton };
    records.set(definition.id, record);
    applyRecord(record);

    const raise = () => bringToFront(definition.id);
    panel.addEventListener("pointerdown", raise);
    panel.addEventListener("focusin", raise);
    collapseButton.addEventListener("click", () => {
      setCollapsed(definition.id, !layout.panels[definition.id].collapsed);
    });

    let drag = null;
    const endDrag = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag = null;
      header.classList.remove("is-dragging");
      if (header.hasPointerCapture?.(event.pointerId)) {
        header.releasePointerCapture(event.pointerId);
      }
      notify("drag", definition.id);
      debug.config(
        "panel-workspace panel=%s x=%d y=%d",
        definition.id,
        Math.round(layout.panels[definition.id].x),
        Math.round(layout.panels[definition.id].y),
      );
    };
    header.addEventListener("pointerdown", event => {
      if (
        event.button !== 0
        || event.target.closest?.("button, input, select, textarea, a, [data-no-drag]")
      ) return;
      const state = layout.panels[definition.id];
      drag = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        x: state.x,
        y: state.y,
      };
      header.setPointerCapture?.(event.pointerId);
      header.classList.add("is-dragging");
      event.preventDefault();
    });
    header.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const state = layout.panels[definition.id];
      const rect = actualRect(record);
      const clamped = clampPanelRect({
        ...rect,
        x: drag.x + event.clientX - drag.clientX,
        y: drag.y + event.clientY - drag.clientY,
      }, viewport, safeArea);
      state.x = clamped.x;
      state.y = clamped.y;
      state.width = clamped.width;
      state.estimatedHeight = clamped.height;
      applyRecord(record);
    });
    header.addEventListener("pointerup", endDrag);
    header.addEventListener("pointercancel", endDrag);
    header.addEventListener("keydown", event => {
      const directions = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      bringToFront(definition.id, { persist: false });
      const distance = event.shiftKey ? 24 : 8;
      movePanel(
        definition.id,
        direction[0] * distance,
        direction[1] * distance,
        "keyboard-move",
      );
      debug.config(
        "panel-workspace panel=%s x=%d y=%d input=keyboard",
        definition.id,
        Math.round(layout.panels[definition.id].x),
        Math.round(layout.panels[definition.id].y),
      );
    });
  }

  mount.append(root);

  const handleResize = () => {
    const nextViewport = currentViewport(windowRef, documentRef);
    const nextSafeArea = readSafeArea(documentRef, windowRef);
    const nextClass = panelWorkspaceViewportClass(nextViewport);
    viewport = nextViewport;
    safeArea = nextSafeArea;
    if (nextClass !== layout.viewportClass) {
      layout = defaultLayoutWithCurrentVisibility();
      maximumZ = Math.max(...Object.values(layout.panels).map(state => state.z));
      records.forEach(applyRecord);
      notify("responsive-layout");
      debug.config(
        "panel-workspace responsive-layout mode=%s panels=%d",
        nextClass,
        definitions.length,
      );
      return;
    }
    records.forEach(clampRecord);
    notify("resize");
  };
  windowRef.addEventListener?.("resize", handleResize);
  cleanups.push(() => windowRef.removeEventListener?.("resize", handleResize));

  const ResizeObserverType = windowRef.ResizeObserver;
  const observer = typeof ResizeObserverType === "function"
    ? new ResizeObserverType(entries => {
      for (const entry of entries) {
        const record = [...records.values()].find(item => item.root === entry.target);
        if (record && !record.root.hidden) clampRecord(record);
      }
    })
    : null;
  records.forEach(record => observer?.observe(record.root));

  debug.config(
    "panel-workspace ready mode=%s panels=%d",
    layout.viewportClass,
    definitions.length,
  );

  return {
    root,
    attach,
    body: id => recordFor(id).body,
    panel: id => recordFor(id).root,
    bringToFront,
    setCollapsed,
    setVisible,
    resetLayout,
    layout: () => snapshotPanelWorkspaceLayout(layout),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect();
      cleanups.forEach(cleanup => cleanup());
      root.remove();
    },
  };
}
