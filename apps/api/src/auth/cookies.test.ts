import assert from "node:assert/strict";
import test from "node:test";

import { expiredSessionCookie, readCookie, serializeSessionCookie } from "./cookies.js";

test("a named cookie is read out of a header holding several", () => {
  const header = "theme=dark; zf_session=abc123; locale=ja";
  assert.equal(readCookie(header, "zf_session"), "abc123");
  assert.equal(readCookie(header, "theme"), "dark");
});

test("a cookie whose name is a suffix of another is not confused for it", () => {
  // "session" must not match "zf_session"; a prefix search would return the
  // wrong value and authenticate the wrong request.
  assert.equal(readCookie("zf_session=real", "session"), undefined);
});

test("missing headers and missing cookies both read as undefined", () => {
  assert.equal(readCookie(undefined, "zf_session"), undefined);
  assert.equal(readCookie("", "zf_session"), undefined);
  assert.equal(readCookie("theme=dark", "zf_session"), undefined);
});

test("values are URL-decoded", () => {
  assert.equal(readCookie("zf_session=a%20b%3Dc", "zf_session"), "a b=c");
});

test("the session cookie carries every protective attribute", () => {
  const cookie = serializeSessionCookie("zf_session", "token", { maxAgeSeconds: 60 });

  assert.match(cookie, /^zf_session=token/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=60/);
});

test("SameSite is Lax and not Strict, so the Stripe return keeps the session", () => {
  // Regression guard: tightening this to Strict looks like an improvement and
  // silently logs the user out on the way back from Stripe's domain.
  assert.doesNotMatch(serializeSessionCookie("zf_session", "t"), /SameSite=Strict/);
});

test("the expiry cookie is already in the past", () => {
  const cookie = expiredSessionCookie("zf_session");

  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /Expires=Thu, 01 Jan 1970/);
});
