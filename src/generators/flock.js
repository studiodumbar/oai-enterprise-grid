import { SpatialHash } from "./spatial-hash.js";
import { debug } from "../debug/index.js";

const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;
const GOLDEN_ANGLE = 2.399963229728653;

function unitSequence(index, offset) {
  const value = offset + index * GOLDEN_RATIO_CONJUGATE;
  return value - Math.floor(value);
}

export class Boid {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.ax = 0;
    this.ay = 0;
    this.age = 0;
    this.lifeProgress = 1;
    this.opacity = 0;
    this.birthDelay = 0;
    this.spawnIndex = 0;
    this.scheduled = false;
    this.active = false;
    this.targetSpeed = 0;
    this.endOfLifeProgress = 0;
    return this;
  }

  schedule(x, y, angle, speed, birthDelay, lifetime, spawnIndex) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.ax = 0;
    this.ay = 0;
    this.age = 0;
    this.lifeProgress = 0;
    this.opacity = 0;
    this.birthDelay = birthDelay;
    this.lifetime = Math.max(0.1, lifetime);
    this.spawnIndex = spawnIndex;
    this.scheduled = true;
    this.active = birthDelay <= 0;
    this.targetSpeed = speed;
    this.endOfLifeProgress = 0;
    if (this.active) this.opacity = 1;
  }

  advanceLife(dt, fadeStartsAt) {
    if (!this.scheduled) return;

    if (!this.active) {
      this.birthDelay -= dt;
      if (this.birthDelay > 0) return;
      this.active = true;
      this.age = Math.max(0, -this.birthDelay);
    } else {
      this.age += dt;
    }

    this.lifeProgress = this.age / this.lifetime;
    if (this.lifeProgress >= 1) {
      this.active = false;
      this.scheduled = false;
      this.opacity = 0;
      return;
    }

    const fadeStart = Math.max(0, Math.min(0.99, fadeStartsAt));
    const fade = Math.max(
      0,
      Math.min(1, (this.lifeProgress - fadeStart) / (1 - fadeStart)),
    );
    const easedFade = fade * fade * (3 - 2 * fade);
    this.opacity = 1 - easedFade;
  }

  integrate(
    dt,
    width,
    height,
    maxSpeed,
    wrapEdges = true,
    speedControl = null,
  ) {
    this.vx += this.ax * dt;
    this.vy += this.ay * dt;

    let speed = Math.hypot(this.vx, this.vy);
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      this.vx *= scale;
      this.vy *= scale;
      speed = maxSpeed;
    }

    if (speedControl && speed > 1e-9) {
      const target = Math.max(0, Math.min(maxSpeed, this.targetSpeed));
      const rate = target > speed
        ? speedControl.acceleration
        : speedControl.drag;
      const maximumChange = Math.max(0, rate) * dt;
      const nextSpeed = target > speed
        ? Math.min(target, speed + maximumChange)
        : Math.max(target, speed - maximumChange);
      const scale = nextSpeed / speed;
      this.vx *= scale;
      this.vy *= scale;
      speed = nextSpeed;
      if (speed <= 1e-9) {
        this.vx = 0;
        this.vy = 0;
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (wrapEdges) {
      this.x = ((this.x % width) + width) % width;
      this.y = ((this.y % height) + height) % height;
    }
  }
}

export class Flock {
  constructor(options) {
    this.options = {
      wrapEdges: true,
      spawnRadius: 0,
      acceleration: 360,
      drag: 720,
      proximityExponent: 1,
      ...options,
    };
    this.options.proximityRadius ??= this.options.perceptionRadius;
    if (typeof this.options.wrapEdges !== "boolean") {
      throw new TypeError("flock.simulation.wrapEdges must be a boolean.");
    }
    if (!Number.isFinite(this.options.spawnRadius) || this.options.spawnRadius < 0) {
      throw new RangeError("flock.simulation.spawnRadius must be finite and non-negative.");
    }
    for (const name of ["acceleration", "drag"]) {
      if (!Number.isFinite(this.options[name]) || this.options[name] < 0) {
        throw new RangeError(`flock.simulation.${name} must be finite and non-negative.`);
      }
    }
    if (!Number.isFinite(this.options.proximityExponent) || this.options.proximityExponent <= 0) {
      throw new RangeError("flock.simulation.proximityExponent must be finite and positive.");
    }
    if (!Number.isFinite(this.options.proximityRadius) || this.options.proximityRadius <= 0) {
      throw new RangeError("flock.simulation.proximityRadius must be finite and positive.");
    }
    this.boids = Array.from({ length: options.count }, () => new Boid());
    this.hash = new SpatialHash(
      Math.max(this.options.perceptionRadius, this.options.proximityRadius),
      this.options.count,
    );
    this.time = 0;
    this.nextPulseTime = 0;
    this.lastPulseTime = -Infinity;
    this.birthIndex = 0;
    this.pulseIndex = 0;
    this.residenceSeconds = this.effectiveResidenceSeconds();
    debug.config(
      "flock-life authored=%.3f residence=%.3f capacity=%d births=%d",
      this.options.lifetimeSeconds,
      this.residenceSeconds,
      this.options.count,
      this.options.birthsPerPulse,
    );
  }

  reset() {
    for (const boid of this.boids) boid.reset();
    this.time = 0;
    this.nextPulseTime = 0;
    this.lastPulseTime = -Infinity;
    this.birthIndex = 0;
    this.pulseIndex = 0;
    return this;
  }

  effectiveResidenceSeconds() {
    const births = Math.max(1, Math.min(
      this.options.count,
      Math.round(this.options.birthsPerPulse),
    ));
    const capacitySeconds = this.options.count / births
      * Math.max(0.1, this.options.pulseEverySeconds);
    return Math.min(this.options.lifetimeSeconds, capacitySeconds);
  }

  update(dt, width, height, pointer = { active: false }) {
    this.time += dt;
    for (const boid of this.boids) {
      boid.advanceLife(dt, this.options.fadeStartsAt);
      boid.endOfLifeProgress = boid.active
        ? Math.min(1, boid.age / this.residenceSeconds)
        : 0;
    }

    const pulseEvery = Math.max(0.1, this.options.pulseEverySeconds);
    while (this.time >= this.nextPulseTime) {
      this.emitPulse(width, height);
      this.nextPulseTime += pulseEvery;
    }

    this.hash.rebuild(width, height, this.boids, {
      wrapEdges: this.options.wrapEdges,
    });
    for (let index = 0; index < this.boids.length; index += 1) {
      if (!this.boids[index].active) continue;
      if (!this.options.wrapEdges && !this.isOnscreen(this.boids[index], width, height)) {
        this.boids[index].ax = 0;
        this.boids[index].ay = 0;
        this.boids[index].targetSpeed = 0;
        continue;
      }
      this.computeAcceleration(index, width, height, pointer);
    }
    for (const boid of this.boids) {
      if (!boid.active) continue;
      boid.integrate(
        dt,
        width,
        height,
        this.options.maxSpeed,
        this.options.wrapEdges,
        {
          acceleration: this.options.acceleration,
          drag: this.options.drag,
        },
      );
    }
    const metrics = this.speedMetrics();
    debug.cells(
      "flock-speed active=%d stopped=%d mean=%.3f target=%.3f",
      metrics.active,
      metrics.stopped,
      metrics.mean,
      metrics.meanTarget,
    );
  }

  emitPulse(width, height) {
    const births = Math.min(
      this.boids.length,
      Math.max(1, Math.round(this.options.birthsPerPulse)),
    );
    this.lastPulseTime = this.time;
    const pulse = this.pulseIndex;
    const originX = width * 0.5;
    const originY = height * 0.5;
    const baseAngle = pulse * GOLDEN_ANGLE;

    for (let indexInPulse = 0; indexInPulse < births; indexInPulse += 1) {
      const boid = this.nextBirthSlot();
      const index = this.birthIndex;
      const spreadAngle = index * GOLDEN_ANGLE;
      const spreadRadius = Math.sqrt(unitSequence(index, 0.41)) * this.options.spawnRadius;
      const directionOffset = (unitSequence(index, 0.29) - 0.5) * 0.7;
      const speedScale = 0.7 + unitSequence(index, 0.73) * 0.3;
      const delay = births > 1
        ? indexInPulse / (births - 1) * this.options.emissionSeconds
        : 0;

      boid.schedule(
        originX + Math.cos(spreadAngle) * spreadRadius,
        originY + Math.sin(spreadAngle) * spreadRadius,
        baseAngle + directionOffset,
        this.options.initialSpeed * speedScale,
        delay,
        this.options.lifetimeSeconds,
        index,
      );
      this.birthIndex += 1;
    }
    this.pulseIndex += 1;
    debug.cells(
      "flock-pulse=%d births=%d active=%d",
      pulse,
      births,
      this.boids.reduce((total, boid) => total + Number(boid.active), 0),
    );
  }

  nextBirthSlot() {
    let oldest = this.boids[0];
    for (const boid of this.boids) {
      if (!boid.scheduled) return boid;
      if (boid.lifeProgress > oldest.lifeProgress) oldest = boid;
    }
    return oldest;
  }

  pulseStrength() {
    const age = this.time - this.lastPulseTime;
    if (!Number.isFinite(age) || age < 0) return 0;
    const decay = Math.max(0.01, this.options.pulseDecaySeconds);
    return Math.exp(-age / decay);
  }

  speedMetrics() {
    let active = 0;
    let stopped = 0;
    let speed = 0;
    let targetSpeed = 0;
    for (const boid of this.boids) {
      if (!boid.active) continue;
      const value = Math.hypot(boid.vx, boid.vy);
      active += 1;
      speed += value;
      targetSpeed += boid.targetSpeed;
      if (value <= 1e-6) stopped += 1;
    }
    return {
      active,
      stopped,
      mean: active > 0 ? speed / active : 0,
      meanTarget: active > 0 ? targetSpeed / active : 0,
    };
  }

  resize(previousViewport, nextViewport) {
    const scaleX = nextViewport.width / Math.max(1, previousViewport.width);
    const scaleY = nextViewport.height / Math.max(1, previousViewport.height);
    for (const boid of this.boids) {
      boid.x *= scaleX;
      boid.y *= scaleY;
    }
  }

  isOnscreen(boid, width, height) {
    return boid.x >= 0 && boid.x < width && boid.y >= 0 && boid.y < height;
  }

  computeAcceleration(index, width, height, pointer) {
    const boid = this.boids[index];
    const options = this.options;
    const radius = options.perceptionRadius;
    const radiusSquared = radius * radius;
    const proximityRadius = options.proximityRadius;
    const proximityRadiusSquared = proximityRadius * proximityRadius;
    const separationSquared = options.separationRadius * options.separationRadius;
    const cellX = Math.floor(boid.x / this.hash.cellSize);
    const cellY = Math.floor(boid.y / this.hash.cellSize);

    let alignX = 0;
    let alignY = 0;
    let centerX = 0;
    let centerY = 0;
    let separateX = 0;
    let separateY = 0;
    let neighbours = 0;
    let proximityNeighbours = 0;
    let nearestDistanceSquared = Infinity;

    const firstRowOffset = this.hash.rows === 1 ? 0 : -1;
    const lastRowOffset = this.hash.rows >= 3 ? 1 : 0;
    const firstColumnOffset = this.hash.columns === 1 ? 0 : -1;
    const lastColumnOffset = this.hash.columns >= 3 ? 1 : 0;

    for (
      let offsetY = firstRowOffset;
      offsetY <= lastRowOffset;
      offsetY += 1
    ) {
      for (
        let offsetX = firstColumnOffset;
        offsetX <= lastColumnOffset;
        offsetX += 1
      ) {
        const bucketColumn = cellX + offsetX;
        const bucketRow = cellY + offsetY;
        if (
          !options.wrapEdges
          && (
            bucketColumn < 0
            || bucketColumn >= this.hash.columns
            || bucketRow < 0
            || bucketRow >= this.hash.rows
          )
        ) continue;
        const bucket = options.wrapEdges
          ? this.hash.wrappedBucket(bucketColumn, bucketRow)
          : bucketRow * this.hash.columns + bucketColumn;
        let otherIndex = this.hash.heads[bucket];
        while (otherIndex !== -1) {
          if (otherIndex !== index) {
            const other = this.boids[otherIndex];
            let deltaX = other.x - boid.x;
            let deltaY = other.y - boid.y;
            if (options.wrapEdges) {
              if (deltaX > width * 0.5) deltaX -= width;
              if (deltaX < -width * 0.5) deltaX += width;
              if (deltaY > height * 0.5) deltaY -= height;
              if (deltaY < -height * 0.5) deltaY += height;
            }
            const distanceSquared = deltaX * deltaX + deltaY * deltaY;

            if (distanceSquared > 0 && distanceSquared < proximityRadiusSquared) {
              nearestDistanceSquared = Math.min(nearestDistanceSquared, distanceSquared);
              proximityNeighbours += 1;
            }
            if (distanceSquared > 0 && distanceSquared < radiusSquared) {
              alignX += other.vx;
              alignY += other.vy;
              centerX += deltaX;
              centerY += deltaY;
              neighbours += 1;
              if (distanceSquared < separationSquared) {
                const inverse = 1 / distanceSquared;
                separateX -= deltaX * inverse;
                separateY -= deltaY * inverse;
              }
            }
          }
          otherIndex = this.hash.next[otherIndex];
        }
      }
    }

    boid.ax = 0;
    boid.ay = 0;
    const proximity = proximityNeighbours > 0
      ? 1 - Math.sqrt(nearestDistanceSquared) / proximityRadius
      : 0;
    boid.targetSpeed = options.maxSpeed * Math.pow(
      Math.max(0, Math.min(1, proximity)),
      options.proximityExponent,
    );
    if (neighbours > 0) {
      this.addSteer(
        boid,
        alignX / neighbours,
        alignY / neighbours,
        options.alignment,
        boid.targetSpeed,
      );
      this.addSteer(
        boid,
        centerX / neighbours,
        centerY / neighbours,
        options.cohesion,
        boid.targetSpeed,
      );
      this.addSteer(
        boid,
        separateX,
        separateY,
        options.separation,
        boid.targetSpeed,
      );
    }

    if (pointer?.active) {
      const deltaX = pointer.x - boid.x;
      const deltaY = pointer.y - boid.y;
      const distance = Math.hypot(deltaX, deltaY);
      if (distance > 1 && distance < options.pointerRadius) {
        const amount = (1 - distance / options.pointerRadius) * options.pointerForce;
        boid.ax += deltaX / distance * amount;
        boid.ay += deltaY / distance * amount;
      }
    }

    const force = Math.hypot(boid.ax, boid.ay);
    if (force > options.maxForce) {
      const scale = options.maxForce / force;
      boid.ax *= scale;
      boid.ay *= scale;
    }
  }

  addSteer(boid, x, y, weight, targetSpeed = this.options.maxSpeed) {
    const magnitude = Math.hypot(x, y);
    if (magnitude < 1e-6) return;
    const scale = targetSpeed / magnitude;
    boid.ax += (x * scale - boid.vx) * weight;
    boid.ay += (y * scale - boid.vy) * weight;
  }
}
