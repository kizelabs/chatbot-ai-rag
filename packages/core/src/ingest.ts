import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadCoreEnv, type IngestJob, readIngestConfig, updateIngestJobs } from "@chatbot/config";
import { embedText } from "./embedding.js";

const execFileAsync = promisify(execFile);

interface ZillizCollection {
  collectionName?: string;
  fields?: Array<{
    name?: string;
    type?: string | number;
    params?: Record<string, unknown>;
  }>;
}

const requestZilliz = async (pathName: string, body: Record<string, unknown>): Promise<unknown> => {
  const env = loadCoreEnv();
  const baseUrl = new URL(env.ZILLIZ_URI);
  const response = await fetch(new URL(pathName, baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.ZILLIZ_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = (await response.json().catch(() => null)) as
    | { code?: number; data?: unknown; message?: string; reason?: string }
    | null;

  if (!response.ok || (payload && typeof payload.code === "number" && payload.code !== 0)) {
    const message = payload?.message ?? payload?.reason ?? response.statusText;
    throw new Error(`Zilliz request failed (${response.status}): ${message}`);
  }

  if (!payload) {
    throw new Error("Zilliz request returned an empty response");
  }

  return payload;
};

const getChunkText = (raw: string): string => {
  const text = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

  return text.trim();
};

const runCommand = async (bin: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(bin, args, { maxBuffer: 25 * 1024 * 1024 });
  return getChunkText(stdout);
};

const readBinaryCommand = async (bin: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(bin, args, { maxBuffer: 25 * 1024 * 1024 });
  return stdout;
};

const decodeXml = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const normalizeParagraph = (value: string): string =>
  decodeXml(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripXmlTags = (value: string): string =>
  normalizeParagraph(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  );

const listArchiveEntries = async (filePath: string): Promise<string[]> => {
  try {
    const output = await readBinaryCommand("unzip", ["-Z", "-1", filePath]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    throw new Error(
      `Archive extraction requires the \`unzip\` binary. Install \`unzip\` in the container. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

const readArchiveEntry = async (filePath: string, entry: string): Promise<string> => {
  const output = await readBinaryCommand("unzip", ["-p", filePath, entry]);
  return output;
};

const readMatchingArchiveEntries = async (filePath: string, pattern: RegExp): Promise<string[]> => {
  const entries = await listArchiveEntries(filePath);
  const matched = entries.filter((entry) => pattern.test(entry));
  const contents: string[] = [];
  for (const entry of matched) {
    const raw = await readArchiveEntry(filePath, entry);
    contents.push(raw);
  }
  return contents;
};

const extractParagraphsFromXml = (xml: string, paragraphPattern: RegExp, textPattern: RegExp): string[] => {
  const paragraphs: string[] = [];
  const blocks = xml.match(paragraphPattern) ?? [];
  for (const block of blocks) {
    const texts = Array.from(block.matchAll(textPattern)).map((match) => normalizeParagraph(match[1] ?? ""));
    const combined = texts.filter(Boolean).join(" ").trim();
    if (combined) {
      paragraphs.push(combined);
    }
  }
  return paragraphs;
};

const extractDocxLikeText = async (filePath: string): Promise<string> => {
  const xmlFiles = await readMatchingArchiveEntries(filePath, /^(word\/(document|header\d+|footer\d+)\.xml)$/i);
  const paragraphs: string[] = [];
  for (const xml of xmlFiles) {
    paragraphs.push(...extractParagraphsFromXml(xml, /<w:p\b[\s\S]*?<\/w:p>/g, /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g));
  }
  return getChunkText(paragraphs.join("\n"));
};

const extractPptxText = async (filePath: string): Promise<string> => {
  const xmlFiles = await readMatchingArchiveEntries(filePath, /^ppt\/slides\/slide\d+\.xml$/i);
  const paragraphs: string[] = [];
  for (const xml of xmlFiles) {
    paragraphs.push(...extractParagraphsFromXml(xml, /<a:p\b[\s\S]*?<\/a:p>/g, /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g));
  }
  return getChunkText(paragraphs.join("\n"));
};

const extractXlsxText = async (filePath: string): Promise<string> => {
  const sharedStringsXml = await readMatchingArchiveEntries(filePath, /^xl\/sharedStrings\.xml$/i);
  const sharedStrings: string[] = [];

  if (sharedStringsXml[0]) {
    const entries = sharedStringsXml[0].match(/<si\b[\s\S]*?<\/si>/g) ?? [];
    for (const entry of entries) {
      const parts = Array.from(entry.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((match) => normalizeParagraph(match[1] ?? ""));
      sharedStrings.push(parts.filter(Boolean).join(" "));
    }
  }

  const sheets = await readMatchingArchiveEntries(filePath, /^xl\/worksheets\/sheet\d+\.xml$/i);
  const lines: string[] = [];

  for (const sheetXml of sheets) {
    const rows = sheetXml.match(/<row\b[\s\S]*?<\/row>/g) ?? [];
    for (const row of rows) {
      const cells = row.match(/<c\b[\s\S]*?<\/c>/g) ?? [];
      const values: string[] = [];
      for (const cell of cells) {
        const typeMatch = cell.match(/\bt="([^"]+)"/i);
        const type = typeMatch?.[1] ?? "";
        const inline = cell.match(/<is\b[\s\S]*?<\/is>/i);
        const valueMatch = cell.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);

        if (type === "s" && valueMatch) {
          const index = Number(normalizeParagraph(valueMatch[1] ?? ""));
          if (Number.isFinite(index)) {
            const shared = sharedStrings[index];
            if (shared) {
              values.push(shared);
            }
          }
          continue;
        }

        if (inline) {
          const textParts = Array.from(cell.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((match) => normalizeParagraph(match[1] ?? ""));
          const inlineText = textParts.filter(Boolean).join(" ");
          if (inlineText) {
            values.push(inlineText);
          }
          continue;
        }

        if (valueMatch) {
          const value = normalizeParagraph(valueMatch[1] ?? "");
          if (value) {
            values.push(value);
          }
        }
      }

      const combined = values.filter(Boolean).join("\t").trim();
      if (combined) {
        lines.push(combined);
      }
    }
  }

  return getChunkText(lines.join("\n"));
};

const extractOdfText = async (filePath: string): Promise<string> => {
  const xmlFiles = await readMatchingArchiveEntries(filePath, /^content\.xml$/i);
  const paragraphs: string[] = [];
  for (const xml of xmlFiles) {
    const blocks = xml.match(/<text:p\b[\s\S]*?<\/text:p>/g) ?? [];
    for (const block of blocks) {
      const text = stripXmlTags(
        block
          .replace(/<text:s\b[^>]*\/>/g, " ")
          .replace(/<text:tab\b[^>]*\/>/g, "\t")
          .replace(/<text:line-break\b[^>]*\/>/g, "\n")
      );
      if (text) {
        paragraphs.push(text);
      }
    }
  }
  return getChunkText(paragraphs.join("\n"));
};

const extractWithLibreOffice = async (filePath: string): Promise<string> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ingest-office-"));

  try {
    await execFileAsync(
      "soffice",
      [
        "--headless",
        "--nologo",
        "--nolockcheck",
        "--norestore",
        "--nodefault",
        "--convert-to",
        "txt",
        "--outdir",
        tempDir,
        filePath
      ],
      { maxBuffer: 25 * 1024 * 1024 }
    );

    const baseName = path.parse(filePath).name;
    const exactPath = path.join(tempDir, `${baseName}.txt`);
    const exactExists = await fs
      .access(exactPath)
      .then(() => true)
      .catch(() => false);
    const fallbackFiles = exactExists ? [] : await fs.readdir(tempDir);
    const candidate = fallbackFiles.find((entry) => entry.toLowerCase().endsWith(".txt"));
    const convertedPath = exactExists ? exactPath : candidate ? path.join(tempDir, candidate) : null;

    if (!convertedPath) {
      throw new Error("LibreOffice did not produce an extractable text file");
    }

    const converted = await fs.readFile(convertedPath, "utf8");
    return getChunkText(converted);
  } catch (error) {
    throw new Error(
      `Office extraction requires LibreOffice for legacy binary files. Install \`libreoffice\` in the container. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const extractPdfText = async (filePath: string): Promise<string> => {
  try {
    return await runCommand("pdftotext", ["-layout", "-nopgbrk", filePath, "-"]);
  } catch (error) {
    throw new Error(
      `PDF extraction requires the \`pdftotext\` binary. Install \`poppler-utils\` in the container. ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const extractImageText = async (filePath: string): Promise<string> => {
  try {
    return await runCommand("tesseract", [filePath, "stdout", "-l", "eng+ind", "--oem", "1", "--psm", "6"]);
  } catch (error) {
    throw new Error(
      `Image OCR requires the \`tesseract\` binary. Install \`tesseract-ocr\` and \`tesseract-ocr-ind\` in the container. ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const extractOfficeText = async (filePath: string): Promise<string> => {
  const lower = filePath.toLowerCase();

  if (lower.endsWith(".docx")) {
    return extractDocxLikeText(filePath);
  }

  if (lower.endsWith(".xlsx")) {
    return extractXlsxText(filePath);
  }

  if (lower.endsWith(".pptx")) {
    return extractPptxText(filePath);
  }

  if (lower.endsWith(".odt") || lower.endsWith(".ods") || lower.endsWith(".odp")) {
    return extractOdfText(filePath);
  }

  if (lower.endsWith(".doc") || lower.endsWith(".xls") || lower.endsWith(".ppt")) {
    return extractWithLibreOffice(filePath);
  }

  return extractWithLibreOffice(filePath);
};

const extractTextFromFile = async (kind: IngestJob["kind"], filePath: string, inlineContent?: string | null): Promise<string> => {
  if (kind === "text") {
    return getChunkText(inlineContent ?? (await fs.readFile(filePath, "utf8")));
  }

  if (kind === "pdf") {
    return extractPdfText(filePath);
  }

  if (kind === "doc" || kind === "sheet" || kind === "ppt") {
    return extractOfficeText(filePath);
  }

  return extractImageText(filePath);
};

const chunkText = (text: string, maxChars = 1800, overlapChars = 250): string[] => {
  const normalized = getChunkText(text);
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
    current = "";
  };

  for (const paragraph of paragraphs) {
    const segments = paragraph.split(/(?<=[.!?])\s+/g);
    for (const segment of segments) {
      const part = segment.trim();
      if (!part) {
        continue;
      }

      if (!current) {
        current = part;
        continue;
      }

      if ((current + "\n\n" + part).length <= maxChars) {
        current = `${current}\n\n${part}`;
        continue;
      }

      const tail = current.slice(Math.max(0, current.length - overlapChars)).trim();
      pushCurrent();
      current = tail ? `${tail}\n\n` : "";

      if (part.length > maxChars) {
        const words = part.split(/\s+/);
        let sub = "";
        for (const word of words) {
          if (!sub) {
            sub = word;
            continue;
          }

          if ((sub + " " + word).length <= maxChars) {
            sub = `${sub} ${word}`;
            continue;
          }

          chunks.push(sub.trim());
          sub = word;
        }

        current = sub;
      } else {
        current = part;
      }
    }
  }

  pushCurrent();
  return chunks;
};

const updateJobProgress = async (
  jobId: string,
  patch: Partial<Pick<IngestJob, "status" | "stage" | "lastError" | "chunkCount" | "indexedAt">>
): Promise<void> => {
  await updateIngestJobs((jobs) =>
    jobs.map((item) =>
      item.id === jobId
        ? {
            ...item,
            ...patch,
            updatedAt: new Date().toISOString()
          }
        : item
    )
  );
};

const getCollectionInfo = async () => {
  const env = loadCoreEnv();

  const describePayload = await requestZilliz("/v2/vectordb/collections/describe", {
    ...(env.ZILLIZ_DATABASE ? { dbName: env.ZILLIZ_DATABASE } : {}),
    collectionName: env.ZILLIZ_COLLECTION
  });
  const collection = ((describePayload as { data?: ZillizCollection }).data ?? describePayload) as ZillizCollection;
  const fields = Array.isArray(collection.fields) ? collection.fields : [];
  const vectorField = fields.find((field) => String(field.type ?? "").toUpperCase().includes("VECTOR"))?.name ?? "vector";

  return {
    collectionName: env.ZILLIZ_COLLECTION,
    dbName: env.ZILLIZ_DATABASE,
    vectorField
  };
};

const insertChunks = async (
  chunks: Array<{
    id: string;
    vector: number[];
    metadata: Record<string, unknown>;
  }>
): Promise<void> => {
  const info = await getCollectionInfo();
  const batchSize = 50;

  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    await requestZilliz("/v2/vectordb/entities/insert", {
      ...(info.dbName ? { dbName: info.dbName } : {}),
      collectionName: info.collectionName,
      data: batch
    });
  }
};

export const ingestJobToVectorStore = async (job: IngestJob): Promise<void> => {
  const currentJobs = await readIngestConfig();
  const current = currentJobs.find((item) => item.id === job.id);
  if (!current || current.status === "stored" || current.status === "processing") {
    return;
  }

  const now = new Date().toISOString();
  await updateJobProgress(job.id, { status: "processing", stage: "extracting", lastError: null });

  try {
    const extractedText = await extractTextFromFile(job.kind, job.filePath ?? "", job.content);
    await updateJobProgress(job.id, { stage: "chunking" });
    const chunks = chunkText(extractedText);

    if (chunks.length === 0) {
      await updateJobProgress(job.id, {
        status: "error",
        stage: "error",
        lastError: "No extractable text found"
      });
      return;
    }

    await updateJobProgress(job.id, { stage: "embedding" });
    const prepared = await Promise.all(
      chunks.map(async (text, index) => {
        const vector = await embedText(`passage: ${text}`);
        return {
          id: `${job.id}:${index}`,
          vector,
          metadata: {
            jobId: job.id,
            title: job.title,
            sourceDocument: job.title,
            kind: job.kind,
            sourceType: job.sourceType,
            fileName: job.fileName,
            filePath: job.filePath,
            mimeType: job.mimeType,
            size: job.size,
            chunkIndex: index,
            chunkCount: chunks.length,
            text: `passage: ${text}`,
            extractedAt: now
          }
        };
      })
    );

    await updateJobProgress(job.id, { stage: "indexing" });
    await insertChunks(prepared);

    await updateJobProgress(job.id, {
      status: "stored",
      stage: "stored",
      chunkCount: chunks.length,
      indexedAt: new Date().toISOString(),
      lastError: null
    });
  } catch (error) {
    await updateJobProgress(job.id, {
      status: "error",
      stage: "error",
      lastError: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

export const processPendingIngestJobs = async (): Promise<void> => {
  const jobs = await readIngestConfig();
  for (const job of jobs) {
    if (job.status === "stored") {
      continue;
    }

    if (job.status === "processing") {
      continue;
    }

    if (job.kind === "text" && !job.content && !job.filePath) {
      continue;
    }

    await ingestJobToVectorStore(job);
  }
};
