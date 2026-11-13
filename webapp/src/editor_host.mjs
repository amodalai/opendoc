// SPDX-License-Identifier: Apache-2.0
// Host transports share the command/session contract. The direct mount adds
// explicit open/export/lifecycle operations while the host owns persistence.
import { openAs } from "../pkg/casual_doc_wasm.js";
import { createHostSession } from "./host_session.mjs";
import { createAssistant } from "./ai_assistant.mjs";
import { t } from "./i18n.mjs";

export function createEditorHost(ed) {
  return createHostSession({
    capabilities: ed.HOST_CAPS,
    registry: () => ed.editorCommands({ surface: "palette" }),
    withheldMessage: () => t("capability.notGranted"),
    revision: () => (ed.revisionUnreadable ? null : ed.currentRevision),
    dirty: () => ed.documentIsDirty(),
    selection: () =>
      ed.selection
        ? {
            anchor: { ...ed.selection.anchor },
            focus: { ...ed.selection.focus },
            hasRange: ed.hasRange(),
          }
        : null,
    document: () => ({ name: ed.currentName, format: ed.currentSourceFormat }),
    ai: createAssistant(ed, {
      onDecision: (detail) => ed.hostSession?.noteAiDecision(detail),
    }),
  });
}

export function createNativeEditorController(ed, ready) {
  return {
    ready,
    session: ed.hostSession,
    async open(bytes, name = "Document.docx") {
      await ready;
      await ed.openBytes(bytes, name, undefined, undefined, {
        throwOnError: true,
        prepare: () => ({
          doc: openAs(bytes, "org.openxmlformats.wordprocessingml.document"),
        }),
      });
      ed.setZoomMode("fit-width", false);
    },
    exportDocx() {
      if (!ed.doc) throw new Error("No document is open");
      let artifact;
      try {
        artifact = ed.doc.exportAs(
          "org.openxmlformats.wordprocessingml.document",
          "exact_if_unchanged",
        );
      } catch {
        artifact = ed.doc.exportAs(
          "org.openxmlformats.wordprocessingml.document",
          "preserve_when_safe",
        );
      }
      try {
        return {
          bytes: new Uint8Array(artifact.bytes),
          report: artifact.reportJson,
        };
      } finally {
        artifact.free();
      }
    },
    revision: () => ed.currentRevision,
    name: () => ed.currentName,
    markSaved: () => ed.markDocumentSaved(),
    destroy() {
      ed.doc?.free();
      ed.doc = null;
    },
  };
}
