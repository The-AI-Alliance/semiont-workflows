/**
 * Dataset Handler Registry
 *
 * Maps handler names to their implementations
 */

import type { HandlerRegistry } from './types.js';
import { cornellLiiHandler } from './cornell-lii.js';
import { huggingfaceHandler } from './huggingface.js';
import { arxivHandler } from './arxiv.js';
import { gutenbergHandler } from './gutenberg.js';
import { localFileHandler } from './local-file.js';
import { localMultiDocHandler } from './local-multi-doc.js';
import { jsonMultiDocHandler } from './json-multi-doc.js';
import { webMultiSourceHandler } from './web-multi-source.js';

export const HANDLERS: HandlerRegistry = {
  'cornell-lii': cornellLiiHandler,
  'huggingface': huggingfaceHandler,
  'arxiv': arxivHandler,
  'gutenberg': gutenbergHandler,
  'local-file': localFileHandler,
  'local-multi-doc': localMultiDocHandler,
  'json-multi-doc': jsonMultiDocHandler,
  'web-multi-source': webMultiSourceHandler,
};

export type { DatasetHandler, DatasetYamlConfig, HandlerRegistry } from './types.js';
