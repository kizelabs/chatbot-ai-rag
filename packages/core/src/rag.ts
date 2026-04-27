import { loadCoreEnv } from "@chatbot/config";
import { embedText } from "./embedding.js";

interface RagChunk {
  id: string;
  score: number;
  text: string;
  source?: string;
}

interface ZillizField {
  name?: string;
  type?: string | number;
  params?: Record<string, unknown>;
  primaryKey?: boolean;
  is_primary?: boolean;
}

interface ZillizCollection {
  collectionName?: string;
  load?: string;
  loadState?: string;
  fields?: ZillizField[];
  indexes?: Array<{
    fieldName?: string;
    metricType?: string;
  }>;
}

interface ZillizSearchHit {
  id?: string | number;
  score?: number;
  distance?: number;
  entity?: Record<string, unknown>;
  [key: string]: unknown;
}

const STOPWORDS = new Set([
  "about",
  "a",
  "ada",
  "agar",
  "an",
  "and",
  "any",
  "akan",
  "aku",
  "anda",
  "apakah",
  "atau",
  "are",
  "as",
  "at",
  "bagaimana",
  "bagi",
  "bulan",
  "buat",
  "can",
  "could",
  "dalam",
  "dan",
  "dari",
  "dengan",
  "di",
  "did",
  "does",
  "do",
  "for",
  "from",
  "guna",
  "hari",
  "have",
  "has",
  "had",
  "how",
  "i",
  "ini",
  "itu",
  "is",
  "jadi",
  "jika",
  "juga",
  "ke",
  "kak",
  "karena",
  "kami",
  "kamu",
  "lagi",
  "lebih",
  "mau",
  "me",
  "month",
  "mohon",
  "my",
  "not",
  "now",
  "on",
  "of",
  "or",
  "pada",
  "per",
  "please",
  "some",
  "such",
  "saat",
  "sebagai",
  "sebuah",
  "semua",
  "serta",
  "siapa",
  "there",
  "sudah",
  "the",
  "this",
  "to",
  "today",
  "was",
  "were",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would",
  "you",
  "your",
  "our",
  "their",
  "untuk",
  "yang"
]);

const PROMO_KEYWORDS = [
  "promo",
  "promosi",
  "diskon",
  "discount",
  "potongan",
  "sale",
  "voucher",
  "deal",
  "deals",
  "penawaran",
  "cashback",
  "bundling",
  "bundle",
  "spesial",
  "special"
];

let collectionInfoPromise: Promise<{
  collectionName: string;
  dbName?: string;
  vectorField: string;
  metadataField: string;
} | null> | null = null;

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value && typeof value === "object") {
    const sourceId = (value as { source_id?: unknown }).source_id;
    if (typeof sourceId === "string" && sourceId.trim()) {
      return sourceId.trim();
    }

    const text = JSON.stringify(value);
    return text === "{}" ? undefined : text;
  }

  return undefined;
};

const parseMetadata = (value: unknown): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
};

const parseTextFromMetadata = (metadata: unknown): string | undefined => {
  const parsed = parseMetadata(metadata);
  if (!parsed) {
    return toStringValue(metadata);
  }

  const text =
    toStringValue(parsed.text) ??
    toStringValue(parsed.content) ??
    toStringValue(parsed.chunk) ??
    toStringValue(parsed.body) ??
    toStringValue(parsed.page_content) ??
    toStringValue(parsed.message) ??
    toStringValue(parsed.metadata) ??
    toStringValue(parsed);

  if (!text) {
    return undefined;
  }

  return text.startsWith("passage: ") ? text.slice("passage: ".length) : text;
};

const normalizeSearchTerm = (term: string): string | null => {
  const normalized = term
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  return normalized || null;
};

const toTitleCase = (term: string): string => {
  return term
    .split(" ")
    .map((part) => {
      if (!part) {
        return part;
      }

      return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(" ");
};

const escapeLikePattern = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const extractSearchTerms = (query: string): string[] => {
  const rawTerms = query
    .split(/[^\p{L}\p{N}]+/u)
    .map(normalizeSearchTerm)
    .filter((term): term is string => !!term);

  const expandedTerms = rawTerms.flatMap((term) => {
    const variants = new Set([term, toTitleCase(term).toLowerCase()]);
    return [...variants];
  });

  return [...new Set(expandedTerms)].filter((term) => term.length >= 3 && !STOPWORDS.has(term));
};

const isPromoInquiry = (terms: string[]): boolean => terms.some((term) => PROMO_KEYWORDS.includes(term));

const buildMetadataLikeFilter = (terms: string[]): string | null => {
  const uniqueTerms = [...new Set(terms)]
    .map(normalizeSearchTerm)
    .filter((term): term is string => !!term)
    .filter((term) => term.length >= 3)
    .slice(0, 8);

  if (uniqueTerms.length === 0) {
    return null;
  }

  const fields = ['metadata["text"]', 'metadata["title"]', 'metadata["sourceDocument"]'];
  const clauses = uniqueTerms.flatMap((term) => {
    const variants = [...new Set([term, toTitleCase(term), term.toUpperCase()])];
    return variants.flatMap((variant) => {
      const pattern = escapeLikePattern(`%${variant}%`);
      return fields.map((field) => `${field} LIKE "${pattern}"`);
    });
  });

  return clauses.length > 0 ? `(${clauses.join(" OR ")})` : null;
};

const extractRows = (payload: unknown): unknown[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload as { data?: unknown; results?: unknown };
  for (const candidate of [root.data, root.results]) {
    if (Array.isArray(candidate)) {
      return candidate;
    }

    if (candidate && typeof candidate === "object") {
      const nested = (candidate as { results?: unknown }).results;
      if (Array.isArray(nested)) {
        return nested;
      }
    }
  }

  return [];
};

const extractEntity = (row: unknown): Record<string, unknown> => {
  if (row && typeof row === "object" && !Array.isArray(row)) {
    const entity = (row as { entity?: unknown }).entity;
    if (entity && typeof entity === "object" && !Array.isArray(entity)) {
      return entity as Record<string, unknown>;
    }

    return row as Record<string, unknown>;
  }

  return {};
};

const getChunkFromEntity = (
  entity: Record<string, unknown>,
  collectionInfo: { metadataField: string },
  idFallback: string,
  scoreFallback = 0
): RagChunk | null => {
  const metadata = parseMetadata(entity[collectionInfo.metadataField] ?? entity.metadata);
  const text =
    parseTextFromMetadata(metadata) ??
    toStringValue(entity.text) ??
    toStringValue(entity.content) ??
    toStringValue(entity.chunk) ??
    toStringValue(entity.body);

  if (!text) {
    return null;
  }

  const source =
    toStringValue(metadata?.sourceDocument) ??
    toStringValue(metadata?.title) ??
    toStringValue(metadata?.source) ??
    toStringValue(metadata?.file_name) ??
    toStringValue(metadata?.filename) ??
    toStringValue(metadata?.doc_id) ??
    toStringValue(metadata?.document) ??
    toStringValue(entity.source) ??
    toStringValue(entity.file_name) ??
    toStringValue(entity.filename) ??
    toStringValue(entity.doc_id) ??
    toStringValue(entity.document);

  const score =
    typeof entity.score === "number"
      ? entity.score
      : typeof entity.distance === "number"
        ? entity.distance
        : scoreFallback;

  return {
    id: String(entity.id ?? idFallback),
    score,
    text,
    source
  };
};

const getChunkFromRow = (
  row: unknown,
  collectionInfo: { metadataField: string },
  idFallback: string
): RagChunk | null => {
  const entity = extractEntity(row);
  const scoreFallback =
    row && typeof row === "object" && !Array.isArray(row)
      ? typeof (row as { score?: unknown }).score === "number"
        ? (row as { score?: number }).score ?? 0
        : typeof (row as { distance?: unknown }).distance === "number"
          ? (row as { distance?: number }).distance ?? 0
          : 0
      : 0;

  return getChunkFromEntity(entity, collectionInfo, idFallback, scoreFallback);
};

const rankChunk = (chunk: RagChunk, terms: string[], index: number): number => {
  if (terms.length === 0) {
    return -index;
  }

  const haystack = `${chunk.source ?? ""}\n${chunk.text}`.toLowerCase();
  const normalizedTerms = terms.map((term) => term.toLowerCase());
  const lexicalHits = normalizedTerms.filter((term) => haystack.includes(term)).length;
  const sourceHits =
    chunk.source && normalizedTerms.some((term) => chunk.source!.toLowerCase().includes(term)) ? 2 : 0;
  const exactTitleHit =
    chunk.source && normalizedTerms.some((term) => chunk.source!.toLowerCase() === term) ? 2 : 0;

  return lexicalHits * 10 + sourceHits + exactTitleHit - index / 1000;
};

const isVectorField = (field: ZillizField): boolean => {
  const type = String(field.type ?? "").toUpperCase();
  if (type.includes("SPARSE")) {
    return false;
  }

  if (type.includes("VECTOR")) {
    return true;
  }

  return field.params?.dim != null;
};

const pickFieldName = (fields: ZillizField[], preferredNames: string[]): string | undefined => {
  for (const preferred of preferredNames) {
    const match = fields.find((field) => field.name === preferred);
    if (match?.name) {
      return match.name;
    }
  }

  return undefined;
};

const requestZilliz = async (path: string, body: Record<string, unknown>): Promise<unknown> => {
  const env = loadCoreEnv();
  const baseUrl = new URL(env.ZILLIZ_URI);
  const response = await fetch(new URL(path, baseUrl), {
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

const loadCollectionInfo = async () => {
  const env = loadCoreEnv();

  if (!env.ZILLIZ_URI || !env.ZILLIZ_COLLECTION) {
    return null;
  }

  const describePayload = await requestZilliz("/v2/vectordb/collections/describe", {
    ...(env.ZILLIZ_DATABASE ? { dbName: env.ZILLIZ_DATABASE } : {}),
    collectionName: env.ZILLIZ_COLLECTION
  });
  const collection = ((describePayload as { data?: ZillizCollection }).data ??
    describePayload) as ZillizCollection;

  const fields = Array.isArray(collection.fields) ? collection.fields : [];
  const vectorField = pickFieldName(fields, ["vector"]) ?? fields.find(isVectorField)?.name;
  if (!vectorField) {
    throw new Error(`No vector field found in Zilliz collection "${env.ZILLIZ_COLLECTION}"`);
  }

  const metadataField = pickFieldName(fields, ["metadata"]) ?? "metadata";

  try {
    await requestZilliz("/v2/vectordb/collections/load", {
      ...(env.ZILLIZ_DATABASE ? { dbName: env.ZILLIZ_DATABASE } : {}),
      collectionName: env.ZILLIZ_COLLECTION
    });
  } catch (error) {
    console.warn("Failed to load Zilliz collection before retrieval:", error);
  }

  return {
    collectionName: env.ZILLIZ_COLLECTION,
    dbName: env.ZILLIZ_DATABASE,
    vectorField,
    metadataField
  };
};

const getCollectionInfo = async () => {
  if (!collectionInfoPromise) {
    collectionInfoPromise = loadCollectionInfo().catch((error) => {
      console.warn("Failed to initialize Zilliz retrieval:", error);
      return null;
    });
  }

  return collectionInfoPromise;
};

const parseSearchHits = (
  payload: unknown,
  collectionInfo: { metadataField: string }
): RagChunk[] => {
  const rows = extractRows(payload);

  return rows
    .map((row, index): RagChunk | null => {
      return getChunkFromRow(row, collectionInfo, String(index));
    })
    .filter((chunk): chunk is RagChunk => chunk !== null);
};

const searchMilvus = async (
  queryEmbedding: number[],
  passageEmbedding?: number[]
): Promise<RagChunk[]> => {
  const collectionInfo = await getCollectionInfo();

  if (!collectionInfo) {
    return [];
  }

  const buildSearchBody = (queryEmbedding: number[]) => ({
    ...(collectionInfo.dbName ? { dbName: collectionInfo.dbName } : {}),
    collectionName: collectionInfo.collectionName,
    data: [queryEmbedding],
    annsField: collectionInfo.vectorField,
    limit: 8,
    outputFields: [collectionInfo.metadataField]
  });

  const [primarySearch, secondarySearch] = await Promise.all([
    requestZilliz("/v2/vectordb/entities/search", buildSearchBody(queryEmbedding)),
    passageEmbedding
      ? requestZilliz("/v2/vectordb/entities/search", buildSearchBody(passageEmbedding))
      : Promise.resolve({ data: [] })
  ]);

  const hits = parseSearchHits(primarySearch, collectionInfo);
  const secondaryHits = parseSearchHits(secondarySearch, collectionInfo);

  const mergedHits = [...hits, ...secondaryHits].filter((hit, index, all) => {
    const id = String(hit.id ?? index);
    return all.findIndex((candidate, candidateIndex) => String(candidate.id ?? candidateIndex) === id) === index;
  });

  return mergedHits;
};

const queryMilvus = async (filter: string): Promise<RagChunk[]> => {
  const collectionInfo = await getCollectionInfo();

  if (!collectionInfo) {
    return [];
  }

  const payload = await requestZilliz("/v2/vectordb/entities/query", {
    ...(collectionInfo.dbName ? { dbName: collectionInfo.dbName } : {}),
    collectionName: collectionInfo.collectionName,
    filter,
    outputFields: [collectionInfo.metadataField],
    limit: 20
  });

  return extractRows(payload)
    .map((row, index): RagChunk | null => {
      return getChunkFromRow(row, collectionInfo, `query-${index}`);
    })
    .filter((chunk): chunk is RagChunk => chunk !== null);
};

export const retrieveContext = async (query: string): Promise<string> => {
  try {
    const terms = extractSearchTerms(query);
    const [queryVector, passageVector] = await Promise.all([embedText(`query: ${query}`), embedText(`passage: ${query}`)]);
    const chunks = await searchMilvus(queryVector, passageVector);
    const fallbackFilter = buildMetadataLikeFilter(
      isPromoInquiry(terms) ? [...terms, ...PROMO_KEYWORDS] : terms
    );
    const fallbackChunks = fallbackFilter ? await queryMilvus(fallbackFilter) : [];

    const mergedChunks = [...chunks, ...fallbackChunks].filter((chunk, index, all) => {
      return all.findIndex((candidate) => candidate.id === chunk.id) === index;
    });

    const rankedChunks = mergedChunks
      .map((chunk, index) => ({
        chunk,
        rank: rankChunk(chunk, terms, index)
      }))
      .sort((left, right) => right.rank - left.rank)
      .map(({ chunk }) => chunk);

    if (rankedChunks.length === 0) {
      return "";
    }

    const formatted = rankedChunks
      .map(
        (chunk, index) =>
          `#${index + 1} (${chunk.score.toFixed(4)}) ${chunk.source ?? "unknown"}\n${chunk.text}`
      )
      .join("\n\n");

    return `Retrieved context:\n${formatted}`;
  } catch (error) {
    console.warn("RAG retrieval failed:", error);
    return "";
  }
};
