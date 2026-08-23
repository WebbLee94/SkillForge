import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rootDir = new URL("..", import.meta.url);
const resolveFile = (rel) => fileURLToPath(new URL(rel, rootDir));

const pkgVersion = JSON.parse(readFileSync(resolveFile("package.json"), "utf8")).version;
const tauriVersion = JSON.parse(readFileSync(resolveFile("src-tauri/tauri.conf.json"), "utf8")).version;

const cargoContent = readFileSync(resolveFile("src-tauri/Cargo.toml"), "utf8");
const cargoMatch = cargoContent.match(/^version\s*=\s*"([^"]+)"/m);
const cargoVersion = cargoMatch?.[1] ?? null;

const sources = [
  ["package.json", pkgVersion],
  ["src-tauri/tauri.conf.json", tauriVersion],
  ["src-tauri/Cargo.toml", cargoVersion],
];

const allPresent = sources.every(([, ver]) => typeof ver === "string");
const allEqual = new Set(sources.map(([, ver]) => ver)).size === 1;

if (allPresent && allEqual) {
  console.log(`version check OK: ${pkgVersion}`);
  process.exit(0);
}

console.error("版本不一致，三处版本如下：");
for (const [file, ver] of sources) {
  console.error(`  ${file}: ${ver ?? "<missing>"}`);
}
process.exit(1);
