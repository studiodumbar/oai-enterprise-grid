import { populatePalettes } from "./palettes.js";

const PALETTE_FAMILIES = {
    blue: ["#013566", "#004F99", "#0169CC", "#0285FF", "#48AAFF"],
    green: ["#003415", "#00692a", "#00a240", "#04b84c", "#8cdfad"],
    orange: ["#B9480D", "#E25507", "#FF7417", "#FF8549", "#FF9E6C"],
    mono: ["#303030", "#666666", "#aaaaaa", "#d5d5d5", "#ffffff"],
};
// Change this one value to recolor the app and every effect palette.
const PALETTE_FAMILY = "blue";

export const GLOBAL_CONFIG = {
    canvas: {
        background: "#000",
        // Initial preview and export frame. The Export panel may change it live.
        aspectRatio: "2:1",
        frameRate: 60,
    },

    ui: {
        showCompositionPanel: true,
        showCellGrid: false,
        showExportPanel: true,
        noisePreview: true,
        flockPreview: true,
    },

    // Machine-readable tracing. Channels: timeline, transition, plan, cells,
    // draw, config, export — or "all". A ?debug= query parameter overrides this,
    // and cg`debug <channels>` switches it at runtime. See AGENTS.md section 3.
    debug: {
        channels: "",
    },

    composition: {
        // flock,
        // base
        // interactive-grid
        // inference-loop
        // l-tree
        // mold
        // tool-loop
        // context-window
        // game-of-life
        // voronoi,
        // noise-grid
        active: "countdown-framed",
        // Legacy phase defaults stay flat while compositions are migrated one by
        // one. A migrated composition overrides them through circleEndpoints.
        startWithCircle: true,
        // A number is an explicit override. "auto" reuses the resolved intro.
        startWithCircleDurationSeconds: 2,
        endWithCircle: true,
        // calc(auto * n) scales the resolved outro.
        endWithCircleDurationSeconds: 0.5,
        circleSubdivision: 1, // 1, 2, 4, 8, or 16.
        circleEndpoints: {
            // Every finite composition uses the shared path-to-centre outro unless
            // its local settings select another supported endpoint mode.
            end: {
                enabled: false,
                mode: "dijkstra",
            },
            // Shared mode defaults. Per-composition values override these by key.
            modes: {
                // Searches cardinal neighbors on the composition's parent-cell grid.
                dijkstra: {
                    // Shares of the numeric end duration. The path share includes the
                    // initial loader; cleanup receives the unallocated middle window.
                    pathFraction: 0.04,
                    blinkFraction: 0.2,
                    centerHoldFraction: 0.1,
                    blinkCount: 6,
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

    // App-wide palette order; compositions can select another derived order.
    palette: "flicker",

    noiseFields: {
        enabled: true,
        levelCount: 5,
        dotMargin: 0.08,
        modes: {},
        layers: {},
    },

    // Motion between discrete scene states. This runs inside the cycle; it is
    // independent from the intro/outro phases at the cycle boundaries.
    cellTransitions: {
        enabled: true,
        mode: "aurora",
        // "auto" uses the active composition's shortest state hold.
        durationSeconds: 'auto',
        modes: {
            none: {
                baseKind: "circle",
            },
            "sort-selection": {
                seed: 13,
                revealFraction: 0.16,
                arcHeightInCells: 0.32,
                overlapDots: false,
                // Sweep order per pass; the list cycles, so these two alternate.
                directions: ["top-down", "bottom-up"],
                staggerSeconds: 0.2,
                timingCurve: [0.065, 0, 0.35, 1],
            },
            // Selection sort with a wavy frontier and grid-bound decay behind it.
            // The mode-owned defaults live beside its implementation.
            aurora: {
                waveAmplitudeInCells: 5,
                waveCycles: 4,
                beamLengthInCells: 5,
                // directions: ["top-down", "bottom-up"],
            },
        },
    },

    intro: {
        enabled: false,
        mode: "text", // text, fade
        durationSeconds: 3, // auto = one beat of the active composition
        modes: {
            fade: {
                // Share of the phase spent fading the centered circle grid up before it
                // crossfades into the composition. 0 makes it a plain fade-in.
                revealFraction: 0.5,
                timingCurve: [0.42, 0, 0.58, 1], // CSS cubic-bezier control points: [x1, y1, x2, y2].
            },
            text: {
                text: "OpenAI",
                fontFamily: "'OpenAI Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
                fontWeight: 900,
                sizeInCells: 0.35,
                // Pixels from the exact canvas centre.
                offsetX: 0,
                offsetY: 0,
                // "auto" uses the text mode's maximum hold window (60% of its phase).
                visibleSeconds: 3,
                colorDrift: 3,
                // null takes `canvas.background`.
                backgroundColor: 'transparent',
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
        mode: "text",
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
                cycleSeconds: "auto",
                ringDelayFraction: 0.14,
                echoDelayFraction: 0.03,
                ringCount: 5,
            },
            // Columns stack upward on a stagger
            "strobe-stack": {
                cycleSeconds: "auto",
                columns: 5,
                rows: 5,
                baseIntensity: 0.08,
            },
            // Frames drop and pile up
            "block-drop": {
                cycleSeconds: "auto",
                baseIntensity: 0.08,
            },
            // A kaleidoscope breathing out
            "prism-bloom": {
                cycleSeconds: "auto",
                blendSeconds: 0.38,
                baseIntensity: 0.08,
            },
            // A scanline steps down the field, leaving a decaying trail
            "crt-glide": {
                cycleSeconds: "auto",
                rows: 5,
                decay: 0.72,
                columnWarp: 0.07,
                baseIntensity: 0.08,
                peakIntensity: 1,
            },
            // A rotating arm sweeps the field
            "radar-arc": { // kinda looks like ass
                cycleSeconds: "auto",
                gridSteps: 5,
                beamWidth: 0.55,
                wakeWidth: 1.15,
                ringInnerRadius: 1.6,
                ringOuterRadius: 1.8,
                baseIntensity: 0.4,
            },
        },
    },

    palettes: populatePalettes(PALETTE_FAMILIES, PALETTE_FAMILY),
};
