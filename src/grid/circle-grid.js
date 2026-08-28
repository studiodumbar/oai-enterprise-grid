import { GridField } from "../fields/grid-field.js";
import { CellStateBuffer } from "../cell-transitions/cell-state-buffer.js";
import { drawCellGridGuides } from "./cell-grid-guides.js";

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function paletteByName(palettes, requestedName) {
  const normalized = String(requestedName).toLowerCase();
  const key = Object.keys(palettes).find(name => name.toLowerCase() === normalized);
  if (!key) {
    throw new Error(
      `Unknown palette "${requestedName}". Available palettes: ${Object.keys(palettes).join(", ")}.`,
    );
  }
  return palettes[key];
}

export class CircleGrid {
  constructor(options, palettes, cellTransition, shapeRenderer, viewport) {
    this.validateCellTransition(cellTransition);
    if (!shapeRenderer || typeof shapeRenderer.addPath !== "function") {
      throw new TypeError("A shape renderer with addPath() is required.");
    }
    this.options = options;
    this.palettes = palettes;
    this.cellTransition = cellTransition;
    this.shapeRenderer = shapeRenderer;
    this.buildPaletteLookup();
    this.resize(viewport);
  }

  validateCellTransition(cellTransition) {
    if (!cellTransition || typeof cellTransition.updateCell !== "function") {
      throw new TypeError("A cell transition with updateCell() is required.");
    }
  }

  setCellTransition(cellTransition) {
    this.validateCellTransition(cellTransition);
    if (cellTransition === this.cellTransition) return;

    const previous = this.cellTransition;
    const cellCount = this.energy?.length ?? this.cellState?.length ?? 0;
    previous?.dispose?.();
    this.cellTransition = cellTransition;
    if (this.cellState) {
      if (this.cellState.length !== cellCount) this.cellState.resize(cellCount);
      else this.cellState.reset();
      this.cellTransition.resize?.(cellCount, this.cellState);
    }
  }

  buildPaletteLookup() {
    if (
      this.options.paletteMode !== undefined
      && !["interpolate", "step"].includes(this.options.paletteMode)
    ) {
      throw new Error(
        `Unknown palette mode "${this.options.paletteMode}". Available modes: interpolate, step.`,
      );
    }
    const palette = paletteByName(this.palettes, this.options.palette);
    this.paletteColors = [...palette];
    const channels = palette.map(hex => {
      const value = Number.parseInt(hex.slice(1), 16);
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    });

    this.paletteLookup = Array.from({ length: 256 }, (_, lookupIndex) => {
      const position = lookupIndex / 255 * (channels.length - 1);
      const index = Math.min(channels.length - 2, Math.floor(position));
      const amount = position - index;
      const from = channels[index];
      const to = channels[index + 1];
      const red = Math.round(from[0] + (to[0] - from[0]) * amount);
      const green = Math.round(from[1] + (to[1] - from[1]) * amount);
      const blue = Math.round(from[2] + (to[2] - from[2]) * amount);
      return `rgb(${red} ${green} ${blue})`;
    });
  }

  resize({ width, height }) {
    const requested = Math.max(3, Math.round(this.options.longSideCells));
    const longCells = requested % 2 === 0 ? requested - 1 : requested;
    const minimumShortCells = Math.min(3, longCells);
    const cellSize = Math.min(
      Math.max(width, height) / longCells,
      Math.min(width, height) / minimumShortCells,
    );

    const fitOdd = size => {
      const count = Math.max(1, Math.floor(size / cellSize));
      return count % 2 === 0 ? Math.max(1, count - 1) : count;
    };
    const columns = width >= height ? longCells : fitOdd(width);
    const rows = width >= height ? fitOdd(height) : longCells;
    const patternWidth = columns * cellSize;
    const patternHeight = rows * cellSize;

    this.layout = {
      width,
      height,
      columns,
      rows,
      cellSize,
      patternWidth,
      patternHeight,
      offsetX: (width - patternWidth) * 0.5,
      offsetY: (height - patternHeight) * 0.5,
    };

    const count = columns * rows;
    this.energy = new Float32Array(count);
    this.previousEnergy = new Float32Array(count);
    this.field = this.field
      ? Object.assign(this.field, { options: this.options })
      : new GridField(this.layout, this.options);
    this.field.resize(this.layout);
    if (this.cellState) this.cellState.resize(count);
    else this.cellState = new CellStateBuffer(count);
    this.cellTransition.resize?.(count, this.cellState);
    this.meanEnergy = 0;
  }

  update(fieldSources, dt, frame, { immediate = false } = {}) {
    this.field.reset();
    for (const source of fieldSources) source.write(this.field, frame);

    const { columns, rows } = this.layout;
    let total = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const before = this.energy[index];
        const wanted = this.field.resolveCell(index);
        const response = wanted > before
          ? this.options.riseSeconds
          : this.options.fallSeconds;
        const blend = immediate || response <= 0 ? 1 : 1 - Math.exp(-dt / response);
        const energy = before + (wanted - before) * blend;

        this.previousEnergy[index] = before;
        this.energy[index] = energy;
        total += energy;
        this.cellState.resetCell(index);
        this.cellTransition.updateCell(
          index,
          { index, row, column, energy, previousEnergy: before, layout: this.layout },
          this.cellState,
          frame,
        );
      }
    }
    this.meanEnergy = this.energy.length > 0 ? total / this.energy.length : 0;
  }

  draw(
    context,
    isGlyphHidden,
    {
      guides = true,
      showCellGrid = this.options.showCellGrid,
      glyphPresentation,
      cellColor,
      glyphColor,
    } = {},
  ) {
    const { columns, rows, cellSize, offsetX, offsetY } = this.layout;
    const marginScale = 1 - Math.max(0, Math.min(0.95, this.options.dotMargin));
    const shouldCheckVisibility = typeof isGlyphHidden === "function";
    const hasCellColors = typeof cellColor === "function";
    const hasGlyphColors = typeof glyphColor === "function";

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        if (!this.cellVisible(index)) continue;
        const subdivisions = 1 << this.cellState.level[index];
        const slot = cellSize / subdivisions;
        const halfSize = slot * 0.5 * marginScale;
        const glyphTransform = {
          scaleX: this.cellState.glyphScaleX[index],
          scaleY: this.cellState.glyphScaleY[index],
          scaleAxis: this.cellState.glyphScaleAxis[index],
          rotation: this.cellState.glyphRotation[index],
          offsetX: this.cellState.glyphOffsetX[index],
          offsetY: this.cellState.glyphOffsetY[index],
        };
        const paletteValue = this.cellState.paletteValue[index];
        const parentScaleX = this.cellState.scaleX[index];
        const parentScaleY = this.cellState.scaleY[index];
        const parentRotation = this.cellState.rotation[index];
        const parentCenterX = offsetX + (column + 0.5) * cellSize
          + this.cellState.offsetX[index];
        const parentCenterY = offsetY + (row + 0.5) * cellSize
          + this.cellState.offsetY[index];
        const rotationCosine = Math.cos(parentRotation);
        const rotationSine = Math.sin(parentRotation);

        context.save();
        const paletteColor = this.paletteColor(
          paletteValue >= 0 ? paletteValue : this.energy[index],
        );
        const defaultColor = hasCellColors
          ? (cellColor({
            index,
            row,
            column,
            x: parentCenterX,
            y: parentCenterY,
            size: cellSize,
          }, paletteColor) ?? paletteColor)
          : paletteColor;
        context.fillStyle = defaultColor;
        context.globalAlpha *= clamp01(this.cellState.opacity[index]);
        context.translate(parentCenterX, parentCenterY);
        context.rotate(parentRotation);
        context.scale(parentScaleX, parentScaleY);
        context.beginPath();

        for (let subRow = 0; subRow < subdivisions; subRow += 1) {
          for (let subColumn = 0; subColumn < subdivisions; subColumn += 1) {
            if (
              Math.abs(glyphTransform.scaleX) < 1e-7
              || Math.abs(glyphTransform.scaleY) < 1e-7
            ) continue;
            const glyphX = (subColumn + 0.5) * slot - cellSize * 0.5;
            const glyphY = (subRow + 0.5) * slot - cellSize * 0.5;
            const glyphIndex = subRow * subdivisions + subColumn;
            const item = {
              id: `${index}:${glyphIndex}`,
              index,
              glyphIndex,
              x: offsetX + (column + 0.5) * cellSize + glyphX,
              y: offsetY + (row + 0.5) * cellSize + glyphY,
              size: slot,
            };
            if (shouldCheckVisibility) {
              const localX = (glyphX + glyphTransform.offsetX) * parentScaleX;
              const localY = (glyphY + glyphTransform.offsetY) * parentScaleY;
              const worldX = parentCenterX
                + localX * rotationCosine
                - localY * rotationSine;
              const worldY = parentCenterY
                + localX * rotationSine
                + localY * rotationCosine;
              const roundness = clamp01(this.cellState.roundness[index]);
              const unscaledRadius = halfSize * (
                Math.SQRT2 - (Math.SQRT2 - 1) * roundness
              );
              const glyphScale = Math.max(
                Math.abs(glyphTransform.scaleX),
                Math.abs(glyphTransform.scaleY),
              );
              const parentScale = Math.max(
                Math.abs(parentScaleX),
                Math.abs(parentScaleY),
              );
              const worldRadius = unscaledRadius * glyphScale * parentScale;
              if (isGlyphHidden(worldX, worldY, worldRadius)) continue;
            }
            if (typeof glyphPresentation === "function") {
              const resolvedPresentations = glyphPresentation(item);
              const presentations = Array.isArray(resolvedPresentations)
                ? resolvedPresentations
                : [resolvedPresentations];
              const color = hasGlyphColors
                ? (glyphColor(item, defaultColor) ?? defaultColor)
                : defaultColor;
              for (const presentation of presentations) {
                if (presentation.opacity <= 0 || presentation.scale <= 0) continue;
                context.save();
                context.fillStyle = color;
                context.globalAlpha *= presentation.opacity;
                context.translate(presentation.offsetX, presentation.offsetY);
                if (presentation.scale !== 1) {
                  context.translate(glyphX, glyphY);
                  context.scale(presentation.scale, presentation.scale);
                  context.translate(-glyphX, -glyphY);
                }
                context.beginPath();
                this.shapeRenderer.addPath(
                  context,
                  glyphX,
                  glyphY,
                  halfSize,
                  this.cellState.roundness[index],
                  glyphTransform,
                );
                context.fill();
                context.restore();
              }
              context.beginPath();
              continue;
            }
            if (hasGlyphColors) {
              context.beginPath();
              context.fillStyle = glyphColor(item, defaultColor) ?? defaultColor;
              this.shapeRenderer.addPath(
                context,
                glyphX,
                glyphY,
                halfSize,
                this.cellState.roundness[index],
                glyphTransform,
              );
              context.fill();
              context.beginPath();
              continue;
            }
            this.shapeRenderer.addPath(
              context,
              glyphX,
              glyphY,
              halfSize,
              this.cellState.roundness[index],
              glyphTransform,
            );
          }
        }
        if (!hasGlyphColors) context.fill();
        context.restore();
      }
    }

    if (guides && showCellGrid) drawCellGridGuides(context, this.layout);
  }

  paletteColor(value) {
    if (this.options.paletteMode === "step") {
      const index = Math.min(
        this.paletteColors.length - 1,
        Math.floor(clamp01(value) * this.paletteColors.length),
      );
      return this.paletteColors[index];
    }
    const index = Math.round(clamp01(value) * 255);
    return this.paletteLookup[index];
  }

  cellVisible(index) {
    const threshold = Number.isFinite(this.options.emptyBelow)
      ? Math.max(0, this.options.emptyBelow)
      : 0;
    return threshold <= 0 || this.energy[index] >= threshold;
  }

  transitionItems() {
    const items = [];
    const { columns, rows, cellSize, offsetX, offsetY } = this.layout;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        if (!this.cellVisible(index)) continue;
        const subdivisions = 1 << this.cellState.level[index];
        const slot = cellSize / subdivisions;
        for (let subRow = 0; subRow < subdivisions; subRow += 1) {
          for (let subColumn = 0; subColumn < subdivisions; subColumn += 1) {
            const glyphIndex = subRow * subdivisions + subColumn;
            items.push({
              id: `${index}:${glyphIndex}`,
              x: offsetX + column * cellSize + (subColumn + 0.5) * slot,
              y: offsetY + row * cellSize + (subRow + 0.5) * slot,
              size: slot,
            });
          }
        }
      }
    }
    return items;
  }

  textColor() {
    return this.paletteColor(0.82 + this.meanEnergy * 0.18);
  }

  inspect() {
    return {
      ...this.layout,
      meanEnergy: this.meanEnergy,
      energy: this.energy,
      cellState: this.cellState,
    };
  }

  dispose() {
    this.cellTransition.dispose?.();
    this.cellState?.dispose();
  }
}
