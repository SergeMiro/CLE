import { type AICompletion, type AICompletionRequest, type AIProvider, AIProviderError, estimateTokens } from './provider.js';

/**
 * Deterministic offline provider. It writes a well-formed quiz from the sentences
 * of the post itself, so the whole content -> quiz -> publish pipeline can be
 * exercised end to end without an API key.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';
  readonly model = 'mock-quiz-v1';
  private failNextCall = false;

  failNext(): void {
    this.failNextCall = true;
  }

  async complete(request: AICompletionRequest): Promise<AICompletion> {
    if (this.failNextCall) {
      this.failNextCall = false;
      throw new AIProviderError('mock provider failure', this.name, true);
    }
    const content = extractContent(request.prompt);
    const questionCount = extractQuestionCount(request.prompt);
    const language = extractLanguage(request.prompt);
    const text = JSON.stringify(buildQuiz(content, questionCount, language));
    return {
      text,
      usage: { inputTokens: estimateTokens(request.system + request.prompt), outputTokens: estimateTokens(text) },
      provider: this.name,
      model: this.model,
    };
  }
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  if (from < 0) return '';
  const to = text.indexOf(end, from + start.length);
  return text.slice(from + start.length, to < 0 ? undefined : to).trim();
}

function extractContent(prompt: string): string {
  return between(prompt, '<content>', '</content>') || prompt;
}

function extractQuestionCount(prompt: string): number {
  const value = Number(between(prompt, '<questions>', '</questions>'));
  return Number.isInteger(value) && value > 0 ? value : 3;
}

function extractLanguage(prompt: string): string {
  return between(prompt, '<language>', '</language>') || 'en';
}

function sentencesOf(content: string): string[] {
  return content
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20);
}

function buildQuiz(content: string, questionCount: number, language: string) {
  const sentences = sentencesOf(content);
  const title = (sentences[0] ?? content).slice(0, 80);
  const questions = Array.from({ length: questionCount }, (_, index) => {
    const source = sentences[index % Math.max(1, sentences.length)] ?? content.slice(0, 120);
    const keyword = keywordOf(source, index);
    return {
      prompt: `According to the post, which statement about "${keyword}" is correct?`,
      options: [
        { text: source.slice(0, 120), isCorrect: true, explanation: 'Stated directly in the post.' },
        { text: `The post says the opposite of: ${keyword}`, isCorrect: false, explanation: 'The post does not claim this.' },
        { text: `${keyword} is not mentioned in the post`, isCorrect: false, explanation: 'It is mentioned in the post.' },
        { text: `The post gives no information about ${keyword}`, isCorrect: false, explanation: 'The post does discuss it.' },
      ],
    };
  });
  return { title, language, questions };
}

function keywordOf(sentence: string, index: number): string {
  const words = sentence.split(/\s+/).filter((word) => word.length > 4);
  return (words[index % Math.max(1, words.length)] ?? 'the topic').replace(/[^\p{L}\p{N}-]/gu, '');
}
