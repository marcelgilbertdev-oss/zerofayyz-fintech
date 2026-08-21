import type { FastifyPluginAsync } from "fastify";

import { recordAudit } from "../auth/audit.js";
import { requireRole } from "../auth/auth.routes.js";
import type { Database } from "../database/database.js";

type AdminRouteOptions = {
  database: Database;
};

/**
 * The privileged read surface behind the admin console.
 *
 * Every route here is guarded by requireRole on the server. The dashboard also
 * hides these screens from viewers, but hiding is presentation — these guards
 * are the actual boundary, and the tests exercise them as one.
 */

type SessionRow = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  client_fingerprint: string | null;
};

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_email: string | null;
  session_id: string | null;
  client_fingerprint: string | null;
  metadata: unknown;
  created_at: Date;
};

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  last_login_at: Date | null;
  created_at: Date;
  disabled_at: Date | null;
  payment_count: string;
};

export const adminRoutes: FastifyPluginAsync<AdminRouteOptions> = async (
  app,
  { database },
) => {
  /**
   * Presence: who is signed in right now.
   *
   * "Now" is decided by the same SQL predicate resolveSession uses —
   * unrevoked and unexpired — so this list and the door itself can never
   * disagree about whether someone is inside.
   */
  app.get(
    "/admin/sessions",
    { preHandler: requireRole("admin") },
    async (request) => {
      const result = await database.query<SessionRow>(
        `
          SELECT s.id,
                 u.email,
                 u.display_name,
                 u.role,
                 s.created_at,
                 s.last_seen_at,
                 s.expires_at,
                 s.client_fingerprint
            FROM sessions s
            JOIN users u ON u.id = s.user_id
           WHERE s.revoked_at IS NULL
             AND s.expires_at > NOW()
           ORDER BY s.last_seen_at DESC
           LIMIT 100
        `,
      );

      return {
        data: result.rows.map((row) => ({
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          role: row.role,
          createdAt: row.created_at.toISOString(),
          lastSeenAt: row.last_seen_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
          clientFingerprint: row.client_fingerprint,
          // So the console can label the viewer's own row "this is you" —
          // and so revoking it can warn before signing yourself out.
          current: row.id === request.session?.sessionId,
        })),
      };
    },
  );

  /**
   * Remote sign-out: an admin ends someone else's session.
   *
   * The audit entry is written by recordAudit, not recordAuditSafely: an
   * unrecorded forced sign-out must not happen, so if the history cannot be
   * appended the action fails with it.
   */
  app.delete<{ Params: { id: string } }>(
    "/admin/sessions/:id",
    {
      preHandler: requireRole("admin"),
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const result = await database.query<{ user_id: string }, [string]>(
        `
          UPDATE sessions
             SET revoked_at = NOW()
           WHERE id = $1
             AND revoked_at IS NULL
          RETURNING user_id
        `,
        [request.params.id],
      );

      if ((result.rowCount ?? 0) === 0) {
        return reply.code(404).send({ error: "No active session with that id" });
      }

      await recordAudit(database, {
        action: "admin.session.revoked",
        entityType: "session",
        entityId: request.params.id,
        actorUserId: request.session?.userId ?? null,
        sessionId: request.session?.sessionId ?? null,
        metadata: { revokedUserId: result.rows[0]?.user_id },
      });

      return reply.send({ revoked: true });
    },
  );

  /**
   * History: the audit log, newest first.
   *
   * Operator and up rather than admin-only: reading the history is how an
   * operator checks their own actions took effect, and it grants no power to
   * change anything — the table itself refuses edits from everyone.
   */
  app.get<{ Querystring: { limit?: number } }>(
    "/admin/audit-logs",
    {
      preHandler: requireRole("operator"),
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? 50;
      // LEFT JOIN because actor ids are plain values, not foreign keys: an
      // entry may name a user who has since been removed, and that entry
      // still counts. A missing actor renders as null, never as a lost row.
      const result = await database.query<AuditRow, [number]>(
        `
          SELECT a.id,
                 a.action,
                 a.entity_type,
                 a.entity_id,
                 u.email AS actor_email,
                 a.session_id,
                 a.client_fingerprint,
                 a.metadata,
                 a.created_at
            FROM audit_logs a
            LEFT JOIN users u ON u.id = a.actor_user_id
           ORDER BY a.created_at DESC
           LIMIT $1
        `,
        [limit],
      );

      return {
        data: result.rows.map((row) => ({
          id: row.id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          actorEmail: row.actor_email,
          sessionId: row.session_id,
          clientFingerprint: row.client_fingerprint,
          metadata: row.metadata ?? {},
          createdAt: row.created_at.toISOString(),
        })),
      };
    },
  );

  /** Accounts: staff and customers, with how much each customer has moved. */
  app.get(
    "/admin/users",
    { preHandler: requireRole("admin") },
    async () => {
      const result = await database.query<UserRow>(
        `
          SELECT u.id,
                 u.email,
                 u.display_name,
                 u.role,
                 u.last_login_at,
                 u.created_at,
                 u.disabled_at,
                 COUNT(p.id) AS payment_count
            FROM users u
            LEFT JOIN payments p ON p.user_id = u.id
           GROUP BY u.id
           ORDER BY u.created_at DESC
           LIMIT 200
        `,
      );

      return {
        data: result.rows.map((row) => ({
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          role: row.role,
          lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
          createdAt: row.created_at.toISOString(),
          disabledAt: row.disabled_at ? row.disabled_at.toISOString() : null,
          paymentCount: Number(row.payment_count),
        })),
      };
    },
  );
};

/**
 * Account management. Admin only, and none of it may be aimed at yourself:
 * self-demotion and self-disabling are how a platform loses its last
 * administrator to a misclick.
 */
export const accountRoutes: FastifyPluginAsync<AdminRouteOptions> = async (
  app,
  { database },
) => {
  app.post<{
    Body: { email: string; displayName: string; role: string; password: string };
  }>(
    "/admin/users",
    {
      preHandler: requireRole("admin"),
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "displayName", "role", "password"],
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            displayName: { type: "string", minLength: 2, maxLength: 100 },
            role: { type: "string", enum: ["viewer", "operator", "admin"] },
            password: { type: "string", minLength: 12, maxLength: 512 },
          },
        },
      },
    },
    async (request, reply) => {
      const { hashPassword } = await import("../auth/password.js");
      const email = request.body.email.trim().toLowerCase();
      const hash = await hashPassword(request.body.password);

      let created;

      try {
        created = await database.query<{ id: string }>(
          `
            INSERT INTO users (email, display_name, role, password_hash)
            VALUES ($1, $2, $3, $4)
            RETURNING id
          `,
          [email, request.body.displayName.trim(), request.body.role, hash],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "An account with that email already exists" });
        }

        throw error;
      }

      await recordAudit(database, {
        action: "admin.user.created",
        entityType: "user",
        entityId: created.rows[0]?.id ?? null,
        actorUserId: request.session?.userId ?? null,
        sessionId: request.session?.sessionId ?? null,
        // The email and role are the auditable facts. The password is not,
        // in any form.
        metadata: { email, role: request.body.role },
      });

      return reply.code(201).send({ id: created.rows[0]?.id, email, role: request.body.role });
    },
  );

  app.patch<{ Params: { id: string }; Body: { role: string } }>(
    "/admin/users/:id/role",
    {
      preHandler: requireRole("admin"),
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["role"],
          properties: { role: { type: "string", enum: ["viewer", "operator", "admin"] } },
        },
      },
    },
    async (request, reply) => {
      if (request.params.id === request.session?.userId) {
        return reply.code(403).send({
          error: "You cannot change your own role",
        });
      }

      const result = await database.query<{ email: string }>(
        `
          UPDATE users
             SET role = $2, updated_at = NOW()
           WHERE id = $1
             AND role <> 'customer'
             AND password_hash IS NOT NULL
          RETURNING email
        `,
        [request.params.id, request.body.role],
      );

      if ((result.rowCount ?? 0) === 0) {
        return reply.code(404).send({ error: "No staff account with that id" });
      }

      await recordAudit(database, {
        action: "admin.user.role_changed",
        entityType: "user",
        entityId: request.params.id,
        actorUserId: request.session?.userId ?? null,
        sessionId: request.session?.sessionId ?? null,
        metadata: { email: result.rows[0]?.email, newRole: request.body.role },
      });

      return reply.send({ updated: true, role: request.body.role });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/users/:id/disable",
    {
      preHandler: requireRole("admin"),
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (request.params.id === request.session?.userId) {
        return reply.code(403).send({ error: "You cannot disable your own account" });
      }

      // Disabling and revoking happen together: an account that cannot sign in
      // but whose existing sessions keep working is not disabled, it is
      // decorative.
      const result = await database.query<{ email: string }>(
        `
          WITH disabled AS (
            UPDATE users
               SET disabled_at = NOW(), updated_at = NOW()
             WHERE id = $1
               AND role <> 'customer'
               AND disabled_at IS NULL
            RETURNING id, email
          ),
          ended AS (
            UPDATE sessions
               SET revoked_at = NOW()
              FROM disabled
             WHERE sessions.user_id = disabled.id
               AND sessions.revoked_at IS NULL
          )
          SELECT email FROM disabled
        `,
        [request.params.id],
      );

      if ((result.rowCount ?? 0) === 0) {
        return reply.code(404).send({ error: "No enabled staff account with that id" });
      }

      await recordAudit(database, {
        action: "admin.user.disabled",
        entityType: "user",
        entityId: request.params.id,
        actorUserId: request.session?.userId ?? null,
        sessionId: request.session?.sessionId ?? null,
        metadata: { email: result.rows[0]?.email },
      });

      return reply.send({ disabled: true });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/users/:id/enable",
    {
      preHandler: requireRole("admin"),
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const result = await database.query<{ email: string }>(
        `
          UPDATE users
             SET disabled_at = NULL, updated_at = NOW()
           WHERE id = $1
             AND disabled_at IS NOT NULL
          RETURNING email
        `,
        [request.params.id],
      );

      if ((result.rowCount ?? 0) === 0) {
        return reply.code(404).send({ error: "No disabled account with that id" });
      }

      await recordAudit(database, {
        action: "admin.user.enabled",
        entityType: "user",
        entityId: request.params.id,
        actorUserId: request.session?.userId ?? null,
        sessionId: request.session?.sessionId ?? null,
        metadata: { email: result.rows[0]?.email },
      });

      return reply.send({ enabled: true });
    },
  );
};
