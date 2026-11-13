import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createScope } from "./scope.mjs";

test("two mounts isolate IDs, globals and shortcuts, and release their resources", async () => {
  const dom = new JSDOM(
    '<div id="host-a"></div><div id="host-b"></div><input id="editorTextInput">',
    { url: "http://localhost/", pretendToBeVisual: true },
  );
  const view = dom.window;
  view.CSS = { escape: (value) => String(value) };
  const fonts = new Set();
  Object.defineProperty(view.document, "fonts", {
    value: {
      ready: Promise.resolve(),
      add: (f) => fonts.add(f),
      delete: (f) => fonts.delete(f),
      check: () => true,
      load: async () => [],
    },
  });
  view.FontFace = class {
    async load() {
      return this;
    }
  };
  view.Worker = class extends view.EventTarget {
    terminate() {
      this.terminated = true;
    }
  };
  view.ResizeObserver = view.MutationObserver = class {
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  };
  const requests = [];
  const options = () => ({
    assetsUrl: "http://localhost/opendoc/",
    signal: new AbortController().signal,
    fetch: async (url) => {
      requests.push(String(url));
      return new Response("ok");
    },
  });
  const a = createScope(
    view.document.querySelector("#host-a"),
    options(),
    '<input id="editorTextInput">',
  );
  const b = createScope(
    view.document.querySelector("#host-b"),
    options(),
    '<input id="editorTextInput">',
  );
  for (const host of ["host-a", "host-b"])
    view.document
      .getElementById(host)
      .shadowRoot.querySelector("link")
      .dispatchEvent(new view.Event("load"));
  await Promise.all([a.ready, b.ready]);
  assert.equal(fonts.size, 6);
  assert.notEqual(
    a.globals.document.getElementById("editorTextInput"),
    b.globals.document.getElementById("editorTextInput"),
  );
  a.globals.window.opendoc = { id: "a" };
  assert.equal(b.globals.window.opendoc, undefined);
  assert.equal(view.opendoc, undefined);
  a.globals.localStorage.setItem("test", "a");
  assert.equal(b.globals.localStorage.getItem("test"), null);
  let keysA = 0,
    keysB = 0,
    hostKeys = 0;
  a.globals.document.addEventListener("keydown", () => keysA++);
  b.globals.document.addEventListener("keydown", () => keysB++);
  view.document.addEventListener("keydown", () => hostKeys++);
  const input = a.globals.document.getElementById("editorTextInput");
  input.dispatchEvent(
    new view.KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      composed: true,
    }),
  );
  assert.deepEqual([keysA, keysB, hostKeys], [1, 0, 0]);
  await assert.rejects(
    a.globals.fetch("https://third-party.test/font"),
    /External/,
  );
  await a.globals.fetch("dict/en-US.txt");
  assert.deepEqual(requests, ["http://localhost/opendoc/dict/en-US.txt"]);
  const worker = new a.globals.Worker(
    "http://localhost/opendoc/src/proof_worker.js",
  );
  const observer = new a.globals.ResizeObserver(() => {});
  let ticked = false;
  a.globals.setTimeout(() => {
    ticked = true;
  }, 0);
  a.destroy();
  a.destroy();
  await new Promise((resolve) => setTimeout(resolve, 10));
  input.dispatchEvent(new view.KeyboardEvent("keydown", { bubbles: true }));
  assert.equal(keysA, 1);
  assert.equal(ticked, false);
  assert.equal(worker.terminated, true);
  assert.equal(observer.disconnected, true);
  assert.equal(fonts.size, 3);
  assert.equal(
    view.document.getElementById("host-a").shadowRoot.childElementCount,
    0,
  );
  assert.equal(
    b.globals.document.getElementById("editorTextInput").isConnected,
    true,
  );
  b.destroy();
  assert.equal(fonts.size, 0);
  dom.window.close();
});

test("built editor scopes selectors without damaging class names and has no analytics or iframe", async () => {
  const css = await readFile(
    new URL("dist/native-editor.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.opendoc-html\s*\{/);
  assert.doesNotMatch(css, /opendoc-\.opendoc/);
  assert.doesNotMatch(css, /modal-\.opendoc/);
  const source = await readFile(
    new URL("dist/native-editor.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /<iframe|googletagmanager\.com|google-analytics\.com/,
  );
  assert.match(source, /src\/spell_check\.mjs/);
});
