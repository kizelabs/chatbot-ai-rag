import { loadCoreEnv } from "@chatbot/config";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

type NVIDIAEmbeddingKind = "query" | "passage";

export class NVIDIAEmbeddings {
  private readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly truncate: "NONE" | "START" | "END";

  constructor(options?: { model?: string; apiKey?: string; baseUrl?: string; truncate?: "NONE" | "START" | "END" }) {
    const env = loadCoreEnv();
    this.model = options?.model ?? env.NVIDIA_EMBEDDING_MODEL;
    this.apiKey = options?.apiKey ?? env.NVIDIA_API_KEY;
    this.baseUrl = options?.baseUrl ?? NVIDIA_BASE_URL;
    this.truncate = options?.truncate ?? "END";
  }

  private async embed(input: string | string[], inputType: NVIDIAEmbeddingKind): Promise<number[][]> {
    const endpoint = new URL("embeddings", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        input,
        input_type: inputType,
        truncate: this.truncate
      })
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          data?: Array<{ embedding?: number[] }>;
          error?: string;
          message?: string;
          detail?: string;
          lc_error_code?: string;
        }
      | null;

    if (!response.ok) {
      const detail = payload?.detail ?? payload?.message ?? payload?.error ?? response.statusText;
      const code = payload?.lc_error_code ? ` ${payload.lc_error_code}` : "";
      throw new Error(`NVIDIA embedding request failed (${response.status})${code}: ${detail}`);
    }

    const embeddings = payload?.data?.map((item) => item.embedding).filter((embedding): embedding is number[] => Array.isArray(embedding)) ?? [];
    if (!embeddings.length) {
      throw new Error("NVIDIA embedding request returned no embeddings");
    }

    return embeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embed(text, "query");
    if (!embedding) {
      throw new Error("NVIDIA query embedding returned no vector");
    }
    return embedding;
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return this.embed(documents, "passage");
  }
}

let embeddingsInstance: NVIDIAEmbeddings | null = null;

const getEmbeddings = (): NVIDIAEmbeddings => {
  if (!embeddingsInstance) {
    embeddingsInstance = new NVIDIAEmbeddings();
  }

  return embeddingsInstance;
};

export const embedQuery = async (input: string): Promise<number[]> => getEmbeddings().embedQuery(input);

export const embedPassage = async (input: string): Promise<number[]> => {
  const [vector] = await getEmbeddings().embedDocuments([input]);
  if (!vector) {
    throw new Error("NVIDIA passage embedding returned no vector");
  }
  return vector;
};

export const embedDocuments = async (inputs: string[]): Promise<number[][]> => getEmbeddings().embedDocuments(inputs);
