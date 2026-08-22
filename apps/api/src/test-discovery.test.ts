import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * A guard on the test runner itself.
 *
 * `src/**` + `/*.test.ts` unquoted is expanded by the shell, and in sh that
 * pattern requires a directory component — so any test written directly in
 * src/ was silently never executed. Four tests sat green-but-unrun until a
 * count that should have gone up did not. A test suite has a shape, and the
 * runner's own invocation is part of that shape.
 *
 * This asserts the globs are quoted so Node does the (recursive) expansion,
 * and that the file count Node would collect matches what is on disk.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(path.join(here, "..", "package.json"), "utf8"),
) as { scripts: Record<string, string> };

function collectTestFiles(dir: string, suffix: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectTestFiles(full, suffix));
    } else if (entry.name.endsWith(suffix)) {
      found.push(full);
    }
  }

  return found;
}

describe("test discovery", () => {
  it("passes its globs to node quoted, not to the shell", () => {
    for (const script of ["test:unit", "test:integration"]) {
      const command = packageJson.scripts[script];
      assert.ok(command, `${script} is missing`);
      assert.match(
        command,
        /"src\/\*\*\/\*[.a-z-]*\.ts"/,
        `${script} must quote its glob so Node expands it recursively: ${command}`,
      );
    }
  });

  it("collects unit tests that live directly in src/, not only in subdirectories", () => {
    const unit = collectTestFiles(here, ".test.ts");
    const topLevel = unit.filter((file) => path.dirname(file) === here);

    // This file is itself one of them, so the count can never legitimately be
    // zero — if it is, discovery has regressed to directories-only again.
    assert.ok(
      topLevel.length > 0,
      "no top-level unit tests found — discovery has regressed",
    );
  });
});
