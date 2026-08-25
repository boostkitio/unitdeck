import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const run = promisify(execFile);

/**
 * The check that was missing.
 *
 * pdfjs takes DOMMatrix from `@napi-rs/canvas` when it runs under Node, and
 * builds `new DOMMatrix()` at the top of its module — so without that package
 * the import throws "DOMMatrix is not defined" before a single PDF is read.
 * It was installed here as an optional dependency of pdfjs and missing from
 * the deployed function, so every PDF failed in production while every test
 * passed locally.
 *
 * The test environment is not Node, so asserting this inside it proves
 * nothing. This runs a real Node process, which is what the server is.
 */
test("pdfjs loads in a plain Node process, as it does on the server", async () => {
  const script = `
    const before = typeof globalThis.DOMMatrix;
    await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (typeof globalThis.DOMMatrix !== "function") {
      throw new Error("DOMMatrix was not polyfilled (was " + before + ")");
    }
    console.log("ok");
  `;
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
  });
  expect(stdout.trim()).toBe("ok");
}, 30_000);
