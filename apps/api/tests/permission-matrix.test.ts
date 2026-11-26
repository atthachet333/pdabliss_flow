import { MemoryStore } from '../src/store/memory.js';
import { definePermissionMatrix } from './support/permission-matrix.js';

definePermissionMatrix('MemoryStore', async () => new MemoryStore());
