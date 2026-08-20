export const GLOBAL_CONFIG = {
  canvas: {
    background: "#000",
    maxPixelDensity: 3,
    frameRate: 60,
  },

  ui: {
    showExportPanel: false,
  },

  // Machine-readable tracing. Channels: timeline, transition, plan, cells,
  // draw, config, export — or "all". A ?debug= query parameter overrides this,
  // and cg`debug <channels>` switches it at runtime. See AGENTS.md section 3.
  debug: {
    channels: "",
  },

  composition: {
    // flock,
    // base, // ok
    // interactive-grid,
    // inference-loop, // BUG: intro is weird
    // game-of-life
    // l-tree,
    // voronoi,
    // tool-loop,
    // context-window,
    active: "voronoi",
    // Legacy phase defaults stay flat while compositions are migrated one by
    // one. A migrated composition overrides them through circleEndpoints.
    startWithCircle: false,
    startWithCircleDurationSeconds: "auto", // "auto" or a duration in seconds.
    endWithCircle: false,
    endWithCircleDurationSeconds: "auto", // "auto" or a duration in seconds.
    circleSubdivision: 1, // 1, 2, 4, 8, or 16.
    circleEndpoints: {
      // Shared mode defaults. Per-composition values override these by key.
      modes: {
        // Searches cardinal neighbors on the composition's parent-cell grid.
        dijkstra: {
          pathFraction: 0.4,
          blinkFraction: 0.2,
          centerHoldFraction: 0.1,
          blinkCount: 2,
          // Cleanup overlap: 0 changes one cell; 1 changes the full path together.
          trailLength: 1,
          maximumLevel: 3,
          paletteStep: 3,
          cleanupAcceleration: 2,
          foreignTerritoryCost: 3,
        },
      },
    },
  },

  // app-wide palette, composition overrides it
  palette: "green",

  // Motion between discrete scene states. This runs inside the cycle; it is
  // independent from the intro/outro phases at the cycle boundaries.
  cellTransitions: {
    enabled: true,
    mode: "sort-selection",
    durationSeconds: 1, // should support auto option
    modes: {
      none: {
        baseKind: "circle",
      },
      "sort-selection": {
        seed: 13,
        revealFraction: 0.16,
        arcHeightInCells: 0.32,
        staggerSeconds: 0.2,
        timingCurve: [0.065, 0, 0.35, 1],
      },
    },
  },

  // App-wide cycle entrance, shared with the intro/outro circle endpoints
  // above. A composition can override any field by adding its own `intro` block
  // beside its palette/flicker settings. The modes usable here are the ones
  // that declare the intro/outro phases in src/transitions/index.js.
  intro: {
    enabled: true,
    // fade — reveal the centered circle grid, then crossfade the composition in.
    // text — build a ladder of subdivided cells out from the centre, slide it
    //        away and hand the screen to a centered string.
    mode: "text",
    durationSeconds: 2,
    modes: {
      fade: {
        // Share of the phase spent fading the centered circle grid up before it
        // crossfades into the composition. 0 makes it a plain fade-in.
        revealFraction: 0.5,
        // CSS cubic-bezier control points: [x1, y1, x2, y2].
        timingCurve: [0.42, 0, 0.58, 1],
      },
      text: {
        text: "Open AI // Cyber",
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        fontWeight: 600,
        sizeInCells: 0.5,
        // Pixels from the exact canvas centre.
        offsetX: 0,
        offsetY: 0,
        visibleSeconds: 2,
        colorDrift: 3,
        // null takes `canvas.background`.
        backgroundColor: null,
        levels: 4, // Deepest subdivision in the ladder
        longSideCells: 5, // Only used when the composition declares no longSideCells of its own.
        dotMargin: 0.08,
        palette: null, // null inherits the composition's palette
        // level — one palette color per subdivision level
        // dot   — spread the palette across the dots inside each cell
        colorBy: "dot",
        // null takes the palette's last color.
        textColor: null,
      },
    },
  },

  // Unauthored per composition, this is the outro every composition inherits.
  // Mode settings not repeated here fall back to the intro's.
  outro: {
    enabled: true,
    mode: "fade",
    durationSeconds: 3,
    modes: {
      fade: {
        revealFraction: 0.05,
        timingCurve: [1, 0.05, 0.38, 0],
      },
    },
  },

  flicker: {
    enabled: true,
    // noise,
    // echo-ring,
    // strobe-stack,
    // block-drop,
    // prism-bloom,
    // crt-glide,
    // radar-arc
    mode: "block-drop",
    scope: "cell", // canvas, cell
    amount: 1,  // How far a flickering dot may travel from its base palette step.
    cellStaggerSeconds: 0.5,
    modes: {
      // Drifting clouds 
      "noise": {
        speed: 0.18,
        spatialScale: 0.28,
      },
      // diamond rings pulse outward 
      "echo-ring": {
        // cycleSeconds: 1,
        ringDelayFraction: 0.14,
        echoDelayFraction: 0.03,
        ringCount: 5,
      },
      // Columns stack upward on a stagger 
      "strobe-stack": {
        // cycleSeconds: 1.43,
        columns: 5,
        rows: 5,
        baseIntensity: 0.08,
      },
      // Frames drop and pile up 
      "block-drop": {
        // cycleSeconds: 1.41,
        baseIntensity: 0.08,
      },
      // A kaleidoscope breathing out
      "prism-bloom": {
        // cycleSeconds: 0.75,
        blendSeconds: 0.38,
        baseIntensity: 0.08,
      },
      // A scanline steps down the field, leaving a decaying trail
      "crt-glide": {
        // cycleSeconds: 0.6,
        rows: 5,
        decay: 0.72,
        columnWarp: 0.07,
        baseIntensity: 0.08,
        peakIntensity: 1,
      },
      // A rotating arm sweeps the field
      "radar-arc": { // kinda looks like ass
        // cycleSeconds: 1,
        gridSteps: 5,
        beamWidth: 0.55,
        wakeWidth: 1.15,
        ringInnerRadius: 1.6,
        ringOuterRadius: 1.8,
        baseIntensity: 0.4,
      },
    },
  },

  palettes: {
    violet: [
      "#cbafd9",
      "#7c5cad",
      "#7047a3",
      "#42276f",
    ],
    blue: ["#012a4f", "#00529d", "#2e7ec6", "#6db9e7"],
    lightBlue: ["#d4ebf7", "#a8ddf0", "#6db9e7", "#2e7ec6", "#0066b3"],
    justBlue: ["#2e7ec6", "#3a89ce", "#5aa0d9", "#7ab7e3", "#9aceee"],
    green: ["#003415", "#00692a", "#00a240", "#04b84c", "#8cdfad"],
    thinking: ["#dce8e3", "#a7d1c2", "#10a37f", "#08745a", "#123b31"],
    orange: ["#762b0a", "#c73f13", "#ff6b00", "#ffb389"],
    mono: ["#303030", "#666666", "#aaaaaa", "#ffffff"],
  },
};
