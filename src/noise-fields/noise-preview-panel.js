import { mountPreviewPanel } from "../ui/preview-panel-mount.js";

const LABELS = Object.freeze(["size", "color", "contrast", "visibility"]);

function previewFields(value) {
  if (Array.isArray(value.fields)) return value.fields;
  const { columns, rows } = value.dimensions;
  const dense = value.previewDimensions ?? { width: columns, height: rows };
  return [
    { id: "size", label: "size", data: value.size, ...dense },
    { id: "color", label: "color", data: value.color, ...dense, palette: value.palette },
    {
      id: "contrast",
      label: "contrast",
      data: value.contrast,
      width: columns * 16,
      height: rows * 16,
    },
    {
      id: "visibility",
      label: "visibility",
      data: value.visibility,
      width: columns * 16,
      height: rows * 16,
    },
  ];
}

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
  root.innerHTML = `<summary>Field previews</summary><div class="noise-preview-grid">${LABELS.map(label => `<figure><canvas data-field="${label}"></canvas><figcaption>${label}</figcaption></figure>`).join("")}</div>`;
  const floatingStyles = { position: "fixed", right: "12px", bottom: "12px", width: "320px", maxHeight: "calc(100vh - 24px)", overflow: "auto", padding: "10px", color: "white", background: "#111e", zIndex: "20", font: "12px sans-serif" };
  const grid = root.querySelector(".noise-preview-grid");
  const figures = [...root.querySelectorAll("figure")];
  const canvases = [...root.querySelectorAll("canvas")];
  const captions = [...root.querySelectorAll("figcaption")];
  Object.assign(grid.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" });
  for (const figure of root.querySelectorAll("figure")) Object.assign(figure.style, { margin: "0" });
  for (const canvas of root.querySelectorAll("canvas")) Object.assign(canvas.style, { width: "100%", aspectRatio: "16 / 9", imageRendering: "pixelated", background: "#000" });
  mountPreviewPanel({ document, mount, root, floatingStyles });

  function setVisible(next) { visible = Boolean(next); root.hidden = !visible; return visible; }
  function update(now = performance.now()) {
    if (!visible || !root.open || isExporting() || now - lastPaint < 1000 / 15 || !root.isConnected) return false;
    const rect = canvases[0].getBoundingClientRect();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const previewWidth = Math.max(2, Math.min(320, Math.round(rect.width * dpr)));
    const previewHeight = Math.max(2, Math.min(180, Math.round(rect.height * dpr)));
    const value = snapshot({ previewWidth, previewHeight });
    if (!value) return false;
    lastPaint = now;
    const fields = previewFields(value);
    for (let index = 0; index < figures.length; index += 1) {
      const field = fields[index];
      figures[index].hidden = field === undefined;
      if (!field) continue;
      if (captions[index]) captions[index].textContent = field.label ?? field.id;
      paint(
        canvases[index],
        field.data,
        field.width,
        field.height,
        field.palette ?? null,
      );
    }
    return true;
  }
  return { root, setVisible, isVisible: () => visible, update, remove: () => root.remove() };
}
