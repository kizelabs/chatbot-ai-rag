import { toolRegistry } from "../packages/core/src/tools/index.js";

const usage = `Usage:\n  pnpm tsx scripts/test-tools.ts <tool_name> '<json_args>'\n\nExample:\n  pnpm tsx scripts/test-tools.ts list_sheets '{"spreadsheetId":"..."}'`;

const [toolName, argsRaw] = process.argv.slice(2);

if (!toolName || !argsRaw) {
  console.error(usage);
  process.exit(1);
}

const tool = toolRegistry.find((candidate) => candidate.function.name === toolName);
if (!tool) {
  console.error(`Unknown tool: ${toolName}`);
  process.exit(1);
}

const args = JSON.parse(argsRaw) as Record<string, unknown>;

const run = async () => {
  const result = await tool.execute(args);
  console.log(JSON.stringify(result, null, 2));
};

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
