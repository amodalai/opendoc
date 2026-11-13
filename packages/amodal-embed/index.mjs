// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from "node:url";

// File paths only: importing the package never boots the editor or WASM.
export const assetsDirectory = fileURLToPath(new URL("./dist/", import.meta.url));
export const engineDirectory = fileURLToPath(new URL("./dist/pkg/", import.meta.url));
export const engineFile = fileURLToPath(new URL("./dist/pkg/casual_doc_wasm.js", import.meta.url));
