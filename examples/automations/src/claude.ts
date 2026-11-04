// src/claude.ts
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "./db";
import { PermanentError } from "./errors";

const client = new Anthropic();
const MODEL = "claude-opus-5-5";

// Dollars per million tokens. Prices change: check them on the Anthropic site
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

/** What one answer cost, from the token counts in `usage`. */
export function cost(usage: Anthropic.Beta.BetaUsage) {
  return (
    (usage.input_tokens * PRICE.input +
      (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      usage.output_tokens * PRICE.output) /
    1_000_000
  );
}

/**
 * One request whose answer must match a JSON Schema. Every automation that
 * asks the model to fill in fields goes through here: leads, tickets and so on.
 */
export async function askJson<T>(request: {
  task: string;
  system: string | Anthropic.Beta.BetaTextBlockParam[];
  content: string;
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
}): Promise<T> {
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      // If the model declines, the API reruns the request on a fallback model
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: request.effort,
        format: { type: "json_schema", schema: request.schema },
      },
      system: request.system,
      messages: [{ role: "user", content: request.content }],
    });
  } catch (error) {
    // 400 means our request is wrong: retrying won't help
    if (error instanceof Anthropic.BadRequestError) {
      throw new PermanentError(error.message);
    }
    throw error; // 429, 5xx, network: the queue retries
  }

  // Every request is recorded: the digest shows the spend, an alert guards the limit
  const usage = response.usage;
  await sql`
    insert into llm_usage (task, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost)
    values (${request.task}, ${response.model}, ${usage.input_tokens}, ${usage.cache_read_input_tokens ?? 0},
            ${usage.cache_creation_input_tokens ?? 0}, ${usage.output_tokens}, ${cost(usage)})
  `;
  console.log(
    `claude ${request.task}: in ${usage.input_tokens}, cached ${usage.cache_read_input_tokens ?? 0}, out ${usage.output_tokens}`
  );

  if (response.stop_reason === "refusal") {
    throw new PermanentError(`the model declined: ${request.task}`);
  }
  const text = response.content.find((block) => block.type === "text");
  if (!text) {
    throw new Error(`no text in the answer, stop_reason ${response.stop_reason}`);
  }
  return JSON.parse(text.text);
}
