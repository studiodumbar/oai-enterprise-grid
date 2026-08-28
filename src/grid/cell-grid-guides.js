export function drawCellGridGuides(
  context,
  layout,
  {
    strokeStyle = "rgba(255, 70, 95, 0.42)",
    lineWidth = 1,
  } = {},
) {
  const {
    columns,
    rows,
    cellSize,
    offsetX,
    offsetY,
    patternWidth,
    patternHeight,
  } = layout;

  context.save();
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.beginPath();
  for (let column = 0; column <= columns; column += 1) {
    const x = offsetX + column * cellSize;
    context.moveTo(x, offsetY);
    context.lineTo(x, offsetY + patternHeight);
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = offsetY + row * cellSize;
    context.moveTo(offsetX, y);
    context.lineTo(offsetX + patternWidth, y);
  }
  context.stroke();
  context.restore();
}
