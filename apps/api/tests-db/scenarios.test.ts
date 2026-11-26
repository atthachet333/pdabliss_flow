import { defineScenarios } from '../tests/support/scenarios.js';
import { testStore } from './support/db.js';

defineScenarios('MariaDB test database', testStore);
