import test from "node:test";
import assert from "node:assert/strict";

import {
  SVGRecordingContext,
  SvgRecordingContext,
  createSvgRecordingContext,
} from "../src/export/svg-recording-context.js";
import { addRoundedRectPath } from "../src/shapes/rounded-rect.js";

function occurrences(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

test("serializes a standalone SVG with optional metadata and no page background", () => {
  const context = createSvgRecordingContext(640, 360);
  context.fillStyle = "#123456";
  context.fillRect(5, 6, 20, 30);

  const svg = context.toSVG({
    metadata: {
      id: "circle-grid-params",
      content: "CIRCLEGRIDPARAMS1B0000000004a<&b",
    },
  });

  assert.ok(context instanceof SVGRecordingContext);
  assert.strictEqual(SvgRecordingContext, SVGRecordingContext);
  assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n/);
  assert.match(
    svg,
    /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="640" height="360" viewBox="0 0 640 360" overflow="visible">/,
  );
  assert.match(
    svg,
    /<metadata id="circle-grid-params">CIRCLEGRIDPARAMS1B0000000004a&lt;&amp;b<\/metadata>/,
  );
  assert.doesNotMatch(svg, /<rect\b/);
  assert.match(svg, /<path d="M5 6 L25 6 L25 36 L5 36 Z" fill="#123456"/);
  assert.match(svg, /<\/svg>$/);
});

test("records compound RoundedRectRenderer paths with each subpath transform baked in", () => {
  const context = new SVGRecordingContext(200, 100);
  context.translate(100, 5);
  context.fillStyle = "rgb(1, 2, 3)";
  context.globalAlpha = 0.4;
  context.beginPath();

  addRoundedRectPath(context, 10, 20, 2, 0, {
    scaleX: 2,
    scaleY: 1,
    scaleAxis: 0,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
  });
  addRoundedRectPath(context, 30, 20, 2, 0, {
    scaleX: 1,
    scaleY: 2,
    scaleAxis: 0,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
  });
  context.fill("evenodd");

  const svg = context.toSVG();
  assert.match(
    svg,
    /d="M106 23 L114 23 L114 27 L106 27 Z M128 21 L132 21 L132 29 L128 29 Z"/,
  );
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, /fill-opacity="0\.4"/);
  assert.equal(occurrences(svg, /<path\b/g), 1);
  assert.doesNotMatch(svg, /<path[^>]+transform=/);
});

test("save and restore include drawing state and transforms but not the current path", () => {
  const context = new SVGRecordingContext(100, 100);
  context.beginPath();
  context.moveTo(0, 0);
  context.save();
  context.translate(10, 20);
  context.fillStyle = "red";
  context.globalAlpha = 0.25;
  context.lineTo(1, 2);
  context.restore();
  context.lineTo(3, 4);
  context.fill();

  context.save();
  context.strokeStyle = "blue";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.lineJoin = "bevel";
  context.miterLimit = 7;
  context.globalAlpha = 0.5;
  context.strokeRect(10, 10, 20, 15);
  context.restore();

  const svg = context.toSVG();
  assert.match(svg, /d="M0 0 L11 22 L3 4" fill="#000000"/);
  assert.doesNotMatch(svg, /fill-opacity="0\.25"/);
  assert.match(
    svg,
    /stroke="blue" stroke-width="3" stroke-linecap="round" stroke-linejoin="bevel" stroke-miterlimit="7" stroke-opacity="0\.5"/,
  );
  assert.equal(context.fillStyle, "#000000");
  assert.equal(context.globalAlpha, 1);
  assert.deepEqual(
    { ...context.getTransform(), toString: undefined },
    { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, is2D: true, toString: undefined },
  );
});

test("supports arcs, rounded rectangles, nonzero fills, and stroked paths", () => {
  const context = new SVGRecordingContext(120, 120);
  context.beginPath();
  context.arc(30, 30, 10, 0, Math.PI * 2);
  context.roundRect(50, 10, 40, 30, [4, 8]);
  context.fill();

  context.beginPath();
  context.moveTo(1, 2);
  context.lineTo(3, 4);
  context.strokeStyle = "rgba(5, 6, 7, 0.8)";
  context.lineWidth = 2;
  context.stroke();

  const svg = context.serialize();
  assert.equal(occurrences(svg, / C/g), 8);
  assert.match(svg, /fill-rule="nonzero"/);
  assert.match(svg, /d="M1 2 L3 4" fill="none" stroke="rgba\(5, 6, 7, 0\.8\)" stroke-width="2"/);
  assert.throws(() => context.arc(0, 0, -1, 0, 1), /radius must be non-negative/);
});

test("serializes cumulative clips and restores the prior clip with canvas state", () => {
  const context = new SVGRecordingContext(100, 100);
  context.beginPath();
  context.rect(0, 0, 80, 80);
  context.clip();

  context.save();
  context.beginPath();
  context.arc(40, 40, 20, 0, Math.PI * 2);
  context.clip("evenodd");
  context.fillStyle = "orange";
  context.fillRect(0, 0, 100, 100);
  context.restore();

  context.fillStyle = "purple";
  context.fillRect(0, 0, 10, 10);

  const svg = context.toSVG();
  assert.match(svg, /<defs>/);
  assert.match(svg, /id="svg-clip-1"[^>]*><path[^>]*fill-rule="nonzero" clip-rule="nonzero"/);
  assert.match(svg, /id="svg-clip-2"[^>]*><path[^>]*fill-rule="evenodd" clip-rule="evenodd"/);
  assert.match(
    svg,
    /<g clip-path="url\(#svg-clip-1\)"><g clip-path="url\(#svg-clip-2\)"><path[^>]+fill="orange"/,
  );
  assert.match(
    svg,
    /<g clip-path="url\(#svg-clip-1\)"><path[^>]+fill="purple"/,
  );
});

test("fillText preserves font, alignment, baseline, alpha, transform, and XML text", () => {
  const context = new SVGRecordingContext(300, 200);
  context.fillStyle = "white";
  context.globalAlpha = 0.75;
  context.font = "700 24px Test Sans";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.translate(50, 60);
  context.rotate(Math.PI / 2);
  context.fillText("A < B & C", 2, 3);

  const svg = context.toSVG();
  assert.match(svg, /<text x="2" y="3" fill="white"/);
  assert.match(svg, /text-anchor="middle" dominant-baseline="central"/);
  assert.match(svg, /style="font: 700 24px Test Sans"/);
  assert.match(svg, /fill-opacity="0\.75"/);
  assert.match(svg, /transform="matrix\(0 1 -1 0 50 60\)"/);
  assert.match(svg, />A &lt; B &amp; C<\/text>/);
});
