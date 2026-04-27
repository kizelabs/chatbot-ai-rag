import { readIngestConfig } from "../../file-config";

export async function GET() {
  const jobs = await readIngestConfig();

  return Response.json({
    jobs,
    refreshedAt: new Date().toISOString()
  });
}
