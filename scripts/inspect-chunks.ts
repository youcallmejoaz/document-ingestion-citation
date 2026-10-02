/**
 * Prints how a file is parsed and chunked, for tuning the chunker.
 *   pnpm tsx scripts/inspect-chunks.ts samples/Refund-and-Returns-Policy.docx
 */
import { readFileSync } from "node:fs";
import { chunkBlocks } from "../src/lib/ingest/chunk";
import { mimeTypeFor, parseDocument } from "../src/lib/ingest/parse";

async function main() {
  for (const file of process.argv.slice(2)) {
    const blocks = await parseDocument(new Uint8Array(readFileSync(file)), mimeTypeFor(file));
    const chunks = chunkBlocks(blocks);
    console.log(`\n=== ${file}: ${blocks.length} blocks, ${chunks.length} chunks`);
    for (const c of chunks) {
      const pages = c.pageStart ? ` p.${c.pageStart}${c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ""}` : "";
      console.log(`\n[${c.index}] ${c.headingPath}${pages} (${c.tokenCount} tok)\n${c.content}`);
    }
  }
}

main();
