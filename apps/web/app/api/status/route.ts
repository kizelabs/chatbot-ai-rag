import { CONFIG_WA_SESSIONS_KEY, getConfigValue } from "@chatbot/db";

interface WaSessionStatus {
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

export async function GET() {
  const sessions = (await getConfigValue<WaSessionStatus[]>(CONFIG_WA_SESSIONS_KEY)) ?? [];
  const connectedCount = sessions.filter((s) => s.connected).length;

  return Response.json({
    connected: connectedCount > 0,
    connectedCount,
    sessions
  });
}
