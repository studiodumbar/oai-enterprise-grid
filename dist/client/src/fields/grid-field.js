export class GridField {
  constructor(layout, options) {
    this.options = options;
    this.resize(layout);
  }

  resize(layout) {
    this.layout = layout;
    const count = layout.columns * layout.rows;
    this.density = new Float32Array(count);
    this.direct = new Float32Array(count);
  }

  reset() {
    this.density.fill(0);
    this.direct.fill(0);
  }

  addPoint(
    x,
    y,
    strength,
    radiusInCells = this.options.fieldRadiusInCells,
  ) {
    const { cellSize, columns, rows, offsetX, offsetY } = this.layout;
    const gridX = (x - offsetX) / cellSize - 0.5;
    const gridY = (y - offsetY) / cellSize - 0.5;
    const centerX = Math.round(gridX);
    const centerY = Math.round(gridY);
    const range = Math.ceil(radiusInCells);
    const radiusSquared = radiusInCells * radiusInCells;

    for (let offsetRow = -range; offsetRow <= range; offsetRow += 1) {
      const row = centerY + offsetRow;
      if (row < 0 || row >= rows) continue;

      for (let offsetColumn = -range; offsetColumn <= range; offsetColumn += 1) {
        const column = centerX + offsetColumn;
        if (column < 0 || column >= columns) continue;

        const deltaX = column - gridX;
        const deltaY = row - gridY;
        const distanceSquared = deltaX * deltaX + deltaY * deltaY;
        if (distanceSquared > radiusSquared) continue;

        const falloff = Math.exp(-distanceSquared * 0.72);
        this.density[row * columns + column] += falloff * strength;
      }
    }
  }

  maxCell(index, value) {
    this.direct[index] = Math.max(this.direct[index], value);
  }

  resolveCell(index) {
    const accumulated = 1 - Math.exp(
      -this.density[index] * this.options.fieldGain,
    );
    return Math.max(accumulated, this.direct[index]);
  }
}
