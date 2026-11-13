// SPDX-License-Identifier: Apache-2.0
import { readFile, mkdir, cp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const web = path.join(repo, "webapp");
const dist = path.join(here, "dist");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
await mkdir(dist, { recursive: true });
for (const directory of [
  "src",
  "pkg",
  "assets",
  "locales",
  "generated",
  "dict",
])
  await cp(path.join(web, directory), path.join(dist, directory), {
    recursive: true,
  });
for (const name of ["LICENSE", "NOTICE"])
  await cp(path.join(repo, name), path.join(dist, name));
const html = await readFile(path.join(web, "editor.html"), "utf8");
const markup = html
  .match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1]
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const bundled = await build({
  plugins: [
    {
      name: "instance-module-urls",
      setup(build) {
        build.onLoad({ filter: /\.m?js$/ }, async ({ path: sourcePath }) => ({
          contents: (await readFile(sourcePath, "utf8")).replaceAll(
            "import.meta.url",
            `new URL(${JSON.stringify(path.relative(web, sourcePath).split(path.sep).join("/"))}, __assetsUrl).href`,
          ),
          loader: "js",
        }));
      },
    },
  ],
  entryPoints: [path.join(here, "entry.mjs")],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "NativeOpenDoc",
  target: "es2022",
});
await cp(path.join(here, "scope.mjs"), path.join(dist, "scope.mjs"));
const source = `import { createScope } from './scope.mjs';
export async function mountEditor(host, options) {
 const scope = createScope(host, options, ${JSON.stringify(markup)});
 let editor;
 try {
  await scope.ready;
  const __assetsUrl = options.assetsUrl;
  const { document, window, globalThis, Worker, URL, ResizeObserver, MutationObserver,
   localStorage, sessionStorage, indexedDB, location, history, getSelection, fetch,
   setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame } = scope.globals;
  ${bundled.outputFiles[0].text}
  editor = NativeOpenDoc.nativeEditorController();
  await editor.ready;
  options.signal.throwIfAborted();
  return { ...editor, root: scope.root, destroy() { scope.destroy(); editor.destroy(); } };
 } catch (error) { scope.destroy(); editor?.destroy(); throw error; }
}`;
await writeFile(path.join(dist, "native-editor.js"), source);
let css = "";
for (const name of [
  "fonts.css",
  "style.css",
  "brand.css",
  "font_advanced.css",
]) {
  const text = await readFile(path.join(web, "src", name), "utf8");
  css += text
    .replaceAll(":root", ".opendoc-html")
    .replace(/(?<![\w-])html(?=[\s.#:[{>,])/g, ".opendoc-html")
    .replace(/(?<![\w-])body(?=[\s.#:[{>,])/g, ".opendoc-body")
    .replace(/url\((['"]?)\.\.\//g, "url($1./");
}
css +=
  "\n:host{display:block;height:100%;min-height:500px}.opendoc-html,.opendoc-body{height:100%;min-height:0;width:100%;margin:0}.opendoc-html{position:relative;isolation:isolate}.opendoc-body{font-family:Inter,system-ui,sans-serif}";
await writeFile(path.join(dist, "native-editor.css"), css);
console.log("Built direct OpenDoc editor:", dist);
