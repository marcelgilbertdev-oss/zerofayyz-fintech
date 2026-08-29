<script setup lang="ts">
import { onMounted, ref } from "vue";

import { useAuthStore } from "../stores/auth";
import AuditTrail from "./AuditTrail.vue";
import PasswordField from "./PasswordField.vue";

/**
 * The staff door and what stands behind it, in one card. Signed out it is the
 * sign-in form with the published demo credentials; signed in it is the
 * audit trail — the one read on this page that a cookie has to earn.
 */
const auth = useAuthStore();

const email = ref("");
const password = ref("");
const filled = ref(false);

// Clearing the refusal the moment a field is edited, so a fixed typo does not
// keep wearing the old error. Same behaviour as the Next.js login form, found
// there in a live charter run.
function edit() {
  auth.error = null;
}

const DEMO_EMAIL = "demo@zerofayyz.test";
const DEMO_PASSWORD = "view-the-ledger";

function fillDemoCredentials() {
  email.value = DEMO_EMAIL;
  password.value = DEMO_PASSWORD;
  filled.value = true;
  auth.error = null;
}

function submit() {
  void auth.signIn(email.value, password.value);
}

onMounted(() => {
  void auth.resume();
});
</script>

<template>
  <section id="operator" aria-label="Operator area" class="panel">
    <header class="panel-header">
      <h2>Operator area</h2>
      <p class="source">
        The dashboard above is public. This door is for the operational half —
        the same session cookie, rate limiter and audit trail as the admin
        console, driven from Vue this time.
      </p>
    </header>

    <p v-if="auth.status === 'unknown'" class="checking" role="status">
      Checking session…
    </p>

    <template v-else-if="auth.status === 'signedIn' && auth.user">
      <div class="identity">
        <p class="who">
          Signed in as <strong>{{ auth.user.displayName }}</strong>
          <span class="role">{{ auth.user.role }}</span>
        </p>
        <button type="button" class="signout" @click="auth.signOut()">
          Sign out
        </button>
      </div>

      <AuditTrail
        v-if="auth.audit"
        :audit="auth.audit"
        @refresh="auth.loadAudit()"
      />
      <p v-if="auth.auditError" role="alert" class="error">
        {{ auth.auditError }}
      </p>
    </template>

    <template v-else>
      <p v-if="auth.notice" role="status" class="notice">{{ auth.notice }}</p>

      <div class="doors">
        <form class="login" @submit.prevent="submit">
          <div class="row">
            <label for="staff-email">Email address</label>
            <input
              id="staff-email"
              v-model="email"
              type="email"
              autocomplete="username"
              required
              @input="edit"
            />
          </div>
          <div class="row">
            <label for="staff-password">Password</label>
            <PasswordField
              id="staff-password"
              v-model="password"
              @update:model-value="edit"
            />
          </div>
          <button type="submit" class="submit" :disabled="auth.submitting">
            {{ auth.submitting ? "Signing in…" : "Sign in" }}
          </button>
          <p aria-live="polite" class="error">{{ auth.error }}</p>
          <!-- The compromise on enumeration: the refusal never says whether
               the account exists or is disabled — this line gives the confused
               legitimate person a next step while confirming nothing. -->
          <p v-if="auth.error" class="contact">
            If you believe you should have access, contact your administrator.
          </p>
        </form>

        <aside class="demo">
          <h3>Reviewer access</h3>
          <p>
            Use the demo operator account — it is published on purpose, so you
            can walk in without asking anyone:
          </p>
          <dl>
            <div><dt>email</dt><dd>{{ DEMO_EMAIL }}</dd></div>
            <div><dt>password</dt><dd>{{ DEMO_PASSWORD }}</dd></div>
          </dl>
          <button type="button" class="fill" @click="fillDemoCredentials">
            Fill these in for me
          </button>
          <p aria-live="polite" class="filled">
            {{ filled ? "Filled in — press Sign in" : "" }}
          </p>
          <p class="note">
            The operator role can read everything and change nothing.
            Administration is reserved for the platform owner.
          </p>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.panel {
  background: rgba(13, 26, 23, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  margin-top: 18px;
  padding: 20px;
}
.panel-header h2 {
  color: rgba(255, 255, 255, 0.88);
  font-size: 14px;
  margin: 0;
}
.source {
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  line-height: 1.5;
  margin: 4px 0 0;
  max-width: 560px;
}
.checking {
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  margin: 16px 0 0;
}
.notice {
  color: #fcd34d;
  font-size: 12px;
  margin: 14px 0 0;
}
.doors {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(260px, 380px) minmax(260px, 1fr);
  margin-top: 16px;
}
@media (max-width: 720px) {
  .doors {
    grid-template-columns: minmax(0, 1fr);
  }
}
.row {
  margin-bottom: 12px;
}
label {
  color: rgba(255, 255, 255, 0.7);
  display: block;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 6px;
}
.login input[type="email"] {
  box-sizing: border-box;
  background: #16241f;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: #fff;
  font-size: 13px;
  padding: 10px 14px;
  width: 100%;
}
.login input[type="email"]:focus {
  border-color: rgba(110, 231, 183, 0.4);
  outline: none;
}
.submit {
  background: #6ee7b7;
  border: none;
  border-radius: 12px;
  color: #062018;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  padding: 10px 16px;
  width: 100%;
}
.submit:disabled {
  cursor: wait;
  opacity: 0.6;
}
.error {
  color: #fda4af;
  font-size: 11px;
  margin: 8px 0 0;
  min-height: 14px;
}
.contact {
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  line-height: 1.5;
  margin: 6px 0 0;
}
.demo {
  background: rgba(110, 231, 183, 0.06);
  border: 1px solid rgba(110, 231, 183, 0.2);
  border-radius: 14px;
  padding: 16px;
}
.demo h3 {
  color: #6ee7b7;
  font-size: 11px;
  letter-spacing: 0.1em;
  margin: 0;
  text-transform: uppercase;
}
.demo p {
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  line-height: 1.5;
  margin: 8px 0 0;
}
.demo dl {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  margin: 10px 0 0;
}
.demo dl div {
  display: flex;
  gap: 8px;
}
.demo dt {
  color: rgba(255, 255, 255, 0.5);
}
.demo dd {
  color: #d1fae5;
  margin: 0;
}
.fill {
  background: none;
  border: 1px solid rgba(110, 231, 183, 0.3);
  border-radius: 12px;
  color: #6ee7b7;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  margin-top: 12px;
  padding: 8px 14px;
  width: 100%;
}
.fill:hover {
  border-color: rgba(110, 231, 183, 0.6);
}
.filled {
  color: rgba(110, 231, 183, 0.8);
  font-size: 10px;
  margin: 6px 0 0;
  min-height: 12px;
  text-align: center;
}
.note {
  color: rgba(255, 255, 255, 0.5) !important;
}
.identity {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin: 16px 0;
}
.who {
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  margin: 0;
}
.role {
  border: 1px solid rgba(110, 231, 183, 0.25);
  border-radius: 999px;
  color: #6ee7b7;
  font-size: 10px;
  margin-left: 8px;
  padding: 2px 10px;
  text-transform: uppercase;
}
.signout {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  font-size: 11px;
  padding: 6px 14px;
}
.signout:hover {
  border-color: rgba(253, 164, 175, 0.4);
  color: #fda4af;
}
</style>
