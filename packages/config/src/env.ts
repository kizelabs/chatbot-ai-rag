import { config as loadDotEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(dirname, "../../../.env");

loadDotEnv({ path: rootEnvPath });
loadDotEnv();

const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  WORKER_HEARTBEAT_MS: z.coerce.number().default(5000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(20),
  MAX_HISTORY_MESSAGES: z.coerce.number().default(20)
});

const coreEnvSchema = baseEnvSchema.extend({
  NVIDIA_API_KEY: z.string().min(1),
  NVIDIA_EMBEDDING_MODEL: z.string().min(1).default("nv-embed-qa"),
  ZILLIZ_URI: z.string().url(),
  ZILLIZ_TOKEN: z.string().min(1),
  ZILLIZ_COLLECTION: z.string().min(1),
  ZILLIZ_DATABASE: z.string().min(1).optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1)
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type CoreEnv = z.infer<typeof coreEnvSchema>;

let cachedBaseEnv: BaseEnv | null = null;
let cachedCoreEnv: CoreEnv | null = null;

export const loadBaseEnv = (): BaseEnv => {
  if (cachedBaseEnv) {
    return cachedBaseEnv;
  }

  const parsed = baseEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid base environment variables: ${parsed.error.message}`);
  }

  cachedBaseEnv = parsed.data;
  return cachedBaseEnv;
};

export const loadCoreEnv = (): CoreEnv => {
  if (cachedCoreEnv) {
    return cachedCoreEnv;
  }

  const parsed = coreEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid core environment variables: ${parsed.error.message}`);
  }

  cachedCoreEnv = parsed.data;
  return cachedCoreEnv;
};
