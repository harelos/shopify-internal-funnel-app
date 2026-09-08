import { mkdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { build } from "esbuild";

const sourcePath = resolve("src/worker.ts");
const outputPath = resolve("dist/worker/worker.js");
const source = await readFile(sourcePath, "utf8");
await mkdir(dirname(outputPath), { recursive: true });

// The managed Windows workspace denies native binaries permission to scan
// parent directories. Load this dependency-free Worker graph through Node's
// permitted filesystem API so esbuild never traverses outside the project.
const localSourcePlugin = {
  name: "local-source-loader",
  setup(builder) {
    builder.onResolve({ filter: /^\./ }, (args) => {
      const unresolved = resolve(args.resolveDir, args.path);
      return {
        path: extname(unresolved) ? unresolved : `${unresolved}.ts`,
        namespace: "local-source",
      };
    });
    builder.onLoad({ filter: /.*/, namespace: "local-source" }, async (args) => {
      const extension = extname(args.path).toLowerCase();
      const loader = extension === ".json" ? "json" : extension === ".tsx" ? "tsx" : "ts";
      return {
        contents: await readFile(args.path, "utf8"),
        loader,
        resolveDir: dirname(args.path),
      };
    });
  },
};

await build({
  stdin: {
    contents: source,
    loader: "ts",
    resolveDir: dirname(sourcePath),
    sourcefile: "worker.ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: outputPath,
  logLevel: "info",
  plugins: [localSourcePlugin],
});
