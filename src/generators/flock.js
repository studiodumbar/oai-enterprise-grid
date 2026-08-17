import { SpatialHash } from "./spatial-hash.js";

export class Boid {
  constructor() {
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

  integrate(dt, width, height, maxSpeed) {
    this.vx += this.ax * dt;
    this.vy += this.ay * dt;

    const speed = Math.hypot(this.vx, this.vy);
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      this.vx *= scale;
      this.vy *= scale;
    }

    this.x = ((this.x + this.vx * dt) % width + width) % width;
    this.y = ((this.y + this.vy * dt) % height + height) % height;
  }
}

export class Flock {
  constructor(options) {
    this.options = options;
    this.boids = Array.from({ length: options.count }, () => new Boid());
    this.hash = new SpatialHash(options.perceptionRadius, options.count);
    this.time = 0;
    this.nextPulseTime = 0;
    this.lastPulseTime = -Infinity;
    this.birthIndex = 0;
    this.force = { x: 0, y: 0 };
  }

  update(dt, width, height, typeField, pointer) {
    this.time += dt;
    for (const boid of this.boids) boid.advanceLife(dt, this.options.fadeStartsAt);

    const pulseEvery = Math.max(0.1, this.options.pulseEverySeconds);
    while (this.time >= this.nextPulseTime) {
      this.emitPulse(typeField);
      this.nextPulseTime += pulseEvery;
    }

    this.hash.rebuild(width, height, this.boids);
    for (let index = 0; index < this.boids.length; index += 1) {
      if (!this.boids[index].active) continue;
      this.computeAcceleration(index, width, height, typeField, pointer);
    }
    for (const boid of this.boids) {
      if (!boid.active) continue;
      boid.integrate(dt, width, height, this.options.maxSpeed);
    }
  }

  draw(context, isBoidHidden) {
    if (!this.options.showBoids) return;
    context.save();
    context.fillStyle = this.options.boidColor;
    const inheritedAlpha = context.globalAlpha;
    const radius = this.options.boidSize * 0.5;
    for (const boid of this.boids) {
      if (!boid.active) continue;
      if (
        typeof isBoidHidden === "function"
        && isBoidHidden(boid.x, boid.y, radius)
      ) {
        continue;
      }
      context.globalAlpha = inheritedAlpha * this.options.boidOpacity * boid.opacity;
      context.beginPath();
      context.moveTo(boid.x + radius, boid.y);
      context.arc(boid.x, boid.y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  emitPulse(typeField) {
    const births = Math.min(
      this.boids.length,
      Math.max(1, Math.round(this.options.birthsPerPulse)),
    );
    this.lastPulseTime = this.time;

    for (let indexInPulse = 0; indexInPulse < births; indexInPulse += 1) {
      const boid = this.nextBirthSlot();
      const index = this.birthIndex;
      const origin = typeField.spawnPointAt(index);
      const fromCenterX = origin.x - typeField.width * 0.5;
      const fromCenterY = origin.y - typeField.height * 0.5;
      const radialAngle = Math.hypot(fromCenterX, fromCenterY) > 1
        ? Math.atan2(fromCenterY, fromCenterX)
        : index * 2.399963229728653;
      const directionOffset = (((index * 0.3819660112501051) % 1) - 0.5) * 0.7;
      const speedScale = 0.7 + ((index * 0.7548776662466927) % 1) * 0.3;
      const delay = births > 1
        ? indexInPulse / (births - 1) * this.options.emissionSeconds
        : 0;

      boid.schedule(
        origin.x,
        origin.y,
        radialAngle + directionOffset,
        this.options.initialSpeed * speedScale,
        delay,
        this.options.lifetimeSeconds,
        index,
      );
      this.birthIndex += 1;
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

  repositionUnborn(typeField) {
    for (const boid of this.boids) {
      if (boid.active || !boid.scheduled) continue;
      const origin = typeField.spawnPointAt(boid.spawnIndex);
      boid.x = origin.x;
      boid.y = origin.y;
    }
  }

  computeAcceleration(index, width, height, typeField, pointer) {
    const boid = this.boids[index];
    const options = this.options;
    const radius = options.perceptionRadius;
    const radiusSquared = radius * radius;
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
        let otherIndex = this.hash.heads[
          this.hash.wrappedBucket(cellX + offsetX, cellY + offsetY)
        ];
        while (otherIndex !== -1) {
          if (otherIndex !== index) {
            const other = this.boids[otherIndex];
            let deltaX = other.x - boid.x;
            let deltaY = other.y - boid.y;
            if (deltaX > width * 0.5) deltaX -= width;
            if (deltaX < -width * 0.5) deltaX += width;
            if (deltaY > height * 0.5) deltaY -= height;
            if (deltaY < -height * 0.5) deltaY += height;
            const distanceSquared = deltaX * deltaX + deltaY * deltaY;

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
    if (neighbours > 0) {
      this.addSteer(boid, alignX / neighbours, alignY / neighbours, options.alignment);
      this.addSteer(boid, centerX / neighbours, centerY / neighbours, options.cohesion);
      this.addSteer(boid, separateX, separateY, options.separation);
    }

    typeField.forceAt(boid.x, boid.y, this.force);
    boid.ax += this.force.x;
    boid.ay += this.force.y;

    if (pointer.active) {
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

  addSteer(boid, x, y, weight) {
    const magnitude = Math.hypot(x, y);
    if (magnitude < 1e-6) return;
    const scale = this.options.maxSpeed / magnitude;
    boid.ax += (x * scale - boid.vx) * weight;
    boid.ay += (y * scale - boid.vy) * weight;
  }
}
