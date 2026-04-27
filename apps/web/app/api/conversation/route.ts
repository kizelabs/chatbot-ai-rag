import { dbHttp, messages } from "@chatbot/db";
import { asc, eq } from "drizzle-orm";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jid = searchParams.get("jid");

  if (!jid) {
    return new Response("Missing jid", { status: 400 });
  }

  const rows = await dbHttp.select().from(messages).where(eq(messages.jid, jid)).orderBy(asc(messages.createdAt)).limit(500);
  return Response.json(rows);
}
