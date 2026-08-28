import {
  GLOBAL_CONFIG,
  SETTINGS,
  GENERATOR_DEFINITIONS,
  COMPOSITION_DEFINITIONS,
  createRuntimeConfig,
} from "../config.js";
import { CompositionDirector } from "./core/composition-director.js";
import { routeCanvasPointerInput } from "./core/canvas-pointer-input.js";
import {
  fitCanvasDisplaySize,
  resolveCanvasViewport,
} from "./core/canvas-viewport.js";
import { createCatalog } from "./catalog.js";
import { createExportState } from "./export/export-state.js";
import { createExportPanel } from "./export/export-panel.js";
import { createExportController } from "./export/export-controller.js";
import { createProjectState, createSnapshotHistory } from "./export/project-state.js";
import { createExportConsole } from "./export/export-console.js";
import { flickerModes } from "./visuals/flicker/index.js";
import { configureDebug, debug, resolveDebugChannels } from "./debug/index.js";
import { createNoisePreviewPanel } from "./noise-fields/noise-preview-panel.js";
import { createFlockPreviewPanel } from "./fields/flock-preview-panel.js";
import { createPanelWorkspace } from "./ui/panel-workspace.js";
import { createCompositionPanel } from "./ui/composition-panel.js";
import { createInteractiveFlockPanel } from "./ui/interactive-flock-panel.js";

if (typeof window.p5 !== "function") {
  throw new Error("p5.js did not load. Check the CDN request before starting the sketch.");
}

window.p5.disableFriendlyErrors = true;

new window.p5(p => {
  let director = null;
  let elapsed = 0;
  let frameIndex = 0;
  let pointerActive = false;
  let canvasElement = null;
  let inputLocked = false;
  let exportController = null;
  let exportPanel = null;
  let exportPanelVisible = false;
  let consoleCommands = null;
  let history = null;
  let pendingWindowResize = false;
  let resetPreviewDelta = false;
  let noisePreviewPanel = null;
  let flockPreviewPanel = null;
  let panelWorkspace = null;
  let compositionPanel = null;
  let interactiveFlockPanel = null;
  let lastPanelSyncTime = -Infinity;
  let compositionTimingOverrides = new Map();
  let projectSeed = createProjectSeed();
  const pointer = { active: false, x: 0, y: 0 };
  const exportState = createExportState();

  const runtime = {
    p5: p,
    viewport: () => ({ width: p.width, height: p.height }),
    context: () => p.drawingContext,
    canvas: () => canvasElement,
    document: () => document,
    announcer: () => document.getElementById("grid-announcer"),
    sessionStorage: () => window.sessionStorage,
    projectSeed: () => projectSeed,
  };

  function createProjectSeed() {
    const values = new Uint32Array(1);
    if (typeof window.crypto?.getRandomValues === "function") {
      window.crypto.getRandomValues(values);
      return values[0];
    }
    return (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
  }

  function setProjectSeed(seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return false;
    projectSeed = seed;
    p.noiseSeed?.(projectSeed);
    return true;
  }

  function activeCompositionFromConfig() {
    const query = new URLSearchParams(window.location.search);
    return query.get("composition") || GLOBAL_CONFIG.composition.active;
  }

  function syncDocumentTitle() {
    const composition = director?.inspect().compositionId
      ?? activeCompositionFromConfig();
    document.title = `OAI // ${composition}`;
  }

  function resolvedRuntimeConfig(overrides = compositionTimingOverrides) {
    if (overrides.size === 0) {
      return {
        settings: SETTINGS,
        generatorDefinitions: GENERATOR_DEFINITIONS,
        compositionDefinitions: COMPOSITION_DEFINITIONS,
      };
    }
    return createRuntimeConfig({ compositionTimingOverrides: overrides });
  }

  function createDirectorForRuntime(
    runtimeOverride,
    config = resolvedRuntimeConfig(),
  ) {
    const catalog = createCatalog({ palettes: GLOBAL_CONFIG.palettes });
    const next = new CompositionDirector({
      settings: config.settings,
      generatorDefinitions: config.generatorDefinitions,
      compositionDefinitions: config.compositionDefinitions,
      generatorTypes: catalog.generatorTypes,
      compositionRules: catalog.compositionRules,
      sceneTransitionTypes: catalog.sceneTransitionTypes,
      palettes: GLOBAL_CONFIG.palettes,
      runtime: runtimeOverride,
    });
    next.resize(runtimeOverride.viewport());
    return next;
  }

  function setCoreDurationFromConsole(seconds) {
    if (inputLocked) throw new Error("Core duration cannot change while input is locked.");
    const compositionId = director.inspect().compositionId;
    const nextOverrides = new Map(compositionTimingOverrides);
    nextOverrides.set(compositionId, seconds);
    const config = resolvedRuntimeConfig(nextOverrides);
    const saved = director.snapshotProjectState();
    let next = null;
    try {
      next = createDirectorForRuntime(runtime, config);
      next.restoreProjectState(saved);
      next.update(currentFrame(0));
      next.seek(elapsed);
    } catch (error) {
      next?.dispose();
      debug.config(
        "timing-override state=failed composition=%s body=%.3f error=%s",
        compositionId,
        seconds,
        error?.name ?? "Error",
      );
      throw error;
    }

    const previous = director;
    director = next;
    compositionTimingOverrides = nextOverrides;
    try {
      previous.dispose();
    } catch (error) {
      debug.config(
        "timing-override state=dispose-failed composition=%s error=%s",
        compositionId,
        error?.name ?? "Error",
      );
    }
    const coreDuration = director.inspect().timeline.coreDuration;
    debug.config(
      "timing-override state=applied composition=%s body=%.3f",
      compositionId,
      coreDuration,
    );
    syncDocumentTitle();
    syncCompositionUi();
    renderPreview();
    return coreDuration;
  }

  function currentFrame(dt = 0) {
    return {
      dt,
      compositionDt: dt,
      time: elapsed,
      frameIndex,
      viewport: runtime.viewport(),
      pointer: inputLocked
        ? { active: false, x: 0, y: 0 }
        : pointer,
    };
  }

  function configuredCanvasViewport() {
    return resolveCanvasViewport({
      resizeWithWindow: GLOBAL_CONFIG.canvas.resizeWithWindow,
      windowViewport: { width: p.windowWidth, height: p.windowHeight },
      requestedViewport: { width: exportState.resW, height: exportState.resH },
    });
  }

  // A fixed-spec canvas keeps its logical/export pixels while its CSS size
  // follows the available browser area. DevTools can therefore change only
  // the preview scale, never the generator layout.
  function fitCanvasDisplay() {
    if (!canvasElement) return;
    const fixed = !GLOBAL_CONFIG.canvas.resizeWithWindow;
    canvasElement.classList.toggle("fixed-spec-canvas", fixed);
    if (!fixed) {
      canvasElement.style.width = "";
      canvasElement.style.height = "";
      return;
    }
    const display = fitCanvasDisplaySize(
      { width: p.width, height: p.height },
      { width: p.windowWidth, height: p.windowHeight },
    );
    canvasElement.style.width = `${display.width}px`;
    canvasElement.style.height = `${display.height}px`;
  }

  function syncCanvasViewport(reason) {
    const viewport = configuredCanvasViewport();
    const changed = p.width !== viewport.width || p.height !== viewport.height;
    if (changed) {
      p.resizeCanvas(viewport.width, viewport.height);
      director?.resize(viewport);
      debug.config(
        "canvas resized reason=%s width=%d height=%d",
        reason,
        viewport.width,
        viewport.height,
      );
    }
    fitCanvasDisplay();
    return changed;
  }

  function renderPreview() {
    if (!director) return;
    p.background(GLOBAL_CONFIG.canvas.background);
    director.draw(currentFrame(0));
  }

  function projectSnapshot() {
    return createProjectState({
      director,
      exportState,
      projectSeed,
      timeline: { time: elapsed, frameIndex },
    });
  }

  function sameSnapshot(left, right) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  function restoreProjectSnapshot(snapshot) {
    if (Number.isInteger(snapshot?.seed)) setProjectSeed(snapshot.seed);
    if (Number.isFinite(snapshot?.timeline?.time)) elapsed = snapshot.timeline.time;
    if (Number.isSafeInteger(snapshot?.timeline?.frameIndex)) {
      frameIndex = snapshot.timeline.frameIndex;
    }
    Object.assign(exportState, snapshot.export);
    exportPanel?.sync();
    syncCanvasViewport("history");
    director.restoreProjectState(snapshot.director);
    director.update(currentFrame(0));
    director.seek(elapsed);
    syncDocumentTitle();
    syncCompositionUi();
  }

  function commitHistory() {
    history?.commit(projectSnapshot());
  }

  // The panel object always exists because the export controller reports
  // progress through it; only its DOM mount is optional, so showing and
  // hiding it is a matter of (un)mounting the same element.
  function setExportPanelVisible(visible) {
    exportPanelVisible = Boolean(visible);
    if (panelWorkspace && exportPanel) {
      panelWorkspace.attach("export", exportPanel.root);
      panelWorkspace.setVisible("export", exportPanelVisible);
      return exportPanelVisible;
    }
    const host = document.getElementById("export-ui");
    if (!host || !exportPanel) return exportPanelVisible;
    host.hidden = !exportPanelVisible;
    if (exportPanelVisible) host.append(exportPanel.root);
    else exportPanel.root.remove();
    return exportPanelVisible;
  }

  // Compositions the director lists include legacy aliases; `export --all`
  // should render each composition once, so aliases are filtered out.
  function canonicalCompositions() {
    return director
      .list()
      .filter(id => !COMPOSITION_DEFINITIONS[id]?.legacyAliasFor);
  }

  function canonicalCompositionInspection() {
    const inspection = director.inspect();
    const canonicalId = COMPOSITION_DEFINITIONS[inspection.compositionId]?.legacyAliasFor
      ?? inspection.compositionId;
    return canonicalId === inspection.compositionId
      ? inspection
      : { ...inspection, compositionId: canonicalId };
  }

  function activeCompositionUi() {
    const compositionId = director?.inspect().compositionId;
    const definition = COMPOSITION_DEFINITIONS[compositionId];
    const generatorId = definition?.steps?.find(step => typeof step?.use === "string")?.use;
    const settingsKey = GENERATOR_DEFINITIONS[generatorId]?.settingsKey;
    return {
      ...GLOBAL_CONFIG.ui,
      ...(settingsKey ? SETTINGS[settingsKey]?.ui : null),
    };
  }

  function syncCompositionUi() {
    const ui = activeCompositionUi();
    const noiseVisible = ui.noisePreview === true;
    const flockVisible = ui.flockPreview === true;
    noisePreviewPanel?.setVisible(noiseVisible);
    flockPreviewPanel?.setVisible(flockVisible);
    panelWorkspace?.setVisible("interactive-flock", ui.interactiveFlock === true);
    panelWorkspace?.setVisible("fields", noiseVisible || flockVisible);
    compositionPanel?.sync();
    interactiveFlockPanel?.sync();
  }

  function setNoisePreviewVisible(visible) {
    const next = noisePreviewPanel?.setVisible(visible) ?? false;
    panelWorkspace?.setVisible(
      "fields",
      next || (flockPreviewPanel?.isVisible() ?? false),
    );
    return next;
  }

  function setFlockPreviewVisible(visible) {
    const next = flockPreviewPanel?.setVisible(visible) ?? false;
    panelWorkspace?.setVisible(
      "fields",
      next || (noisePreviewPanel?.isVisible() ?? false),
    );
    return next;
  }

  function syncPanels(now = performance.now(), force = false) {
    if (!force && now - lastPanelSyncTime < 100) return;
    lastPanelSyncTime = now;
    compositionPanel?.sync();
    interactiveFlockPanel?.sync();
  }

  function dispatchDirectorInput(type, payload) {
    if (inputLocked) return false;
    const handled = director.input(type, payload);
    if (!handled) return false;
    director.update(currentFrame(0));
    commitHistory();
    syncPanels(performance.now(), true);
    renderPreview();
    return true;
  }

  function useCompositionFromConsole(id) {
    director.use(id);
    director.update(currentFrame(0));
    syncCompositionUi();
    syncDocumentTitle();
    commitHistory();
    renderPreview();
  }

  function baseGenerator() {
    return director.generator("baseGrid");
  }

  function useBaseFlickerPreview(preview) {
    baseGenerator().useFlickerPreview(preview);
    renderPreview();
  }

  function exposeRuntimeApi() {
    const api = {
      list: () => director.list(),
      use: name => {
        if (inputLocked) return director.inspect().compositionId;
        useCompositionFromConsole(name);
        return name;
      },
      inspect: () => director.inspect(),
      input: (type, payload) => {
        return dispatchDirectorInput(type, payload);
      },
      export: () => exportController?.run(),
      exportState: () => Object.freeze({ ...exportState }),
      showExportPanel: visible => setExportPanelVisible(visible !== false),
      exportPanelVisible: () => exportPanelVisible,
      cli: consoleCommands,
    };

    Object.defineProperty(window, "circleGridApp", {
      configurable: true,
      value: Object.freeze(api),
    });
  }

  syncDocumentTitle();

  p.setup = async () => {
    if (document.fonts?.ready) await document.fonts.ready;

    configureDebug({
      channels: resolveDebugChannels({
        search: window.location.search,
        config: GLOBAL_CONFIG.debug,
      }),
    });

    const initialViewport = configuredCanvasViewport();
    const canvas = p.createCanvas(initialViewport.width, initialViewport.height);
    canvas.parent("sketch");
    canvasElement = canvas.elt;
    canvasElement.setAttribute("aria-label", "Circle grid canvas");
    canvasElement.setAttribute("tabindex", "0");
    canvasElement.setAttribute("aria-describedby", "grid-keyboard-instructions");
    let capturedPointerId = null;
    const deactivatePointer = () => {
      pointerActive = false;
    };
    const routePrimaryPointer = (event, inputType, { commit = false } = {}) => {
      if (inputLocked || event.isPrimary === false) return false;
      const handled = routeCanvasPointerInput({
        canvas: canvas.elt,
        event,
        canvasWidth: p.width,
        canvasHeight: p.height,
        inputType,
        input: (type, payload) => director?.input(type, payload),
        preventDefault: true,
      });
      if (handled && commit) commitHistory();
      return handled;
    };
    canvas.mouseOut(deactivatePointer);
    canvas.elt.addEventListener("pointercancel", event => {
      routePrimaryPointer(event, "pointercancel");
      if (
        capturedPointerId === event.pointerId
        && canvas.elt.hasPointerCapture?.(event.pointerId)
      ) canvas.elt.releasePointerCapture?.(event.pointerId);
      if (capturedPointerId === event.pointerId) capturedPointerId = null;
      deactivatePointer();
    });
    canvas.elt.addEventListener("pointerup", event => {
      routePrimaryPointer(event, "pointerup", { commit: true });
      if (
        capturedPointerId === event.pointerId
        && canvas.elt.hasPointerCapture?.(event.pointerId)
      ) canvas.elt.releasePointerCapture?.(event.pointerId);
      if (capturedPointerId === event.pointerId) capturedPointerId = null;
      if (event.pointerType !== "mouse") deactivatePointer();
    });
    canvas.elt.addEventListener("pointerdown", event => {
      if (inputLocked || event.isPrimary === false) return;
      pointerActive = true;
      if (!routePrimaryPointer(event, "pointerdown")) return;
      if (Number.isInteger(event.pointerId)) {
        canvas.elt.setPointerCapture?.(event.pointerId);
        capturedPointerId = event.pointerId;
      }
    });
    canvas.elt.addEventListener("pointermove", event => {
      if (
        capturedPointerId !== null
        && event.pointerId !== capturedPointerId
      ) return;
      routePrimaryPointer(event, "pointermove");
    });
    canvas.elt.addEventListener("click", event => {
      if (inputLocked) return;
      routeCanvasPointerInput({
        canvas: canvas.elt,
        event,
        canvasWidth: p.width,
        canvasHeight: p.height,
        inputType: "click",
        input: (type, payload) => {
          const handled = director?.input(type, payload);
          if (handled) commitHistory();
          return handled;
        },
      });
    });
    canvas.elt.addEventListener("contextmenu", event => {
      if (inputLocked) {
        event.preventDefault();
        return;
      }
      routeCanvasPointerInput({
        canvas: canvas.elt,
        event,
        canvasWidth: p.width,
        canvasHeight: p.height,
        inputType: "contextmenu",
        input: (type, payload) => {
          const handled = director?.input(type, payload);
          if (handled) commitHistory();
          return handled;
        },
        preventDefault: true,
      });
    });
    canvas.elt.addEventListener("keydown", event => {
      if (inputLocked) return;
      const handled = director?.input("keydown", {
        key: event.key,
        repeat: event.repeat,
      });
      if (handled) {
        event.preventDefault();
        commitHistory();
      }
    });
    window.addEventListener("blur", deactivatePointer);
    p.pixelDensity(Math.min(
      GLOBAL_CONFIG.canvas.resizeWithWindow ? window.devicePixelRatio || 1 : 1,
      GLOBAL_CONFIG.canvas.maxPixelDensity,
    ));
    fitCanvasDisplay();
    p.frameRate(GLOBAL_CONFIG.canvas.frameRate);
    p.noiseSeed?.(projectSeed);

    director = createDirectorForRuntime(runtime);
    director.use(activeCompositionFromConfig());
    director.update(currentFrame(0));
    syncDocumentTitle();
    history = createSnapshotHistory(projectSnapshot());

    panelWorkspace = createPanelWorkspace({
      document,
      window,
      mount: document.body,
    });
    compositionPanel = createCompositionPanel({
      container: panelWorkspace.body("composition"),
      compositions: canonicalCompositions(),
      current: canonicalCompositionInspection,
      use: useCompositionFromConsole,
    });
    interactiveFlockPanel = createInteractiveFlockPanel({
      container: panelWorkspace.body("interactive-flock"),
      inspectTake: () => director.inspect().timeline.rule,
      input: dispatchDirectorInput,
      palettes: GLOBAL_CONFIG.palettes,
      defaults: SETTINGS.interactiveFlock,
      viewport: runtime.viewport,
      confirm: message => window.confirm(message),
    });

    exportPanel = createExportPanel({
      state: exportState,
      onExport: () => exportController?.run(),
      onExportPreset: name => exportController?.runPreset(name),
      onStateChange: () => {
        syncCanvasViewport("export-spec");
        commitHistory();
      },
    });
    setExportPanelVisible(GLOBAL_CONFIG.ui.showExportPanel);
    exportController = createExportController({
      p,
      getDirector: () => director,
      createDirector: async ({ viewport, context, sessionStorage, random, projectSeed: seed }) => {
        const exportRuntime = {
          p5: p,
          viewport: () => viewport,
          context: () => context,
          canvas: () => null,
          document: () => document,
          announcer: () => null,
          sessionStorage: () => sessionStorage,
          random,
          projectSeed: () => seed,
        };
        return createDirectorForRuntime(exportRuntime);
      },
      state: exportState,
      panel: exportPanel,
      getPreviewClock: () => ({
        time: elapsed,
        frameIndex,
        viewport: { ...runtime.viewport() },
      }),
      getProjectSeed: () => projectSeed,
      setProjectSeed,
      pausePreview: () => {
        document.body.classList.add("exporting");
        p.noLoop();
      },
      resumePreview: wasLooping => {
        document.body.classList.remove("exporting");
        resetPreviewDelta = true;
        if (pendingWindowResize) {
          pendingWindowResize = false;
          syncCanvasViewport("window");
        }
        try {
          renderPreview();
        } finally {
          if (wasLooping) p.loop();
        }
      },
      onProjectRestored: (snapshot, timeline) => {
        const savedTimeline = timeline ?? snapshot?.timeline;
        if (Number.isFinite(savedTimeline?.time)) elapsed = savedTimeline.time;
        if (Number.isSafeInteger(savedTimeline?.frameIndex)) {
          frameIndex = savedTimeline.frameIndex;
        }
        syncCanvasViewport("project-restore");
        director.update(currentFrame(0));
        director.seek(elapsed);
        syncDocumentTitle();
        syncCompositionUi();
      },
      renderPreview,
      setInputLocked: value => {
        inputLocked = value;
        pointerActive = false;
        if (panelWorkspace?.root) panelWorkspace.root.inert = value;
      },
      background: GLOBAL_CONFIG.canvas.background,
    });
    consoleCommands = createExportConsole({
      state: exportState,
      prepareExport: () => exportController.prepareSession(),
      runExport: ({ cycles, session } = {}) => exportController.run({
        notify: false,
        cycles,
        session,
      }),
      listCompositions: () => director.list(),
      canonicalCompositions,
      activeComposition: () => director.inspect().compositionId,
      useComposition: useCompositionFromConsole,
      coreDuration: () => director.inspect().timeline.coreDuration,
      setCoreDuration: setCoreDurationFromConsole,
      previewComposition: "base",
      listFlickerModes: () => flickerModes.list(),
      listFlickerScopes: () => ["canvas", "cell"],
      defaultPreviewRepeats: SETTINGS.base.previewRepeats,
      activeFlickerPreview: () => baseGenerator().flickerPreviewState(),
      useFlickerPreview: useBaseFlickerPreview,
      setPanelVisible: setExportPanelVisible,
      isPanelVisible: () => exportPanelVisible,
      syncPanel: () => exportPanel?.sync(),
      onStateChange: () => syncCanvasViewport("export-spec"),
      isExporting: () => Boolean(exportController?.exporting),
      setNoisePreviewVisible,
      isNoisePreviewVisible: () => noisePreviewPanel?.isVisible() ?? false,
      setFlockPreviewVisible,
      isFlockPreviewVisible: () => flockPreviewPanel?.isVisible() ?? false,
      log: message => console.log(message),
    });
    noisePreviewPanel = createNoisePreviewPanel({
      document,
      mount: panelWorkspace.body("fields"),
      isExporting: () => Boolean(exportController?.exporting),
      snapshot: options => director.inspect().compositionId === "noise-grid"
        ? director.generator("noiseGrid").noisePreviewSnapshot(options)
        : null,
    });
    flockPreviewPanel = createFlockPreviewPanel({
      document,
      mount: panelWorkspace.body("fields"),
      isExporting: () => Boolean(exportController?.exporting),
      snapshot: () => director.inspect().compositionId.startsWith("flock")
        ? director.generator("flockGrid").flockPreviewSnapshot()
        : null,
    });
    syncCompositionUi();
    Object.defineProperty(window, "cg", {
      configurable: true,
      value: consoleCommands,
    });
    installProjectDropRestore();
    exposeRuntimeApi();
    console.info(
      "Circle Grid console ready — run cg`help` for export commands.",
    );
  };

  p.draw = () => {
    if (!director) return;

    const compositionDt = resetPreviewDelta
      ? 0
      : Number.isFinite(p.deltaTime)
        ? Math.max(0, p.deltaTime / 1000)
        : 0;
    resetPreviewDelta = false;
    const dt = Math.min(compositionDt, 1 / 30);
    elapsed += compositionDt;
    frameIndex += 1;
    debug.setFrame(frameIndex);
    pointer.active = pointerActive
      && p.mouseX >= 0
      && p.mouseX <= p.width
      && p.mouseY >= 0
      && p.mouseY <= p.height;
    pointer.x = p.mouseX;
    pointer.y = p.mouseY;

    const frame = currentFrame(dt);
    frame.compositionDt = compositionDt;

    p.background(GLOBAL_CONFIG.canvas.background);
    director.update(frame);
    director.draw(frame);
    noisePreviewPanel?.update();
    flockPreviewPanel?.update();
    syncPanels();
  };

  p.mouseMoved = () => {
    if (inputLocked) return;
    pointerActive = true;
  };

  p.mouseDragged = () => {
    if (inputLocked) return;
    pointerActive = true;
  };

  p.touchMoved = () => {
    if (inputLocked) return;
    pointerActive = true;
  };

  p.touchEnded = () => {
    pointerActive = false;
  };

  p.windowResized = () => {
    if (!GLOBAL_CONFIG.canvas.resizeWithWindow) {
      fitCanvasDisplay();
      return;
    }
    if (exportController?.exporting) {
      pendingWindowResize = true;
      return;
    }
    syncCanvasViewport("window");
  };

  function installProjectDropRestore() {
    let dragDepth = 0;
    let overlay = null;
    const showOverlay = () => {
      if (overlay) return;
      overlay = document.createElement("div");
      overlay.className = "export-drop-message";
      overlay.textContent = "Drop an exported PNG, MP4, or SVG to restore its project state";
      document.body.append(overlay);
    };
    const hideOverlay = () => {
      overlay?.remove();
      overlay = null;
    };
    const restoreFile = async file => {
      if (!file || exportController?.exporting) return false;
      const before = projectSnapshot();
      inputLocked = true;
      document.body.classList.add("restoring-project");
      try {
        await exportController.restoreFile(file);
        const after = projectSnapshot();
        if (!sameSnapshot(before, after)) history.commit(after);
        return true;
      } catch (error) {
        console.warn("Project-state restore failed:", error);
        window.alert(error.message);
        restoreProjectSnapshot(before);
        renderPreview();
        return false;
      } finally {
        inputLocked = false;
        document.body.classList.remove("restoring-project");
      }
    };
    window.addEventListener("dragenter", event => {
      if (![...(event.dataTransfer?.items ?? [])].some(item => item.kind === "file")) return;
      event.preventDefault();
      dragDepth += 1;
      showOverlay();
    });
    window.addEventListener("dragover", event => {
      if ([...(event.dataTransfer?.items ?? [])].some(item => item.kind === "file")) {
        event.preventDefault();
      }
    });
    window.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideOverlay();
    });
    window.addEventListener("drop", async event => {
      dragDepth = 0;
      hideOverlay();
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      await restoreFile(file);
    });

    window.addEventListener("keydown", event => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z" || inputLocked) return;
      const next = event.shiftKey
        ? history.redo(projectSnapshot())
        : history.undo(projectSnapshot());
      if (!next) return;
      event.preventDefault();
      restoreProjectSnapshot(next);
      renderPreview();
    });
  }

  window.addEventListener("beforeunload", event => {
    if (!exportController?.exporting) return;
    event.preventDefault();
    event.returnValue = "";
  });
  window.addEventListener("pagehide", () => {
    compositionPanel?.dispose();
    interactiveFlockPanel?.dispose();
    noisePreviewPanel?.remove();
    flockPreviewPanel?.remove();
    panelWorkspace?.destroy();
    director?.dispose();
  }, { once: true });
});
