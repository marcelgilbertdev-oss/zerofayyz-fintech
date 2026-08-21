import { defineStore } from "pinia";

import {
  fetchAuditTrail,
  fetchSessionUser,
  SessionExpiredError,
  signIn as apiSignIn,
  signOut as apiSignOut,
} from "../api";
import type { AuditLogs, SessionUser } from "../schemas";

type AuthStatus = "unknown" | "signedOut" | "signedIn";

/**
 * The staff half of the client, kept apart from the dashboard store because
 * the two answer different questions: "what does the ledger say" is public,
 * "who are you" is not. The session itself lives in an HttpOnly cookie the
 * API owns — this store only mirrors what /auth/me is willing to admit, so
 * there is nothing here for a script to steal and nothing to get stale in
 * localStorage.
 */
export const useAuthStore = defineStore("auth", {
  state: () => ({
    status: "unknown" as AuthStatus,
    user: null as SessionUser | null,
    submitting: false,
    /** The API's refusal, verbatim — never paraphrased. */
    error: null as string | null,
    /** Why you were signed out when you didn't ask to be. */
    notice: null as string | null,
    audit: null as AuditLogs | null,
    auditError: null as string | null,
  }),

  actions: {
    /** Ask the cookie who we are. Runs once when the panel mounts. */
    async resume() {
      try {
        const user = await fetchSessionUser();
        this.user = user;
        this.status = user ? "signedIn" : "signedOut";
      } catch {
        // A dead API already has a banner on this page; the panel just offers
        // the door again rather than stacking a second error on top.
        this.status = "signedOut";
      }

      if (this.status === "signedIn") {
        await this.loadAudit();
      }
    },

    async signIn(email: string, password: string) {
      this.submitting = true;
      this.error = null;
      this.notice = null;

      try {
        this.user = await apiSignIn(email, password);
        this.status = "signedIn";
        await this.loadAudit();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Unable to sign in";
      } finally {
        this.submitting = false;
      }
    },

    async signOut() {
      // Local state clears even if the network call fails: the user asked to
      // leave, and the server-side session still dies at its expiry.
      try {
        await apiSignOut();
      } catch {
        // Ignored on purpose — see above.
      }

      this.user = null;
      this.audit = null;
      this.auditError = null;
      this.error = null;
      this.notice = null;
      this.status = "signedOut";
    },

    async loadAudit() {
      this.auditError = null;

      try {
        this.audit = await fetchAuditTrail();
      } catch (error) {
        if (error instanceof SessionExpiredError) {
          // The cookie the panel trusted has been revoked or has expired —
          // an admin ending sessions from the console lands exactly here.
          this.user = null;
          this.audit = null;
          this.status = "signedOut";
          this.notice = error.message;
          return;
        }

        this.auditError =
          error instanceof Error ? error.message : "Unable to load the audit trail";
      }
    },
  },
});
