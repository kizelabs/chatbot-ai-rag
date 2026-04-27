import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ModelSpec {
  id: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  enableThinking?: boolean;
  reasoningBudget?: number;
  stream?: boolean;
  toolCapable: boolean;
  enabled: boolean;
  order: number;
}

export interface ModelFileSpec {
  model?: string;
  id?: string;
  max_tokens?: number;
  maxTokens?: number;
  contextWindow?: number;
  temperature?: number;
  top_p?: number;
  topP?: number;
  enable_thinking?: boolean;
  enableThinking?: boolean;
  chat_template_kwargs?: {
    enable_thinking?: boolean;
    thinking?: boolean;
  };
  reasoning_budget?: number;
  reasoningBudget?: number;
  stream?: boolean;
  toolCapable?: boolean;
  enabled?: boolean;
  order?: number;
}

interface ConfigModelsStore {
  getModelsFromConfig: () => Promise<ModelSpec[] | null>;
  upsertModelsInConfig: (models: ModelSpec[]) => Promise<void>;
}

const MODELS_FILE = "models.json";
const dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(dirname, "../../../");

const normalize = (models: ModelSpec[]): ModelSpec[] =>
  models
    .filter((m) => (m.enabled ?? true) && (m.toolCapable ?? true))
    .sort((a, b) => a.order - b.order);

const fromFileModel = (model: ModelFileSpec, index: number): ModelSpec => ({
  id: model.model ?? model.id ?? "",
  maxTokens: model.max_tokens ?? model.maxTokens ?? model.contextWindow ?? 0,
  temperature: model.temperature,
  topP: model.top_p ?? model.topP,
  enableThinking:
    model.enable_thinking ??
    model.enableThinking ??
    model.chat_template_kwargs?.enable_thinking ??
    model.chat_template_kwargs?.thinking,
  reasoningBudget: model.reasoning_budget ?? model.reasoningBudget,
  stream: model.stream,
  toolCapable: model.toolCapable ?? true,
  enabled: model.enabled ?? true,
  order: model.order ?? index + 1
});

const toFileModel = (model: ModelSpec): ModelFileSpec => ({
  model: model.id,
  max_tokens: model.maxTokens,
  temperature: model.temperature,
  top_p: model.topP,
  enable_thinking: model.enableThinking,
  chat_template_kwargs: typeof model.enableThinking === "boolean" ? { enable_thinking: model.enableThinking } : undefined,
  reasoning_budget: model.reasoningBudget,
  stream: model.stream,
  toolCapable: model.toolCapable,
  enabled: model.enabled,
  order: model.order
});

export const deserializeModelsFromFile = (models: ModelFileSpec[]): ModelSpec[] => models.map(fromFileModel);

export const loadModelsFromFile = async (rootDir = defaultRepoRoot): Promise<ModelSpec[]> => {
  const filePath = path.join(rootDir, MODELS_FILE);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as ModelFileSpec[];
  return normalize(parsed.map(fromFileModel));
};

export const serializeModelsForFile = (models: ModelSpec[]): ModelFileSpec[] => models.map(toFileModel);

export const loadModelChain = async (store?: ConfigModelsStore): Promise<ModelSpec[]> => {
  try {
    const fileModels = await loadModelsFromFile();
    if (store) {
      await store.upsertModelsInConfig(fileModels);
    }
    return fileModels;
  } catch {
    if (store) {
      const dbModels = await store.getModelsFromConfig();
      if (dbModels && dbModels.length > 0) {
        return normalize(dbModels);
      }
    }

    return [];
  }
};
