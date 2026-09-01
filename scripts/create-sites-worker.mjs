import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";

mkdirSync("dist/server", { recursive: true });
mkdirSync("dist/client", { recursive: true });
for (const entry of ["assets", "index.html", "manifest.webmanifest", "sw.js"]) {
  if (existsSync(`dist/${entry}`)) {
    rmSync(`dist/client/${entry}`, { recursive: true, force: true });
    renameSync(`dist/${entry}`, `dist/client/${entry}`);
  }
}
copyFileSync("worker/index.js", "dist/server/index.js");
