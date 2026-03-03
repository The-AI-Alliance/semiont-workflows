/**
 * Dataset Handler Types
 *
 * Handlers implement the actual logic for downloading and loading datasets.
 * Configs (YAML files) reference handlers and provide configuration data.
 */

import type { SemiontApiClient } from '@semiont/api-client';
import type { AccessToken, ResourceUri } from '@semiont/core';
import type { DocumentInfo } from '../types.js';

/**
 * Phase configuration for json-multi-doc handler
 */
export interface PhaseConfig {
  name: string;
  displayName: string;
  source: string; // Item selection expression: "[]", "[].attachments[]", "[?attachments[0]]"
  filter?: string; // Field-existence expression: "firstName && surname"
  groupBy?: string[]; // Fields to group by (e.g., ["firstName", "surname"])
  title: string; // Handlebars template for resource title
  language?: string; // Handlebars template for language (ISO 639-1)
  format?: string; // MIME type (default: text/markdown)
  entityTypes: string[]; // Additional entity types for this phase
  template?: string; // Handlebars markdown template
  binaryFile?: {
    pathTemplate: string; // Handlebars template for file path
    format: string; // MIME type (e.g., "application/pdf")
  };
  refs?: Record<string, PhaseRef>; // Cross-references to earlier phases
  annotations?: PhaseAnnotation[]; // Reference annotations to create after upload
}

export interface PhaseRef {
  phase: string; // Name of the earlier phase
  matchOn: string; // Field path to match (e.g., "id", "attachments[0].documentId")
  multi?: boolean; // If true, collects multiple URIs
}

/**
 * Annotation configuration for a phase.
 * After uploading, creates Semiont reference annotations on each resource,
 * linking anchor text in the rendered content to target resources.
 */
export interface PhaseAnnotation {
  anchor: string; // Handlebars template for anchor text to find in rendered content
  ref: string; // Name of the ref whose URI is the annotation target
  multi?: boolean; // If true, creates one annotation per sub-item (for grouped phases)
}

/**
 * ToC phase configuration for json-multi-doc handler
 */
export interface TocPhaseConfig {
  name: string;
  title: string;
  phase: string; // Name of the upload phase to create ToC for
  entryTemplate: string; // Handlebars template for each ToC entry
  entityTypes: string[];
}

/**
 * Master ToC configuration for json-multi-doc handler
 */
export interface MasterTocConfig {
  title: string;
  entityTypes: string[];
  entries: string[]; // Static text entries (linked to sub-ToCs via annotations)
}

/**
 * Highlight phase configuration for the annotate command.
 * Each phase targets resources from an upload phase and uses Semiont's AI
 * to create highlighting annotations with a given prompt.
 */
export interface HighlightPhaseConfig {
  name: string;
  displayName: string;
  phase: string;           // upload phase whose resources to annotate
  instructions: string;    // prompt for Semiont's annotateHighlights AI
  density?: number;        // highlights per 2000 words (1-15)
  entityTypes: string[];
}

/**
 * Configuration data from YAML file
 */
export interface DatasetYamlConfig {
  name: string;
  displayName: string;
  emoji?: string;
  handler: string;

  // Handler-specific configuration
  url?: string;
  dataset?: string;  // For HuggingFace/ArXiv datasets (arxiv ID or HF dataset name)
  count?: number;

  // Processing options
  shouldChunk?: boolean;
  chunkSize?: number;
  useSmartChunking?: boolean;
  entityTypes?: string[];
  createTableOfContents?: boolean;
  tocTitle?: string;
  detectCitations?: boolean;

  // Text extraction (for Gutenberg handler)
  extractionConfig?: {
    startPattern: string;  // Regex pattern as string
    endMarker: string;
  };

  // Paths
  cacheFile?: string;

  // Multi-document support
  isMultiDocument?: boolean;

  // json-multi-doc handler config
  jsonFile?: string;
  phases?: PhaseConfig[];
  tocPhases?: TocPhaseConfig[];
  masterToc?: MasterTocConfig;

  // Annotate command config
  highlightPhases?: HighlightPhaseConfig[];
}

/**
 * Result from customLoad — handler manages its own upload workflow
 */
export interface CustomLoadResult {
  totalUploaded: number;
  totalFailed: number;
  phaseResults: Record<string, { uploaded: number; failed: number }>;
  phaseResourceIds: Record<string, ResourceUri[]>;
}

/**
 * Handler implementation interface
 */
export interface DatasetHandler {
  /**
   * Download content from external source and cache it
   */
  download: (config: DatasetYamlConfig) => Promise<void>;

  /**
   * Load and process cached content
   * Returns either text (single document) or documents array
   */
  load: (config: DatasetYamlConfig) => Promise<string | DocumentInfo[]>;

  /**
   * Optional: Handler manages its own upload workflow (multi-phase with cross-references).
   * When present, the load command delegates entirely to this method.
   */
  customLoad?: (
    config: DatasetYamlConfig,
    scenarioDir: string,
    client: SemiontApiClient,
    auth: AccessToken,
  ) => Promise<CustomLoadResult>;
}

/**
 * Handler registry
 */
export type HandlerRegistry = Record<string, DatasetHandler>;
