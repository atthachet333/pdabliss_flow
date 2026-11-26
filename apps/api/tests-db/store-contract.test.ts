import { defineStoreContract } from '../tests/support/store-contract.js';
import { testStore } from './support/db.js';

defineStoreContract('MariaDB test database', testStore);
