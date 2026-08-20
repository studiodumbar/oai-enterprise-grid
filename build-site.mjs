import { cp, mkdir, rm } from "node:fs/promises";

const runtimeEntries = [
  "index.html",
  "sketch.js",
  "config.js",
  "config",
  "css",
  "src",
  "assets",
];

await rm("dist", { recursive: true, force: true });
await mkdir("dist/client", { recursive: true });
await mkdir("dist/server", { recursive: true });

for (const entry of runtimeEntries) {
  await cp(entry, `dist/client/${entry}`, { recursive: true });
}
await cp("worker/index.js", "dist/server/index.js");
