import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { returnOriginFor } from "./payments.routes.js";

/**
 * The payer's return address is chosen by a request header, and this endpoint is
 * public. That makes it an open-redirect surface, so the allowlist is the whole
 * security control and these are the tests that matter.
 */

const DASHBOARD = "https://zerofayyz-fintech.vercel.app";
const VUE = "https://zerofayyz-fintech-vue.vercel.app";
const SVELTE = "https://zerofayyz-fintech-svelte.vercel.app";

let previousAppUrl: string | undefined;
let previousClientOrigins: string | undefined;

before(() => {
  previousAppUrl = process.env.APP_URL;
  previousClientOrigins = process.env.CLIENT_ORIGINS;
  process.env.APP_URL = DASHBOARD;
  process.env.CLIENT_ORIGINS = `${VUE},${SVELTE}`;
});

after(() => {
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
  if (previousClientOrigins === undefined) delete process.env.CLIENT_ORIGINS;
  else process.env.CLIENT_ORIGINS = previousClientOrigins;
});

describe("checkout return origin", () => {
  it("returns the payer to the client they started from", () => {
    assert.equal(returnOriginFor(VUE), VUE);
    assert.equal(returnOriginFor(SVELTE), SVELTE);
    assert.equal(returnOriginFor(DASHBOARD), DASHBOARD);
  });

  it("falls back to the dashboard when no origin is sent", () => {
    assert.equal(returnOriginFor(undefined), DASHBOARD);
    assert.equal(returnOriginFor(""), DASHBOARD);
  });

  it("refuses an unknown origin rather than redirecting to it", () => {
    assert.equal(returnOriginFor("https://attacker.test"), DASHBOARD);
  });

  it("refuses a look-alike that would pass a prefix check", () => {
    // The reason the allowlist compares whole origins instead of using
    // startsWith: this is a different site that begins with the real one.
    assert.equal(
      returnOriginFor("https://zerofayyz-fintech.vercel.app.attacker.test"),
      DASHBOARD,
    );
  });

  it("refuses a subdomain of an allowed host", () => {
    assert.equal(returnOriginFor("https://evil.zerofayyz-fintech.vercel.app"), DASHBOARD);
  });

  it("refuses the same host over plain http", () => {
    assert.equal(returnOriginFor("http://zerofayyz-fintech-vue.vercel.app"), DASHBOARD);
  });

  it("tolerates a trailing slash on an otherwise valid origin", () => {
    assert.equal(returnOriginFor(`${VUE}/`), VUE);
  });

  it("allows the local dev servers so development needs no second code path", () => {
    assert.equal(returnOriginFor("http://localhost:3001"), "http://localhost:3001");
    assert.equal(returnOriginFor("http://127.0.0.1:3002"), "http://127.0.0.1:3002");
  });
});
