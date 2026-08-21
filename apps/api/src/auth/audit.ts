import type { Database } from "../database/database.js";

/**
 * Writing to the audit log.
 *
 * The table refuses UPDATE and DELETE at the database level, so this module is
 * append-only whether it intends to be or not. That is the point: an audit
 * trail the application could rewrite answers no question worth asking.
 */
export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  actorUserId?: string | null;
  sessionId?: string | null;
  clientFingerprint?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(
  database: Database,
  entry: AuditEntry,
): Promise<void> {
  await database.query(
    `
      INSERT INTO audit_logs (
        actor_user_id,
        session_id,
        action,
        entity_type,
        entity_id,
        client_fingerprint,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB)
    `,
    [
      entry.actorUserId ?? null,
      entry.sessionId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.clientFingerprint ?? null,
      // Cast written explicitly. An uncast JSONB bind parameter is what caused
      // 42P18 and left the webhook broken for the life of the project.
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}

/**
 * Records an event that must not take the request down with it.
 *
 * A failed audit write is serious and is logged loudly, but refusing a
 * successful login because the history could not be appended trades a
 * bookkeeping failure for an outage. Actions that must not proceed unrecorded
 * — refunds, role changes — call recordAudit directly inside their own
 * transaction instead.
 */
export async function recordAuditSafely(
  database: Database,
  entry: AuditEntry,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await recordAudit(database, entry);
  } catch (error) {
    onError(error);
  }
}
