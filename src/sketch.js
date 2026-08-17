import {
  GLOBAL_CONFIG,
  SETTINGS,
  GENERATOR_DEFINITIONS,
  COMPOSITION_DEFINITIONS,
} from "../config.js";
import { CompositionDirector } from "./core/composition-director.js";
import { routeCanvasPointerInput } from "./core/canvas-pointer-input.js";
import { createCatalog } from "./catalog.js";
import { createExportState } from "./export/export-state.js";
import { createExportPanel } from "./export/export-panel.js";
import { createExportController } from "./export/export-controller.js";
import { createProjectState, createSnapshotHistory } from "./export/project-state.js";
import { createExportConsole } from "./export/export-console.js";
import { flickerModes } from "./visuals/flicker/index.js";

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

  function createDirectorForRuntime(runtimeOverride) {
    const catalog = createCatalog({ palettes: GLOBAL_CONFIG.palettes });
    const next = new CompositionDirector({
      settings: SETTINGS,
      generatorDefinitions: GENERATOR_DEFINITIONS,
      compositionDefinitions: COMPOSITION_DEFINITIONS,
      generatorTypes: catalog.generatorTypes,
      compositionRules: catalog.compositionRules,
      runtime: runtimeOverride,
    });
    next.resize(runtimeOverride.viewport());
    return next;
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
    director.restoreProjectState(snapshot.director);
    director.update(currentFrame(0));
    director.seek(elapsed);
    Object.assign(exportState, snapshot.export);
    exportPanel?.sync();
  }

  function commitHistory() {
    history?.commit(projectSnapshot());
  }

  // The panel object always exists because the export controller reports
  // progress through it; only its DOM mount is optional, so showing and
  // hiding it is a matter of (un)mounting the same element.
  function setExportPanelVisible(visible) {
    const host = document.getElementById("export-ui");
    if (!host || !exportPanel) return exportPanelVisible;
    exportPanelVisible = Boolean(visible);
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

  function useCompositionFromConsole(id) {
    director.use(id);
    director.update(currentFrame(0));
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
        director.use(name);
        director.update(currentFrame(0));
        commitHistory();
        return name;
      },
      inspect: () => director.inspect(),
      input: (type, payload) => {
        if (inputLocked) return false;
        const handled = director.input(type, payload);
        if (handled) commitHistory();
        return handled;
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

  p.setup = async () => {
    if (document.fonts?.ready) await document.fonts.ready;

    const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
    canvas.parent("sketch");
    canvasElement = canvas.elt;
    canvasElement.setAttribute("aria-label", "Circle grid canvas");
    canvasElement.setAttribute("tabindex", "0");
    canvasElement.setAttribute("aria-describedby", "grid-keyboard-instructions");
    const deactivatePointer = () => {
      pointerActive = false;
    };
    canvas.mouseOut(deactivatePointer);
    canvas.elt.addEventListener("pointercancel", deactivatePointer);
    canvas.elt.addEventListener("pointerup", event => {
      if (event.pointerType !== "mouse") deactivatePointer();
    });
    canvas.elt.addEventListener("pointerdown", event => {
      if (inputLocked) return;
      pointerActive = true;
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
      window.devicePixelRatio || 1,
      GLOBAL_CONFIG.canvas.maxPixelDensity,
    ));
    p.frameRate(GLOBAL_CONFIG.canvas.frameRate);
    p.noiseSeed?.(projectSeed);

    director = createDirectorForRuntime(runtime);
    director.use(activeCompositionFromConfig());
    director.update(currentFrame(0));
    history = createSnapshotHistory(projectSnapshot());

    exportPanel = createExportPanel({
      state: exportState,
      onExport: () => exportController?.run(),
      onStateChange: () => commitHistory(),
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
          p.resizeCanvas(p.windowWidth, p.windowHeight);
          director?.resize(runtime.viewport());
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
        director.update(currentFrame(0));
        director.seek(elapsed);
      },
      renderPreview,
      setInputLocked: value => {
        inputLocked = value;
        pointerActive = false;
      },
      background: GLOBAL_CONFIG.canvas.background,
    });
    consoleCommands = createExportConsole({
      state: exportState,
      runExport: ({ cycles } = {}) => exportController.run({ notify: false, cycles }),
      listCompositions: () => director.list(),
      canonicalCompositions,
      activeComposition: () => director.inspect().compositionId,
      useComposition: useCompositionFromConsole,
      previewComposition: "base",
      listFlickerModes: () => flickerModes.list(),
      listFlickerScopes: () => ["canvas", "cell"],
      defaultPreviewRepeats: SETTINGS.base.previewRepeats,
      activeFlickerPreview: () => baseGenerator().flickerPreviewState(),
      useFlickerPreview: useBaseFlickerPreview,
      setPanelVisible: setExportPanelVisible,
      isPanelVisible: () => exportPanelVisible,
      syncPanel: () => exportPanel?.sync(),
      isExporting: () => Boolean(exportController?.exporting),
      log: message => console.log(message),
    });
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
    if (exportController?.exporting) {
      pendingWindowResize = true;
      return;
    }
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    director?.resize(runtime.viewport());
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
      if (exportController?.exporting) return;
      const before = projectSnapshot();
      inputLocked = true;
      document.body.classList.add("restoring-project");
      try {
        await exportController.restoreFile(file);
        const after = projectSnapshot();
        if (!sameSnapshot(before, after)) history.commit(after);
      } catch (error) {
        console.warn("Project-state restore failed:", error);
        window.alert(error.message);
        restoreProjectSnapshot(before);
        renderPreview();
      } finally {
        inputLocked = false;
        document.body.classList.remove("restoring-project");
      }
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
  window.addEventListener("pagehide", () => director?.dispose(), { once: true });
});
