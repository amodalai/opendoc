# Amodal direct embedding prototype

This fork mounts the real OpenDoc editor inside a host-owned ShadowRoot, without an iframe.
Build the matching web WASM first, then `npm install && npm run build` in this directory.
Serve `dist/` from the host origin; import `native-editor.js` and call
`mountEditor(element, { assetsUrl, signal, theme: 'light' })`.

Each mount evaluates a separate bundled editor graph so module-level state, DOM queries,
listeners and timers belong to that instance. `destroy()` releases them and the WASM document.
The host owns persistence and must flush before locking, changing documents or unmounting.
`exportDocx()` returns bytes and a compatibility report; it does not silently claim a save.
The prototype disables upstream analytics, add-ins, collaboration, local drafts and remote
font fetches. It uses the engine's bundled fonts. Shadow DOM is style isolation, not a security boundary.

Scope: DOCX editing, local host persistence and agent-driven edits. PDF import, collaboration,
third-party add-ins, and unrestricted standalone editor actions are not prototype features.
