import { readIngestConfig } from "../file-config";
import IngestClient from "./IngestClient";
import type { IngestJob } from "@chatbot/config";

export const dynamic = "force-dynamic";

export default async function IngestPage() {
  const jobs = (await readIngestConfig()) as IngestJob[];

  return <IngestClient jobs={jobs} />;
}
