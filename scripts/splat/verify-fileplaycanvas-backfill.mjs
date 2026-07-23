#!/usr/bin/env node
/**
 * Verify every DynamoDB field exposed by GET /fields has FilePlayCanvas (+ FileFormat).
 *
 * Usage (from repo root):
 *   VITE_PUBLIC_API_URL=https://api.example.com npm run verify:fileplaycanvas
 *
 * Loads VITE_PUBLIC_API_URL from repo root `.env` when not set in the environment.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

function loadDotEnv() {
  const envPath = resolve(repoRoot, ".env");
  if (!existsSync(envPath)) return;

  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function normalizeFields(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray(raw.items)) return raw.items;
  return [];
}

async function main() {
  loadDotEnv();

  const base = process.env.VITE_PUBLIC_API_URL?.replace(/\/$/, "");
  if (!base) {
    console.error(
      "error: VITE_PUBLIC_API_URL is not set. Copy .env.example to .env and set your Virtual Soils API Gateway URL, or pass VITE_PUBLIC_API_URL in the environment.",
    );
    process.exit(1);
  }

  const url = `${base}/fields`;
  console.log(`Fetching ${url} …`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`GET /fields failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const raw = await res.json();
  const fields = normalizeFields(raw);

  if (fields.length === 0) {
    console.warn("No fields returned from API.");
    process.exit(0);
  }

  const missingPlayCanvas = [];
  const missingFormat = [];
  const missingLegacyFile = [];

  for (const field of fields) {
    const fieldId = String(field.FieldID ?? "(unknown)");
    const playCanvas = typeof field.FilePlayCanvas === "string" ? field.FilePlayCanvas.trim() : "";
    const format = typeof field.FileFormat === "string" ? field.FileFormat.trim() : "";
    const legacy = typeof field.File === "string" ? field.File.trim() : "";

    if (!playCanvas) missingPlayCanvas.push(fieldId);
    else if (!format) missingFormat.push(fieldId);
    if (!legacy) missingLegacyFile.push(fieldId);
  }

  console.log(`Checked ${fields.length} field(s).`);
  console.log(`  FilePlayCanvas present: ${fields.length - missingPlayCanvas.length}/${fields.length}`);
  console.log(`  FileFormat present:     ${fields.length - missingPlayCanvas.length - missingFormat.length}/${fields.length}`);
  console.log(`  Legacy File present:    ${fields.length - missingLegacyFile.length}/${fields.length}`);

  if (missingPlayCanvas.length > 0) {
    console.error("\nMissing FilePlayCanvas:");
    for (const id of missingPlayCanvas) console.error(`  - ${id}`);
  }

  if (missingFormat.length > 0) {
    console.error("\nMissing FileFormat (has FilePlayCanvas):");
    for (const id of missingFormat) console.error(`  - ${id}`);
  }

  if (missingLegacyFile.length > 0) {
    console.warn("\nMissing legacy File (Three.js editor fallback until Phase 6.2):");
    for (const id of missingLegacyFile) console.warn(`  - ${id}`);
  }

  if (missingPlayCanvas.length > 0 || missingFormat.length > 0) {
    console.error("\nBackfill incomplete — run splat conversion and update DynamoDB before PlayCanvas editor cutover.");
    process.exit(1);
  }

  console.log("\nAll fields have FilePlayCanvas + FileFormat. Ready for PlayCanvas editor migration.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
