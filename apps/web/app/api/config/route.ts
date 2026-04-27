import { dbHttp, config } from "@chatbot/db";

export async function GET() {
  const rows = await dbHttp.select().from(config);
  return Response.json(rows);
}
