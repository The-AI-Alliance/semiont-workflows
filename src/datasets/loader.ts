import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import type { DatasetConfig, DatasetConfigWithPaths } from '../types.js';
import type { DatasetYamlConfig } from '../handlers/types.js';
import { HANDLERS } from '../handlers/index.js';

/**
 * Resolve cacheFile path. Absolute paths (including /tmp/) are kept as-is.
 * Relative paths are resolved against the scenario directory.
 */
function resolveCacheFile(cacheFile: string | undefined, scenarioDir: string, name: string): string {
  if (!cacheFile) {
    return `/tmp/${name}.cache`;
  }
  if (isAbsolute(cacheFile)) {
    return cacheFile;
  }
  return join(scenarioDir, cacheFile);
}

/**
 * Convert YAML config to DatasetConfig with handler functions.
 * scenarioDir is the absolute path to the scenario directory containing config.yaml.
 */
function yamlToDatasetConfig(yamlConfig: DatasetYamlConfig, scenarioDir: string): DatasetConfig {
  const handler = HANDLERS[yamlConfig.handler];
  if (!handler) {
    throw new Error(`Unknown handler: ${yamlConfig.handler}. Available handlers: ${Object.keys(HANDLERS).join(', ')}`);
  }

  const resolvedCacheFile = resolveCacheFile(yamlConfig.cacheFile, scenarioDir, yamlConfig.name);

  // Update the yamlConfig's cacheFile so handlers see the resolved path
  const resolvedConfig = { ...yamlConfig, cacheFile: resolvedCacheFile };

  return {
    name: yamlConfig.name,
    displayName: yamlConfig.displayName || yamlConfig.name,
    emoji: yamlConfig.emoji || '📄',
    shouldChunk: yamlConfig.shouldChunk || false,
    chunkSize: yamlConfig.chunkSize,
    useSmartChunking: yamlConfig.useSmartChunking,
    entityTypes: yamlConfig.entityTypes || [],
    createTableOfContents: yamlConfig.createTableOfContents || false,
    tocTitle: yamlConfig.tocTitle,
    detectCitations: yamlConfig.detectCitations || false,
    cacheFile: resolvedCacheFile,
    isMultiDocument: yamlConfig.isMultiDocument,
    extractionConfig: yamlConfig.extractionConfig ? {
      startPattern: new RegExp(yamlConfig.extractionConfig.startPattern),
      endMarker: yamlConfig.extractionConfig.endMarker,
    } : undefined,

    // Bind handler functions with the config
    downloadContent: () => handler.download(resolvedConfig),
    loadText: yamlConfig.isMultiDocument ? undefined : async () => {
      const result = await handler.load(resolvedConfig);
      if (typeof result !== 'string') {
        throw new Error(`Handler ${yamlConfig.handler} returned documents but isMultiDocument is false`);
      }
      return result;
    },
    loadDocuments: yamlConfig.isMultiDocument ? async () => {
      const result = await handler.load(resolvedConfig);
      if (typeof result === 'string') {
        throw new Error(`Handler ${yamlConfig.handler} returned string but isMultiDocument is true`);
      }
      return result;
    } : undefined,

    // Custom load: handler manages its own upload workflow (multi-phase with cross-references)
    customLoad: handler.customLoad
      ? (client, auth) => handler.customLoad!(resolvedConfig, scenarioDir, client, auth)
      : undefined,

    // Annotate command config
    highlightPhases: yamlConfig.highlightPhases,
  };
}

/**
 * Dynamically load all dataset configurations from the structured-knowledge submodule
 * Each dataset should be in its own subdirectory with a config.yaml file
 * Scans both structured-knowledge/scenarios/ and structured-knowledge/scenarios/private/ directories
 */
export async function loadDatasets(): Promise<Record<string, DatasetConfigWithPaths>> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // In dev: src/datasets/loader.ts -> ../../structured-knowledge/scenarios
  // In built bundle: dist/cli.js -> ../structured-knowledge/scenarios
  const isBundled = __filename.includes('/dist/');
  const configDir = isBundled ? join(__dirname, '../structured-knowledge/scenarios') : join(__dirname, '../../structured-knowledge/scenarios');

  const datasets: Record<string, DatasetConfigWithPaths> = {};

  async function scanDirectory(basePath: string, relativePathPrefix: string) {
    if (!existsSync(basePath)) {
      return;
    }

    const entries = readdirSync(basePath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      // Try YAML first (preferred), then fall back to TypeScript
      const yamlPath = join(basePath, entry.name, 'config.yaml');
      const tsPath = join(basePath, entry.name, 'config.ts');

      try {
        if (existsSync(yamlPath)) {
          // Load YAML config with handlers
          const yamlContent = readFileSync(yamlPath, 'utf-8');
          const yamlConfig = yaml.load(yamlContent) as DatasetYamlConfig;
          const scenarioDir = join(basePath, entry.name);
          const config = yamlToDatasetConfig(yamlConfig, scenarioDir);

          const configWithPaths: DatasetConfigWithPaths = {
            ...config,
            stateFile: join(relativePathPrefix, entry.name, '.state.json'),
          };

          datasets[config.name] = configWithPaths;
        } else if (existsSync(tsPath)) {
          // Fall back to TypeScript config (legacy - dev mode only)
          const module = await import(tsPath);
          if (module.config && typeof module.config === 'object') {
            const config = module.config as DatasetConfig;

            const configWithPaths: DatasetConfigWithPaths = {
              ...config,
              stateFile: join(relativePathPrefix, entry.name, '.state.json'),
            };

            datasets[config.name] = configWithPaths;
          }
        }
      } catch (error) {
        console.warn(`Warning: Could not load config from ${relativePathPrefix}/${entry.name}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  await scanDirectory(configDir, 'structured-knowledge/scenarios');
  await scanDirectory(join(configDir, 'private'), 'structured-knowledge/scenarios/private');

  return datasets;
}

// Load datasets at module initialization (top-level await)
export const DATASETS = await loadDatasets();
