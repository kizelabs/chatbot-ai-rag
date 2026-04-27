import { encoding_for_model } from "tiktoken";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const encoder = encoding_for_model("gpt-4o-mini");

const stringifyMessage = (message: ChatCompletionMessageParam): string => {
  const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
  return `${message.role}:${content}`;
};

export const countChatTokens = (messages: ChatCompletionMessageParam[]): number =>
  messages.reduce((sum, message) => sum + encoder.encode(stringifyMessage(message)).length + 8, 0);

export const trimToTokenBudget = (
  messages: ChatCompletionMessageParam[],
  maxTokens: number
): ChatCompletionMessageParam[] => {
  if (countChatTokens(messages) <= maxTokens) {
    return messages;
  }

  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");

  while (rest.length > 2 && countChatTokens([...system, ...rest]) > maxTokens) {
    rest.shift();
    rest.shift();
  }

  return [...system, ...rest];
};
