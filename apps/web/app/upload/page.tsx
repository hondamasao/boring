import { submitUpload } from './actions';

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const showNoBillsError = params.error === 'no-bills';

  return (
    <main>
      <h1>Upload your bills</h1>
      <p>
        Upload each monthly bill as a separate PDF — as many months as you have, ideally
        12. If you&apos;ve downloaded your interval data from SCE&apos;s Green Button
        &quot;Download My Data&quot;, attach that too; it&apos;s optional.
      </p>

      {showNoBillsError ? (
        <p style={{ color: '#b00020', fontWeight: 'bold' }}>
          Please choose at least one bill PDF before submitting.
        </p>
      ) : null}

      <form action={submitUpload} encType="multipart/form-data">
        <fieldset style={{ marginBottom: '1.5rem' }}>
          <legend>Bill PDFs (required, choose multiple)</legend>
          <input type="file" name="bills" accept="application/pdf" multiple required />
        </fieldset>

        <fieldset style={{ marginBottom: '1.5rem' }}>
          <legend>Green Button export (optional — XML or CSV)</legend>
          <input type="file" name="greenButton" accept=".xml,.csv,text/xml,text/csv" multiple />
        </fieldset>

        <button type="submit">Upload</button>
      </form>
    </main>
  );
}
