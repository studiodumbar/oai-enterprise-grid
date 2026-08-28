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
  const cssX = event.clientX - bounds.left;
  const cssY = event.clientY - bounds.top;
  const normalizedX = cssX / bounds.width;
  const normalizedY = cssY / bounds.height;
  const handled = Boolean(input(inputType, {
    x: normalizedX * canvasWidth,
    y: normalizedY * canvasHeight,
    normalizedX,
    normalizedY,
    cssX,
    cssY,
    button: event.button,
    buttons: event.buttons,
    shiftKey: event.shiftKey,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
  }));
  if (!handled) return false;

  if (preventDefault) event.preventDefault?.();
  canvas.focus?.({ preventScroll: true });
  return true;
}
