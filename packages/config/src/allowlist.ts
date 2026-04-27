import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(dirname, "../../../");
const ALLOWLIST_FILE = "allowlist.json";

export const loadAllowlistFromFile = async (rootDir = defaultRepoRoot): Promise<string[]> => {
  try {
    const filePath = path.join(rootDir, ALLOWLIST_FILE);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as string[];
    return parsed.filter((jid) => typeof jid === "string" && jid.trim().length > 0);
  } catch {
    return [];
  }
};
