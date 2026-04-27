import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { deserializeModelsFromFile, serializeModelsForFile, type ModelFileSpec, type ModelSpec } from "@chatbot/config";
import { dbHttp, sqlHttp } from "./client";
import { config, controlEvents, conversations, messages, rateLimits, workerStatus } from "./schema";

export const CONFIG_MODELS_KEY = "models";
export const CONFIG_SESSION_INFO_KEY = "session_info";
export const CONFIG_WA_SESSION_IDS_KEY = "wa_session_ids";
export const CONFIG_WA_SESSIONS_KEY = "wa_sessions";

export const getModelsFromConfig = async (): Promise<ModelSpec[] | null> => {
  const rows = await dbHttp.select().from(config).where(eq(config.key, CONFIG_MODELS_KEY)).limit(1);
  if (rows.length === 0) {
    return null;
  }
  return deserializeModelsFromFile(rows[0].value as ModelFileSpec[]);
};

export const upsertModelsInConfig = async (models: ModelSpec[]): Promise<void> => {
  await dbHttp
    .insert(config)
    .values({ key: CONFIG_MODELS_KEY, value: serializeModelsForFile(models) })
    .onConflictDoUpdate({
      target: config.key,
      set: { value: serializeModelsForFile(models), updatedAt: sql`now()` }
    });
};

export const upsertConfigValue = async (key: string, value: unknown): Promise<void> => {
  await dbHttp
    .insert(config)
    .values({ key, value })
    .onConflictDoUpdate({
      target: config.key,
      set: { value, updatedAt: sql`now()` }
    });
};

export const getConfigValue = async <T>(key: string): Promise<T | null> => {
  const rows = await dbHttp.select().from(config).where(eq(config.key, key)).limit(1);
  if (rows.length === 0) {
    return null;
  }
  return rows[0].value as T;
};

export const emitControlEvent = async (kind: string, payload: unknown): Promise<void> => {
  await dbHttp.insert(controlEvents).values({ kind, payload });
  await sqlHttp`select pg_notify('control_events', ${kind})`;
};

export const consumePendingControlEvents = async (limit = 50) => {
  const pending = await dbHttp
    .select()
    .from(controlEvents)
    .where(isNull(controlEvents.consumedAt))
    .orderBy(controlEvents.createdAt)
    .limit(limit);

  if (pending.length === 0) {
    return [];
  }

  const ids = pending.map((row) => row.id);
  await dbHttp
    .update(controlEvents)
    .set({ consumedAt: sql`now()` })
    .where(and(inArray(controlEvents.id, ids), isNull(controlEvents.consumedAt)));

  return pending;
};

export const updateWorkerHeartbeat = async (
  connected: boolean,
  qr: string | null | undefined,
  lastError: string | null
): Promise<void> => {
  const updatePayload: {
    connected: boolean;
    lastHeartbeat: Date;
    lastError: string | null;
    qr?: string | null;
  } = {
    connected,
    lastHeartbeat: new Date(),
    lastError
  };

  if (qr !== undefined) {
    updatePayload.qr = qr;
  }

  await dbHttp
    .insert(workerStatus)
    .values({ id: 1, connected, qr: qr ?? null, lastHeartbeat: new Date(), lastError })
    .onConflictDoUpdate({
      target: workerStatus.id,
      set: updatePayload
    });
};

export const readConversationHistory = async (jid: string, maxMessages: number) =>
  dbHttp.select().from(messages).where(eq(messages.jid, jid)).orderBy(desc(messages.createdAt)).limit(maxMessages);

export const isConversationAllowlisted = async (jid: string): Promise<boolean> => {
  const rows = await dbHttp
    .select({ allowlisted: conversations.allowlisted })
    .from(conversations)
    .where(and(eq(conversations.jid, jid), eq(conversations.allowlisted, true)))
    .limit(1);

  return rows.length > 0;
};

export const cleanRateLimitWindows = async (jid: string, cutoff: Date): Promise<void> => {
  await dbHttp.delete(rateLimits).where(and(eq(rateLimits.jid, jid), lt(rateLimits.windowStart, cutoff)));
};

export const incrementRateWindow = async (jid: string, windowStart: Date): Promise<number> => {
  await dbHttp
    .insert(rateLimits)
    .values({ jid, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.jid, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` }
    });

  const row = await dbHttp
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(and(eq(rateLimits.jid, jid), eq(rateLimits.windowStart, windowStart)))
    .limit(1);

  return row[0]?.count ?? 1;
};
