import { defineConsolidated } from '../tests/support/consolidated.js';
import { testStore } from './support/db.js';

defineConsolidated('MariaDB test database', testStore);
