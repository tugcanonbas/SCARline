import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "tailwindcss";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const widgetsDir = path.join(repoRoot, "widgets");
const sourceFile = path.join(widgetsDir, "tailwind-source.css");
const outputFile = path.join(widgetsDir, "dist.css");
const require = createRequire(import.meta.url);
const tailwindEntry = require.resolve("tailwindcss/index.css");
const checkOnly = process.argv.includes("--check");

function resolveBaseUrl(filePath) {
  return pathToFileURL(`${path.dirname(filePath)}/`).toString();
}

async function loadStylesheet(id, base) {
  if (id === "tailwindcss") {
    return {
      path: tailwindEntry,
      base: resolveBaseUrl(tailwindEntry),
      content: await fs.readFile(tailwindEntry, "utf8"),
    };
  }

  const resolved = fileURLToPath(new URL(id, base));
  return {
    path: resolved,
    base: resolveBaseUrl(resolved),
    content: await fs.readFile(resolved, "utf8"),
  };
}

async function collectSourceFiles(directory, files = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(fullPath, files);
      continue;
    }
    if (/\.(html|js)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractCandidates(content) {
  const candidates = new Set();
  const patterns = [
    /class\s*=\s*"([^"]+)"/gu,
    /data-bind-class\s*=\s*"([^"]+)"/gu,
    /data-bind-class-false\s*=\s*"([^"]+)"/gu,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      for (const token of match[1].split(/\s+/u).filter(Boolean)) {
        candidates.add(token);
      }
    }
  }

  return candidates;
}

const source = await fs.readFile(sourceFile, "utf8");
const compiler = await compile(source, {
  base: resolveBaseUrl(sourceFile),
  loadStylesheet,
});
const widgetFiles = await collectSourceFiles(widgetsDir);
const candidates = new Set();
for (const file of widgetFiles) {
  const content = await fs.readFile(file, "utf8");
  for (const candidate of extractCandidates(content)) {
    candidates.add(candidate);
  }
}
const output = `${compiler.build([...candidates]).trim()}\n`;

if (checkOnly) {
  const existing = await fs.readFile(outputFile, "utf8").catch(() => null);
  if (existing !== output) {
    console.error(
      "widgets/dist.css is out of date. Run `npm run widgets:build-css`.",
    );
    process.exitCode = 1;
  }
} else {
  await fs.writeFile(outputFile, output, "utf8");
}
