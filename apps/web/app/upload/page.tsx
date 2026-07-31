import { submitUpload } from './actions';

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const showNoBillsError = params.error === 'no-bills';

  return (
    <main className="shell-main">
      <p className="eyebrow">Step 1 of 4</p>
      <h1>Upload your bills</h1>
      <p className="muted">
        Upload each monthly bill as a separate PDF — as many months as you have, ideally 12. If
        you&apos;ve downloaded your interval data from SCE&apos;s Green Button &quot;Download My
        Data&quot;, attach that too; it&apos;s optional.
      </p>

      {showNoBillsError ? (
        <div className="notice notice-bad">
          <p>
            <strong>Choose at least one bill PDF</strong> before submitting — the form was
            reloaded, nothing was uploaded.
          </p>
        </div>
      ) : null}

      <form action={submitUpload} encType="multipart/form-data">
        <fieldset className="field-group">
          <legend>Bill PDFs — required, choose multiple</legend>
          <input type="file" name="bills" accept="application/pdf" multiple required />
          <p className="field-hint">PDF only. One file per billing period.</p>
        </fieldset>

        <fieldset className="field-group">
          <legend>Green Button export — optional</legend>
          <input type="file" name="greenButton" accept=".xml,.csv,text/xml,text/csv" multiple />
          <p className="field-hint">XML or CSV. Don&apos;t have this? Skip it — we&apos;ll estimate your usage instead.</p>
        </fieldset>

        <button type="submit" className="btn">
          Upload
        </button>
      </form>
    </main>
  );
}
