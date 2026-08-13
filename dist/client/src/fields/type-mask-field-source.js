export class TypeMaskFieldSource {
  constructor(typeField, options) {
    this.typeField = typeField;
    this.options = options;
  }

  write(field) {
    if (!this.options.influencesGrid) return;

    const { cellSize, columns, rows, offsetX, offsetY } = field.layout;

    for (let row = 0; row < rows; row += 1) {
      const centerY = offsetY + (row + 0.5) * cellSize;

      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const centerX = offsetX + (column + 0.5) * cellSize;
        const coverage = this.typeField.coverageAt(centerX, centerY);
        field.maxCell(index, coverage * this.options.gridInfluence);
      }
    }
  }
}
