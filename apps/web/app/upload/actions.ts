'use server';

import { redirect } from 'next/navigation';
import { createUpload } from '../../lib/storage';

function realFiles(formData: FormData, field: string): File[] {
  return formData
    .getAll(field)
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
}

/** Checks the file's own bytes, not the browser-reported MIME type — the
 * `accept` attribute on the input is a hint a user can bypass (drag-and-drop,
 * "all files" in the picker), and a reported type can simply be wrong. */
async function isPdf(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === '%PDF-';
}

export async function submitUpload(formData: FormData): Promise<void> {
  const bills = realFiles(formData, 'bills');
  const greenButton = realFiles(formData, 'greenButton');

  if (bills.length === 0) {
    redirect('/upload?error=no-bills');
  }

  const nonPdf: string[] = [];
  for (const file of bills) {
    if (!(await isPdf(file))) nonPdf.push(file.name);
  }
  if (nonPdf.length > 0) {
    redirect(`/upload?error=invalid-file&files=${encodeURIComponent(nonPdf.join(', '))}`);
  }

  const id = await createUpload(bills, greenButton);
  redirect(`/upload/${id}`);
}
