import type { Metadata } from 'next';
import { Progress } from '../../components/Progress';
import { submitUpload } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TITLE = 'Upload Your SCE Bills';
const DESCRIPTION =
  "Upload 12 months of Southern California Edison commercial bills as PDF. Attach a Green Button export if you have one, or we'll estimate your usage instead.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/upload' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/upload' },
};

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = params.error;
  const badFiles = typeof params.files === 'string' ? params.files : null;

  return (
    <main className="shell-main">
      <Progress current={1} />
      <h1>Upload your bills</h1>
      <p className="muted">
        Upload each monthly bill as its own PDF. As many months as you have, ideally all 12. If
        you&apos;ve downloaded your interval data from SCE&apos;s Green Button &quot;Download My
        Data&quot; feature, attach that too. It&apos;s optional.
      </p>

      {error === 'no-bills' ? (
        <div className="notice notice-bad">
          <p style={{ marginBottom: 0 }}>
            <strong>Choose at least one bill PDF</strong> before submitting. The form reloaded and
            nothing was uploaded.
          </p>
        </div>
      ) : null}

      {error === 'invalid-file' ? (
        <div className="notice notice-bad">
          <p style={{ marginBottom: 0 }}>
            <strong>{badFiles ?? 'One of your files'} isn&apos;t a PDF.</strong> Bills need to be
            uploaded as PDF. Export or re-scan it, then try again. Nothing was uploaded.
          </p>
        </div>
      ) : null}

      <form action={submitUpload} encType="multipart/form-data">
        <fieldset className="field-group">
          <legend>Bill PDFs (required, choose multiple)</legend>
          <Input type="file" name="bills" accept="application/pdf" multiple required style={{ marginTop: '0.5rem' }} />
          <p className="field-hint">PDF only. One file per billing period.</p>
        </fieldset>

        <fieldset className="field-group">
          <legend>Green Button export (optional)</legend>
          <Input
            type="file"
            name="greenButton"
            accept=".xml,.csv,text/xml,text/csv"
            multiple
            style={{ marginTop: '0.5rem' }}
          />
          <p className="field-hint">XML or CSV. Don&apos;t have this? Skip it. We&apos;ll estimate your usage instead.</p>
        </fieldset>

        <Button type="submit">Upload</Button>
      </form>
    </main>
  );
}
