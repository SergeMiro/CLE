import { type AICompletion, type AICompletionRequest, type AIProvider, AIProviderError, estimateTokens } from './provider.js';

export type AIVendor = 'openrouter' | 'gemini' | 'anthropic' | 'openai-compatible';

export interface HttpAIProviderOptions {
  vendor: AIVendor;
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Sent by OpenRouter as attribution headers. */
  referer?: string;
}

const DEFAULT_BASE_URL: Record<AIVendor, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  anthropic: 'https://api.anthropic.com/v1',
  'openai-compatible': 'https://api.openai.com/v1',
};

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

interface VendorRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** One HTTP client, four request shapes. Adding a vendor means adding two small adapters. */
export class HttpAIProvider implements AIProvider {
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpAIProviderOptions) {
    if (!options.apiKey) throw new AIProviderError('an API key is required', options.vendor);
    if (!options.model) throw new AIProviderError('a model name is required', options.vendor);
    this.name = options.vendor;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL[options.vendor]).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  private buildRequest(request: AICompletionRequest): VendorRequest {
    // Reasoning-capable models spend part of their budget on thinking, so the
    // ceiling has to stay generous or the JSON comes back truncated.
    const maxTokens = request.maxOutputTokens ?? 6000;
    const temperature = request.temperature ?? 0.3;
    switch (this.options.vendor) {
      case 'anthropic':
        return {
          url: `${this.baseUrl}/messages`,
          headers: { 'x-api-key': this.options.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: {
            model: this.model,
            max_tokens: maxTokens,
            temperature,
            system: request.system,
            messages: [{ role: 'user', content: request.prompt }],
          },
        };
      case 'gemini':
        return {
          url: `${this.baseUrl}/models/${this.model}:generateContent`,
          headers: { 'x-goog-api-key': this.options.apiKey, 'content-type': 'application/json' },
          body: {
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
            generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
          },
        };
      case 'openrouter':
      case 'openai-compatible':
        return {
          url: `${this.baseUrl}/chat/completions`,
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            'content-type': 'application/json',
            ...(this.options.vendor === 'openrouter' && this.options.referer
              ? { 'http-referer': this.options.referer, 'x-title': 'CLE' }
              : {}),
          },
          body: {
            model: this.model,
            max_tokens: maxTokens,
            temperature,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.prompt },
            ],
          },
        };
    }
  }

  private parseResponse(payload: unknown, request: AICompletionRequest): AICompletion {
    const fallbackUsage = {
      inputTokens: estimateTokens(request.system + request.prompt),
      outputTokens: 0,
    };
    const body = payload as Record<string, any>;
    let text = '';
    let usage = fallbackUsage;

    if (this.options.vendor === 'anthropic') {
      text = (body.content ?? []).filter((part: any) => part?.type === 'text').map((part: any) => part.text).join('');
      if (body.usage) usage = { inputTokens: body.usage.input_tokens ?? 0, outputTokens: body.usage.output_tokens ?? 0 };
    } else if (this.options.vendor === 'gemini') {
      const candidate = body.candidates?.[0];
      text = (candidate?.content?.parts ?? []).map((part: any) => part?.text ?? '').join('');
      if (body.usageMetadata) {
        usage = {
          inputTokens: body.usageMetadata.promptTokenCount ?? 0,
          outputTokens: body.usageMetadata.candidatesTokenCount ?? 0,
        };
      }
      if (!text && candidate?.finishReason && candidate.finishReason !== 'STOP') {
        throw new AIProviderError(`generation stopped early: ${candidate.finishReason}`, this.name, true);
      }
    } else {
      text = body.choices?.[0]?.message?.content ?? '';
      if (body.usage) usage = { inputTokens: body.usage.prompt_tokens ?? 0, outputTokens: body.usage.completion_tokens ?? 0 };
    }

    if (!text.trim()) throw new AIProviderError('the model returned no text', this.name, true);
    if (usage.outputTokens === 0) usage = { ...usage, outputTokens: estimateTokens(text) };
    return { text, usage, provider: this.name, model: this.model };
  }

  async complete(request: AICompletionRequest): Promise<AICompletion> {
    const { url, headers, body } = this.buildRequest(request);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new AIProviderError(
          `${this.name} responded ${response.status}: ${detail.slice(0, 300)}`,
          this.name,
          RETRYABLE_STATUS.has(response.status),
        );
      }
      return this.parseResponse(await response.json(), request);
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(error instanceof Error ? error.message : String(error), this.name, true);
    } finally {
      clearTimeout(timer);
    }
  }
}
