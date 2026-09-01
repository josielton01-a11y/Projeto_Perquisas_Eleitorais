import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist/server", { recursive: true });
writeFileSync(
  "dist/server/index.js",
  `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) {
      if (request.mode !== "navigate" && new URL(request.url).pathname !== "/sw.js") {
        return response;
      }
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store, max-age=0");
      return new Response(response.body, { status: response.status, headers });
    }
    const url = new URL(request.url);
    url.pathname = "/index.html";
    const fallback = await env.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(fallback.headers);
    headers.set("Cache-Control", "no-store, max-age=0");
    return new Response(fallback.body, { status: fallback.status, headers });
  }
};\n`,
);
