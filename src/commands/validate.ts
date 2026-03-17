import { existsSync, readFileSync } from 'node:fs';
import { SemiontApiClient } from '@semiont/api-client';
import type { ResourceId } from '@semiont/core';
import { baseUrl } from '@semiont/core';
import type { DatasetConfigWithPaths } from '../types.js';
import { DATASETS } from '../datasets/loader.js';
import { authenticate } from '../auth.js';
import { validateResources, formatValidationResults } from '../validation.js';
import type { TableOfContentsReference } from '../resources.js';
import {
  printMainHeader,
  printSectionHeader,
  printSuccess,
  printCompletion,
  printError,
} from '../display.js';

interface DemoState {
  dataset: string;
  tocId?: ResourceId;
  chunkIds?: ResourceId[];
  documentIds?: ResourceId[];
  references?: TableOfContentsReference[];
  formattedText: string;
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

export async function validateCommand(datasetName: string): Promise<void> {
  const dataset = DATASETS[datasetName];
  if (!dataset) {
    throw new Error(`Unknown dataset: ${datasetName}. Available: ${Object.keys(DATASETS).join(', ')}`);
  }

  printMainHeader(dataset.emoji || '📄', `${dataset.displayName} Demo - Validate`);

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

    // Collect all resource URIs
    const allResources: ResourceId[] = [];

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
    throw error;
  }
}
