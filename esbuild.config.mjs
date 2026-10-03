import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/*
Atlas VTT MCP Bridge - generated/bundled by esbuild.
Source lives in src/. Provenance and history: see CHANGELOG.md.
*/
`;

const production = process.argv[2] === "production" ? true : false;

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2018",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: false,
  logLevel: production ? "warning" : "info",
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
