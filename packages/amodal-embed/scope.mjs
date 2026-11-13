/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */
// The maintained editor runs against an instance-local document/window surface.
// This is DOM/style isolation, not a security boundary.
export function createScope(host, options, markup) {
  const page = host.ownerDocument;
  const view = page.defaultView;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const root = page.createElement("div");
  root.className = "opendoc-body compact-mode";
  const html = page.createElement("div");
  html.className = "opendoc-html engine-pending";
  html.dataset.chrome = "compact";
  html.dataset.theme = options.theme ?? "light";
  html.append(root);
  if (options.theme) root.dataset.theme = options.theme;
  root.innerHTML = markup;
  const stylesheet = page.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new view.URL("native-editor.css", options.assetsUrl).href;
  const cleanups = new Set();
  const timers = new Set();
  const intervals = new Set();
  const frames = new Set();
  const blobs = new Set();
  const controller = new AbortController();
  let disposed = false;
  const signal = AbortSignal.any([controller.signal, options.signal]);
  const ready = new Promise((resolve, reject) => {
    stylesheet.onload = resolve;
    stylesheet.onerror = () =>
      reject(new Error("Could not load document styles."));
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
  // Native editor shortcuts cannot also trigger the surrounding chat shortcuts.
  for (const type of ["keydown", "keyup", "keypress", "paste", "cut", "copy"]) {
    const stop = (event) => event.stopPropagation();
    shadow.addEventListener(type, stop);
    cleanups.add(() => shadow.removeEventListener(type, stop));
  }
  shadow.replaceChildren(stylesheet, html);
  // Font-face rules inside a shadow tree are not registered by every browser.
  // Explicit faces are owned by this mount and removed with it.
  const fontReady = Promise.all(
    [
      ["Inter", "inter-latin-400-700.woff2", "400 700"],
      ["Material Symbols Outlined", "material-symbols-outlined.woff2", "400"],
      ["Instrument Sans", "instrument-sans.woff2", "400 700"],
    ].map(async ([family, file, weight]) => {
      const face = new view.FontFace(
        family,
        `url("${new view.URL("assets/fonts/" + file, options.assetsUrl)}")`,
        { weight },
      );
      await face.load();
      if (!disposed) {
        page.fonts.add(face);
        cleanups.add(() => page.fonts.delete(face));
      }
    }),
  );
  const listeners = new Map();
  const resizeListeners = new Set();
  function listen(target, type, callback, settings) {
    if (disposed) return;
    const handler = (event) => {
      if (disposed) return;
      if (typeof callback === "function") callback(event);
      else callback.handleEvent(event);
    };
    target.addEventListener(type, handler, settings);
    if (type === "resize") resizeListeners.add(handler);
    const remove = () => {
      target.removeEventListener(type, handler, settings);
      resizeListeners.delete(handler);
    };
    cleanups.add(remove);
    const key = callback;
    const records = listeners.get(key) ?? [];
    records.push({ target, type, settings, remove });
    listeners.set(key, records);
  }
  function unlisten(target, type, callback, settings) {
    for (const record of listeners.get(callback) ?? []) {
      if (
        record.target === target &&
        record.type === type &&
        (typeof record.settings === "boolean"
          ? record.settings
          : !!record.settings?.capture) ===
          (typeof settings === "boolean" ? settings : !!settings?.capture)
      ) {
        record.remove();
        cleanups.delete(record.remove);
      }
    }
  }
  const globalEvents = new Set([
    "resize",
    "beforeunload",
    "afterprint",
    "visibilitychange",
    "fullscreenchange",
    "pagehide",
  ]);
  const eventTarget = (type) =>
    globalEvents.has(type)
      ? type === "visibilitychange" || type === "fullscreenchange"
        ? page
        : view
      : root;
  const doc = new Proxy(page, {
    get(target, key) {
      if (key === "body") return root;
      if (key === "documentElement" || key === "head") return html;
      if (key === "defaultView") return win;
      if (key === "activeElement") return shadow.activeElement ?? root;
      if (key === "title") return "";
      if (key === "fonts")
        return {
          ready: page.fonts.ready,
          check: page.fonts.check.bind(page.fonts),
          load: page.fonts.load.bind(page.fonts),
          add(face) {
            if (disposed) return;
            page.fonts.add(face);
            cleanups.add(() => page.fonts.delete(face));
          },
        };
      if (key === "getElementById")
        return (id) => root.querySelector("#" + view.CSS.escape(id));
      if (
        key === "querySelector" ||
        key === "querySelectorAll" ||
        key === "contains"
      )
        return root[key].bind(root);
      if (key === "elementFromPoint")
        return shadow.elementFromPoint?.bind(shadow) ?? (() => null);
      if (key === "addEventListener")
        return (type, fn, opts) => listen(eventTarget(type), type, fn, opts);
      if (key === "removeEventListener")
        return (type, fn, opts) => unlisten(eventTarget(type), type, fn, opts);
      if (key === "dispatchEvent") return root.dispatchEvent.bind(root);
      if (key === "fullscreenElement") return shadow.fullscreenElement;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(_target, key, value) {
      if (key === "title") root.setAttribute("aria-label", value);
      return true;
    },
  });
  const ownGlobals = { crypto: view.crypto, __opendocBuild: "amodal" };
  const win = new Proxy(ownGlobals, {
    get(target, key) {
      if (key === "document") return doc;
      if (
        key === "self" ||
        key === "top" ||
        key === "window" ||
        key === "globalThis"
      )
        return win;
      if (key === "innerWidth") return host.clientWidth;
      if (key === "innerHeight") return host.clientHeight;
      if (key === "addEventListener")
        return (type, fn, opts) => listen(eventTarget(type), type, fn, opts);
      if (key === "removeEventListener")
        return (type, fn, opts) => unlisten(eventTarget(type), type, fn, opts);
      if (key === "dispatchEvent")
        return (event) => eventTarget(event.type).dispatchEvent(event);
      if (key === "parent") return win;
      if (Object.hasOwn(target, key)) return target[key];
      const value = Reflect.get(view, key, view);
      return typeof value === "function" ? value.bind(view) : value;
    },
  });
  class ScopedWorker extends view.Worker {
    constructor(...args) {
      super(...args);
      if (disposed) {
        this.terminate();
        return;
      }
      const terminate = () => {
        this.dispatchEvent(new view.Event("error", { cancelable: true }));
        this.terminate();
      };
      cleanups.add(terminate);
    }
  }
  const observer = (Base) =>
    class extends Base {
      constructor(fn) {
        super((...args) => {
          if (!disposed) fn(...args);
        });
        if (disposed) this.disconnect();
        else cleanups.add(() => this.disconnect());
      }
    };
  class ScopedURL extends view.URL {
    static createObjectURL(blob) {
      const url = view.URL.createObjectURL(blob);
      blobs.add(url);
      return url;
    }
    static revokeObjectURL(url) {
      blobs.delete(url);
      view.URL.revokeObjectURL(url);
    }
  }
  const storage = new Map([
    ["opendoc.chromeMode", "compact"],
    ["opendoc.settings", JSON.stringify({ theme: options.theme ?? "light" })],
  ]);
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const globals = {
    document: doc,
    window: win,
    globalThis: win,
    Worker: ScopedWorker,
    URL: ScopedURL,
    ResizeObserver: observer(view.ResizeObserver),
    MutationObserver: observer(view.MutationObserver),
    localStorage,
    sessionStorage: localStorage,
    // Host-owned history and persistence; native history must not leak between decks.
    indexedDB: undefined,
    location: new view.URL(
      "editor.html?blank=1&mode=edit&autosave=0&can=-print&chrome=-brand,-state&ai=direct&plugins=none&aiProvider=off",
      options.assetsUrl,
    ),
    history: { replaceState() {} },
    getSelection: () => shadow.getSelection?.() ?? view.getSelection(),
    fetch: (input, init = {}) => {
      const url = new view.URL(
        typeof input === "string" ? input : (input.url ?? String(input)),
        options.assetsUrl,
      );
      if (url.origin !== view.location.origin)
        return Promise.reject(
          new Error("External editor resources are disabled"),
        );
      return (options.fetch ?? view.fetch.bind(view))(url, {
        ...init,
        signal: AbortSignal.any([
          signal,
          ...(init.signal ? [init.signal] : []),
        ]),
      });
    },
    setTimeout: (fn, ms, ...args) => {
      if (disposed) return 0;
      const id = view.setTimeout(() => {
        timers.delete(id);
        if (!disposed) fn(...args);
      }, ms);
      timers.add(id);
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
      view.clearTimeout(id);
    },
    setInterval: (fn, ms, ...args) => {
      if (disposed) return 0;
      const id = view.setInterval(() => {
        if (!disposed) fn(...args);
      }, ms);
      intervals.add(id);
      return id;
    },
    clearInterval: (id) => {
      intervals.delete(id);
      view.clearInterval(id);
    },
    requestAnimationFrame: (fn) => {
      if (disposed) return 0;
      const id = view.requestAnimationFrame((time) => {
        frames.delete(id);
        if (!disposed) fn(time);
      });
      frames.add(id);
      return id;
    },
    cancelAnimationFrame: (id) => {
      frames.delete(id);
      view.cancelAnimationFrame(id);
    },
  };
  Object.assign(ownGlobals, globals);
  // A split pane changes size without resizing the browser window. Notify only
  // this editor so fit-to-width and responsive chrome follow its host bounds.
  const hostResize = new view.ResizeObserver(() => {
    if (disposed) return;
    for (const handler of resizeListeners) handler(new view.Event("resize"));
  });
  hostResize.observe(host);
  cleanups.add(() => hostResize.disconnect());
  function destroy() {
    if (disposed) return;
    disposed = true;
    controller.abort(new Error("Document editor closed"));
    for (const cleanup of cleanups) cleanup();
    for (const id of timers) view.clearTimeout(id);
    for (const id of intervals) view.clearInterval(id);
    for (const id of frames) view.cancelAnimationFrame(id);
    for (const url of blobs) view.URL.revokeObjectURL(url);
    cleanups.clear();
    listeners.clear();
    timers.clear();
    intervals.clear();
    frames.clear();
    blobs.clear();
    if (shadow.contains(html)) shadow.replaceChildren();
  }
  options.signal.addEventListener("abort", destroy, { once: true });
  cleanups.add(() => options.signal.removeEventListener("abort", destroy));
  if (options.signal.aborted) destroy();
  return { globals, ready: Promise.all([ready, fontReady]), destroy, root };
}
