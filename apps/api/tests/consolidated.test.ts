import { MemoryStore } from '../src/store/memory.js';
import { defineConsolidated } from './support/consolidated.js';

defineConsolidated('MemoryStore', async () => new MemoryStore());
