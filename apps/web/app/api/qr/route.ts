import { CONFIG_WA_SESSIONS_KEY, getConfigValue } from "@chatbot/db";
import QRCode from "qrcode";

interface WaSessionStatus {
  sessionId: string;
  qr: string | null;
}

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = String(searchParams.get("sessionId") ?? "").trim();
  if (!sessionId) {
    return new Response("Session id is required", { status: 400 });
  }

  const sessions = (await getConfigValue<WaSessionStatus[]>(CONFIG_WA_SESSIONS_KEY)) ?? [];
  const session = sessions.find((item) => item.sessionId === sessionId);
  const qrPayload = session?.qr ?? null;

  if (!qrPayload) {
    return new Response("QR payload not available", { status: 404 });
  }

  const png = await QRCode.toBuffer(qrPayload, {
    type: "png",
    width: 320,
    margin: 1,
    color: {
      dark: "#111827",
      light: "#f3f4f6"
    }
  });

  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, max-age=0"
    }
  });
}
