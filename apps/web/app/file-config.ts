import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deserializeModelsFromFile,
  readIngestConfig as sharedReadIngestConfig,
  serializeModelsForFile,
  type IngestJob,
  type ModelFileSpec,
  type ModelSpec,
  writeIngestConfig as sharedWriteIngestConfig
} from "@chatbot/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

const MODELS_FILE = path.join(repoRoot, "models.json");
const ALLOWLIST_FILE = path.join(repoRoot, "allowlist.json");
const INGEST_DIR = path.join(repoRoot, "data", "ingest");

const safeParse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const readJson = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return safeParse(raw, fallback);
  } catch {
    return fallback;
  }
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

export const readModelsConfig = async (): Promise<ModelSpec[]> => {
  const raw = await readJson<ModelFileSpec[]>(MODELS_FILE, []);

  return deserializeModelsFromFile(raw);
};

export const readModelsJson = async (): Promise<string> => {
  try {
    return await fs.readFile(MODELS_FILE, "utf8");
  } catch {
    return "[]\n";
  }
};

export const writeModelsConfig = async (models: ModelSpec[]): Promise<void> => {
  await writeJson(MODELS_FILE, serializeModelsForFile(models));
};

export const writeModelsJson = async (raw: string): Promise<void> => {
  const parsed = JSON.parse(raw) as unknown;
  await writeJson(MODELS_FILE, parsed);
};

export const readAllowlistConfig = async (): Promise<string[]> => readJson<string[]>(ALLOWLIST_FILE, []);

export const writeAllowlistConfig = async (allowlist: string[]): Promise<void> => {
  await writeJson(ALLOWLIST_FILE, allowlist);
};

const sanitizeFileName = (value: string): string => {
  const base = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return base.replace(/-+/g, "-").replace(/^-|-$/g, "") || "document";
};

export const persistIngestUpload = async (file: File): Promise<{ fileName: string; filePath: string; size: number }> => {
  await fs.mkdir(INGEST_DIR, { recursive: true });

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileName = `${randomUUID()}-${sanitizeFileName(file.name)}`;
  const filePath = path.join(INGEST_DIR, fileName);
  await fs.writeFile(filePath, bytes);

  return {
    fileName,
    filePath,
    size: bytes.length
  };
};

export const readIngestConfig = sharedReadIngestConfig;

export const writeIngestConfig = sharedWriteIngestConfig;
