import { MemoryStore } from '../src/store/memory.js';
import { defineScenarios } from './support/scenarios.js';

defineScenarios('MemoryStore', async () => new MemoryStore());
