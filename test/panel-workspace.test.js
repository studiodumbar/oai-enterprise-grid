import test from "node:test";
import assert from "node:assert/strict";

import { VERSION as TWEAKPANE_VERSION } from "../src/vendor/tweakpane-4.0.5.min.js";
import {
  DEFAULT_PANEL_DEFINITIONS,
  PANEL_WORKSPACE_LAYOUT_VERSION,
  clampPanelRect,
  createDefaultPanelWorkspaceLayout,
  loadPanelWorkspaceLayout,
  panelRectsForLayout,
  resolvePanelWorkspaceLayout,
  savePanelWorkspaceLayout,
} from "../src/ui/panel-workspace.js";

function overlaps(first, second) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function assertSafeDefault(viewport) {
  const layout = createDefaultPanelWorkspaceLayout(viewport);
  const rects = panelRectsForLayout(layout);
  assert.equal(rects.length, 4);
  for (const rect of rects) {
    assert.ok(rect.x >= 12 && rect.y >= 12);
    assert.ok(rect.x + rect.width <= viewport.width - 12);
    assert.ok(rect.y + rect.height <= viewport.height - 12);
  }
  for (let first = 0; first < rects.length; first += 1) {
    for (let second = first + 1; second < rects.length; second += 1) {
      assert.equal(
        overlaps(rects[first], rects[second]),
        false,
        `${rects[first].id} overlaps ${rects[second].id}`,
      );
    }
  }
  return layout;
}

test("default panel layouts are collision-free at desktop and phone sizes", () => {
  const desktop = assertSafeDefault({ width: 1440, height: 900 });
  assert.equal(desktop.viewportClass, "wide");
  assert.ok(Object.values(desktop.panels).every(panel => !panel.collapsed));

  const phone = assertSafeDefault({ width: 390, height: 844 });
  assert.equal(phone.viewportClass, "compact");
  assert.deepEqual(
    Object.entries(phone.panels)
      .filter(([, panel]) => !panel.collapsed)
      .map(([id]) => id),
    ["interactive-flock"],
  );
});

test("panel rectangles remain entirely inside the safe viewport", () => {
  assert.deepEqual(
    clampPanelRect(
      { x: -200, y: 400, width: 500, height: 500 },
      { width: 100, height: 80 },
      { top: 10, right: 10, bottom: 10, left: 10 },
    ),
    { x: 10, y: 10, width: 80, height: 60 },
  );
});

test("stored layouts are validated, clamped, and scoped to a viewport class", () => {
  const viewport = { width: 1440, height: 900 };
  const stored = createDefaultPanelWorkspaceLayout(viewport);
  stored.panels.composition = {
    ...stored.panels.composition,
    x: 5000,
    y: -100,
    collapsed: true,
    hidden: true,
    z: 84,
  };
  const restored = resolvePanelWorkspaceLayout(stored, viewport);
  assert.equal(restored.panels.composition.x, 1140);
  assert.equal(restored.panels.composition.y, 12);
  assert.equal(restored.panels.composition.collapsed, true);
  assert.equal(restored.panels.composition.hidden, true);
  assert.equal(restored.panels.composition.z, 84);

  const stale = resolvePanelWorkspaceLayout(
    { ...stored, version: PANEL_WORKSPACE_LAYOUT_VERSION - 1 },
    viewport,
  );
  assert.equal(stale.panels.composition.x, 12);
  const compact = resolvePanelWorkspaceLayout(stored, { width: 390, height: 844 });
  assert.equal(compact.viewportClass, "compact");
  assert.equal(compact.panels["interactive-flock"].collapsed, false);
});

test("layout storage round-trips and unavailable storage falls back safely", () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const viewport = { width: 1440, height: 900 };
  const layout = createDefaultPanelWorkspaceLayout(viewport);
  layout.panels.fields.collapsed = true;
  assert.equal(savePanelWorkspaceLayout(storage, layout), true);
  assert.equal(
    loadPanelWorkspaceLayout({ storage, viewport }).panels.fields.collapsed,
    true,
  );

  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.equal(savePanelWorkspaceLayout(unavailable, layout), false);
  assert.deepEqual(
    Object.keys(loadPanelWorkspaceLayout({ storage: unavailable, viewport }).panels),
    DEFAULT_PANEL_DEFINITIONS.map(definition => definition.id),
  );
});

test("the vendored Tweakpane module is pinned to 4.0.5", () => {
  assert.equal(String(TWEAKPANE_VERSION), "4.0.5");
});
