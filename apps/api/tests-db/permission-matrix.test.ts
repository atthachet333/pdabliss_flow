import { definePermissionMatrix } from '../tests/support/permission-matrix.js';
import { testStore } from './support/db.js';

definePermissionMatrix('MariaDB test database', testStore);
