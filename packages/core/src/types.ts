import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type ChatMessage = ChatCompletionMessageParam;

export interface ToolExecutionResult {
  output: unknown;
  isError?: boolean;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
  execute: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

export interface LLMResponse {
  content: string;
  modelUsed: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
}
