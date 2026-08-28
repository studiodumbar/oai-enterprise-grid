import test from "node:test";
import assert from "node:assert/strict";

import { createFlockPreviewPanel } from "../src/fields/flock-preview-panel.js";
import { createNoisePreviewPanel } from "../src/noise-fields/noise-preview-panel.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.style = {};
    this.className = "";
    this.hidden = false;
    this.open = false;
    this.isConnected = false;
    this.parentElement = null;
  }

  get classList() {
    return { contains: value => this.className.split(/\s+/).includes(value) };
  }

  set innerHTML(value) {
    this.children = [];
    if (value.includes("noise-preview-grid")) {
      const grid = new FakeElement("div");
      grid.className = "noise-preview-grid";
      for (let index = 0; index < 4; index += 1) {
        const figure = new FakeElement("figure");
        figure.append(new FakeElement("canvas"));
        grid.append(figure);
      }
      this.append(grid);
    } else if (value.includes("<canvas")) {
      this.append(new FakeElement("canvas"));
    }
  }

  append(...elements) {
    for (const element of elements) {
      element.parentElement = this;
      element.isConnected = this.isConnected || this.tagName === "BODY";
      this.children.push(element);
    }
  }

  descendants() {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }

  querySelector(selector) {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.descendants().find(element => element.classList.contains(className)) ?? null;
    }
    return this.descendants().find(element => element.tagName === selector.toUpperCase()) ?? null;
  }

  querySelectorAll(selector) {
    return this.descendants().filter(element => element.tagName === selector.toUpperCase());
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    }
    this.parentElement = null;
    this.isConnected = false;
  }
}

function fakeDocument() {
  const body = new FakeElement("body");
  body.isConnected = true;
  return {
    body,
    createElement: tagName => new FakeElement(tagName),
  };
}

test("flock preview keeps floating defaults and supports a workspace mount", () => {
  const document = fakeDocument();
  const floating = createFlockPreviewPanel({ document, snapshot: () => null });
  assert.equal(floating.root.parentElement, document.body);
  assert.equal(floating.root.style.position, "fixed");
  assert.equal(floating.setVisible(true), true);
  assert.equal(floating.isVisible(), true);

  const mount = new FakeElement("div");
  mount.className = "panel-window-body";
  const mounted = createFlockPreviewPanel({ document, mount, snapshot: () => null });
  assert.equal(mounted.root.parentElement, mount);
  assert.equal(mounted.root.style.position, undefined);
  mounted.remove();
  assert.equal(mounted.root.parentElement, null);
});

test("noise preview keeps floating defaults and supports a workspace mount", () => {
  const document = fakeDocument();
  const floating = createNoisePreviewPanel({ document, snapshot: () => null });
  assert.equal(floating.root.parentElement, document.body);
  assert.equal(floating.root.style.position, "fixed");

  const mount = new FakeElement("div");
  mount.className = "panel-window-body";
  const mounted = createNoisePreviewPanel({ document, mount, snapshot: () => null });
  assert.equal(mounted.root.parentElement, mount);
  assert.equal(mounted.root.style.position, undefined);
  assert.equal(mounted.root.querySelectorAll("canvas").length, 4);
});
