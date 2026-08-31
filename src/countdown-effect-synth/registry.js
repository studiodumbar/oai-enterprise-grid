import { FactoryRegistry } from "../core/registry.js";

const INSTANCE_METHODS = Object.freeze([
  "resize",
  "planAt",
  "sampleAt",
  "drawLayer",
  "inspect",
  "dispose",
]);

function requireDescriptor(descriptor, kind) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new TypeError(`Countdown ${kind} descriptor must be an object.`);
  }
  if (typeof descriptor.name !== "string" || descriptor.name.trim() === "") {
    throw new TypeError(`Countdown ${kind} descriptor name must be a non-empty string.`);
  }
  if (!Number.isSafeInteger(descriptor.seedSalt) || descriptor.seedSalt < 0) {
    throw new RangeError(
      `Countdown ${kind} "${descriptor.name}" seedSalt must be a non-negative integer.`,
    );
  }
  if (!descriptor.ports || typeof descriptor.ports !== "object") {
    throw new TypeError(`Countdown ${kind} "${descriptor.name}" ports must be an object.`);
  }
  if (typeof descriptor.normalize !== "function" || typeof descriptor.create !== "function") {
    throw new TypeError(
      `Countdown ${kind} "${descriptor.name}" requires normalize() and create().`,
    );
  }
  return Object.freeze({ defaults: Object.freeze({}), ...descriptor });
}

function validateInstance(instance, label) {
  if (!instance || typeof instance !== "object") {
    throw new TypeError(`${label} create() must return an object.`);
  }
  for (const method of INSTANCE_METHODS) {
    if (typeof instance[method] !== "function") {
      throw new TypeError(`${label} instance requires ${method}().`);
    }
  }
  return instance;
}

class DescriptorRegistry {
  constructor(kind) {
    this.kind = kind;
    this.registry = new FactoryRegistry(`countdown ${kind}`);
    this.descriptors = new Map();
  }

  register(descriptor) {
    const normalized = requireDescriptor(descriptor, this.kind);
    this.registry.register(normalized.name, creation => normalized.create(creation));
    this.descriptors.set(normalized.name, normalized);
    return this;
  }

  descriptor(name) {
    if (!this.descriptors.has(name)) throw new Error(this.registry.unknownNameMessage(name));
    return this.descriptors.get(name);
  }

  create(name, creation) {
    return validateInstance(
      this.registry.create(name, creation),
      `Countdown ${this.kind} "${name}"`,
    );
  }

  has(name) {
    return this.descriptors.has(name);
  }

  list() {
    return [...this.descriptors.keys()];
  }
}

export class CountdownEffectRegistry extends DescriptorRegistry {
  constructor() {
    super("effect");
  }
}

export class CountdownConnectorRegistry extends DescriptorRegistry {
  constructor() {
    super("connector");
    this.pairs = new Map();
  }

  register(descriptor) {
    super.register(descriptor);
    if (descriptor.from && descriptor.to) {
      const key = `${descriptor.from}->${descriptor.to}`;
      if (this.pairs.has(key)) {
        throw new Error(`Countdown connector pair "${key}" is already registered.`);
      }
      this.pairs.set(key, descriptor.name);
    }
    return this;
  }

  resolve(requestedUse, fromDescriptor, toDescriptor) {
    let descriptor;
    if (requestedUse !== "auto") descriptor = this.descriptor(requestedUse);
    const pair = `${fromDescriptor.name}->${toDescriptor.name}`;
    descriptor ??= this.descriptor(this.pairs.get(pair) ?? "hard-cut");
    if (
      descriptor.from !== null
      && descriptor.from !== undefined
      && (descriptor.from !== fromDescriptor.name || descriptor.to !== toDescriptor.name)
    ) {
      throw new Error(
        `Countdown connector "${descriptor.name}" supports `
        + `${descriptor.from}->${descriptor.to}, not ${pair}.`,
      );
    }
    const required = descriptor.requiredPorts ?? {};
    for (const [side, effect] of [["from", fromDescriptor], ["to", toDescriptor]]) {
      for (const port of required[side] ?? []) {
        if (effect.ports[port] !== true) {
          throw new Error(
            `Countdown connector "${descriptor.name}" requires ${side} port `
            + `"${port}", but effect "${effect.name}" does not provide it.`,
          );
        }
      }
    }
    return descriptor;
  }
}

export function countdownEffectPorts(...names) {
  return Object.freeze(Object.fromEntries(names.map(name => [name, true])));
}

export { validateInstance as validateCountdownSynthInstance };
