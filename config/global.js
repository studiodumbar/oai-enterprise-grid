// Values in this file apply to the whole app, regardless of which composition
// family is active.
export const GLOBAL_CONFIG = {
  canvas: {
    background: "#fff",
    maxPixelDensity: 3,
    frameRate: 60,
  },

  composition: {
    // [] flock,
    // [x] [] interactive-grid,
    // [x] [x] inference-loop (or thinking),
    // [x] [x] game-of-life
    // [x] [x] l-tree,
    // [x] [x] voronoi,
    // [x] [x] tool-loop,
    // [x] [x] context-window,
    active: "voronoi",
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
    green: ["#005122", "#008a3a", "#00b63c", "#7fd3a5"],
    thinking: ["#dce8e3", "#a7d1c2", "#10a37f", "#08745a", "#123b31"],
    orange: ["#762b0a", "#c73f13", "#ff6b00", "#ffb389"],
    mono: ["#303030", "#666666", "#aaaaaa", "#ffffff"],
  },
};
