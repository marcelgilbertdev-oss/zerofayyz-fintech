import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, needsRehash, verifyPassword } from "./password.js";

// Cheap parameters so the suite stays fast. The production values are what the
// module defaults to; these only exercise the format and the comparison.
const FAST = { N: 1_024, r: 8, p: 1 };

test("a correct password verifies", async () => {
  const stored = await hashPassword("correct horse battery staple", FAST);
  assert.equal(await verifyPassword("correct horse battery staple", stored), true);
});

test("a wrong password does not verify", async () => {
  const stored = await hashPassword("correct horse battery staple", FAST);
  assert.equal(await verifyPassword("Correct horse battery staple", stored), false);
  assert.equal(await verifyPassword("", stored), false);
});

test("the same password hashes differently every time", async () => {
  const first = await hashPassword("same input", FAST);
  const second = await hashPassword("same input", FAST);

  // Distinct salts. Identical hashes would tell anyone reading the table which
  // accounts share a password.
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("same input", first), true);
  assert.equal(await verifyPassword("same input", second), true);
});

test("the hash records the parameters it was made with", async () => {
  const stored = await hashPassword("parameterised", FAST);
  assert.match(stored, /^scrypt\$N=1024,r=8,p=1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
});

test("a hash made with old parameters still verifies", async () => {
  // The upgrade path: raising the cost must never lock out existing accounts.
  const legacy = await hashPassword("unchanged", { N: 256, r: 8, p: 1 });
  assert.equal(await verifyPassword("unchanged", legacy), true);
  assert.equal(needsRehash(legacy), true);
});

test("a malformed hash fails the login instead of throwing", async () => {
  for (const broken of [
    "",
    "not-a-hash",
    "scrypt$N=1024$only-three-parts",
    "bcrypt$N=1024,r=8,p=1$c2FsdA==$aGFzaA==",
    "scrypt$N=abc,r=8,p=1$c2FsdA==$aGFzaA==",
    "scrypt$N=0,r=8,p=1$c2FsdA==$aGFzaA==",
    "scrypt$r=8,p=1$c2FsdA==$aGFzaA==",
  ]) {
    assert.equal(
      await verifyPassword("anything", broken),
      false,
      `expected false for ${JSON.stringify(broken)}`,
    );
  }
});

test("passwords are Unicode-normalised before hashing", async () => {
  // "é" composed vs decomposed are different byte sequences and the same
  // character. A password manager and a keyboard can disagree about which one
  // they send; the user should not be locked out over it.
  const composed = "cafépass";
  const decomposed = "cafépass";

  const stored = await hashPassword(composed, FAST);
  assert.equal(await verifyPassword(decomposed, stored), true);
});
