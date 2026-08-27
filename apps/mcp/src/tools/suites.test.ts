import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SUITES, isSuiteName, tail } from "./suites.js";

describe("suite allowlist", () => {
  it("accepts only known suite names", () => {
    assert.equal(isSuiteName("api-unit"), true);
    assert.equal(isSuiteName("production-smoke"), true);
    assert.equal(isSuiteName("rm -rf /"), false);
    assert.equal(isSuiteName("api-unit; curl evil.example"), false);
  });

  it("does not inherit object prototype keys as suite names", () => {
    // `"constructor" in SUITES` is true for a plain object, so a membership
    // check written with `in` would happily accept it as a suite name.
    assert.equal(isSuiteName("constructor"), false);
    assert.equal(isSuiteName("toString"), false);
    assert.equal(isSuiteName("__proto__"), false);
  });

  it("never spawns through a shell", () => {
    // The allowlist is only a boundary if nothing re-parses the command, so no
    // definition may smuggle shell metacharacters into its arguments.
    for (const [name, definition] of Object.entries(SUITES)) {
      const parts = [definition.command, ...definition.args];

      for (const part of parts) {
        assert.ok(
          !/[;&|`$><]/.test(part),
          `${name} has a shell metacharacter in "${part}"`,
        );
      }
    }
  });

  it("flags exactly the suites that reach production", () => {
    assert.equal(SUITES["production-smoke"].touchesProduction, true);
    assert.equal(SUITES["api-unit"].touchesProduction, false);

    const flagged = Object.entries(SUITES)
      .filter(([, definition]) => definition.touchesProduction)
      .map(([name]) => name);

    assert.deepEqual(flagged, ["production-smoke"]);
  });
});

describe("tail", () => {
  it("returns short output unchanged", () => {
    assert.equal(tail("all passed", 100), "all passed");
  });

  it("keeps the end of long output, where the totals are", () => {
    const output = `${"x".repeat(500)}\n7 passing, 1 failing`;
    const trimmed = tail(output, 40);

    assert.ok(trimmed.endsWith("7 passing, 1 failing"));
    assert.match(trimmed, /earlier characters omitted/);
  });
});
