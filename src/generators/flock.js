import { SpatialHash } from "./spatial-hash.js";
import { debug } from "../debug/index.js";

const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;
const GOLDEN_ANGLE = 2.399963229728653;
const FLOCK_STATE_VERSION = 1;
const BOID_NUMERIC_STATE_KEYS = Object.freeze([
  "x",
  "y",
  "vx",
  "vy",
  "ax",
  "ay",
  "age",
  "lifeProgress",
  "opacity",
  "birthDelay",
  "spawnIndex",
  "targetSpeed",
  "endOfLifeProgress",
]);

function unitSequence(index, offset) {
  const value = offset + index * GOLDEN_RATIO_CONJUGATE;
  return value - Math.floor(value);
}

function normalizedGuide(guide) {
  if (guide === undefined || guide === null) return null;
  if (!guide || typeof guide !== "object" || Array.isArray(guide)) {
    throw new TypeError("Flock guidance must be an object.");
  }
  for (const key of [
    "x",
    "y",
    "directionX",
    "directionY",
    "force",
    "radius",
    "tangentWeight",
  ]) {
    if (!Number.isFinite(guide[key])) {
      throw new RangeError(`Flock guidance ${key} must be finite.`);
    }
  }
  if (guide.force < 0 || guide.tangentWeight < 0) {
    throw new RangeError("Flock guidance force and tangentWeight must be non-negative.");
  }
  if (!(guide.radius > 0)) {
    throw new RangeError("Flock guidance radius must be positive.");
  }
  const magnitude = Math.hypot(guide.directionX, guide.directionY);
  if (!(magnitude > 0)) {
    throw new RangeError("Flock guidance direction must be non-zero.");
  }
  return {
    ...guide,
    directionX: guide.directionX / magnitude,
    directionY: guide.directionY / magnitude,
  };
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

  snapshotState() {
    return {
      version: FLOCK_STATE_VERSION,
      time: this.time,
      nextPulseTime: Number.isFinite(this.nextPulseTime)
        ? this.nextPulseTime
        : null,
      lastPulseTime: Number.isFinite(this.lastPulseTime)
        ? this.lastPulseTime
        : null,
      birthIndex: this.birthIndex,
      pulseIndex: this.pulseIndex,
      boids: this.boids.map(boid => ({
        x: boid.x,
        y: boid.y,
        vx: boid.vx,
        vy: boid.vy,
        ax: boid.ax,
        ay: boid.ay,
        age: boid.age,
        lifeProgress: boid.lifeProgress,
        opacity: boid.opacity,
        birthDelay: boid.birthDelay,
        spawnIndex: boid.spawnIndex,
        scheduled: boid.scheduled,
        active: boid.active,
        targetSpeed: boid.targetSpeed,
        endOfLifeProgress: boid.endOfLifeProgress,
        lifetime: Number.isFinite(boid.lifetime) ? boid.lifetime : null,
      })),
    };
  }

  restoreState(state) {
    if (
      !state
      || typeof state !== "object"
      || state.version !== FLOCK_STATE_VERSION
    ) {
      throw new TypeError(
        `Flock state must be a version ${FLOCK_STATE_VERSION} object.`,
      );
    }
    if (!Array.isArray(state.boids) || state.boids.length !== this.boids.length) {
      throw new RangeError(
        `Flock state must contain ${this.boids.length} boids.`,
      );
    }
    if (!Number.isFinite(state.time) || state.time < 0) {
      throw new RangeError("Flock state time must be finite and non-negative.");
    }
    if (
      state.nextPulseTime !== null
      && (!Number.isFinite(state.nextPulseTime) || state.nextPulseTime < 0)
    ) {
      throw new RangeError(
        "Flock state nextPulseTime must be finite and non-negative or null.",
      );
    }
    if (state.lastPulseTime !== null && !Number.isFinite(state.lastPulseTime)) {
      throw new RangeError("Flock state lastPulseTime must be finite or null.");
    }
    for (const key of ["birthIndex", "pulseIndex"]) {
      if (!Number.isInteger(state[key]) || state[key] < 0) {
        throw new RangeError(
          `Flock state ${key} must be a non-negative integer.`,
        );
      }
    }

    for (let index = 0; index < state.boids.length; index += 1) {
      const source = state.boids[index];
      if (!source || typeof source !== "object") {
        throw new TypeError(`Flock state boid ${index} must be an object.`);
      }
      for (const key of BOID_NUMERIC_STATE_KEYS) {
        if (!Number.isFinite(source[key])) {
          throw new RangeError(
            `Flock state boid ${index} ${key} must be finite.`,
          );
        }
      }
      if (
        source.lifetime !== null
        && (!Number.isFinite(source.lifetime) || source.lifetime <= 0)
      ) {
        throw new RangeError(
          `Flock state boid ${index} lifetime must be positive or null.`,
        );
      }
      for (const key of ["scheduled", "active"]) {
        if (typeof source[key] !== "boolean") {
          throw new TypeError(
            `Flock state boid ${index} ${key} must be a boolean.`,
          );
        }
      }
    }

    this.time = state.time;
    this.nextPulseTime = state.nextPulseTime === null
      ? Infinity
      : state.nextPulseTime;
    this.lastPulseTime = state.lastPulseTime === null
      ? -Infinity
      : state.lastPulseTime;
    this.birthIndex = state.birthIndex;
    this.pulseIndex = state.pulseIndex;
    for (let index = 0; index < state.boids.length; index += 1) {
      const source = state.boids[index];
      const boid = this.boids[index];
      for (const key of BOID_NUMERIC_STATE_KEYS) boid[key] = source[key];
      boid.scheduled = source.scheduled;
      boid.active = source.active;
      if (source.lifetime === null) delete boid.lifetime;
      else boid.lifetime = source.lifetime;
    }
    this.hash.heads.fill(-1);
    this.hash.next.fill(-1);
    return true;
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

  update(dt, width, height, pointer = { active: false }, guide) {
    const activeGuide = normalizedGuide(guide);
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
      this.computeAcceleration(index, width, height, pointer, activeGuide);
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

  emitPulse(width, height, emission) {
    const births = Math.min(
      this.boids.length,
      Math.max(1, Math.round(this.options.birthsPerPulse)),
    );
    const pulse = this.pulseIndex;
    let originX = width * 0.5;
    let originY = height * 0.5;
    let baseAngle = pulse * GOLDEN_ANGLE;
    let mode = "centered";
    let strength = 1;

    if (emission !== undefined) {
      if (!emission || typeof emission !== "object" || Array.isArray(emission)) {
        throw new TypeError("Flock pulse emission must be an object.");
      }
      for (const key of ["originX", "originY", "directionX", "directionY"]) {
        if (!Number.isFinite(emission[key])) {
          throw new RangeError(`Flock pulse ${key} must be finite.`);
        }
      }
      if (emission.strength !== undefined) {
        if (
          !Number.isFinite(emission.strength)
          || emission.strength <= 0
          || emission.strength > 1
        ) {
          throw new RangeError("Flock pulse strength must be finite and between zero and one.");
        }
        strength = emission.strength;
      }
      let directionMagnitude = Math.hypot(
        emission.directionX,
        emission.directionY,
      );
      if (!(directionMagnitude > 0)) {
        throw new RangeError("Flock pulse direction must be non-zero.");
      }
      originX = emission.originX;
      originY = emission.originY;
      let directionX;
      let directionY;
      if (!Number.isFinite(directionMagnitude)) {
        const directionScale = Math.max(
          Math.abs(emission.directionX),
          Math.abs(emission.directionY),
        );
        const scaledDirectionX = emission.directionX / directionScale;
        const scaledDirectionY = emission.directionY / directionScale;
        const scaledMagnitude = Math.hypot(
          scaledDirectionX,
          scaledDirectionY,
        );
        directionX = scaledDirectionX / scaledMagnitude;
        directionY = scaledDirectionY / scaledMagnitude;
      } else {
        directionX = emission.directionX / directionMagnitude;
        directionY = emission.directionY / directionMagnitude;
      }
      baseAngle = Math.atan2(directionY, directionX);
      mode = "directed";
    }
    this.lastPulseTime = this.time;

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
        this.options.initialSpeed * strength * speedScale,
        delay,
        this.options.lifetimeSeconds,
        index,
      );
      this.birthIndex += 1;
    }
    this.pulseIndex += 1;
    const active = this.boids.reduce(
      (total, boid) => total + Number(boid.active),
      0,
    );
    if (mode === "directed") {
      debug.transition(
        "flock-pulse=%d mode=directed originX=%.3f originY=%.3f directionX=%.6f directionY=%.6f strength=%.3f births=%d active=%d",
        pulse,
        originX,
        originY,
        Math.cos(baseAngle),
        Math.sin(baseAngle),
        strength,
        births,
        active,
      );
    } else {
      debug.cells(
        "flock-pulse=%d births=%d active=%d",
        pulse,
        births,
        active,
      );
    }
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

  computeAcceleration(index, width, height, pointer, guide = null) {
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

    if (guide) this.applyGuide(boid, guide);

    const force = Math.hypot(boid.ax, boid.ay);
    if (force > options.maxForce) {
      const scale = options.maxForce / force;
      boid.ax *= scale;
      boid.ay *= scale;
    }
  }

  applyGuide(boid, guide) {
    boid.targetSpeed = this.options.maxSpeed;
    this.addSteer(
      boid,
      guide.directionX,
      guide.directionY,
      guide.tangentWeight,
      this.options.maxSpeed,
    );

    const deltaX = guide.x - boid.x;
    const deltaY = guide.y - boid.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= 1e-9 || guide.force === 0) return;
    const amount = guide.force * Math.min(1, distance / guide.radius);
    boid.ax += deltaX / distance * amount;
    boid.ay += deltaY / distance * amount;
  }

  addSteer(boid, x, y, weight, targetSpeed = this.options.maxSpeed) {
    const magnitude = Math.hypot(x, y);
    if (magnitude < 1e-6) return;
    const scale = targetSpeed / magnitude;
    boid.ax += (x * scale - boid.vx) * weight;
    boid.ay += (y * scale - boid.vy) * weight;
  }
}
