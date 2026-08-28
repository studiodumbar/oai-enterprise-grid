import { mountPreviewPanel } from "../ui/preview-panel-mount.js";

const LABELS = Object.freeze(["size", "color", "contrast", "visibility"]);

function paint(canvas, bytes, width, height, palette = null) {
  const context = canvas.getContext("2d");
  canvas.width = width; canvas.height = height;
  const image = context.createImageData(width, height);
  for (let index = 0; index < bytes.length; index += 1) {
    let red = bytes[index], green = red, blue = red;
    if (palette) {
      const step = Math.min(palette.length - 1, Math.floor(bytes[index] / 256 * palette.length));
      const value = Number.parseInt(palette[step].slice(1), 16);
      red = value >> 16; green = value >> 8 & 255; blue = value & 255;
    }
    const at = index * 4;
    image.data[at] = red; image.data[at + 1] = green; image.data[at + 2] = blue; image.data[at + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

export function createNoisePreviewPanel({
  document,
  mount,
  snapshot,
  isExporting = () => false,
}) {
  let visible = false;
  let lastPaint = -Infinity;
  const root = document.createElement("details");
  root.open = true;
  root.hidden = true;
  root.className = "noise-preview-panel";
  root.innerHTML = `<summary>Noise fields</summary><div class="noise-preview-grid">${LABELS.map(label => `<figure><canvas data-field="${label}"></canvas><figcaption>${label}</figcaption></figure>`).join("")}</div>`;
  const floatingStyles = { position: "fixed", right: "12px", bottom: "12px", width: "320px", maxHeight: "calc(100vh - 24px)", overflow: "auto", padding: "10px", color: "white", background: "#111e", zIndex: "20", font: "12px sans-serif" };
  const grid = root.querySelector(".noise-preview-grid");
  Object.assign(grid.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" });
  for (const figure of root.querySelectorAll("figure")) Object.assign(figure.style, { margin: "0" });
  for (const canvas of root.querySelectorAll("canvas")) Object.assign(canvas.style, { width: "100%", aspectRatio: "16 / 9", imageRendering: "pixelated", background: "#000" });
  mountPreviewPanel({ document, mount, root, floatingStyles });

  function setVisible(next) { visible = Boolean(next); root.hidden = !visible; return visible; }
  function update(now = performance.now()) {
    if (!visible || !root.open || isExporting() || now - lastPaint < 1000 / 15 || !root.isConnected) return false;
    const sizeCanvas = root.querySelector('[data-field="size"]');
    const rect = sizeCanvas.getBoundingClientRect();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const previewWidth = Math.max(2, Math.min(320, Math.round(rect.width * dpr)));
    const previewHeight = Math.max(2, Math.min(180, Math.round(rect.height * dpr)));
    const value = snapshot({ previewWidth, previewHeight });
    if (!value) return false;
    lastPaint = now;
    const { columns, rows } = value.dimensions;
    const dense = value.previewDimensions ?? { width: columns, height: rows };
    paint(sizeCanvas, value.size, dense.width, dense.height);
    paint(root.querySelector('[data-field="color"]'), value.color, dense.width, dense.height, value.palette);
    paint(root.querySelector('[data-field="contrast"]'), value.contrast, columns * 16, rows * 16);
    paint(root.querySelector('[data-field="visibility"]'), value.visibility, columns * 16, rows * 16);
    return true;
  }
  return { root, setVisible, isVisible: () => visible, update, remove: () => root.remove() };
}
