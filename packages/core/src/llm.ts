import OpenAI, { APIError } from "openai";
import type { ModelSpec } from "@chatbot/config";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { countChatTokens, trimToTokenBudget } from "./tokens.js";
import type { LLMResponse } from "./types.js";

export class AllModelsFailed extends Error {
  constructor(public readonly causes: Array<{ model: string; reason: string }>) {
    super("AllModelsFailed");
  }
}

const TIMEOUT_MS = 30_000;

const isTokenLimitError = (error: unknown): boolean => {
  if (!(error instanceof APIError)) {
    return false;
  }
  return `${error.code ?? ""}`.includes("context_length_exceeded") || error.status === 400;
};

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const collectStreamResponse = async (stream: AsyncIterable<any>): Promise<LLMResponse> => {
  let content = "";
  const toolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();

  for await (const chunk of stream) {
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta;

    if (typeof delta?.content === "string") {
      content += delta.content;
    }

    for (const toolCall of delta?.tool_calls ?? []) {
      const current = toolCalls.get(toolCall.index) ?? { arguments: "" };

      if (typeof toolCall.id === "string") {
        current.id = toolCall.id;
      }

      if (typeof toolCall.function?.name === "string") {
        current.name = toolCall.function.name;
      }

      if (typeof toolCall.function?.arguments === "string") {
        current.arguments += toolCall.function.arguments;
      }

      toolCalls.set(toolCall.index, current);
    }
  }

  return {
    content,
    modelUsed: "",
    toolCalls: Array.from(toolCalls.values())
      .filter((toolCall) => typeof toolCall.id === "string" && typeof toolCall.name === "string")
      .map((toolCall) => ({
        id: toolCall.id as string,
        name: toolCall.name as string,
        arguments: toolCall.arguments
      }))
  };
};

export const createLlmClient = (apiKey: string): OpenAI =>
  new OpenAI({
    apiKey,
    baseURL: "https://integrate.api.nvidia.com/v1",
    timeout: TIMEOUT_MS
  });

const buildExtraBody = (model: ModelSpec) => {
  const extraBody: {
    chat_template_kwargs?: {
      enable_thinking?: boolean;
    };
    reasoning_budget?: number;
  } = {};

  if (typeof model.enableThinking === "boolean") {
    extraBody.chat_template_kwargs = { enable_thinking: model.enableThinking };
  }

  if (typeof model.reasoningBudget === "number") {
    extraBody.reasoning_budget = model.reasoningBudget;
  }

  return Object.keys(extraBody).length > 0 ? extraBody : undefined;
};

export const chatCompletion = async ({
  client,
  modelChain,
  messages,
  tools
}: {
  client: OpenAI;
  modelChain: ModelSpec[];
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
}): Promise<LLMResponse> => {
  const failures: Array<{ model: string; reason: string }> = [];
  const minContext = Math.min(...modelChain.map((m) => m.maxTokens));
  let workingMessages = trimToTokenBudget(messages, minContext);

  for (const model of modelChain) {
    let retries = 0;

    while (retries < 3) {
      try {
        if (countChatTokens(workingMessages) > model.maxTokens) {
          workingMessages = trimToTokenBudget(workingMessages, model.maxTokens);
        }

        const response = await client.chat.completions.create({
          model: model.id,
          messages: workingMessages,
          tools,
          tool_choice: tools.length > 0 ? "auto" : undefined,
          max_tokens: model.maxTokens,
          temperature: model.temperature,
          top_p: model.topP,
          stream: model.stream ?? false,
          extra_body: buildExtraBody(model)
        } as any);

        if (model.stream) {
          const streamed = await collectStreamResponse(response as unknown as AsyncIterable<any>);
          return {
            ...streamed,
            modelUsed: model.id
          };
        }

        const choice = response.choices[0];
        const toolCalls =
          choice.message.tool_calls?.map((call) => ({
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments
          })) ?? [];

        return {
          content: choice.message.content ?? "",
          modelUsed: model.id,
          toolCalls
        };
      } catch (error) {
        retries += 1;

        if (error instanceof APIError) {
          if (error.status === 401 || error.status === 403) {
            throw error;
          }

          if (error.status === 429) {
            failures.push({ model: model.id, reason: "rate_limited" });
            break;
          }

          if (error.status && error.status >= 500) {
            if (retries < 3) {
              await wait(retries * 1000);
              continue;
            }
            failures.push({ model: model.id, reason: "upstream_5xx" });
            break;
          }

          if (isTokenLimitError(error)) {
            const trimmed = trimToTokenBudget(workingMessages, model.maxTokens - 512);
            if (trimmed.length !== workingMessages.length && retries < 3) {
              workingMessages = trimmed;
              continue;
            }
            failures.push({ model: model.id, reason: "token_limit" });
            break;
          }
        }

        if (error instanceof Error && error.name === "AbortError") {
          failures.push({ model: model.id, reason: "timeout" });
          break;
        }

        failures.push({ model: model.id, reason: "unknown" });
        break;
      }
    }
  }

  throw new AllModelsFailed(failures);
};
