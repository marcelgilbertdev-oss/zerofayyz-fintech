import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

// promisify() picks scrypt's simplest overload and drops the options argument,
// so the cost parameters would be silently ignored at runtime while still
// typechecking. Wrapped by hand instead.
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

/**
 * Password hashing on Node's standard library, deliberately.
 *
 * Argon2id is the usual first choice and is a fine algorithm. It is also a
 * native module distributed through platform-specific optional dependencies —
 * the exact shape that broke this project's CI twice already (a macOS lockfile
 * that pruned the Linux binaries; see the acceptance-test failure log). scrypt
 * is memory-hard, is on OWASP's recommended list, and ships inside Node, so it
 * cannot be absent on one platform and present on another.
 *
 * The cost parameters are stored inside the hash string rather than read from
 * a constant at verify time. That is what makes this decision reversible:
 * raising N later, or moving to Argon2 entirely, leaves every existing hash
 * verifiable, because each one still says how it was made. Changing a global
 * constant instead would lock every existing user out on deploy.
 */
const ALGORITHM = "scrypt";
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// OWASP's scrypt baseline: N=2^17, r=8, p=1.
const DEFAULT_PARAMETERS = { N: 131_072, r: 8, p: 1 } as const;

// scrypt needs roughly 128 * N * r bytes. At N=2^17 that is ~134 MB, well over
// Node's default 32 MB cap, so the limit is raised to match the parameters
// rather than the parameters quietly lowered to fit the default.
const maxmem = 256 * 1024 * 1024;

export type ScryptParameters = { N: number; r: number; p: number };

export async function hashPassword(
  password: string,
  parameters: ScryptParameters = DEFAULT_PARAMETERS,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...parameters,
    maxmem,
  });

  return [
    ALGORITHM,
    `N=${parameters.N},r=${parameters.r},p=${parameters.p}`,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupted row must
 * fail the login, not crash the endpoint and hand an attacker a way to tell a
 * real account from a broken one by the shape of the response.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");

  if (parts.length !== 4 || parts[0] !== ALGORITHM) {
    return false;
  }

  const [, parameterString, saltBase64, expectedBase64] = parts;

  if (!parameterString || !saltBase64 || !expectedBase64) {
    return false;
  }

  const parameters: Record<string, number> = {};

  for (const pair of parameterString.split(",")) {
    const [key, value] = pair.split("=");
    const parsed = Number(value);

    if (!key || !Number.isInteger(parsed) || parsed <= 0) {
      return false;
    }

    parameters[key] = parsed;
  }

  const { N, r, p } = parameters;

  if (!N || !r || !p) {
    return false;
  }

  try {
    const salt = Buffer.from(saltBase64, "base64");
    const expected = Buffer.from(expectedBase64, "base64");
    const derived = await scryptAsync(
      password.normalize("NFKC"),
      salt,
      expected.length,
      { N, r, p, maxmem },
    );

    // Constant-time: a byte-by-byte comparison that returns early leaks how
    // much of the hash matched through how long the answer took.
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash was made with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const match = /^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$/.exec(stored);

  if (!match) {
    return true;
  }

  return Number(match[1]) < DEFAULT_PARAMETERS.N;
}
