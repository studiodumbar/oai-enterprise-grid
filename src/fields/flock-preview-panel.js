import { mountPreviewPanel } from "../ui/preview-panel-mount.js";

function colorChannels(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16, value >> 8 & 255, value & 255];
}

function paint(canvas, snapshot) {
  const context = canvas.getContext("2d");
  const { width, height, pixels } = snapshot;
  const [red, green, blue] = colorChannels(snapshot.color ?? "#8cdfad");
  canvas.width = width;
  canvas.height = height;
  canvas.style.aspectRatio = `${width} / ${height}`;
  const image = context.createImageData(width, height);
  for (let index = 0; index < pixels.length; index += 1) {
    const intensity = pixels[index] / 255;
    const at = index * 4;
    image.data[at] = Math.round(red * intensity);
    image.data[at + 1] = Math.round(green * intensity);
    image.data[at + 2] = Math.round(blue * intensity);
    image.data[at + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

export function createFlockPreviewPanel({
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
  root.className = "flock-preview-panel";
  root.innerHTML = "<summary>Flock field</summary><canvas></canvas>";
  const floatingStyles = {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    width: "240px",
    padding: "10px",
    color: "white",
    background: "#111e",
    zIndex: "20",
    font: "12px sans-serif",
  };
  const canvas = root.querySelector("canvas");
  Object.assign(canvas.style, {
    display: "block",
    width: "100%",
    marginTop: "8px",
    aspectRatio: "16 / 9",
    imageRendering: "pixelated",
    background: "#000",
  });
  mountPreviewPanel({ document, mount, root, floatingStyles });

  function setVisible(next) {
    visible = Boolean(next);
    root.hidden = !visible;
    return visible;
  }

  function update(now = performance.now()) {
    if (
      !visible
      || !root.open
      || isExporting()
      || now - lastPaint < 1000 / 30
      || !root.isConnected
    ) return false;
    const value = snapshot();
    if (!value) return false;
    lastPaint = now;
    paint(canvas, value);
    return true;
  }

  return {
    root,
    setVisible,
    isVisible: () => visible,
    update,
    remove: () => root.remove(),
  };
}
