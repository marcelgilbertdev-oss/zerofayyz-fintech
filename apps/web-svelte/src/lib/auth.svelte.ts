import {
  fetchAuditTrail,
  fetchSessionUser,
  SessionExpiredError,
  signIn as apiSignIn,
  signOut as apiSignOut,
} from "./api";
import type { AuditLogs, SessionUser } from "./schemas";

type AuthStatus = "unknown" | "signedOut" | "signedIn";

/**
 * The staff half of the client as a runes factory — the direct counterpart to
 * the Vue client's auth store, deliberately with the same semantics. The
 * session itself lives in an HttpOnly cookie the API owns; this state only
 * mirrors what /auth/me is willing to admit, so there is nothing here for a
 * script to steal and nothing to go stale in localStorage.
 */
export function createAuth() {
  let status = $state<AuthStatus>("unknown");
  let user = $state<SessionUser | null>(null);
  let submitting = $state(false);
  /** The API's refusal, verbatim — never paraphrased. */
  let error = $state<string | null>(null);
  /** Why you were signed out when you didn't ask to be. */
  let notice = $state<string | null>(null);
  let audit = $state<AuditLogs | null>(null);
  let auditError = $state<string | null>(null);

  /** Ask the cookie who we are. Runs once when the panel mounts. */
  async function resume() {
    try {
      user = await fetchSessionUser();
      status = user ? "signedIn" : "signedOut";
    } catch {
      // A dead API already has a banner on this page; the panel just offers
      // the door again rather than stacking a second error on top.
      status = "signedOut";
    }

    if (status === "signedIn") {
      await loadAudit();
    }
  }

  async function signIn(email: string, password: string) {
    submitting = true;
    error = null;
    notice = null;

    try {
      user = await apiSignIn(email, password);
      status = "signedIn";
      await loadAudit();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Unable to sign in";
    } finally {
      submitting = false;
    }
  }

  async function signOut() {
    // Local state clears even if the network call fails: the user asked to
    // leave, and the server-side session still dies at its expiry.
    try {
      await apiSignOut();
    } catch {
      // Ignored on purpose — see above.
    }

    user = null;
    audit = null;
    auditError = null;
    error = null;
    notice = null;
    status = "signedOut";
  }

  async function loadAudit() {
    auditError = null;

    try {
      audit = await fetchAuditTrail();
    } catch (caught) {
      if (caught instanceof SessionExpiredError) {
        // The cookie the panel trusted has been revoked or has expired — an
        // admin ending sessions from the console lands exactly here.
        user = null;
        audit = null;
        status = "signedOut";
        notice = caught.message;
        return;
      }

      auditError =
        caught instanceof Error ? caught.message : "Unable to load the audit trail";
    }
  }

  return {
    get status() { return status; },
    get user() { return user; },
    get submitting() { return submitting; },
    get error() { return error; },
    get notice() { return notice; },
    get audit() { return audit; },
    get auditError() { return auditError; },
    /** The form clears the last refusal the moment a field is edited. */
    clearError() { error = null; },
    resume,
    signIn,
    signOut,
    loadAudit,
  };
}

export type Auth = ReturnType<typeof createAuth>;
