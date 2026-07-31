'use server';

import { redirect } from 'next/navigation';
import { writeConfirmation } from '../../../../lib/extraction-storage';

export async function confirmExtraction(uploadId: string, confirmedBillFilenames: string[]): Promise<void> {
  await writeConfirmation(uploadId, confirmedBillFilenames);
  redirect(`/upload/${uploadId}/confirmed`);
}
