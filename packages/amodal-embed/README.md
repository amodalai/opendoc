# Amodal direct document embedding

This fork mounts the real OpenDoc editor inside a host-owned ShadowRoot, without an iframe.
Build the matching web WASM first, then `npm install && npm run build` in this directory.
Serve `dist/` from the host origin; import `native-editor.js` and call
`mountEditor(element, { assetsUrl, signal, theme: 'light' })`.

Each mount evaluates a separate bundled editor graph so module-level state, DOM queries,
listeners and timers belong to that instance. `destroy()` releases them and the WASM document.
Host size changes notify only that instance's resize listeners, keeping fit-to-width and editor controls responsive when a surrounding split pane is dragged.
The host owns persistence and must flush before locking, changing documents or unmounting.
`exportDocx()` returns bytes and a compatibility report; it does not silently claim a save.
The embedded editor disables upstream analytics, add-ins, collaboration, local drafts and remote
font fetches. It uses the engine's bundled fonts. Shadow DOM is style isolation, not a security boundary.

Scope: DOCX editing, local host persistence and agent-driven edits. PDF import, collaboration,
third-party add-ins, and unrestricted standalone editor actions are not supported features.

## Package contract

`@amodalai/opendoc` exports absolute filesystem paths from its Node-safe root:
`assetsDirectory` points to `dist/`, `engineDirectory` points to `dist/pkg/`, and
`engineFile` points to the ESM `casual_doc_wasm.js` loader. Importing the root does not
initialize WASM or require a browser DOM. Serve `assetsDirectory` from the host origin;
load `native-editor.js` from that location, or use the separate
`@amodalai/opendoc/editor` entry. The matching WASM, fonts, dictionaries, locale files,
and license notices ship together. The runtime host owns storage, authentication,
network policy, and session isolation; this package supplies none of those services.

The package builder clears `dist/` first so incremental builds cannot retain old assets.
`npm run test:package` packs and unpacks the real tarball, imports its Node entry,
opens Markdown using its WASM engine, exports DOCX and reopens the result. The scoped
editor lifecycle tests remain `node --test scope.test.mjs`.

## Amodal release

`.github/workflows/release-amodal-npm.yml` builds the engine from the checked-out source,
builds the embedded editor, and runs both tests before publishing. A tag
`amodal-npm-v<version>` must match this package's version. Manual dispatch defaults to a
dry run; a real release requires disabling that input. Set the npm publishing token in
the fork's **release** environment as **NPM_TOKEN**, with write access to
`@amodalai/opendoc`. It is supplied only to the publishing step as `NODE_AUTH_TOKEN`.
The upstream `npm-publish.yml` continues to own the `@casualoffice` packages.

The initial Amodal package is prepared for publication; being packed locally does not
mean it has been published to npm. A consumer should pin the registry version after the
release succeeds; local file paths are only for development verification.

A full release includes both `webapp/pkg` (document engine) and `webapp/pkg-pdf`
(lazy PDF reader), built from the same checkout. For local DOCX integration only,
`OPENDOC_ALLOW_MISSING_PDF=1` permits building/testing with a prebuilt main engine
when the PDF reader is absent. That development tarball must not be published;
the release workflow always builds and checks both modules without this override.
