import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildLocalities, distributeInterviews, distributionValid, localityKey, localitySections } from "../src/localities.ts";

// Read the real geographic base, including quoted CSV fields.
const csv = readFileSync(new URL("../dados_entrada/ruas_bonito_geocodificadas.csv", import.meta.url), "utf8");
const lines = csv.trim().split(/\r?\n/).map((line) => [...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)].map((match) => match[1].replace(/^"|"$/g, "").replaceAll('""', '"')));
const header = lines.shift();
const rows = lines.map((line) => ({ district: line[header.indexOf("DISTRITO/POVOADO")], neighborhood: line[header.indexOf("BAIRRO")] }));
const options = buildLocalities(rows);

test("the real base has separate Centros for Bonito and Alto Bonito", () => {
  const centers = options.filter((option) => option.label === "CENTRO");
  assert.equal(centers.length, 2);
  assert.deepEqual(new Set(centers.map((option) => option.section)), new Set(["Bonito", "Alto Bonito"]));
  assert.equal(new Set(centers.map((option) => option.key)).size, 2);
  assert.equal(centers.find((option) => option.section === "Bonito").key, "CENTRO");
});

test("Estreito is represented independently of the rural classification in the CSV", () => {
  assert.ok(rows.some((row) => row.district === "ESTREITO DO NORTE" && row.neighborhood === "ZONA RURAL"));
  assert.deepEqual(options.find((option) => option.key === "ESTREITO DO NORTE"), {
    key: "ESTREITO DO NORTE", label: "ESTREITO DO NORTE", section: "Estreito",
  });
  assert.deepEqual(localitySections, ["Bonito", "Alto Bonito", "Estreito", "Bentivi", "Zona Rural"]);
  assert.equal(options.find((option) => option.key === "BENTIVI").section, "Bentivi");
});

test("street assignment uses the same district-specific identifiers", () => {
  assert.equal(localityKey({ district: "ALTO BONITO", neighborhood: "CENTRO" }), "CENTRO — ALTO BONITO");
  assert.equal(localityKey({ district: "BONITO", neighborhood: "CENTRO" }), "CENTRO");
  assert.equal(localityKey({ district: "ESTREITO DO NORTE", neighborhood: "ZONA RURAL" }), "ESTREITO DO NORTE");
});

test("automatic distribution always closes the exact total with whole, nonnegative counts", () => {
  for (let count = 1; count <= 40; count++) {
    const keys = Array.from({ length: count }, (_, index) => `localidade-${index}`);
    for (const target of [1, 2, 17, 22, 378, 400, 1001]) {
      const quotas = distributeInterviews(target, keys);
      assert.equal(distributionValid(target, quotas), true);
      assert.equal(Object.keys(quotas).length, count);
      assert.ok(Math.max(...Object.values(quotas)) - Math.min(...Object.values(quotas)) <= 1);
    }
  }
});

test("rural entries participate in totals and survive serialization", () => {
  const keys = ["CENTRO", "CENTRO — ALTO BONITO", "ESTREITO DO NORTE", "ZONA RURAL — SÍTIO TESTE"];
  const quotas = JSON.parse(JSON.stringify(distributeInterviews(401, keys)));
  assert.equal(distributionValid(401, quotas), true);
  assert.equal(quotas["ZONA RURAL — SÍTIO TESTE"], 100);
});

test("mismatched totals and invalid counts cannot pass save validation", () => {
  assert.equal(distributionValid(400, { CENTRO: 378 }), false);
  assert.equal(distributionValid(400, { CENTRO: 401 }), false);
  assert.equal(distributionValid(400, { CENTRO: 378, ESTREITO: 22 }), true);
  assert.equal(distributionValid(400, { CENTRO: 400.5, ESTREITO: -0.5 }), false);
  assert.equal(distributionValid(400, { CENTRO: 401, ESTREITO: -1 }), false);
  assert.equal(distributionValid(0, {}), false);
  assert.equal(distributionValid(1, { CENTRO: NaN }), false);
  assert.equal(distributionValid(Infinity, { CENTRO: Infinity }), false);
  assert.equal(distributeInterviews(400, []), null);
  assert.equal(distributeInterviews(0, ["CENTRO"]), null);
  assert.equal(distributeInterviews(1.5, ["CENTRO"]), null);
});
