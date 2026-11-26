import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMariaDbJsonColumn, isMariaDbJsonDiff } from './db-drift.mjs';

const replayDiff = [
  '-- AlterTable\r\nALTER TABLE `appointment_events` MODIFY `fields` JSON NULL;',
  '-- AlterTable\r\nALTER TABLE `audit_logs` MODIFY `metadata` JSON NULL;',
  '-- AlterTable\r\nALTER TABLE `user_preferences` MODIFY `defaultReminders` JSON NULL;',
].join('\r\n\r\n');
const create = `CREATE TABLE \`appointment_events\` (\n  \`fields\` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(\`fields\`)),\n  \`id\` char(36) NOT NULL\n) ENGINE=InnoDB`;

test('MariaDB migration replay recognizes the complete known alias diff and exact DDL', () => {
  assert.ok(isMariaDbJsonDiff(replayDiff));
  assert.ok(isMariaDbJsonColumn(create, 'fields'));
});

test('MariaDB migration replay rejects type drift, unrelated changes and incomplete matches', () => {
  assert.ok(!isMariaDbJsonDiff(replayDiff.replace('JSON NULL', 'JSON NOT NULL')));
  assert.ok(!isMariaDbJsonDiff(replayDiff.replace('JSON NULL', 'LONGTEXT NULL')));
  assert.ok(!isMariaDbJsonDiff(replayDiff.replace('`fields`', '`unknown`')));
  assert.ok(!isMariaDbJsonDiff(replayDiff.split('\r\n\r\n').slice(1).join('\r\n\r\n')));
  assert.ok(!isMariaDbJsonDiff(`${replayDiff}\nALTER TABLE \`users\` ADD COLUMN \`extra\` TEXT;`));
});

test('MariaDB metadata check rejects a missing or widened constraint, collation, type or nullability drift', () => {
  for (const [from, to] of [
    [' CHECK (json_valid(`fields`))', ''],
    ['json_valid(`fields`)', 'json_valid(`fields`) or 1'],
    ['utf8mb4_bin', 'utf8mb4_unicode_ci'],
    ['DEFAULT NULL', 'NOT NULL'],
    ['longtext', 'mediumtext'],
  ]) {
    assert.ok(!isMariaDbJsonColumn(create.replace(from, to), 'fields'));
  }
});
