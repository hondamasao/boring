'use server';

import { redirect } from 'next/navigation';
import { isFeedbackAnswer, writeFeedback } from '../../../../lib/feedback-storage';

export async function submitFeedback(uploadId: string, formData: FormData): Promise<void> {
  const answer = formData.get('answer');
  if (!isFeedbackAnswer(answer)) return;
  const note = formData.get('note');
  await writeFeedback(uploadId, answer, typeof note === 'string' ? note : null);
  redirect(`/upload/${uploadId}/report`);
}
