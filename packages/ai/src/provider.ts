export class AIProviderError extends Error {
  constructor(message: string, readonly provider: string, readonly retryable = false) {
    super(message);
  }
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AICompletion {
  text: string;
  usage: AIUsage;
  provider: string;
  model: string;
}

export interface AICompletionRequest {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}

/** CLE never talks to a vendor SDK directly, so a model can be swapped per deployment. */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  complete(request: AICompletionRequest): Promise<AICompletion>;
}

/** Rough USD micro-cents per 1M tokens, used only for the AIUsage cost estimate. */
export interface CostModel {
  inputMicroUsdPerMillion: number;
  outputMicroUsdPerMillion: number;
}

export function estimateCostMicroUsd(usage: AIUsage, cost: CostModel): number {
  return Math.round(
    (usage.inputTokens * cost.inputMicroUsdPerMillion) / 1_000_000 +
      (usage.outputTokens * cost.outputMicroUsdPerMillion) / 1_000_000,
  );
}

/** Provider-agnostic token estimate, good enough for budgeting when a vendor omits usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
