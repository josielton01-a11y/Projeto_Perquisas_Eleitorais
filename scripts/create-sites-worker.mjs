import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";

mkdirSync("dist/server", { recursive: true });
mkdirSync("dist/client", { recursive: true });
for (const entry of ["assets", "index.html", "manifest.webmanifest", "sw.js"]) {
  if (existsSync(`dist/${entry}`)) {
    renameSync(`dist/${entry}`, `dist/client/${entry}`);
  }
}
copyFileSync("worker/index.js", "dist/server/index.js");
