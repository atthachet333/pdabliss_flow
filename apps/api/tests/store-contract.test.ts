import { MemoryStore } from '../src/store/memory.js';
import { defineStoreContract } from './support/store-contract.js';

defineStoreContract('MemoryStore', async () => new MemoryStore());
