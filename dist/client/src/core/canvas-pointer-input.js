export function routeCanvasPointerInput({
  canvas,
  event,
  canvasWidth,
  canvasHeight,
  inputType,
  input,
  preventDefault = false,
}) {
  if (
    !canvas
    || !event
    || typeof canvas.getBoundingClientRect !== "function"
    || typeof input !== "function"
  ) return false;

  const bounds = canvas.getBoundingClientRect();
  if (!(bounds.width > 0) || !(bounds.height > 0)) return false;
  const handled = Boolean(input(inputType, {
    x: (event.clientX - bounds.left) / bounds.width * canvasWidth,
    y: (event.clientY - bounds.top) / bounds.height * canvasHeight,
    button: event.button,
    shiftKey: event.shiftKey,
  }));
  if (!handled) return false;

  if (preventDefault) event.preventDefault?.();
  canvas.focus?.({ preventScroll: true });
  return true;
}
