'use server';

import { redirect } from 'next/navigation';
import { createUpload } from '../../lib/storage';

function realFiles(formData: FormData, field: string): File[] {
  return formData
    .getAll(field)
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

export async function submitUpload(formData: FormData): Promise<void> {
  const bills = realFiles(formData, 'bills');
  const greenButton = realFiles(formData, 'greenButton');

  if (bills.length === 0) {
    redirect('/upload?error=no-bills');
  }

  const id = await createUpload(bills, greenButton);
  redirect(`/upload/${id}`);
}
