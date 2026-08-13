function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

/**
 * A small, strict registry for named factories.
 *
 * Factories receive exactly the arguments passed after `name` in `create()`.
 * Keeping that forwarding behavior generic lets the registries stay unaware of
 * p5, generator, and composition implementation details.
 */
export class FactoryRegistry {
  constructor(kind) {
    this.kind = requireNonEmptyString(kind, "Registry kind");
    this.factories = new Map();
  }

  register(name, factory) {
    requireNonEmptyString(name, `${this.kind} name`);
    if (typeof factory !== "function") {
      throw new TypeError(`Factory for ${this.kind} "${name}" must be a function.`);
    }
    if (this.factories.has(name)) {
      throw new Error(`${this.kind} "${name}" is already registered.`);
    }

    this.factories.set(name, factory);
    return this;
  }

  create(name, ...args) {
    requireNonEmptyString(name, `${this.kind} name`);
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(this.unknownNameMessage(name));
    }
    return factory(...args);
  }

  has(name) {
    return typeof name === "string" && this.factories.has(name);
  }

  list() {
    return Array.from(this.factories.keys());
  }

  unknownNameMessage(name) {
    const available = this.list();
    const suffix = available.length > 0
      ? ` Available ${this.kind}s: ${available.join(", ")}.`
      : ` No ${this.kind}s are registered.`;
    return `Unknown ${this.kind} "${name}".${suffix}`;
  }
}

export default FactoryRegistry;
