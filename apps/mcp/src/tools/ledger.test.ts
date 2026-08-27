import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ApiClient } from "../api-client.js";
import { buildQueryString, queryLedger } from "./ledger.js";

/**
 * A stub client that returns a canned body and records the path it was asked
 * for. queryLedger never needs more of ApiClient than `request`.
 */
function stubClient(body: unknown, status = 200): ApiClient & { paths: string[] } {
  const paths: string[] = [];

  return {
    paths,
    async request(path: string) {
      paths.push(path);
      return { status, ok: status < 400, latencyMs: 1, body };
    },
  } as unknown as ApiClient & { paths: string[] };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `row-${i}` }));

describe("buildQueryString", () => {
  it("clamps limit into 1..100 instead of rejecting", () => {
    assert.equal(buildQueryString({ resource: "payments", limit: 10_000 }), "?limit=100");
    assert.equal(buildQueryString({ resource: "payments", limit: 0 }), "?limit=1");
  });

  it("omits the query string entirely when nothing was asked", () => {
    assert.equal(buildQueryString({ resource: "payments" }), "");
  });
});

describe("queryLedger paging", () => {
  it("trusts the server when meta echoes the limit back", async () => {
    const client = stubClient({
      data: rows(2),
      meta: { total: 34, limit: 2, offset: 0, source: "postgresql" },
    });

    const result = await queryLedger(client, { resource: "payments", limit: 2 });

    assert.equal(result.paging, "server");
    assert.equal(result.rowCount, 2);
  });

  it("slices client-side when the endpoint ignored the query string", async () => {
    // The /transactions shape: hardcoded window, meta.count only. The tool
    // promised limit=5, so the tool delivers limit=5.
    const client = stubClient({
      data: rows(10),
      meta: { count: 10, source: "postgresql" },
    });

    const result = await queryLedger(client, { resource: "transactions", limit: 5 });

    assert.equal(result.paging, "client");
    assert.equal(result.rowCount, 5);
    assert.deepEqual(
      (result.body as { data: Array<{ id: string }> }).data.map((r) => r.id),
      ["row-0", "row-1", "row-2", "row-3", "row-4"],
    );
    // meta is passed through untouched — the tool does not forge server meta.
    assert.deepEqual((result.body as { meta: unknown }).meta, {
      count: 10,
      source: "postgresql",
    });
  });

  it("applies offset before limit when slicing client-side", async () => {
    const client = stubClient({ data: rows(10), meta: { count: 10 } });

    const result = await queryLedger(client, {
      resource: "transactions",
      limit: 3,
      offset: 2,
    });

    assert.deepEqual(
      (result.body as { data: Array<{ id: string }> }).data.map((r) => r.id),
      ["row-2", "row-3", "row-4"],
    );
  });

  it("reports no paging when none was requested", async () => {
    const client = stubClient({ data: rows(10), meta: { count: 10 } });

    const result = await queryLedger(client, { resource: "transactions" });

    assert.equal(result.paging, null);
    assert.equal(result.rowCount, 10);
  });

  it("leaves error bodies alone", async () => {
    const client = stubClient({ error: "nope" }, 500);

    const result = await queryLedger(client, { resource: "transactions", limit: 5 });

    assert.equal(result.paging, null);
    assert.deepEqual(result.body, { error: "nope" });
  });

  it("still sends limit/offset on the wire so a fixed server can take over", async () => {
    const client = stubClient({ data: rows(10), meta: { count: 10 } });

    await queryLedger(client, { resource: "transactions", limit: 5, offset: 2 });

    assert.deepEqual(client.paths, ["/api/v1/transactions?limit=5&offset=2"]);
  });
});
