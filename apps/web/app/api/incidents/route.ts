import { dbHttp, incidents } from "@chatbot/db";
import { desc } from "drizzle-orm";

export async function GET() {
  const rows = await dbHttp.select().from(incidents).orderBy(desc(incidents.createdAt)).limit(200);
  return Response.json(rows);
}
