/**
 * Web Multi-Source Handler
 *
 * A config-driven handler for building knowledge bases from heterogeneous web sources
 * (articles, blog posts, Reddit threads, podcast pages, YouTube videos, research reports).
 *
 * Workflow:
 *   download  — fetches each URL listed in config.sources, strips HTML to plain text,
 *               and saves to {cacheFile}/{id}.txt. Already-cached files are skipped,
 *               so download is safe to re-run as you add new sources.
 *   load      — reads all cached files, wraps each in a structured Markdown header
 *               (title, source, type, author, date, URL, tags), and uploads to Semiont
 *               as one resource per source. Saves phaseResourceIds so that
 *               highlightPhases (annotate command) works correctly.
 *   annotate  — driven entirely by highlightPhases in config.yaml (no handler code needed).
 *
 * To add a new source: append an entry to the `sources` list in config.yaml and re-run
 * the download + load commands.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SemiontApiClient } from '@semiont/api-client';
import type { AccessToken, ResourceUri } from '@semiont/core';
import type {
  DatasetHandler,
  DatasetYamlConfig,
  SourceConfig,
  CustomLoadResult,
} from './types.js';
import type { DocumentInfo } from '../types.js';
import { uploadDocuments, createDocumentTableOfContents } from '../resources.js';
import { createStubReferences, linkReferences } from '../annotations.js';
import {
  printInfo,
  printSuccess,
  printWarning,
  printSectionHeader,
  printBatchProgress,
} from '../display.js';

// ─────────────────────────────────────────────────────────────────────────────
// HTML → plain text extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip HTML and extract readable text. Tries to focus on the main content
 * area (<article> or <main>) before falling back to <body>.
 */
function extractText(html: string): string {
  // Remove scripts, styles, and nav chrome
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');

  // Prefer <article> or <main> over full body
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch    = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const bodyMatch    = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  const inner = articleMatch?.[1] ?? mainMatch?.[1] ?? bodyMatch?.[1] ?? text;

  // Convert block elements to newlines
  let out = inner
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
      (_, c) => '\n\n## ' + c.replace(/<[^>]+>/g, '').trim() + '\n\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi,
      (_, c) => '- ' + c.replace(/<[^>]+>/g, '').trim() + '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');   // strip remaining tags

  // Decode common HTML entities
  out = out
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, ' ');

  // Normalise whitespace
  return out
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown document builder
// ─────────────────────────────────────────────────────────────────────────────

function buildMarkdown(source: SourceConfig, body: string): string {
  return `# ${source.title}

| Field | Value |
|-------|-------|
| **Source** | ${source.source ?? source.type} |
| **Type** | ${source.type} |
| **Author** | ${source.author ?? 'N/A'} |
| **Date** | ${source.date ?? 'N/A'} |
| **URL** | ${source.url} |
| **Tags** | ${source.tags ?? ''} |

---

${body}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export const webMultiSourceHandler: DatasetHandler = {

  // ── Download ───────────────────────────────────────────────────────────────
  async download(config: DatasetYamlConfig): Promise<void> {
    const sources = config.sources;
    if (!sources || sources.length === 0) {
      throw new Error('web-multi-source handler requires a "sources" list in config.yaml');
    }

    const cacheDir = config.cacheFile;
    if (!cacheDir) {
      throw new Error('web-multi-source handler requires "cacheFile" (used as cache directory) in config.yaml');
    }

    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
      printInfo(`Created cache directory: ${cacheDir}`);
    }

    printInfo(`Downloading ${sources.length} sources → ${cacheDir}`);

    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const dest = join(cacheDir, `${src.id}.txt`);

      printBatchProgress(i + 1, sources.length, src.title);

      if (existsSync(dest)) {
        printInfo('  (already cached — skipping)', 4);
        continue;
      }

      try {
        const res = await fetch(src.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
              + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: AbortSignal.timeout(20_000),
        });

        if (!res.ok) {
          printWarning(`  HTTP ${res.status} — saving placeholder`);
          writeFileSync(dest, `[Fetch failed: HTTP ${res.status} from ${src.url}]`);
          continue;
        }

        const ct = res.headers.get('content-type') ?? '';
        let body: string;

        if (ct.includes('text/html')) {
          const html = await res.text();
          body = extractText(html);
        } else {
          body = await res.text();
        }

        writeFileSync(dest, body, 'utf-8');
        printSuccess(`  Saved ${body.length.toLocaleString()} chars`);

        // Polite crawl delay
        await new Promise(r => setTimeout(r, 600));

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        printWarning(`  Failed: ${msg} — saving placeholder`);
        writeFileSync(dest, `[Fetch failed: ${msg}]`);
      }
    }

    printSuccess(`Download complete (${sources.length} sources processed)`);
  },

  // ── Load (standard path — not used; customLoad is used instead) ───────────
  async load(_config: DatasetYamlConfig): Promise<DocumentInfo[]> {
    throw new Error(
      'web-multi-source uses customLoad — it manages its own multi-document upload workflow.',
    );
  },

  // ── Custom Load ────────────────────────────────────────────────────────────
  async customLoad(
    config: DatasetYamlConfig,
    _scenarioDir: string,
    client: SemiontApiClient,
    auth: AccessToken,
  ): Promise<CustomLoadResult> {
    const sources = config.sources;
    if (!sources || sources.length === 0) {
      throw new Error('web-multi-source handler requires a "sources" list in config.yaml');
    }

    const cacheDir = config.cacheFile;
    if (!cacheDir) {
      throw new Error('web-multi-source handler requires "cacheFile" (cache directory) in config.yaml');
    }

    const baseEntityTypes = config.entityTypes ?? [];

    // ── Step 1: build DocumentInfo list from cache ──────────────────────────
    printSectionHeader('📥', 1, 'Load Cached Sources');

    const documents: DocumentInfo[] = [];
    const missing: string[] = [];

    for (const src of sources) {
      const cachePath = join(cacheDir, `${src.id}.txt`);

      let body: string;
      if (existsSync(cachePath)) {
        body = readFileSync(cachePath, 'utf-8');
      } else {
        missing.push(src.title);
        body = '[Content not yet downloaded — run the download command first.]';
      }

      documents.push({
        title: src.title,
        content: buildMarkdown(src, body),
        format: 'text/markdown',
      });
    }

    if (missing.length > 0) {
      printWarning(`${missing.length} source(s) not yet cached — run download first:`);
      missing.forEach(t => printWarning(`  • ${t}`, 4));
    }

    printSuccess(`Prepared ${documents.length} documents`);

    // ── Step 2: upload ───────────────────────────────────────────────────────
    printSectionHeader('📤', 2, 'Upload Sources to Semiont');

    const uploadResult = await uploadDocuments(documents, client, auth, {
      entityTypes: [...baseEntityTypes, 'ai-news-source'],
    });

    const uploadedIds: ResourceUri[] = uploadResult.ids;

    // ── Step 3: Table of Contents (optional) ────────────────────────────────
    if (config.createTableOfContents && config.tocTitle) {
      printSectionHeader('📑', 3, 'Create Table of Contents');

      const tocResult = await createDocumentTableOfContents(
        uploadResult.uploaded,
        client,
        auth,
        { title: config.tocTitle, entityTypes: baseEntityTypes },
      );

      const refsWithIds = await createStubReferences(
        tocResult.tocId, tocResult.references, uploadedIds, client, auth,
      );
      await linkReferences(tocResult.tocId, refsWithIds, client, auth);

      printSuccess(`ToC created: "${config.tocTitle}"`);
    }

    const totalUploaded = uploadResult.uploaded.length;
    const totalFailed   = uploadResult.failed.length;

    printSectionHeader('✨', config.createTableOfContents ? 4 : 3, 'Summary');
    printSuccess(`Uploaded ${totalUploaded} sources, ${totalFailed} failed`);

    return {
      totalUploaded,
      totalFailed,
      phaseResults: {
        sources: { uploaded: totalUploaded, failed: totalFailed },
      },
      // ← this is what lets highlightPhases in annotate.ts find the resources
      phaseResourceIds: { sources: uploadedIds },
    };
  },
};
