#!/usr/bin/env tsx
/**
 * Semiont Demo Script
 *
 * Demonstrates document processing, chunking, annotation, and linking workflows
 * for multiple datasets.
 *
 * Workflow:
 *   Download Phase (optional):
 *     - Fetch content from remote source (Cornell LII, arXiv API, etc.)
 *     - Cache raw content in data/tmp/
 *     - Skip if dataset is already local (e.g., hiking.txt)
 *
 *   Load Phase:
 *     - Read from local cache
 *     - Format and process text
 *     - Chunk document (if configured)
 *     - Upload chunks to backend
 *     - Create Table of Contents (if configured)
 *     - Link TOC references to documents (if configured)
 *
 *   Annotate Phase:
 *     - Detect patterns in text (e.g., legal citations)
 *     - Create annotations via API
 *
 * Usage:
 *   tsx demo.ts <dataset> download   # Download and cache raw content
 *   tsx demo.ts <dataset> load       # Process cache and upload to backend
 *   tsx demo.ts <dataset> annotate   # Detect citations and create annotations
 *
 * Available datasets:
 *   - citizens_united: Supreme Court case (chunked, TOC+links, citation detection)
 *   - hiking: Simple text document (single doc, no TOC, no citations)
 *   - arxiv: Research paper from arXiv.org (single doc, no TOC, no citations)
 *   - prometheus_bound: Ancient Greek drama from Project Gutenberg (smart-chunked, TOC+links, no citations)
 */

import { Command } from 'commander';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SemiontApiClient } from '@semiont/api-client';
import type { ResourceUri } from '@semiont/core';
import { baseUrl, resourceUri } from '@semiont/core';
import winston from 'winston';

// Dataset configuration types
import type { DatasetConfig, DatasetConfigWithPaths } from './src/types.js';

// Local modules
import { chunkBySize, chunkText, type ChunkInfo } from './src/chunking';
import { authenticate } from './src/auth';
import {
  uploadChunks,
  uploadDocuments,
  createTableOfContents,
  createDocumentTableOfContents,
  type TableOfContentsReference,
} from './src/resources';
import { createStubReferences, linkReferences } from './src/annotations';
import { showDocumentHistory } from './src/history';
import { detectCitations } from './src/legal-citations';
import { TerminalApp } from './src/terminal-app.js';
import { validateResources, formatValidationResults } from './src/validation.js';
import {
  printMainHeader,
  printSectionHeader,
  printInfo,
  printSuccess,
  printDownloadStats,
  printChunkingStats,
  printBatchProgress,
  printResults,
  printCompletion,
  printError,
} from './src/display';

// ============================================================================
// DATASET CONFIGURATIONS
// ============================================================================

/**
 * Dynamically load all dataset configurations from the structured-knowledge submodule
 * Each dataset should be in its own subdirectory with a config.ts file
 * Scans both structured-knowledge/scenarios/ and structured-knowledge/scenarios/private/ directories
 */
async function loadDatasets(): Promise<Record<string, DatasetConfigWithPaths>> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const configDir = join(__dirname, 'structured-knowledge/scenarios');

  const datasets: Record<string, DatasetConfigWithPaths> = {};

  /**
   * Scan a directory for dataset configurations
   * @param basePath - The base directory to scan (e.g., 'structured-knowledge/scenarios' or 'structured-knowledge/scenarios/private')
   * @param relativePathPrefix - The relative path prefix for state files (e.g., 'structured-knowledge/scenarios' or 'structured-knowledge/scenarios/private')
   */
  async function scanDirectory(basePath: string, relativePathPrefix: string) {
    if (!existsSync(basePath)) {
      return;
    }

    // Read all entries in the directory
    const entries = readdirSync(basePath, { withFileTypes: true });

    for (const entry of entries) {
      // Only process directories (skip files like types.ts, README.md, .gitignore)
      if (!entry.isDirectory()) {
        continue;
      }

      // Look for config.ts within the dataset directory
      const configPath = join(basePath, entry.name, 'config.ts');

      // Skip if config.ts doesn't exist (e.g., private/ is a container directory, not a dataset)
      if (!existsSync(configPath)) {
        continue;
      }

      try {
        const module = await import(configPath);

        if (module.config && typeof module.config === 'object') {
          const config = module.config as DatasetConfig;

          // Add computed stateFile path
          const configWithPaths: DatasetConfigWithPaths = {
            ...config,
            stateFile: join(relativePathPrefix, entry.name, '.state.json'),
          };

          datasets[config.name] = configWithPaths;
        }
      } catch (error) {
        // Skip directories that don't have a valid config.ts
        console.warn(`Warning: Could not load config from ${relativePathPrefix}/${entry.name}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  // Scan public configs in structured-knowledge/scenarios/
  await scanDirectory(configDir, 'structured-knowledge/scenarios');

  // Scan private configs in structured-knowledge/scenarios/private/
  await scanDirectory(join(configDir, 'private'), 'structured-knowledge/scenarios/private');

  return datasets;
}

// Load datasets at startup
const DATASETS = await loadDatasets();

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

const SEMIONT_URL = process.env.SEMIONT_URL || process.env.BACKEND_URL || 'http://localhost:8080';
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'you@example.com';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';

if (!AUTH_EMAIL && !ACCESS_TOKEN) {
  throw new Error('Either AUTH_EMAIL or ACCESS_TOKEN must be provided');
}

// Configure logger for API client
const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
      return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

interface DemoState {
  dataset: string;
  tocId?: ResourceUri;
  chunkIds?: ResourceUri[];
  documentIds?: ResourceUri[];
  references?: TableOfContentsReference[];
  formattedText: string;
  phaseResourceIds?: Record<string, ResourceUri[]>;
}

function saveState(dataset: DatasetConfigWithPaths, state: Omit<DemoState, 'dataset'>): void {
  const fullState: DemoState = { dataset: dataset.name, ...state };
  writeFileSync(dataset.stateFile, JSON.stringify(fullState, null, 2));
  printSuccess(`State saved to ${dataset.stateFile}`);
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

// ============================================================================
// COMMAND: DOWNLOAD
// ============================================================================

async function downloadCommand(datasetName: string) {
  const dataset = DATASETS[datasetName];
  if (!dataset) {
    throw new Error(`Unknown dataset: ${datasetName}. Available: ${Object.keys(DATASETS).join(', ')}`);
  }

  printMainHeader(dataset.emoji, `${dataset.displayName} Demo - Download`);

  try {
    // Check if already cached
    if (existsSync(dataset.cacheFile)) {
      printInfo(`Cache file already exists: ${dataset.cacheFile}`);
      console.log('💡 Use --force to re-download, or run the load command to proceed.');
      return;
    }

    // Check if download is needed
    if (!dataset.downloadContent) {
      printInfo('This dataset is already local, no download needed.');
      printSuccess(`Using: ${dataset.cacheFile}`);
      printCompletion();
      return;
    }

    // Ensure data/tmp directory exists
    const { mkdirSync } = await import('node:fs');
    mkdirSync('data/tmp', { recursive: true });

    // Download content
    printSectionHeader('📥', 1, 'Download Content');
    await dataset.downloadContent();

    printCompletion();
    console.log(`\n💡 Next step: Run "tsx demo.ts ${datasetName} load" to process and upload\n`);
  } catch (error) {
    printError(error as Error);
    process.exit(1);
  }
}

// ============================================================================
// COMMAND: LOAD
// ============================================================================

async function loadCommand(datasetName: string) {
  const dataset = DATASETS[datasetName];
  if (!dataset) {
    throw new Error(`Unknown dataset: ${datasetName}. Available: ${Object.keys(DATASETS).join(', ')}`);
  }

  printMainHeader(dataset.emoji, `${dataset.displayName} Demo - Load`);

  try {
    // Check if cache file exists
    if (!existsSync(dataset.cacheFile)) {
      printError(new Error(`Cache file not found: ${dataset.cacheFile}`));
      console.log(`\n💡 Run "tsx demo.ts ${datasetName} download" first to download the content.\n`);
      process.exit(1);
    }

    const client = new SemiontApiClient({
      baseUrl: baseUrl(SEMIONT_URL),
      logger,
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

    let chunkIds: ResourceUri[];
    let tocId: ResourceUri | undefined;
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
      console.log(`\n💡 Next step: Run "tsx demo.ts ${datasetName} annotate" to detect citations\n`);
    }
  } catch (error) {
    printError(error as Error);
    process.exit(1);
  }
}

// ============================================================================
// COMMAND: ANNOTATE
// ============================================================================

async function annotateCommand(datasetName: string) {
  const dataset = DATASETS[datasetName];
  if (!dataset) {
    throw new Error(`Unknown dataset: ${datasetName}. Available: ${Object.keys(DATASETS).join(', ')}`);
  }

  printMainHeader(dataset.emoji, `${dataset.displayName} Demo - Annotate`);

  try {
    const client = new SemiontApiClient({
      baseUrl: baseUrl(SEMIONT_URL),
      logger,
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

    // Check if this dataset supports citation detection
    if (!dataset.detectCitations) {
      printInfo('This dataset does not support the annotate command (no citations to detect)');
      printCompletion();
      return;
    }

    if (!state.chunkIds || state.chunkIds.length === 0) {
      printError(new Error('No chunks found in state. Run the load command first.'));
      process.exit(1);
    }

    printSuccess(`Loaded ${state.chunkIds.length} chunk IDs`);

    // Re-chunk the text to get chunk content for annotation detection
    let chunks: ChunkInfo[];
    if (dataset.isMultiDocument) {
      // For multi-document datasets, load the documents and treat each as a chunk
      const documents = await dataset.loadDocuments!();
      chunks = documents.map((doc, index) => ({
        title: doc.title,
        content: typeof doc.content === 'string' ? doc.content : doc.content.toString(),
        partNumber: index + 1,
      }));
    } else if (dataset.shouldChunk) {
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
          await client.createAnnotation(resourceUri(chunkId), {
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
    process.exit(1);
  }
}

// ============================================================================
// COMMAND: VALIDATE
// ============================================================================

async function validateCommand(datasetName: string) {
  const dataset = DATASETS[datasetName];
  if (!dataset) {
    throw new Error(`Unknown dataset: ${datasetName}. Available: ${Object.keys(DATASETS).join(', ')}`);
  }

  printMainHeader(dataset.emoji, `${dataset.displayName} Demo - Validate`);

  try {
    const client = new SemiontApiClient({
      baseUrl: baseUrl(SEMIONT_URL),
      logger,
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

    // Collect all resource URIs
    const allResources: ResourceUri[] = [];

    if (state.tocId) {
      allResources.push(state.tocId);
    }

    if (state.chunkIds) {
      allResources.push(...state.chunkIds);
    }

    if (state.documentIds) {
      allResources.push(...state.documentIds);
    }

    printSuccess(`Found ${allResources.length} resources to validate`);
    console.log();

    // Pass 2: Validate Resources
    printSectionHeader('✓', 2, 'Validate Resources');
    const results = await validateResources(allResources, client, auth);

    // Display results
    const formattedLines = formatValidationResults(results);
    formattedLines.forEach(line => console.log(line));

    // Summary
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    console.log();
    console.log('📊 Summary:');
    console.log(`   Total resources: ${results.length}`);
    console.log(`   ✓ Successful: ${successCount}`);
    if (errorCount > 0) {
      console.log(`   ✗ Errors: ${errorCount}`);
    }

    printCompletion();
  } catch (error) {
    printError(error as Error);
    process.exit(1);
  }
}

// ============================================================================
// EXPORTS (for interactive terminal app)
// ============================================================================

export { downloadCommand, loadCommand, annotateCommand, validateCommand };

// ============================================================================
// CLI SETUP
// ============================================================================

const program = new Command();

program
  .name('demo')
  .description('Semiont demo script for multiple datasets\n\nUse --interactive (or --app, --terminal) to launch the interactive terminal UI')
  .version('0.1.0')
  .argument('[dataset]', `Dataset name. Available: ${Object.keys(DATASETS).join(', ')}`)
  .argument('[command]', 'Command to run: download, load, annotate, validate')
  .action((dataset?: string, command?: string) => {
    if (!dataset || !command) {
      program.help();
      return;
    }

    if (command === 'download') {
      return downloadCommand(dataset);
    } else if (command === 'load') {
      return loadCommand(dataset);
    } else if (command === 'annotate') {
      return annotateCommand(dataset);
    } else if (command === 'validate') {
      return validateCommand(dataset);
    } else {
      console.error(`Unknown command: ${command}. Use 'download', 'load', 'annotate', or 'validate'.`);
      process.exit(1);
    }
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  // Check for interactive mode flags before Commander processes them
  const hasInteractiveFlag = process.argv.some(arg =>
    arg === '--interactive' || arg === '--app' || arg === '--terminal'
  );

  if (hasInteractiveFlag) {
    // Keep reference to app for cleanup in error handlers
    let app: TerminalApp | null = null;

    // Add global error handlers FIRST, before creating blessed screen
    // This ensures errors don't get swallowed by the blessed UI
    process.on('uncaughtException', (error) => {
      // Try to clean up blessed screen if it exists
      if (app) {
        try {
          app.destroy();
        } catch {
          // Ignore cleanup errors
        }
      }
      console.error('\n❌ Uncaught exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      // Try to clean up blessed screen if it exists
      if (app) {
        try {
          app.destroy();
        } catch {
          // Ignore cleanup errors
        }
      }
      console.error('\n❌ Unhandled promise rejection:', reason);
      process.exit(1);
    });

    // Launch interactive mode directly
    try {
      app = new TerminalApp(DATASETS);
      app.run();
    } catch (error) {
      // Error during initialization
      if (app) {
        try {
          app.destroy();
        } catch {
          // Ignore cleanup errors
        }
      }
      console.error('\n❌ Fatal error during interactive mode initialization:\n');
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
        console.error(`\nStack trace:`);
        console.error(error.stack);
      } else {
        console.error(error);
      }
      console.error('\nPlease check:');
      console.error('  - That all dependencies are installed (npm install)');
      console.error('  - That .env file exists with valid credentials');
      console.error('  - That DATASETS configuration is valid\n');
      process.exit(1);
    }
  } else {
    // Show help if no command provided
    if (process.argv.length === 2) {
      program.help();
    }

    // Parse commands normally
    program.parse(process.argv);
  }
}
