import { z } from 'zod';

export const generatedOptionSchema = z.object({
  text: z.string().trim().min(1).max(300),
  isCorrect: z.boolean(),
  explanation: z.string().trim().max(500).optional(),
});

export const generatedQuestionSchema = z.object({
  prompt: z.string().trim().min(10).max(500),
  options: z.array(generatedOptionSchema).min(2).max(6),
});

export const generatedQuizSchema = z.object({
  title: z.string().trim().min(3).max(120),
  language: z.string().trim().min(2).max(10).optional(),
  questions: z.array(generatedQuestionSchema).min(1).max(10),
});

export type GeneratedOption = z.infer<typeof generatedOptionSchema>;
export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type GeneratedQuiz = z.infer<typeof generatedQuizSchema>;

export class QuizSchemaError extends Error {}

/** Models like to wrap JSON in prose or a code fence; take the outermost object. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new QuizSchemaError('the model response contains no JSON object');
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch (error) {
    throw new QuizSchemaError(`the model response is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
}

export function parseGeneratedQuiz(text: string): GeneratedQuiz {
  const result = generatedQuizSchema.safeParse(extractJsonObject(text));
  if (!result.success) throw new QuizSchemaError(`generated quiz failed validation: ${z.prettifyError(result.error)}`);
  return result.data;
}
