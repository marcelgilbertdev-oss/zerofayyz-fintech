import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildApp } from "./app.js";
import type { Database } from "./database/database.js";

/**
 * Request correlation.
 *
 * With a shared demo account and concurrent reviewers, "the request that
 * failed" is not identifiable from a timestamp. These pin the two halves that
 * make an id useful: it reaches the caller, and a caller-supplied one is
 * honoured but never trusted blindly.
 */

function databaseStub(): Database {
  return {
    async checkHealth() {
      return { operational: true, latencyMs: 1, name: "test" };
    },
    async query() {
      throw new Error("unexpected query");
    },
    async close() {},
  };
}

describe("request correlation", () => {
  it("returns a request id the caller can quote back", async (t) => {
    const app = buildApp({ database: databaseStub(), logger: false });
    t.after(async () => app.close());

    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    const id = response.headers["x-request-id"];
    assert.equal(typeof id, "string");
    assert.ok((id as string).length >= 8, `id too short: ${id}`);
  });

  it("gives different requests different ids", async (t) => {
    const app = buildApp({ database: databaseStub(), logger: false });
    t.after(async () => app.close());

    const first = await app.inject({ method: "GET", url: "/api/v1/health" });
    const second = await app.inject({ method: "GET", url: "/api/v1/health" });

    assert.notEqual(first.headers["x-request-id"], second.headers["x-request-id"]);
  });

  it("continues an upstream trace when the id is well-formed", async (t) => {
    const app = buildApp({ database: databaseStub(), logger: false });
    t.after(async () => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { "x-request-id": "edge-7f3a91c4-2b" },
    });

    assert.equal(response.headers["x-request-id"], "edge-7f3a91c4-2b");
  });

  it("refuses a caller-supplied id that could poison a log line or a header", async (t) => {
    const app = buildApp({ database: databaseStub(), logger: false });
    t.after(async () => app.close());

    // This value is echoed into a response header and written to logs. Newlines
    // are header splitting; unbounded length is a log-flooding lever; quotes and
    // braces corrupt the JSON a log query depends on. All must be replaced by a
    // generated id rather than reflected.
    for (const hostile of [
      "abc\r\nX-Injected: yes",
      "x".repeat(500),
      'id","level":"fatal',
      "short",
      "with spaces here",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/health",
        headers: { "x-request-id": hostile },
      });

      assert.notEqual(
        response.headers["x-request-id"],
        hostile,
        `reflected a hostile request id: ${JSON.stringify(hostile)}`,
      );
      assert.match(String(response.headers["x-request-id"]), /^[A-Za-z0-9-]{8,128}$/);
    }
  });
});
