// Turns failing tests into GitHub annotations, so the reason for a failure shows on the workflow's summary page.
// Used by .github/workflows/deploy.yml alongside the normal "spec" output.
import { relative } from 'node:path';

const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const prop = s => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export default async function* githubReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const { name, file, line, details } = event.data;
    const err = details?.error;
    if (err?.failureType === 'subtestsFailed') continue;
    const message = err?.cause?.message || err?.message || String(err);
    const where = file ? `file=${prop(relative(process.cwd(), file))},line=${line || 1},` : '';
    yield `::error ${where}title=${prop(name)}::${esc(message.slice(0, 1500))}\n`;
  }
}
