export class FlockFieldSource {
  constructor(flock) {
    this.flock = flock;
  }

  write(field, frame) {
    const maxSpeed = this.flock.options.maxSpeed;

    for (const boid of this.flock.boids) {
      if (!boid.active) continue;

      const speedRatio = Math.hypot(boid.vx, boid.vy) / maxSpeed;
      const strength = (0.55 + speedRatio * 0.45) * boid.opacity;
      field.addPoint(boid.x, boid.y, strength);
    }
  }
}
