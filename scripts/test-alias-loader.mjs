// Resolves this project's `@/` path alias (tsconfig.json `paths`) AND
// TypeScript's extensionless relative imports (`./provider`, `../foo`)
// for Node's built-in test runner — so focused unit tests can `import`
// real source files exactly the way app code does, with zero extra
// dependencies (no ts-node, no bundler, no test framework).
//
// Usage: node --experimental-strip-types --experimental-loader ./scripts/test-alias-loader.mjs --test <files>
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";

const projectRoot = path.resolve(import.meta.dirname, "..");

/** Appends a TS extension, or resolves to an index file, if `candidate` needs it. */
function withTsResolution(candidate) {
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  if (fs.existsSync(candidate + ".ts")) return candidate + ".ts";
  if (fs.existsSync(candidate + ".tsx")) return candidate + ".tsx";
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    if (fs.existsSync(path.join(candidate, "index.ts"))) return path.join(candidate, "index.ts");
    if (fs.existsSync(path.join(candidate, "index.tsx"))) return path.join(candidate, "index.tsx");
  }
  return candidate;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const candidate = path.join(projectRoot, specifier.slice(2));
    return nextResolve(pathToFileURL(withTsResolution(candidate)).href, context);
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const candidate = path.resolve(parentDir, specifier);
    return nextResolve(pathToFileURL(withTsResolution(candidate)).href, context);
  }

  return nextResolve(specifier, context);
}
