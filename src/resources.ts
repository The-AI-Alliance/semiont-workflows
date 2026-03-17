/**
 * Resource Management
 *
 * Reusable utilities for creating and managing resources.
 */

import type { SemiontApiClient } from '@semiont/api-client';
import type { AccessToken, ResourceId } from '@semiont/core';
import type { ChunkInfo } from './chunking';
import type { DocumentInfo } from './types';
import { printBatchProgress, printSuccess, printInfo, printWarning } from './display';

export type { DocumentInfo } from './types';

export interface UploadOptions {
  entityTypes?: string[];
}

export interface UploadResult<T> {
  ids: ResourceId[];
  uploaded: T[];
  failed: UploadFailure[];
}

export interface UploadFailure {
  title: string;
  error: string;
}

/**
 * Upload text chunks as resources
 */
export async function uploadChunks(
  chunks: ChunkInfo[],
  client: SemiontApiClient,
  auth: AccessToken,
  options: UploadOptions = {}
): Promise<UploadResult<ChunkInfo>> {
  const ids: ResourceId[] = [];
  const uploaded: ChunkInfo[] = [];
  const failed: UploadFailure[] = [];
  const { entityTypes = [] } = options;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    printBatchProgress(i + 1, chunks.length, `Uploading ${chunk.title}...`);

    try {
      const request = {
        name: chunk.title,
        file: Buffer.from(chunk.content),
        format: 'text/plain' as const,
        entityTypes,
      };

      const response = await client.createResource(request, { auth });
      const resourceId = response.resourceId as ResourceId;
      ids.push(resourceId);
      uploaded.push(chunk);
      printSuccess(resourceId, 7);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ title: chunk.title, error: message });
      printWarning(`Failed: ${message}`, 7);
    }
  }

  printUploadSummary(chunks.length, ids.length, failed);
  return { ids, uploaded, failed };
}

function printUploadSummary(total: number, succeeded: number, failed: UploadFailure[]): void {
  if (failed.length === 0) {
    printSuccess(`All ${total} items uploaded`);
  } else {
    printWarning(`${succeeded} of ${total} uploaded, ${failed.length} failed:`);
    for (const f of failed) {
      printWarning(`  ${f.title}: ${f.error}`, 5);
    }
  }
}

export interface TableOfContentsReference {
  text: string;
  start: number;
  end: number;
  documentId: ResourceId;
  annotationId?: string;
}

export interface TableOfContentsOptions {
  title: string;
  entityTypes?: string[];
}

/**
 * Create a Table of Contents document with references to chunks
 */
export async function createTableOfContents(
  chunks: ChunkInfo[],
  client: SemiontApiClient,
  auth: AccessToken,
  options: TableOfContentsOptions
): Promise<{ tocId: ResourceId; references: TableOfContentsReference[] }> {
  const { title, entityTypes = [] } = options;

  // Build markdown content with timestamp to ensure unique document ID
  const timestamp = new Date().toISOString();
  let content = `# ${title}\n\n`;
  content += `_Generated: ${timestamp}_\n\n`;
  content += '## Parts\n\n';
  const references: TableOfContentsReference[] = [];

  chunks.forEach((chunk, index) => {
    const partText = `Part ${chunk.partNumber}`;
    const listItem = `${index + 1}. ${partText}\n`;
    const start = content.length + `${index + 1}. `.length;
    const end = start + partText.length;

    references.push({
      text: partText,
      start,
      end,
      documentId: '' as ResourceId, // Will be filled by caller
    });

    content += listItem;
  });

  printInfo(`Creating ToC document with ${chunks.length} entries (${timestamp})...`);

  const request = {
    name: title,
    file: Buffer.from(content),
    format: 'text/markdown' as const,
    entityTypes: [...entityTypes, 'table-of-contents'],
  };

  const response = await client.createResource(request, { auth });
  const tocId = response.resourceId as ResourceId;
  printSuccess(`Created ToC: ${tocId}`);

  return { tocId, references };
}

/**
 * Upload multiple documents as separate resources
 * Similar to uploadChunks but for multi-document datasets
 */
export async function uploadDocuments(
  documents: DocumentInfo[],
  client: SemiontApiClient,
  auth: AccessToken,
  options: UploadOptions = {}
): Promise<UploadResult<DocumentInfo>> {
  const ids: ResourceId[] = [];
  const uploaded: DocumentInfo[] = [];
  const failed: UploadFailure[] = [];
  const { entityTypes = [] } = options;

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    printBatchProgress(i + 1, documents.length, `Uploading ${doc.title}...`);

    try {
      // Handle both string and Buffer content
      const fileBuffer = Buffer.isBuffer(doc.content) ? doc.content : Buffer.from(doc.content);

      // Use format from document if provided, otherwise default to text/plain
      const format = doc.format || 'text/plain';

      const request = {
        name: doc.title,
        file: fileBuffer,
        format,
        entityTypes,
        ...(doc.language ? { language: doc.language.toLowerCase() } : {}),
      };

      const response = await client.createResource(request, { auth });
      const resourceId = response.resourceId as ResourceId;
      ids.push(resourceId);
      uploaded.push(doc);
      printSuccess(resourceId, 7);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ title: doc.title, error: message });
      printWarning(`Failed: ${message}`, 7);
    }
  }

  printUploadSummary(documents.length, ids.length, failed);
  return { ids, uploaded, failed };
}

/**
 * Create a Table of Contents with references to multiple documents
 * Similar to createTableOfContents but uses document titles instead of part numbers
 */
export async function createDocumentTableOfContents(
  documents: DocumentInfo[],
  client: SemiontApiClient,
  auth: AccessToken,
  options: TableOfContentsOptions
): Promise<{ tocId: ResourceId; references: TableOfContentsReference[] }> {
  const { title, entityTypes = [] } = options;

  // Build markdown content with timestamp to ensure unique document ID
  const timestamp = new Date().toISOString();
  let content = `# ${title}\n\n`;
  content += `_Generated: ${timestamp}_\n\n`;
  content += '## Documents\n\n';
  const references: TableOfContentsReference[] = [];

  documents.forEach((doc, index) => {
    const docText = doc.title;
    const listItem = `${index + 1}. ${docText}\n`;
    const start = content.length + `${index + 1}. `.length;
    const end = start + docText.length;

    references.push({
      text: docText,
      start,
      end,
      documentId: '' as ResourceId, // Will be filled by caller
    });

    content += listItem;
  });

  printInfo(`Creating ToC document with ${documents.length} entries (${timestamp})...`);

  const request = {
    name: title,
    file: Buffer.from(content),
    format: 'text/markdown' as const,
    entityTypes: [...entityTypes, 'table-of-contents'],
  };

  const response = await client.createResource(request, { auth });
  const tocId = response.resourceId as ResourceId;
  printSuccess(`Created ToC: ${tocId}`);

  return { tocId, references };
}
