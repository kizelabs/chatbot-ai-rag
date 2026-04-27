import { dbHttp, conversations } from "@chatbot/db";
import { desc } from "drizzle-orm";

export async function GET() {
  const rows = await dbHttp.select().from(conversations).orderBy(desc(conversations.updatedAt)).limit(200);
  return Response.json(rows);
}
