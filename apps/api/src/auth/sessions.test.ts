import assert from "node:assert/strict";
import test from "node:test";

import { clientFingerprint } from "./sessions.js";

const SECRET = "unit-test-fingerprint-secret";

test("two clients on different networks get different fingerprints", () => {
  const a = clientFingerprint("203.0.113.7", SECRET);
  const b = clientFingerprint("198.51.100.9", SECRET);

  assert.ok(a && b);
  assert.notEqual(a, b);
});

test("two clients on the same /24 share a fingerprint — the host part is discarded", () => {
  assert.equal(
    clientFingerprint("203.0.113.7", SECRET),
    clientFingerprint("203.0.113.200", SECRET),
  );
});

test("an IPv4-mapped IPv6 address fingerprints as its IPv4 self", () => {
  // Node reports IPv4 over dual-stack sockets as ::ffff:a.b.c.d. Before the
  // unwrap, the colon test classified every such address as IPv6 and sliced
  // them all to "::ffff" — one fingerprint for the entire IPv4 internet.
  assert.equal(
    clientFingerprint("::ffff:203.0.113.7", SECRET),
    clientFingerprint("203.0.113.7", SECRET),
  );

  assert.notEqual(
    clientFingerprint("::ffff:203.0.113.7", SECRET),
    clientFingerprint("::ffff:198.51.100.9", SECRET),
  );
});

test("IPv6 addresses keep only the /48 routing prefix", () => {
  assert.equal(
    clientFingerprint("2001:db8:85a3:8d3:1319:8a2e:370:7348", SECRET),
    clientFingerprint("2001:db8:85a3:ffff:ffff:ffff:ffff:ffff", SECRET),
  );
});

test("the fingerprint is keyed: a different secret yields a different value", () => {
  assert.notEqual(
    clientFingerprint("203.0.113.7", SECRET),
    clientFingerprint("203.0.113.7", "another-secret"),
  );
});

test("no address, no fingerprint", () => {
  assert.equal(clientFingerprint(undefined, SECRET), null);
});

test("the fingerprint never contains the address it was made from", () => {
  const fingerprint = clientFingerprint("203.0.113.7", SECRET);

  assert.ok(fingerprint);
  assert.ok(!fingerprint.includes("203"));
  assert.match(fingerprint, /^[0-9a-f]{32}$/);
});
