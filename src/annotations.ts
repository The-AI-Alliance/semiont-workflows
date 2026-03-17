/**
 * Annotation Management
 *
 * Reusable utilities for creating and linking annotations.
 */

import type { SemiontApiClient } from '@semiont/api-client';
import type { AccessToken, ResourceId, AnnotationId } from '@semiont/core';
import { printBatchProgress, printSuccess, printWarning, printAnnotationCreated } from './display';
import type { TableOfContentsReference } from './resources';

export interface CreateStubReferencesOptions {
  // Future options can be added here
}

/**
 * Create stub annotations (references without targets yet)
 */
export async function createStubReferences(
  tocId: ResourceId,
  references: TableOfContentsReference[],
  chunkIds: ResourceId[],
  client: SemiontApiClient,
  auth: AccessToken,
  options: CreateStubReferencesOptions = {}
): Promise<TableOfContentsReference[]> {

  for (let i = 0; i < references.length; i++) {
    const ref = references[i];
    ref.documentId = chunkIds[i];

    printBatchProgress(i + 1, references.length, `Creating annotation for "${ref.text}"...`);

    const response = await client.createAnnotation(tocId, {
      motivation: 'linking',
      target: {
        source: tocId,
        selector: [
          {
            type: 'TextPositionSelector',
            start: ref.start,
            end: ref.end,
          },
          {
            type: 'TextQuoteSelector',
            exact: ref.text,
          },
        ],
      },
      body: [{
        type: 'TextualBody',
        value: 'part-reference',
        purpose: 'tagging',
      }],
    }, { auth });

    // Store the FULL annotation ID (includes URL prefix)
    ref.annotationId = response.annotationId;

    printAnnotationCreated(response.annotationId);
  }

  printSuccess(`Created ${references.length} stub annotations`);
  return references;
}

export interface LinkReferencesOptions {
  showProgress?: boolean;
}

/**
 * Link stub references to target documents
 */
export async function linkReferences(
  tocId: ResourceId,
  references: TableOfContentsReference[],
  client: SemiontApiClient,
  auth: AccessToken,
  options: LinkReferencesOptions = {}
): Promise<number> {
  const { showProgress = true } = options;
  let successCount = 0;

  for (let i = 0; i < references.length; i++) {
    const ref = references[i];
    const shortDocId = ref.documentId.substring(0, 20);

    if (showProgress) {
      printBatchProgress(i + 1, references.length, `Linking "${ref.text}" → ${shortDocId}...`);
    }

    try {
      await client.updateAnnotationBody(tocId, ref.annotationId! as AnnotationId, {
        resourceId: tocId,
        operations: [{
          op: 'add',
          item: {
            type: 'SpecificResource',
            source: ref.documentId,
            purpose: 'linking',
          },
        }],
      }, { auth });

      if (showProgress) {
        printSuccess('Linked', 7);
      }
      successCount++;
    } catch (error) {
      if (showProgress) {
        printWarning(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 7);
      }
    }
  }

  printSuccess(`Linked ${successCount}/${references.length} references`);
  return successCount;
}
