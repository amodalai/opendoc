// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("packed package exposes its matching editor assets and a working ESM document engine", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opendoc-package-"));
  try {
    const [{ filename, files }] = JSON.parse(execFileSync("npm", [
      "pack", "--json", "--cache", path.join(directory, "cache"), "--pack-destination", directory,
    ], { cwd: here, encoding: "utf8" }));
    for (const name of [
      "index.mjs", "index.d.mts", "LICENSE", "NOTICE", "dist/LICENSE", "dist/NOTICE",
      "dist/native-editor.js", "dist/native-editor.css", "dist/scope.mjs",
      "dist/pkg/casual_doc_wasm.js", "dist/pkg/casual_doc_wasm_bg.wasm", "dist/pkg/package.json",
      "dist/locales/en.json", "dist/licenses/LICENSE-ECMA-376.txt",
      "dist/licenses/engine-fonts/OFL-1.1-Carlito.txt",
    ]) assert.ok(files.some(f => f.path === name), `tarball must contain ${name}`);
    if (process.env.OPENDOC_ALLOW_MISSING_PDF !== "1") {
      for (const name of ["casual_doc_wasm_pdf.js", "casual_doc_wasm_pdf_bg.wasm", "package.json"])
        assert.ok(files.some(f => f.path === `dist/pkg-pdf/${name}`), `tarball must contain the PDF reader: ${name}`);
    }
    assert.ok(!files.some(f => /(?:^|\/)(?:node_modules|target|tests)(?:\/|$)/.test(f.path)));
    execFileSync("tar", ["-xzf", path.join(directory, filename), "-C", directory]);
    const packed = path.join(directory, "package");
    const manifest = JSON.parse(await readFile(path.join(packed, "package.json")));
    assert.equal(manifest.private, undefined);
    assert.equal(manifest.name, "@amodalai/opendoc");
    assert.equal(manifest.exports["./editor"], "./dist/native-editor.js");
    const api = await import(pathToFileURL(path.join(packed, manifest.exports["."].import)));
    assert.equal(await realpath(api.assetsDirectory), await realpath(path.join(packed, "dist")));
    assert.equal(await realpath(api.engineDirectory), await realpath(path.join(packed, "dist/pkg")));
    for (const name of ["LICENSE", "NOTICE"])
      assert.deepEqual(await readFile(path.join(packed, name)), await readFile(path.join(here, "../..", name)));
    const wasm = await readFile(path.join(api.engineDirectory, "casual_doc_wasm_bg.wasm"));
    assert.deepEqual(wasm, await readFile(path.join(here, "dist/pkg/casual_doc_wasm_bg.wasm")));
    const engine = await import(pathToFileURL(api.engineFile));
    await engine.default({ module_or_path: wasm });
    const document = engine.openAs(new TextEncoder().encode("# Package smoke test\n\nEditable document content."), "text.markdown");
    try {
      assert.ok(document.pageCount >= 1);
      const read = JSON.parse(document.aiRead(JSON.stringify({ tool: "read", maxTokens: 1000 }), "read"));
      assert.equal(read.ok, true);
      assert.match(JSON.stringify(read.value), /Editable document content/);
      const artifact = document.exportAs("org.openxmlformats.wordprocessingml.document", "preserve_when_safe");
      try {
        assert.equal(Buffer.from(artifact.bytes).readUInt32LE(), 0x04034b50);
        const reopened = engine.openAs(artifact.bytes, "org.openxmlformats.wordprocessingml.document");
        try { assert.equal(reopened.pageCount, document.pageCount); } finally { reopened.free(); }
      } finally { artifact.free(); }
    } finally { document.free(); }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Amodal release checks the packed package before publishing to the Amodal scope", async () => {
  const workflow = await readFile(path.join(here, "../../.github/workflows/release-amodal-npm.yml"), "utf8");
  assert.match(workflow, /tags: \['amodal-npm-v\*'\]/);
  assert.match(workflow, /scope: '@amodalai'/);
  assert.match(workflow, /node --test scope.test.mjs package.test.mjs/);
  assert.match(workflow, /NODE_AUTH_TOKEN: \$\{\{ secrets.NPM_TOKEN \}\}/);
  assert.ok(workflow.indexOf("package.test.mjs") < workflow.indexOf("run: npm publish"));
});
