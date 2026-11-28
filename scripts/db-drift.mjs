export const EP02_JSON_COLUMNS = [
  ['appointment_events', 'fields'],
  ['audit_logs', 'metadata'],
  ['user_preferences', 'defaultReminders'],
  // EP02 consolidated (20261128090000_ep02_series_bills_colors): same nullable JSON contract.
  ['appointment_series', 'template'],
];

/** Prisma 7.10.1 loses the JSON alias during migration replay. Match the entire diff. */
export function isMariaDbJsonDiff(sql) {
  const expected = EP02_JSON_COLUMNS.map(
    ([table, column]) => `ALTER TABLE \`${table}\` MODIFY \`${column}\` JSON NULL;`,
  ).sort();
  const actual = sql
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== '-- AlterTable')
    .sort();
  return actual.length === expected.length && actual.every((line, i) => line === expected[i]);
}

export function isMariaDbJsonColumn(createTable, column) {
  const definition = `\`${column}\` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(\`${column}\`))`;
  return createTable.split('\n').some((line) => line.trim().replace(/,$/, '') === definition);
}
