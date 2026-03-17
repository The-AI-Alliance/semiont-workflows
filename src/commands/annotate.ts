import { existsSync, readFileSync } from 'node:fs';
import { SemiontApiClient } from '@semiont/api-client';
import type { ResourceId } from '@semiont/core';
import { baseUrl, EventBus } from '@semiont/core';
import type { DatasetConfigWithPaths } from '../types.js';
import type { HighlightPhaseConfig } from '../handlers/types.js';
import { DATASETS } from '../datasets/loader.js';
import { chunkBySize, chunkText, type ChunkInfo } from '../chunking.js';
import { authenticate } from '../auth.js';
import { showDocumentHistory } from '../history.js';
import { detectCitations } from '../legal-citations.js';
import type { TableOfContentsReference } from '../resources.js';
import {
  printMainHeader,
  printSectionHeader,
  printInfo,
  printSuccess,
  printWarning,
  printBatchProgress,
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

function loadState(dataset: DatasetConfigWithPaths): DemoState {
  if (!existsSync(dataset.stateFile)) {
    throw new Error(`State file ${dataset.stateFile} not found. Run 'load' command first.`);
  }
  const data = readFileSync(dataset.stateFile, 'utf-8');
  const state: DemoState = JSON.parse(data);

  if (state.dataset !== dataset.name) {
    throw new Error(`State file is for dataset '${state.dataset}', but you requested '${dataset.name}'`);
  }

  return state;
}

/**
 * Run annotateHighlights on a single resource via SSE, returning the number of highlights created.
 */
async function annotateHighlightsForResource(
  resourceId: ResourceId,
  instructions: string,
  density: number | undefined,
  client: SemiontApiClient,
  auth: import('@semiont/core').AccessToken,
): Promise<void> {
  const eventBus = new EventBus();

  const completionPromise = new Promise<void>((resolve, reject) => {
    const finishedSub = eventBus.get('mark:assist-finished').subscribe(() => {
      finishedSub.unsubscribe();
      failedSub.unsubscribe();
      resolve();
    });
    const failedSub = eventBus.get('mark:assist-failed').subscribe((result) => {
      finishedSub.unsubscribe();
      failedSub.unsubscribe();
      const msg = (result as unknown as Record<string, unknown>).error ?? 'Unknown error';
      reject(new Error(`Highlight annotation failed: ${msg}`));
    });
  });

  const stream = client.sse.annotateHighlights(
    resourceId,
    { instructions, density },
    { auth, eventBus },
  );

  try {
    await completionPromise;
  } finally {
    stream.close();
    eventBus.destroy();
  }
}

/**
 * Execute highlight phases: for each phase, iterate over target resources
 * and call annotateHighlights with the configured prompt.
 */
async function executeHighlightPhases(
  highlightPhases: HighlightPhaseConfig[],
  state: DemoState,
  client: SemiontApiClient,
  auth: import('@semiont/core').AccessToken,
): Promise<number> {
  let totalAnnotated = 0;
  let stepNumber = 2;

  for (const phase of highlightPhases) {
    printSectionHeader('🔍', stepNumber++, phase.displayName);

    const resourceIds = state.phaseResourceIds?.[phase.phase];
    if (!resourceIds || resourceIds.length === 0) {
      printWarning(`No resources found for phase "${phase.phase}" in state`);
      continue;
    }

    printInfo(`Annotating ${resourceIds.length} resources with AI highlights...`);
    printInfo(`Instructions: "${phase.instructions}"`);

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < resourceIds.length; i++) {
      printBatchProgress(i + 1, resourceIds.length, `Highlighting resource ${i + 1}...`);

      try {
        await annotateHighlightsForResource(
          resourceIds[i], phase.instructions, phase.density, client, auth,
        );
        succeeded++;
      } catch (error) {
        failed++;
        printWarning(`Failed on resource ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    printSuccess(`Highlighted ${succeeded}/${resourceIds.length} resources (${failed} failed)`);
    totalAnnotated += succeeded;
  }

  return totalAnnotated;
}

export async function annotateCommand(datasetName: string): Promise<void> {
  const dataset = DATASETS[datasetName];
  if (!dataset) {
    throw new Error(`Unknown dataset: ${datasetName}. Available: ${Object.keys(DATASETS).join(', ')}`);
  }

  printMainHeader(dataset.emoji || '📄', `${dataset.displayName} Demo - Annotate`);

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

    // Load state from load command
    printSectionHeader('📂', 1, 'Load State');
    const state = loadState(dataset);

    // Branch: Highlight phases (AI-driven) vs Citation detection (legacy)
    if (dataset.highlightPhases && dataset.highlightPhases.length > 0) {
      // AI-driven highlighting via Semiont SSE
      if (!state.phaseResourceIds) {
        throw new Error('No phaseResourceIds found in state. Run the load command first.');
      }

      printSuccess(`Loaded state with ${Object.keys(state.phaseResourceIds).length} phases`);

      const totalAnnotated = await executeHighlightPhases(
        dataset.highlightPhases, state, client, auth,
      );

      // Summary
      console.log();
      console.log('📊 Summary:');
      console.log(`   Resources highlighted: ${totalAnnotated}`);

      printCompletion();
      return;
    }

    // Legacy: Citation detection
    if (!dataset.detectCitations) {
      printInfo('This dataset does not support the annotate command');
      printCompletion();
      return;
    }

    if (!state.chunkIds || state.chunkIds.length === 0) {
      throw new Error('No chunks found in state. Run the load command first.');
    }

    printSuccess(`Loaded ${state.chunkIds.length} chunk IDs`);

    // Re-chunk the text to get chunk content for annotation detection
    let chunks: ChunkInfo[];
    if (dataset.shouldChunk) {
      if (dataset.useSmartChunking) {
        chunks = chunkText(state.formattedText, dataset.chunkSize!, `${dataset.displayName} - Part`);
      } else {
        chunks = chunkBySize(state.formattedText, dataset.chunkSize!, `${dataset.displayName} - Part`);
      }
    } else {
      chunks = [{
        title: dataset.displayName,
        content: state.formattedText,
        partNumber: 1,
      }];
    }

    let totalAnnotations = 0;

    // Pass 2: Detect Legal Citations
    printSectionHeader('⚖️ ', 2, 'Detect Legal Citations');

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkId = state.chunkIds[i];

      printBatchProgress(i + 1, chunks.length, `Scanning "${chunk.title}"...`);

      const citations = await detectCitations(chunk.content);

      if (citations.length > 0) {
        printInfo(`Found ${citations.length} citation(s)`, 7);

        for (const citation of citations) {
          await client.createAnnotation(chunkId, {
            motivation: 'linking',
            target: {
              source: chunkId,
              selector: [
                {
                  type: 'TextPositionSelector',
                  start: citation.start,
                  end: citation.end,
                },
                {
                  type: 'TextQuoteSelector',
                  exact: citation.text,
                },
              ],
            },
            body: [{
              type: 'TextualBody',
              value: 'LegalCitation',
              purpose: 'tagging',
            }],
          }, { auth });

          totalAnnotations++;
        }
      }
    }

    printSuccess(`Detected and tagged ${totalAnnotations} legal citations across ${chunks.length} chunks`);

    // Pass 3: Show Document History
    printSectionHeader('📜', 3, 'Document History');
    await showDocumentHistory(state.chunkIds[0], client, auth);

    // Pass 4: Print Summary
    console.log();
    console.log('📊 Summary:');
    console.log(`   Citations detected: ${totalAnnotations}`);

    printCompletion();
  } catch (error) {
    printError(error as Error);
    throw error;
  }
}
