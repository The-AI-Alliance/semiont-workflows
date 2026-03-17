import { existsSync, writeFileSync } from 'node:fs';
import { SemiontApiClient } from '@semiont/api-client';
import type { ResourceId } from '@semiont/core';
import { baseUrl } from '@semiont/core';
import { DATASETS } from '../datasets/loader.js';
import { chunkBySize, chunkText, type ChunkInfo } from '../chunking.js';
import { authenticate } from '../auth.js';
import {
  uploadChunks,
  uploadDocuments,
  createTableOfContents,
  createDocumentTableOfContents,
  type TableOfContentsReference,
} from '../resources.js';
import { createStubReferences, linkReferences } from '../annotations.js';
import { showDocumentHistory } from '../history.js';
import {
  printMainHeader,
  printSectionHeader,
  printInfo,
  printSuccess,
  printDownloadStats,
  printChunkingStats,
  printResults,
  printCompletion,
  printError,
} from '../display.js';

interface DemoState {
  dataset: string;
  tocId?: ResourceId;
  chunkIds?: ResourceId[];
  references?: TableOfContentsReference[];
  formattedText: string;
  phaseResourceIds?: Record<string, ResourceId[]>;
}

function saveState(dataset: { name: string; stateFile: string }, state: Omit<DemoState, 'dataset'>): void {
  const fullState: DemoState = { dataset: dataset.name, ...state };
  writeFileSync(dataset.stateFile, JSON.stringify(fullState, null, 2));
}

export async function loadCommand(datasetName: string): Promise<void> {
  const dataset = DATASETS[datasetName];
  if (!dataset) {
    throw new Error(`Unknown dataset: ${datasetName}. Available: ${Object.keys(DATASETS).join(', ')}`);
  }

  printMainHeader(dataset.emoji || '📄', `${dataset.displayName} Demo - Load`);

  try {
    // Read environment variables - NO DEFAULTS, FAIL LOUDLY
    const SEMIONT_URL = process.env.SEMIONT_URL;
    const AUTH_EMAIL = process.env.AUTH_EMAIL;
    const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
    const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

    // Validate required environment variables
    if (!SEMIONT_URL) {
      throw new Error('SEMIONT_URL environment variable is required');
    }

    // Check if cache file exists
    if (!existsSync(dataset.cacheFile)) {
      throw new Error(`Cache file not found: ${dataset.cacheFile}. Run "demo ${datasetName} download" first.`);
    }

    const client = new SemiontApiClient({
      baseUrl: baseUrl(SEMIONT_URL),
    });

    // Pass 0: Authentication
    printSectionHeader('🔐', 0, 'Authentication');
    const auth = await authenticate(client, {
      email: AUTH_EMAIL,
      password: AUTH_PASSWORD,
      accessToken: ACCESS_TOKEN,
    });

    // Branch: Custom load vs Multi-document vs Single-document workflow
    if (dataset.customLoad) {
      // Custom load: handler manages its own multi-phase upload workflow
      const result = await dataset.customLoad(client, auth);
      saveState(dataset, {
        formattedText: '',
        phaseResourceIds: result.phaseResourceIds,
      });
      printCompletion();
      printInfo(`Total uploaded: ${result.totalUploaded}, failed: ${result.totalFailed}`);
      return;
    }

    let chunkIds: ResourceId[];
    let tocId: ResourceId | undefined;
    let references: TableOfContentsReference[] | undefined;
    let formattedText = '';

    if (dataset.isMultiDocument && dataset.loadDocuments) {
      // Multi-document workflow
      printSectionHeader('📥', 1, 'Load Documents');
      const documents = await dataset.loadDocuments();

      // Pass 2: Upload Documents
      printSectionHeader('📤', 2, 'Upload Documents');
      const uploadResult = await uploadDocuments(documents, client, auth, {
        entityTypes: dataset.entityTypes,
      });
      chunkIds = uploadResult.ids;

      // Pass 3: Create Table of Contents (if needed)
      if (dataset.createTableOfContents) {
        printSectionHeader('📑', 3, 'Create Table of Contents');
        const result = await createDocumentTableOfContents(uploadResult.uploaded, client, auth, {
          title: dataset.tocTitle!,
          entityTypes: dataset.entityTypes,
        });
        tocId = result.tocId;
        references = result.references;
      }
    } else if (dataset.loadText) {
      // Single-document workflow
      printSectionHeader('📥', 1, 'Load Document');
      formattedText = await dataset.loadText();

      // Pass 2: Chunk the Document (or create single chunk)
      let chunks: ChunkInfo[];
      if (dataset.shouldChunk) {
        printSectionHeader('✂️ ', 2, 'Chunk Document');
        if (dataset.useSmartChunking) {
          printInfo(`Chunking at paragraph boundaries (~${dataset.chunkSize} chars per chunk)...`);
          chunks = chunkText(formattedText, dataset.chunkSize!, `${dataset.displayName} - Part`);
        } else {
          printInfo(`Chunking into sections (~${dataset.chunkSize} chars per chunk)...`);
          chunks = chunkBySize(formattedText, dataset.chunkSize!, `${dataset.displayName} - Part`);
        }
        const totalChars = chunks.reduce((sum, c) => sum + c.content.length, 0);
        const avgChars = Math.round(totalChars / chunks.length);
        printDownloadStats(totalChars, totalChars);
        printChunkingStats(chunks.length, avgChars);
      } else {
        printSectionHeader('📄', 2, 'Create Single Document');
        printInfo('Loading as a single document (no chunking)...');
        chunks = [{
          title: dataset.displayName,
          content: formattedText,
          partNumber: 1,
        }];
        printSuccess(`Created single document with ${formattedText.length.toLocaleString()} characters`);
      }

      // Pass 3: Upload Chunks
      printSectionHeader('📤', 3, 'Upload Chunks');
      const chunkResult = await uploadChunks(chunks, client, auth, {
        entityTypes: dataset.entityTypes,
      });
      chunkIds = chunkResult.ids;

      // Pass 4: Create Table of Contents (if needed)
      if (dataset.createTableOfContents) {
        printSectionHeader('📑', 4, 'Create Table of Contents');
        const result = await createTableOfContents(chunkResult.uploaded, client, auth, {
          title: dataset.tocTitle!,
          entityTypes: dataset.entityTypes,
        });
        tocId = result.tocId;
        references = result.references;
      }
    } else {
      throw new Error(`Dataset ${dataset.name} must have either loadText or loadDocuments configured`);
    }

    // Shared workflow: Create stub references and link (if TOC was created)
    if (dataset.createTableOfContents && tocId && references) {

      // Pass 5: Create Stub References
      printSectionHeader('🔗', 5, 'Create Stub References');
      const referencesWithIds = await createStubReferences(tocId, references, chunkIds, client, auth, {});

      // Pass 6: Link References to Documents
      printSectionHeader('🎯', 6, 'Link References to Documents');
      const linkedCount = await linkReferences(tocId, referencesWithIds, client, auth);

      // Pass 7: Show Document History
      printSectionHeader('📜', 7, 'Document History');
      await showDocumentHistory(tocId, client, auth);

      // Pass 8: Print Results
      printResults({
        tocId,
        chunkIds,
        linkedCount,
        totalCount: references.length,
        frontendUrl: SEMIONT_URL,
      });
    } else {
      // Pass 4: Show Document History (for non-TOC datasets)
      printSectionHeader('📜', 4, 'Document History');
      await showDocumentHistory(chunkIds[0], client, auth);

      // Print results
      printSectionHeader('✨', 5, 'Results');
      console.log();
      console.log('📄 Document:');
      const parts = chunkIds[0].split('/resources/');
      if (parts.length !== 2 || !parts[1]) {
        throw new Error(`Invalid resource ID format: ${chunkIds[0]}`);
      }
      const resourceId = parts[1];
      console.log(`   ${SEMIONT_URL}/en/know/resource/${resourceId}`);
      console.log();
    }

    // Save state for annotate command
    saveState(dataset, {
      tocId,
      chunkIds,
      references,
      formattedText,
    });

    printCompletion();
    if (dataset.detectCitations) {
      console.log(`\n💡 Next step: Run "demo ${datasetName} annotate" to detect citations\n`);
    }
  } catch (error) {
    printError(error as Error);
    throw error;
  }
}
