/**
 * Generic JSON Multi-Phase Document Handler
 *
 * A config-driven handler that reads a JSON file and executes multiple phases
 * of resource creation. Each phase can select items, filter, group, render
 * Handlebars templates, and upload resources. Later phases can cross-reference
 * URIs from earlier phases. ToC phases create table-of-contents resources with
 * annotation links. A master ToC links to all sub-ToCs.
 *
 * All scenario-specific logic lives in config.yaml — this handler is generic.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Handlebars from 'handlebars';
import type { SemiontApiClient } from '@semiont/api-client';
import type { AccessToken, ResourceId, AnnotationId } from '@semiont/core';
import type { DocumentInfo } from '../types.js';
import type {
  DatasetHandler,
  DatasetYamlConfig,
  PhaseConfig,
  PhaseAnnotation,
  CustomLoadResult,
} from './types.js';
import {
  uploadDocuments,
  createDocumentTableOfContents,
} from '../resources.js';
import { createStubReferences, linkReferences } from '../annotations.js';
import {
  printSectionHeader,
  printInfo,
  printSuccess,
  printWarning,
  printBatchProgress,
  printAnnotationCreated,
} from '../display.js';

// ============================================================================
// Source Expression Evaluator
// ============================================================================

/**
 * Select items from JSON data using a simple expression language:
 * - "[]" — all top-level items
 * - "[].attachments[]" — flatten nested arrays
 * - "[?attachments[0]]" — filter: only items where attachments[0] exists
 */
function selectItems(data: Record<string, unknown>[], source: string): Record<string, unknown>[] {
  if (source === '[]') {
    return data;
  }

  // "[?field]" or "[?nested[0]]" — filter expression
  const filterMatch = source.match(/^\[\?(.+)\]$/);
  if (filterMatch) {
    const expr = filterMatch[1];
    return data.filter(item => resolveFieldPath(item, expr) != null);
  }

  // "[].field[]" — flatten nested array
  const flattenMatch = source.match(/^\[\]\.(.+)\[\]$/);
  if (flattenMatch) {
    const field = flattenMatch[1];
    const results: Record<string, unknown>[] = [];
    for (const item of data) {
      const nested = item[field];
      if (Array.isArray(nested)) {
        for (const child of nested) {
          if (typeof child === 'object' && child !== null) {
            results.push(child as Record<string, unknown>);
          }
        }
      }
    }
    return results;
  }

  throw new Error(`Unsupported source expression: ${source}`);
}

// ============================================================================
// Field Path Resolution
// ============================================================================

/**
 * Resolve a dotted/bracketed field path on an object.
 * Supports: "field", "nested.field", "array[0].field"
 */
function resolveFieldPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ============================================================================
// Filter Evaluation
// ============================================================================

/**
 * Evaluate a simple filter expression like "firstName && surname" or "organization".
 * Only supports field-existence checks joined by &&.
 */
function evaluateFilter(item: Record<string, unknown>, filter: string): boolean {
  const parts = filter.split('&&').map(p => p.trim());
  return parts.every(field => {
    const val = resolveFieldPath(item, field);
    return val != null && val !== '';
  });
}

// ============================================================================
// Grouping
// ============================================================================

interface GroupedItem extends Record<string, unknown> {
  _items: Record<string, unknown>[];
}

/**
 * Group items by specified fields. Returns one entry per unique combination.
 * Each entry has all fields from the first item, plus _items containing all items.
 */
function groupItems(items: Record<string, unknown>[], groupBy: string[]): GroupedItem[] {
  const groups = new Map<string, Record<string, unknown>[]>();

  for (const item of items) {
    const key = groupBy.map(field => String(resolveFieldPath(item, field) ?? '')).join('|||');
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  const results: GroupedItem[] = [];
  for (const groupedItems of groups.values()) {
    results.push({
      ...groupedItems[0],
      _items: groupedItems,
    });
  }
  return results;
}

// ============================================================================
// Template Rendering
// ============================================================================

/**
 * Compile and render a Handlebars template with the given context.
 */
function renderTemplate(template: string, context: Record<string, unknown>): string {
  const compiled = Handlebars.compile(template, { noEscape: true });
  return compiled(context);
}

// ============================================================================
// Phase Executor
// ============================================================================

type UriMap = Map<string, ResourceId>;

/**
 * Tracks a document alongside the item context and rendered content,
 * so we can create annotations after upload.
 */
interface DocumentWithContext {
  document: DocumentInfo;
  item: GroupedItem;
  renderedContent: string | null; // null for binary uploads
}

/**
 * After uploading a resource, create Semiont reference annotations for
 * cross-references declared in the phase's `annotations` config.
 *
 * Each annotation declaration specifies:
 * - anchor: Handlebars template for the text to find in the rendered content
 * - ref: name of the resolved ref whose URI is the annotation target
 * - multi: if true, creates one annotation per sub-item
 */
async function createPhaseAnnotations(
  annotations: PhaseAnnotation[],
  resourceId: ResourceId,
  item: GroupedItem,
  renderedContent: string,
  client: SemiontApiClient,
  auth: AccessToken,
): Promise<number> {
  let created = 0;

  for (const ann of annotations) {
    if (ann.multi) {
      // One annotation per sub-item
      for (const subItem of item._items) {
        const targetUri = (subItem as Record<string, unknown>)[ann.ref] as ResourceId | undefined;
        if (!targetUri) continue;

        const anchorText = renderTemplate(ann.anchor, subItem as Record<string, unknown>);
        const pos = findTextPosition(renderedContent, anchorText);
        if (!pos) continue; // anchor empty or not found — skip silently

        await createAndLinkAnnotation(resourceId, anchorText, pos.start, pos.end, targetUri, client, auth);
        created++;
      }
    } else {
      // Single annotation
      const targetUri = (item as Record<string, unknown>)[ann.ref] as ResourceId | undefined;
      if (!targetUri) continue;

      const anchorText = renderTemplate(ann.anchor, item);
      const pos = findTextPosition(renderedContent, anchorText);
      if (!pos) continue; // anchor empty or not found — skip silently

      await createAndLinkAnnotation(resourceId, anchorText, pos.start, pos.end, targetUri, client, auth);
      created++;
    }
  }

  return created;
}

/**
 * Find the first occurrence of text in content, returning start/end positions.
 * Returns null for empty/whitespace-only text or if text is not found.
 */
function findTextPosition(content: string, text: string): { start: number; end: number } | null {
  if (!text || !text.trim()) return null;
  const index = content.indexOf(text);
  if (index === -1) return null;
  return { start: index, end: index + text.length };
}

/**
 * Create a reference annotation on a resource and link it to a target resource.
 * Two-step: create stub annotation with text selectors, then add SpecificResource body.
 */
async function createAndLinkAnnotation(
  sourceId: ResourceId,
  anchorText: string,
  start: number,
  end: number,
  targetId: ResourceId,
  client: SemiontApiClient,
  auth: AccessToken,
): Promise<void> {
  // Step 1: Create stub annotation
  const response = await client.createAnnotation(sourceId, {
    motivation: 'linking',
    target: {
      source: sourceId,
      selector: [
        { type: 'TextPositionSelector', start, end },
        { type: 'TextQuoteSelector', exact: anchorText },
      ],
    },
    body: [{
      type: 'TextualBody',
      value: 'cross-reference',
      purpose: 'tagging',
    }],
  }, { auth });

  const annId = response.annotationId as AnnotationId;
  printAnnotationCreated(annId);

  // Step 2: Link to target resource
  await client.updateAnnotationBody(sourceId, annId, {
    resourceId: sourceId,
    operations: [{
      op: 'add',
      item: {
        type: 'SpecificResource',
        source: targetId,
        purpose: 'linking',
      },
    }],
  }, { auth });
}

/**
 * Execute a single upload phase: select items, filter, group, render, upload.
 * After upload, creates reference annotations for cross-references.
 * Returns a URI map keyed by a match field for cross-referencing.
 */
async function executePhase(
  phase: PhaseConfig,
  jsonData: Record<string, unknown>[],
  scenarioDir: string,
  baseEntityTypes: string[],
  uriMaps: Record<string, UriMap>,
  client: SemiontApiClient,
  auth: AccessToken,
): Promise<{ uriMap: UriMap; ids: ResourceId[]; uploaded: number; failed: number }> {
  // 1. Select items
  let items = selectItems(jsonData, phase.source);

  // 2. Apply filter
  if (phase.filter) {
    items = items.filter(item => evaluateFilter(item, phase.filter!));
  }

  // 3. Group (or wrap each item)
  const grouped: GroupedItem[] = phase.groupBy
    ? groupItems(items, phase.groupBy)
    : items.map(item => ({ ...item, _items: [item] }));

  // 4. Build documents (tracking context for annotations)
  const docsWithContext: DocumentWithContext[] = [];
  for (const item of grouped) {
    // Inject cross-reference URIs into the template context
    if (phase.refs) {
      for (const [refName, refConfig] of Object.entries(phase.refs)) {
        const sourceMap = uriMaps[refConfig.phase];
        if (!sourceMap) {
          printWarning(`Phase "${phase.name}" refs "${refName}" references unknown phase "${refConfig.phase}"`);
          continue;
        }
        if (refConfig.multi) {
          // Inject URI onto each sub-item so annotations can use it per sub-item
          const uris: ResourceId[] = [];
          for (const subItem of item._items) {
            const key = String(resolveFieldPath(subItem, refConfig.matchOn) ?? '');
            const uri = sourceMap.get(key);
            if (uri) {
              uris.push(uri);
              (subItem as Record<string, unknown>)[refName] = uri;
            }
          }
          (item as Record<string, unknown>)[refName] = uris;
        } else {
          const key = String(resolveFieldPath(item, refConfig.matchOn) ?? '');
          (item as Record<string, unknown>)[refName] = sourceMap.get(key);
        }
      }
    }

    if (phase.binaryFile) {
      // Binary file upload
      const filePath = renderTemplate(phase.binaryFile.pathTemplate, item);
      const fullPath = resolve(scenarioDir, filePath);
      try {
        const content = readFileSync(fullPath);
        docsWithContext.push({
          document: {
            title: renderTemplate(phase.title, item),
            content,
            format: phase.binaryFile.format,
          },
          item,
          renderedContent: null,
        });
      } catch (error) {
        printWarning(`Cannot read file ${fullPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (phase.template) {
      // Markdown template
      const content = renderTemplate(phase.template, item);
      const title = renderTemplate(phase.title, item);
      const language = phase.language ? renderTemplate(phase.language, item) : undefined;
      docsWithContext.push({
        document: {
          title,
          content,
          format: phase.format || 'text/markdown',
          ...(language && language.trim() ? { language: language.toLowerCase() } : {}),
        },
        item,
        renderedContent: content,
      });
    }
  }

  // 5. Upload
  const documents = docsWithContext.map(d => d.document);
  const entityTypes = [...baseEntityTypes, ...phase.entityTypes];
  const result = await uploadDocuments(documents, client, auth, { entityTypes });

  // 6. Create reference annotations (if configured)
  if (phase.annotations && phase.annotations.length > 0) {
    let totalAnnotations = 0;
    for (let i = 0; i < docsWithContext.length && i < result.ids.length; i++) {
      const { item, renderedContent } = docsWithContext[i];
      if (!renderedContent) continue; // skip binary uploads

      printBatchProgress(i + 1, docsWithContext.length, `Annotating ${documents[i].title}...`);
      const count = await createPhaseAnnotations(
        phase.annotations, result.ids[i], item, renderedContent, client, auth,
      );
      totalAnnotations += count;
    }
    printSuccess(`Created ${totalAnnotations} reference annotations`);
  }

  // 7. Build URI map for cross-referencing by later phases.
  const uriMap: UriMap = new Map();

  if (phase.groupBy) {
    // For grouped phases, map each sub-item's "id" (or other identifier) to the group's URI
    for (let i = 0; i < grouped.length && i < result.ids.length; i++) {
      const uri = result.ids[i];
      for (const subItem of grouped[i]._items) {
        const id = subItem.id ?? subItem.documentId;
        if (id != null) {
          uriMap.set(String(id), uri);
        }
      }
      // Also store by the group's title for ToC lookups
      const title = renderTemplate(phase.title, grouped[i]);
      uriMap.set(`__title__${title}`, uri);
    }
  } else {
    for (let i = 0; i < items.length && i < result.ids.length; i++) {
      const item = items[i];
      const id = item.id ?? item.documentId;
      if (id != null) {
        uriMap.set(String(id), result.ids[i]);
      }
    }
  }

  return { uriMap, ids: result.ids, uploaded: result.uploaded.length, failed: result.failed.length };
}

// ============================================================================
// Handler Implementation
// ============================================================================

export const jsonMultiDocHandler: DatasetHandler = {
  async download(_config: DatasetYamlConfig): Promise<void> {
    printInfo('json-multi-doc handler: no download needed (data is local)');
  },

  async load(_config: DatasetYamlConfig): Promise<DocumentInfo[]> {
    // This handler uses customLoad instead
    throw new Error('json-multi-doc handler requires customLoad — it manages its own upload workflow');
  },

  async customLoad(
    config: DatasetYamlConfig,
    scenarioDir: string,
    client: SemiontApiClient,
    auth: AccessToken,
  ): Promise<CustomLoadResult> {
    if (!config.jsonFile) {
      throw new Error('json-multi-doc handler requires jsonFile in config');
    }
    if (!config.phases || config.phases.length === 0) {
      throw new Error('json-multi-doc handler requires at least one phase in config');
    }

    // Load JSON data
    const jsonPath = join(scenarioDir, config.jsonFile);
    printInfo(`Loading JSON data from ${jsonPath}...`);
    const jsonData: Record<string, unknown>[] = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    printSuccess(`Loaded ${jsonData.length} items`);

    const baseEntityTypes = config.entityTypes || [];
    const uriMaps: Record<string, UriMap> = {};
    const phaseResults: Record<string, { uploaded: number; failed: number }> = {};
    const phaseResourceIds: Record<string, ResourceId[]> = {};
    let totalUploaded = 0;
    let totalFailed = 0;
    let stepNumber = 1;

    // Execute upload phases
    for (const phase of config.phases) {
      printSectionHeader('📤', stepNumber++, `Upload: ${phase.displayName}`);
      const result = await executePhase(
        phase, jsonData, scenarioDir, baseEntityTypes, uriMaps, client, auth,
      );
      uriMaps[phase.name] = result.uriMap;
      phaseResourceIds[phase.name] = result.ids;
      phaseResults[phase.name] = { uploaded: result.uploaded, failed: result.failed };
      totalUploaded += result.uploaded;
      totalFailed += result.failed;
    }

    // Execute ToC phases
    const tocUriMap: UriMap = new Map();

    if (config.tocPhases) {
      for (const tocPhase of config.tocPhases) {
        printSectionHeader('📑', stepNumber++, `ToC: ${tocPhase.title}`);

        const phaseUriMap = uriMaps[tocPhase.phase];
        if (!phaseUriMap) {
          printWarning(`ToC phase "${tocPhase.name}" references unknown phase "${tocPhase.phase}"`);
          continue;
        }

        // Select items for this ToC (same source as the referenced phase)
        const referencedPhase = config.phases.find(p => p.name === tocPhase.phase);
        if (!referencedPhase) {
          printWarning(`ToC phase "${tocPhase.name}" references unknown phase "${tocPhase.phase}"`);
          continue;
        }

        let items = selectItems(jsonData, referencedPhase.source);
        if (referencedPhase.filter) {
          items = items.filter(item => evaluateFilter(item, referencedPhase.filter!));
        }

        const grouped = referencedPhase.groupBy
          ? groupItems(items, referencedPhase.groupBy)
          : items.map(item => ({ ...item, _items: [item] }));

        // Build ToC entry documents (one per item), matching them to URIs
        const tocDocs: DocumentInfo[] = [];
        const tocDocUris: ResourceId[] = [];

        for (const item of grouped) {
          const entryText = renderTemplate(tocPhase.entryTemplate, item);
          // Find the URI for this item
          let uri: ResourceId | undefined;
          if (referencedPhase.groupBy) {
            const title = renderTemplate(referencedPhase.title, item);
            uri = phaseUriMap.get(`__title__${title}`);
          } else {
            const id = (item as Record<string, unknown>).id ?? (item as Record<string, unknown>).documentId;
            if (id != null) uri = phaseUriMap.get(String(id));
          }

          if (uri) {
            tocDocs.push({ title: entryText, content: entryText, format: 'text/markdown' });
            tocDocUris.push(uri);
          }
        }

        // Create the ToC resource with annotation links
        const entityTypes = [...baseEntityTypes, ...tocPhase.entityTypes];
        const tocResult = await createDocumentTableOfContents(tocDocs, client, auth, {
          title: tocPhase.title,
          entityTypes,
        });

        // Create stub references and link them
        const refsWithIds = await createStubReferences(
          tocResult.tocId, tocResult.references, tocDocUris, client, auth,
        );
        await linkReferences(tocResult.tocId, refsWithIds, client, auth);

        tocUriMap.set(tocPhase.name, tocResult.tocId);
        phaseResults[tocPhase.name] = { uploaded: 1, failed: 0 };
        totalUploaded += 1;
      }
    }

    // Execute Master ToC
    if (config.masterToc) {
      printSectionHeader('📑', stepNumber++, `Master ToC: ${config.masterToc.title}`);

      const masterDocs: DocumentInfo[] = [];
      const masterDocUris: ResourceId[] = [];

      for (let i = 0; i < config.masterToc.entries.length; i++) {
        const entryText = config.masterToc.entries[i];
        masterDocs.push({ title: entryText, content: entryText, format: 'text/markdown' });

        // Match entry to its sub-ToC by position in tocPhases
        if (config.tocPhases && i < config.tocPhases.length) {
          const tocUri = tocUriMap.get(config.tocPhases[i].name);
          if (tocUri) {
            masterDocUris.push(tocUri);
          } else {
            masterDocUris.push('' as ResourceId); // placeholder
          }
        }
      }

      const entityTypes = [...baseEntityTypes, ...config.masterToc.entityTypes];
      const masterResult = await createDocumentTableOfContents(masterDocs, client, auth, {
        title: config.masterToc.title,
        entityTypes,
      });

      // Link master ToC entries to sub-ToCs
      const validRefs = masterResult.references.filter((_, i) => masterDocUris[i] && masterDocUris[i] !== '');
      const validUris = masterDocUris.filter(uri => uri && uri !== '');

      if (validRefs.length > 0) {
        const refsWithIds = await createStubReferences(
          masterResult.tocId, validRefs, validUris, client, auth,
        );
        await linkReferences(masterResult.tocId, refsWithIds, client, auth);
      }

      phaseResults['masterToc'] = { uploaded: 1, failed: 0 };
      totalUploaded += 1;
    }

    // Print summary
    printSectionHeader('✨', stepNumber, 'Summary');
    printSuccess(`Total uploaded: ${totalUploaded}, failed: ${totalFailed}`);
    for (const [name, result] of Object.entries(phaseResults)) {
      printInfo(`  ${name}: ${result.uploaded} uploaded, ${result.failed} failed`);
    }

    return { totalUploaded, totalFailed, phaseResults, phaseResourceIds };
  },
};
