import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface IngestJob {
  id: string;
  title: string;
  kind: "text" | "doc" | "sheet" | "ppt" | "pdf" | "image";
  status: "ready" | "queued" | "processing" | "stored" | "error";
  stage?: "queued" | "extracting" | "chunking" | "embedding" | "indexing" | "stored" | "error" | null;
  sourceType: "inline" | "file";
  fileName: string | null;
  filePath: string | null;
  mimeType: string | null;
  size: number | null;
  content: string | null;
  createdAt: string;
  updatedAt: string;
  chunkCount?: number | null;
  indexedAt?: string | null;
  lastError?: string | null;
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(dirname, "../../../");
const INGEST_FILE = "ingest.json";

const readJson = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

export const readIngestConfig = async (rootDir = defaultRepoRoot): Promise<IngestJob[]> => {
  const filePath = path.join(rootDir, INGEST_FILE);
  return readJson<IngestJob[]>(filePath, []);
};

export const writeIngestConfig = async (jobs: IngestJob[], rootDir = defaultRepoRoot): Promise<void> => {
  const filePath = path.join(rootDir, INGEST_FILE);
  await writeJson(filePath, jobs);
};

export const upsertIngestJob = async (
  jobId: string,
  patch: Partial<IngestJob>,
  rootDir = defaultRepoRoot
): Promise<IngestJob[]> => {
  const jobs = await readIngestConfig(rootDir);
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index >= 0) {
    jobs[index] = { ...jobs[index], ...patch, id: jobId, updatedAt: new Date().toISOString() };
  }
  await writeIngestConfig(jobs, rootDir);
  return jobs;
};

export const updateIngestJobs = async (
  updater: (jobs: IngestJob[]) => IngestJob[] | Promise<IngestJob[]>,
  rootDir = defaultRepoRoot
): Promise<IngestJob[]> => {
  const jobs = await readIngestConfig(rootDir);
  const next = await updater(jobs);
  await writeIngestConfig(next, rootDir);
  return next;
};
