import { uploadDir } from './storage';
import { storageBackend } from './storage-backend';

export type FeedbackAnswer = 'yes' | 'no' | 'not_sure';

export interface FeedbackRecord {
  answer: FeedbackAnswer;
  note: string | null;
  submittedAt: string;
}

function feedbackKey(uploadId: string): string {
  return `${uploadDir(uploadId)}/feedback.json`;
}

export function isFeedbackAnswer(value: unknown): value is FeedbackAnswer {
  return value === 'yes' || value === 'no' || value === 'not_sure';
}

export async function writeFeedback(uploadId: string, answer: FeedbackAnswer, note: string | null): Promise<void> {
  const trimmed = note?.trim();
  const record: FeedbackRecord = {
    answer,
    note: trimmed && trimmed.length > 0 ? trimmed : null,
    submittedAt: new Date().toISOString(),
  };
  await storageBackend().write(feedbackKey(uploadId), Buffer.from(JSON.stringify(record, null, 2)));
}

export async function readFeedback(uploadId: string): Promise<FeedbackRecord | null> {
  const raw = await storageBackend().read(feedbackKey(uploadId));
  if (raw === null) return null;
  try {
    return JSON.parse(raw.toString('utf8')) as FeedbackRecord;
  } catch {
    return null;
  }
}
