import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { brand, categoryThemes, contrastRatio, feedback, neutral, sally } from '../src/tokens.js';

const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8').toUpperCase();
const AA = 4.5;

describe('design tokens', () => {
  it('computes contrast like WCAG 2.x', () => {
    assert.equal(contrastRatio('#000000', '#FFFFFF').toFixed(1), '21.0');
    assert.equal(contrastRatio('#FFFFFF', '#FFFFFF'), 1);
  });

  it('keeps tokens.css in sync with tokens.ts', () => {
    const all = [
      ...Object.values(brand),
      ...Object.values(sally),
      ...Object.values(feedback),
      neutral.ink,
      neutral.inkMuted,
      neutral.line,
      ...Object.values(categoryThemes).flatMap((t) => [t.accent, t.tint, t.ink, t.highlight]),
    ];
    for (const hex of all)
      assert.ok(css.includes(hex.toUpperCase()), `${hex} missing from tokens.css`);
  });

  for (const [id, t] of Object.entries(categoryThemes)) {
    it(`theme "${id}": white on accent and ink on tint meet AA`, () => {
      assert.ok(
        contrastRatio(t.accent, '#FFFFFF') >= AA,
        `${id} accent ${contrastRatio(t.accent, '#FFFFFF').toFixed(2)}`,
      );
      assert.ok(
        contrastRatio(t.ink, t.tint) >= 7,
        `${id} ink/tint ${contrastRatio(t.ink, t.tint).toFixed(2)}`,
      );
    });
  }

  it('body and muted text meet AA on the ivory canvas and white surface', () => {
    for (const bg of [brand.ivory, neutral.surface]) {
      assert.ok(contrastRatio(neutral.ink, bg) >= 7);
      assert.ok(contrastRatio(neutral.inkMuted, bg) >= AA);
      assert.ok(contrastRatio(brand.emerald700, bg) >= AA);
    }
  });

  it('primary buttons (white on emerald) meet AA', () => {
    assert.ok(contrastRatio('#FFFFFF', brand.emerald) >= AA);
  });

  it('documents that emerald and muted blue are NOT for small text on ivory/white', () => {
    assert.ok(contrastRatio(brand.emerald, brand.ivory) < AA);
    assert.ok(contrastRatio(sally.mutedBlue, '#FFFFFF') < AA);
  });

  it('feedback text colours meet AA on their tints', () => {
    assert.ok(contrastRatio(feedback.warning, feedback.warningTint) >= AA);
    assert.ok(contrastRatio(feedback.danger, feedback.dangerTint) >= AA);
    assert.ok(contrastRatio(feedback.info, feedback.infoTint) >= AA);
  });
});
