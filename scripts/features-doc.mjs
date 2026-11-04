#!/usr/bin/env node
/**
 * Regenerate docs/FEATURE_CHECKLIST.md from the LIVE feature endpoint.
 * Nothing is asserted here that the running Worker does not itself report (H10).
 *
 *   node scripts/features-doc.mjs [http://127.0.0.1:3000/api/v1/features] [path/to/features.json]
 *
 * With a second argument the JSON is read from disk instead of fetched (useful
 * in CI where no server is running). The JSON must be the whole API envelope.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:3000/api/v1/features';
const fromFile = process.argv[3];
const envelope = fromFile
  ? JSON.parse(readFileSync(fromFile, 'utf8'))
  : await (await fetch(url)).json();
const features = envelope?.data?.features;
if (!Array.isArray(features) || features.length === 0) {
  console.error('FEATURES_DOC_FAIL: no features in response');
  process.exit(1);
}
const badge = { COMPLETE: '✅ **COMPLETE**', PARTIAL: '🟡 **PARTIAL**', INCOMPLETE: '❌ **INCOMPLETE**' };
const totals = { COMPLETE: 0, PARTIAL: 0, INCOMPLETE: 0 };
for (const f of features) totals[f.state] = (totals[f.state] || 0) + 1;
const rows = features.map((f) => {
  const note = (f.note_ur || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return `| ${f.id} | ${f.ur} | ${f.en} | ${badge[f.state] || f.state} | ${note} |`;
});
const date = new Date().toISOString().slice(0, 10);
const doc = `# FEATURE CHECKLIST — live copy of \`GET /api/v1/features\`

Regenerated from the running Worker on ${date} by \`node scripts/features-doc.mjs\`.
The same data powers \`/erp/status\`. COMPLETE = real + persisted + working;
PARTIAL = working but narrowed; INCOMPLETE = not built / not verified.
An unfinished feature is NEVER reported as COMPLETE.

| ID | اسکرین / خصوصیت | English | State | نوٹ |
|---|---|---|---|---|
${rows.join('\n')}

**Totals:** ${JSON.stringify(totals)} — ${features.length} tracked items.

Full acceptance mapping: \`docs/ACCEPTANCE.md\`. Known gaps: \`docs/KNOWN_LIMITATIONS.md\`.
`;
writeFileSync('docs/FEATURE_CHECKLIST.md', doc);
console.log(`FEATURES_DOC_OK: ${features.length} items ${JSON.stringify(totals)} -> docs/FEATURE_CHECKLIST.md`);
