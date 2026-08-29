import { describe, expect, it, vi } from 'vitest';
import {
  AIProviderError,
  HttpAIProvider,
  MockAIProvider,
  QuizGenerationError,
  QuizSchemaError,
  assessQuiz,
  buildPrompt,
  detectLanguage,
  estimateCostMicroUsd,
  extractJsonObject,
  generateQuiz,
  normaliseContent,
  parseGeneratedQuiz,
  similarity,
  type AIProvider,
  type GeneratedQuiz,
  type QuizGenerationPolicy,
} from '../src/index.js';

const policy: QuizGenerationPolicy = {
  questionsPerQuiz: 3,
  difficulty: 'NORMAL',
  language: 'en',
  minimumPostLength: 200,
  qualityThreshold: 70,
  pointsPerQuestion: 10,
};

const post = [
  'Astronomers using the James Webb Space Telescope have detected carbon dioxide in the atmosphere of an exoplanet.',
  'The planet, WASP-39b, orbits a sun-like star roughly 700 light-years from Earth.',
  'The detection was made with the NIRSpec instrument, which measures how starlight is absorbed as it passes through the atmosphere.',
  'Carbon dioxide is an important tracer of how a planet formed and how much heavy material it collected.',
].join(' ');

function goodQuiz(): GeneratedQuiz {
  return {
    title: 'Carbon dioxide on WASP-39b',
    language: 'en',
    questions: [
      {
        prompt: 'Which instrument detected carbon dioxide on WASP-39b?',
        options: [
          { text: 'NIRSpec', isCorrect: true, explanation: 'The post names NIRSpec.' },
          { text: 'MIRI camera', isCorrect: false, explanation: 'Not mentioned in the post.' },
          { text: 'Hubble WFC3', isCorrect: false, explanation: 'A different telescope entirely.' },
        ],
      },
    ],
  };
}

describe('content preparation', () => {
  it('detects language from script and stop words', () => {
    expect(detectLanguage('Привет, это научный пост')).toBe('ru');
    expect(detectLanguage('Le telescope a detecte une atmosphere')).toBe('fr');
    expect(detectLanguage('A plain english sentence')).toBe('en');
  });

  it('strips links, mentions and emoji', () => {
    expect(normaliseContent('Look 🔭 https://t.me/x @channel #space  real   text')).toBe('Look real text');
  });

  it('builds a prompt that carries the policy', () => {
    const prompt = buildPrompt({ id: 'c1', text: post }, policy, 'en');
    expect(prompt).toContain('<questions>3</questions>');
    expect(prompt).toContain('<content>');
    expect(prompt).toContain('NIRSpec');
  });
});

describe('response parsing', () => {
  it('extracts JSON from a fenced code block', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts JSON surrounded by prose', () => {
    expect(extractJsonObject('Sure! {"a":1} Hope that helps.')).toEqual({ a: 1 });
  });

  it('rejects a response with no JSON', () => {
    expect(() => extractJsonObject('I cannot do that')).toThrow(QuizSchemaError);
    expect(() => extractJsonObject('{ broken')).toThrow(QuizSchemaError);
  });

  it('rejects a quiz that violates the schema', () => {
    expect(() => parseGeneratedQuiz(JSON.stringify({ title: 'x', questions: [] }))).toThrow(QuizSchemaError);
  });

  it('accepts a well-formed quiz', () => {
    expect(parseGeneratedQuiz(JSON.stringify(goodQuiz())).questions).toHaveLength(1);
  });
});

describe('quality assessment', () => {
  it('scores a clean quiz highly', () => {
    const report = assessQuiz(goodQuiz(), { expectedQuestions: 1, threshold: 70, sourceText: post });
    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
  });

  it('fails a quiz with two correct answers', () => {
    const quiz = goodQuiz();
    quiz.questions[0]!.options[1]!.isCorrect = true;
    const report = assessQuiz(quiz, { expectedQuestions: 1, threshold: 70 });
    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('answer_key');
  });

  it('flags a quiz with no correct answer', () => {
    const quiz = goodQuiz();
    quiz.questions[0]!.options[0]!.isCorrect = false;
    expect(assessQuiz(quiz, { expectedQuestions: 1, threshold: 70 }).passed).toBe(false);
  });

  it('flags a question count that misses the policy', () => {
    const report = assessQuiz(goodQuiz(), { expectedQuestions: 3, threshold: 70 });
    expect(report.issues.map((issue) => issue.code)).toContain('question_count');
  });

  it('flags duplicate options and a missing explanation', () => {
    const quiz = goodQuiz();
    quiz.questions[0]!.options[1]!.text = 'NIRSpec';
    delete quiz.questions[0]!.options[2]!.explanation;
    const codes = assessQuiz(quiz, { expectedQuestions: 1, threshold: 70 }).issues.map((issue) => issue.code);
    expect(codes).toContain('duplicate_options');
    expect(codes).toContain('missing_explanation');
  });

  it('flags an answer given away by its length', () => {
    const quiz = goodQuiz();
    quiz.questions[0]!.options[0]!.text = 'The NIRSpec instrument on the James Webb Space Telescope, measuring transmission spectra';
    expect(assessQuiz(quiz, { expectedQuestions: 1, threshold: 70 }).issues.map((issue) => issue.code)).toContain('length_giveaway');
  });

  it('flags a question that repeats an earlier quiz', () => {
    const report = assessQuiz(goodQuiz(), {
      expectedQuestions: 1,
      threshold: 70,
      existingPrompts: ['Which instrument detected carbon dioxide on WASP-39b?'],
    });
    expect(report.issues.map((issue) => issue.code)).toContain('duplicate_of_previous');
  });

  it('flags a quiz that is not about the post', () => {
    const quiz = goodQuiz();
    quiz.questions[0]!.prompt = 'What is the capital city of Portugal today?';
    expect(assessQuiz(quiz, { expectedQuestions: 1, threshold: 70, sourceText: post }).issues.map((issue) => issue.code)).toContain(
      'ungrounded',
    );
  });

  it('measures similarity between prompts', () => {
    expect(similarity('the same sentence', 'the same sentence')).toBe(1);
    expect(similarity('completely different', 'nothing alike here')).toBeLessThan(0.3);
  });
});

describe('generateQuiz', () => {
  it('produces a validated quiz through the mock provider', async () => {
    const result = await generateQuiz(new MockAIProvider(), { content: { id: 'c1', text: post }, policy });
    expect(result.quiz.questions).toHaveLength(3);
    expect(result.totalPoints).toBe(30);
    expect(result.provider).toBe('mock');
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it('refuses a post that is too short to quiz', async () => {
    await expect(generateQuiz(new MockAIProvider(), { content: { id: 'c1', text: 'too short' }, policy })).rejects.toMatchObject({
      reason: 'too_short',
    });
  });

  it('reports a provider failure as a generation error', async () => {
    const provider = new MockAIProvider();
    provider.failNext();
    await expect(generateQuiz(provider, { content: { id: 'c1', text: post }, policy })).rejects.toMatchObject({ reason: 'provider' });
  });

  it('reports an unparseable model response', async () => {
    const provider: AIProvider = {
      name: 'broken',
      model: 'x',
      complete: async () => ({ text: 'sorry, no', usage: { inputTokens: 1, outputTokens: 1 }, provider: 'broken', model: 'x' }),
    };
    await expect(generateQuiz(provider, { content: { id: 'c1', text: post }, policy })).rejects.toBeInstanceOf(QuizGenerationError);
  });

  it('estimates the cost when a cost model is supplied', async () => {
    const result = await generateQuiz(new MockAIProvider(), {
      content: { id: 'c1', text: post },
      policy,
      costModel: { inputMicroUsdPerMillion: 1_000_000, outputMicroUsdPerMillion: 3_000_000 },
    });
    expect(result.estimatedCostMicroUsd).toBeGreaterThan(0);
  });

  it('computes a cost estimate from usage', () => {
    expect(
      estimateCostMicroUsd({ inputTokens: 1_000_000, outputTokens: 0 }, { inputMicroUsdPerMillion: 250_000, outputMicroUsdPerMillion: 0 }),
    ).toBe(250_000);
  });
});

describe('HttpAIProvider', () => {
  function ok(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  it('speaks the OpenAI chat completions shape', async () => {
    const fetchImpl = vi.fn(async () =>
      ok({ choices: [{ message: { content: '{"title":"t","questions":[]}' } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }),
    );
    const provider = new HttpAIProvider({ vendor: 'openrouter', apiKey: 'k', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch });
    const completion = await provider.complete({ system: 's', prompt: 'p' });
    expect(completion.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('speaks the Anthropic messages shape', async () => {
    const fetchImpl = vi.fn(async () => ok({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 3, output_tokens: 4 } }));
    const provider = new HttpAIProvider({ vendor: 'anthropic', apiKey: 'k', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await provider.complete({ system: 's', prompt: 'p' })).text).toBe('{}');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/messages');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
  });

  it('speaks the Gemini generateContent shape and asks for a generous token budget', async () => {
    const fetchImpl = vi.fn(async () =>
      ok({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 } }),
    );
    const provider = new HttpAIProvider({ vendor: 'gemini', apiKey: 'k', model: 'gemini-x', fetchImpl: fetchImpl as unknown as typeof fetch });
    await provider.complete({ system: 's', prompt: 'p' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/models/gemini-x:generateContent');
    expect(JSON.parse(String(init.body)).generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(6000);
  });

  it('treats a truncated Gemini response as retryable', async () => {
    const fetchImpl = vi.fn(async () => ok({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }));
    const provider = new HttpAIProvider({ vendor: 'gemini', apiKey: 'k', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.complete({ system: 's', prompt: 'p' })).rejects.toMatchObject({ retryable: true });
  });

  it('marks a 429 as retryable and a 400 as final', async () => {
    const make = (status: number) =>
      new HttpAIProvider({
        vendor: 'openrouter',
        apiKey: 'k',
        model: 'm',
        fetchImpl: (async () => new Response('nope', { status })) as unknown as typeof fetch,
      });
    await expect(make(429).complete({ system: 's', prompt: 'p' })).rejects.toMatchObject({ retryable: true });
    await expect(make(400).complete({ system: 's', prompt: 'p' })).rejects.toMatchObject({ retryable: false });
  });

  it('requires an API key and a model', () => {
    expect(() => new HttpAIProvider({ vendor: 'openrouter', apiKey: '', model: 'm' })).toThrow(AIProviderError);
    expect(() => new HttpAIProvider({ vendor: 'openrouter', apiKey: 'k', model: '' })).toThrow(AIProviderError);
  });
});
