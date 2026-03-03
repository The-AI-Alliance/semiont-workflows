/**
 * Dataset Configuration Types
 *
 * Shared types for dataset configurations.
 */

/**
 * Document info for multi-document datasets
 */
export interface DocumentInfo {
  title: string;
  content: string | Buffer; // Support both text and binary content
  format?: 'text/plain' | 'text/markdown' | 'image/jpeg' | 'image/png' | string; // MIME type
  language?: string; // ISO 639-1 lowercase (e.g., "en", "fr", "de")
  metadata?: Record<string, unknown>;
}

export interface DatasetConfig {
  name: string;
  displayName: string;
  emoji: string;

  // Single-document workflow (chunked or not)
  shouldChunk: boolean;
  chunkSize?: number;
  useSmartChunking?: boolean; // If true, use paragraph-aware chunking instead of fixed-size
  cacheFile: string;
  downloadContent?: () => Promise<void>;
  loadText?: () => Promise<string>; // For single-document datasets

  // Multi-document workflow
  isMultiDocument?: boolean; // If true, uses loadDocuments instead of loadText
  loadDocuments?: () => Promise<DocumentInfo[]>; // For multi-document datasets

  // Custom load workflow (handler manages its own multi-phase uploads)
  customLoad?: (
    client: import('@semiont/api-client').SemiontApiClient,
    auth: import('@semiont/core').AccessToken,
  ) => Promise<import('./handlers/types.js').CustomLoadResult>;

  // Common fields
  entityTypes: string[];
  createTableOfContents: boolean;
  tocTitle?: string;
  detectCitations: boolean;
  extractionConfig?: {
    startPattern: RegExp;
    endMarker: string;
  };

  // Annotate command config (highlight phases use Semiont AI)
  highlightPhases?: import('./handlers/types.js').HighlightPhaseConfig[];
}

/**
 * Extended dataset config with computed paths
 * Created internally by demo.ts during dataset loading
 */
export interface DatasetConfigWithPaths extends DatasetConfig {
  stateFile: string; // Computed: structured-knowledge/scenarios/{dataset_dir}/.state.json
}
