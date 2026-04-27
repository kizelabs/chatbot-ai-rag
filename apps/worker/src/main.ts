import fs from "node:fs/promises";
import path from "node:path";
import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket
} from "@whiskeysockets/baileys";
import pino from "pino";
import { loadBaseEnv } from "@chatbot/config";
import {
  runChatTurn,
  isAllowlistedConversation,
  recordInboundMessage,
  ingestJobToVectorStore,
  processPendingIngestJobs,
} from "@chatbot/core";
import {
  CONFIG_WA_SESSION_IDS_KEY,
  CONFIG_WA_SESSIONS_KEY,
  getConfigValue,
  updateWorkerHeartbeat,
  upsertConfigValue
} from "@chatbot/db";
import { readIngestConfig } from "@chatbot/config";
import { startControlEventLoop } from "./listen.js";
import { nextDelay, wait } from "./supervisor.js";

const logger = pino({ name: "worker" });
const env = loadBaseEnv();

interface SessionState {
  sessionId: string;
  connected: boolean;
  qr: string | null;
  lastHeartbeat: string | null;
  lastError: string | null;
  jid: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  disconnectedReason: string | null;
  disconnectedCode: number | null;
}

const sockets = new Map<string, WASocket>();
const reconnectAttempts = new Map<string, number>();
const stoppingSessions = new Set<string>();

const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  if (typeof error === "object" && error) {
    return error as Record<string, unknown>;
  }

  return { message: String(error) };
};

const authDirFor = (sessionId: string): string => path.join("./data/auth", sessionId);

const normalizeSessionId = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");

const requireSessionId = (value: string | undefined | null): string => {
  const sessionId = normalizeSessionId(String(value ?? ""));
  if (!sessionId) {
    throw new Error("Session id is required");
  }

  return sessionId;
};

const describeDisconnectReason = (statusCode?: number): string => {
  if (statusCode == null) {
    return "unknown";
  }

  switch (statusCode) {
    case DisconnectReason.badSession:
      return "bad_session";
    case DisconnectReason.connectionClosed:
      return "connection_closed";
    case DisconnectReason.connectionLost:
      return "connection_lost";
    case DisconnectReason.connectionReplaced:
      return "connection_replaced";
    case DisconnectReason.loggedOut:
      return "logged_out";
    case DisconnectReason.multideviceMismatch:
      return "multidevice_mismatch";
    case DisconnectReason.restartRequired:
      return "restart_required";
    case DisconnectReason.timedOut:
      return "timed_out";
    default:
      return `status_code_${statusCode}`;
  }
};

const readSessionStates = async (): Promise<SessionState[]> => {
  const rows = await getConfigValue<SessionState[]>(CONFIG_WA_SESSIONS_KEY);
  return rows ?? [];
};

const upsertSessionState = async (sessionId: string, patch: Partial<SessionState>): Promise<void> => {
  const rows = await readSessionStates();
  const index = rows.findIndex((row) => row.sessionId === sessionId);
  const now = new Date().toISOString();
  const base: SessionState = {
    sessionId,
    connected: false,
    qr: null,
    lastHeartbeat: now,
    lastError: null,
    jid: null,
    displayName: null,
    phoneNumber: null,
    connectedAt: null,
    disconnectedAt: null,
    disconnectedReason: null,
    disconnectedCode: null
  };

  if (index >= 0) {
    rows[index] = { ...rows[index], ...patch, sessionId };
  } else {
    rows.push({ ...base, ...patch, sessionId });
  }

  await upsertConfigValue(CONFIG_WA_SESSIONS_KEY, rows);
  const connectedCount = rows.filter((row) => row.connected).length;
  const firstDisconnected = rows.find((row) => !row.connected);
  await updateWorkerHeartbeat(connectedCount > 0, firstDisconnected?.qr ?? undefined, firstDisconnected?.lastError ?? null);
};

const extractText = (message: WAMessage): string => {
  const msg = message.message;
  if (!msg) {
    return "";
  }

  if (msg.conversation) {
    return msg.conversation;
  }

  if (msg.extendedTextMessage?.text) {
    return msg.extendedTextMessage.text;
  }

  return "";
};

const shouldHandleMessage = async (jid: string, text: string, isGroup: boolean): Promise<boolean> => {
  const allowlisted = await isAllowlistedConversation(jid);
  if (!allowlisted) {
    return false;
  }

  if (!isGroup) {
    return true;
  }

  return text.includes("@bot") || text.toLowerCase().startsWith("bot ");
};

const handleIncomingMessage = async (sock: WASocket, message: WAMessage): Promise<void> => {
  const jid = message.key.remoteJid;
  if (!jid || message.key.fromMe) {
    return;
  }

  const text = extractText(message).trim();
  if (!text) {
    return;
  }

  const isGroup = jid.endsWith("@g.us");
  await recordInboundMessage({
    jid,
    text,
    displayName: message.pushName,
    isGroup
  });

  const allowed = await shouldHandleMessage(jid, text, isGroup);
  if (!allowed) {
    return;
  }

  await sock.sendPresenceUpdate("composing", jid);

  const result = await runChatTurn({
    jid,
    text,
    displayName: message.pushName,
    isGroup,
    persistInput: false
  });

  await sock.sendMessage(jid, { text: result.reply });
  await sock.sendPresenceUpdate("paused", jid);
};

const connectSession = async (rawSessionId: string): Promise<void> => {
  const sessionId = requireSessionId(rawSessionId);

  if (sockets.has(sessionId)) {
    return;
  }

  await fs.mkdir(authDirFor(sessionId), { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDirFor(sessionId));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" })
  });

  sockets.set(sessionId, sock);
  reconnectAttempts.set(sessionId, 0);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }: any) => {
    if (qr) {
      await upsertSessionState(sessionId, {
        connected: false,
        qr,
        lastHeartbeat: new Date().toISOString(),
        lastError: null
      });
    }

    if (connection === "open") {
      reconnectAttempts.set(sessionId, 0);
      const jid = sock.user?.id ?? null;
      const displayName = sock.user?.name ?? null;
      const phoneNumber = jid ? jid.split(":")[0] : null;
      await upsertSessionState(sessionId, {
        connected: true,
        qr: null,
        jid,
        displayName,
        phoneNumber,
        connectedAt: new Date().toISOString(),
        disconnectedAt: null,
        disconnectedReason: null,
        disconnectedCode: null,
        lastError: null,
        lastHeartbeat: new Date().toISOString()
      });
      logger.info({ sessionId, jid }, "WhatsApp connected");
    }

    if (connection === "close") {
      sockets.delete(sessionId);

      const status = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
      const statusCode = status?.output?.statusCode;
      const disconnectedReason = describeDisconnectReason(statusCode);
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !stoppingSessions.has(sessionId);

      await upsertSessionState(sessionId, {
        connected: false,
        lastError: `closed:${String(statusCode ?? "unknown")}`,
        disconnectedAt: new Date().toISOString(),
        disconnectedReason,
        disconnectedCode: statusCode ?? null,
        lastHeartbeat: new Date().toISOString()
      });

      if (shouldReconnect) {
        const attempt = (reconnectAttempts.get(sessionId) ?? 0) + 1;
        reconnectAttempts.set(sessionId, attempt);
        const delay = nextDelay(attempt);
        await wait(delay);
        await connectSession(sessionId);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ type, messages }: any) => {
    if (type !== "notify") {
      return;
    }

    for (const message of messages) {
      try {
        await handleIncomingMessage(sock, message);
      } catch (error) {
        logger.error({ error, sessionId }, "Failed to handle message");
      }
    }
  });
};

const syncSessionsFromConfig = async (): Promise<void> => {
  const ids = (await getConfigValue<string[]>(CONFIG_WA_SESSION_IDS_KEY)) ?? [];
  const normalized = Array.from(new Set(ids.map((id) => normalizeSessionId(id)).filter(Boolean)));
  const active = new Set(normalized);

  await upsertConfigValue(CONFIG_WA_SESSION_IDS_KEY, normalized);

  for (const sessionId of Array.from(sockets.keys())) {
    if (!active.has(sessionId)) {
      const sock = sockets.get(sessionId);
      if (!sock) {
        continue;
      }

      stoppingSessions.add(sessionId);
      try {
        await sock.logout();
      } finally {
        stoppingSessions.delete(sessionId);
      }
    }
  }

  for (const sessionId of normalized) {
    await connectSession(sessionId);
  }
};

const boot = async (): Promise<void> => {
  await syncSessionsFromConfig();
  await processPendingIngestJobs().catch((error) => {
    logger.error({ error: serializeError(error) }, "Failed to process pending ingest jobs during boot");
  });

  await startControlEventLoop(async (kind, payload) => {
    if (kind === "reload_config") {
      await syncSessionsFromConfig();
      return;
    }

    if (kind === "ingest_document") {
      const payloadObj = (payload ?? {}) as { id?: string };
      const jobId = String(payloadObj.id ?? "").trim();
      if (!jobId) {
        return;
      }

      const jobs = await readIngestConfig();
      const job = jobs.find((item) => item.id === jobId);
      if (!job) {
        return;
      }

      await ingestJobToVectorStore(job);
      return;
    }

    const payloadObj = (payload ?? {}) as { sessionId?: string };
    const sessionId = requireSessionId(payloadObj.sessionId);

    if (kind === "pair") {
      const ids = (await getConfigValue<string[]>(CONFIG_WA_SESSION_IDS_KEY)) ?? [];
      if (!ids.includes(sessionId)) {
        ids.push(sessionId);
        await upsertConfigValue(CONFIG_WA_SESSION_IDS_KEY, ids);
      }
      await connectSession(sessionId);
      return;
    }

    if (kind === "unpair") {
      const sock = sockets.get(sessionId);
      if (sock) {
        stoppingSessions.add(sessionId);
        await sock.logout();
        stoppingSessions.delete(sessionId);
      }
      await upsertSessionState(sessionId, {
        connected: false,
        qr: null,
        lastHeartbeat: new Date().toISOString(),
        lastError: "unpaired_by_user",
        disconnectedAt: new Date().toISOString(),
        disconnectedReason: "unpaired_by_user",
        disconnectedCode: null
      });
    }
  });

  setInterval(() => {
    void processPendingIngestJobs().catch((error) => {
      logger.error({ error: serializeError(error) }, "Queued ingest sweep failed");
    });
  }, 5000);

  setInterval(() => {
    void (async () => {
      const now = new Date().toISOString();
      const ids = Array.from(sockets.keys());
      for (const sessionId of ids) {
        await upsertSessionState(sessionId, {
          lastHeartbeat: now,
          connected: true,
          lastError: null
        });
      }
    })().catch((error: unknown) => {
      logger.error({ error: serializeError(error) }, "Heartbeat update failed");
    });
  }, env.WORKER_HEARTBEAT_MS);
};

void boot().catch(async (error) => {
  logger.error({ error: serializeError(error) }, "Worker crashed during boot");
  await updateWorkerHeartbeat(false, undefined, error instanceof Error ? error.message : String(error));
  process.exit(1);
});
