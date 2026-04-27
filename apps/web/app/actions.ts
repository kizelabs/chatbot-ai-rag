"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  CONFIG_WA_SESSION_IDS_KEY,
  emitControlEvent,
  getConfigValue,
  upsertConfigValue
} from "@chatbot/db";
import type { ModelSpec } from "@chatbot/config";
import {
  readAllowlistConfig,
  readIngestConfig,
  readModelsConfig,
  persistIngestUpload,
  writeModelsJson,
  writeAllowlistConfig,
  writeIngestConfig,
  writeModelsConfig
} from "./file-config";
import type { IngestJob } from "@chatbot/config";

const normalizeAllowlistNumber = (value: string): string => value.replace(/\D/g, "");

const parseOptionalNumber = (value: FormDataEntryValue | null): number | undefined => {
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toAllowlistJid = (value: string): string => {
  const number = normalizeAllowlistNumber(value);
  if (!number) {
    throw new Error("Phone number is required");
  }
  return `${number}@s.whatsapp.net`;
};

const sanitizeModel = (formData: FormData): ModelSpec => ({
  id: String(formData.get("id") ?? "").trim(),
  maxTokens: Number(formData.get("max_tokens") ?? 0),
  temperature: parseOptionalNumber(formData.get("temperature")),
  topP: parseOptionalNumber(formData.get("top_p")),
  reasoningBudget: parseOptionalNumber(formData.get("reasoning_budget")),
  stream: String(formData.get("stream") ?? "").length > 0 ? String(formData.get("stream")) === "true" : undefined,
  enableThinking:
    String(formData.get("enable_thinking") ?? "").length > 0 ? String(formData.get("enable_thinking")) === "true" : undefined,
  toolCapable: String(formData.get("toolCapable") ?? "false") === "true",
  enabled: String(formData.get("enabled") ?? "false") === "true",
  order: Number(formData.get("order") ?? 0)
});

const refreshConfig = async () => {
  await emitControlEvent("reload_config", {});
  revalidatePath("/config");
};

const refreshIngest = async () => {
  revalidatePath("/ingest");
};

const normalizeSessionId = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");

const requireSessionId = (value: string): string => {
  const sessionId = normalizeSessionId(value);
  if (!sessionId) {
    throw new Error("Session id is required");
  }

  return sessionId;
};

export const requestPair = async (formData: FormData) => {
  const sessionId = requireSessionId(String(formData.get("sessionId") ?? ""));
  await emitControlEvent("pair", { sessionId });
  revalidatePath("/status");
  revalidatePath("/pairing");
};

export const requestUnpair = async (formData: FormData) => {
  const sessionId = requireSessionId(String(formData.get("sessionId") ?? ""));
  await emitControlEvent("unpair", { sessionId });
  revalidatePath("/status");
  revalidatePath("/pairing");
};

export const addSession = async (formData: FormData) => {
  const sessionIdRaw = String(formData.get("sessionId") ?? "");
  const sessionId = normalizeSessionId(sessionIdRaw);
  if (!sessionId) {
    throw new Error("Session id is required");
  }

  const ids = (await getConfigValue<string[]>(CONFIG_WA_SESSION_IDS_KEY)) ?? [];
  if (!ids.includes(sessionId)) {
    ids.push(sessionId);
  }
  await upsertConfigValue(CONFIG_WA_SESSION_IDS_KEY, ids);
  await emitControlEvent("pair", { sessionId });
  revalidatePath("/status");
  revalidatePath("/pairing");
};

export const addModel = async (formData: FormData) => {
  const model = sanitizeModel(formData);
  if (!model.id) {
    throw new Error("Model id is required");
  }

  const models = await readModelsConfig();
  models.push(model);
  await writeModelsConfig(models);
  await refreshConfig();
};

export const saveModelsJson = async (formData: FormData) => {
  const raw = String(formData.get("json") ?? "").trim();
  if (!raw) {
    throw new Error("Models JSON is required");
  }

  await writeModelsJson(raw);
  await refreshConfig();
};

export const updateModel = async (formData: FormData) => {
  const index = Number(formData.get("index") ?? -1);
  const model = sanitizeModel(formData);

  const models = await readModelsConfig();
  if (index < 0 || index >= models.length) {
    throw new Error("Invalid model index");
  }

  models[index] = model;
  await writeModelsConfig(models);
  await refreshConfig();
};

export const deleteModel = async (formData: FormData) => {
  const index = Number(formData.get("index") ?? -1);
  const models = await readModelsConfig();
  if (index < 0 || index >= models.length) {
    throw new Error("Invalid model index");
  }

  models.splice(index, 1);
  await writeModelsConfig(models);
  await refreshConfig();
};

export const addAllowlist = async (formData: FormData) => {
  const jid = toAllowlistJid(String(formData.get("jid") ?? "").trim());

  const allowlist = await readAllowlistConfig();
  if (!allowlist.includes(jid)) {
    allowlist.push(jid);
  }

  await writeAllowlistConfig(allowlist);
  await refreshConfig();
};

export const updateAllowlist = async (formData: FormData) => {
  const index = Number(formData.get("index") ?? -1);
  const jid = toAllowlistJid(String(formData.get("jid") ?? "").trim());

  const allowlist = await readAllowlistConfig();
  if (index < 0 || index >= allowlist.length) {
    throw new Error("Invalid allowlist index");
  }

  allowlist[index] = jid;
  await writeAllowlistConfig(allowlist);
  await refreshConfig();
};

export const deleteAllowlist = async (formData: FormData) => {
  const index = Number(formData.get("index") ?? -1);
  const allowlist = await readAllowlistConfig();
  if (index < 0 || index >= allowlist.length) {
    throw new Error("Invalid allowlist index");
  }

  allowlist.splice(index, 1);
  await writeAllowlistConfig(allowlist);
  await refreshConfig();
};

export const retryIngestJob = async (formData: FormData) => {
  const jobId = String(formData.get("id") ?? "").trim();
  if (!jobId) {
    throw new Error("Job id is required");
  }

  const jobs = await readIngestConfig();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index < 0) {
    throw new Error("Invalid ingest job");
  }

  const job = jobs[index];
  jobs[index] = {
    ...job,
    status: "queued",
    stage: "queued",
    lastError: null,
    updatedAt: new Date().toISOString()
  };

  await writeIngestConfig(jobs);
  await emitControlEvent("ingest_document", { id: jobId });
  await refreshIngest();
};

const inferIngestKind = (file: File | null): IngestJob["kind"] => {
  const mime = file?.type.toLowerCase() ?? "";
  const name = file?.name.toLowerCase() ?? "";

  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|tiff?|svg)$/i.test(name)) {
    return "image";
  }

  if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
    return "pdf";
  }

  if (
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/rtf" ||
    /\.(doc|docx|rtf)$/i.test(name)
  ) {
    return "doc";
  }

  if (
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.oasis.opendocument.spreadsheet" ||
    /\.(xls|xlsx|ods)$/i.test(name)
  ) {
    return "sheet";
  }

  if (
    mime === "application/vnd.ms-powerpoint" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.oasis.opendocument.presentation" ||
    /\.(ppt|pptx|odp)$/i.test(name)
  ) {
    return "ppt";
  }

  if (mime.startsWith("text/") || /\.(txt|md|markdown|csv|json|yaml|yml|log|ini|toml)$/i.test(name)) {
    return "text";
  }

  return "text";
};

export const ingestDocument = async (formData: FormData) => {
  const fileEntries = formData
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const now = new Date().toISOString();

  if (fileEntries.length === 0) {
    throw new Error("Upload one or more files");
  }

  const jobs = await readIngestConfig();
  const newJobs: IngestJob[] = [];

  for (const file of fileEntries) {
    const stored = await persistIngestUpload(file);
    const inferredKind = inferIngestKind(file);
    const title = file.name.replace(/\.[^.]+$/, "").trim() || "document";

    newJobs.push({
      id: randomUUID(),
      title,
      kind: inferredKind,
      status: "queued",
      stage: "queued",
      sourceType: "file",
      fileName: stored.fileName,
      filePath: stored.filePath,
      mimeType: file.type || null,
      size: stored.size,
      content: null,
      createdAt: now,
      updatedAt: now
    });
  }

  if (newJobs.length > 0) {
    jobs.unshift(...newJobs);
  }

  await writeIngestConfig(jobs);
  for (const job of newJobs) {
    await emitControlEvent("ingest_document", {
      id: job.id,
      kind: job.kind,
      title: job.title,
      fileName: job.fileName ?? undefined,
      filePath: job.filePath ?? undefined,
      mimeType: job.mimeType ?? undefined,
      size: job.size ?? undefined,
      content: job.content ?? undefined
    });
  }
  await refreshIngest();
};
