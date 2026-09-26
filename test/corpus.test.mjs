// Every corpus screen must keep what its expected.json says the tool reports (see corpus.mjs).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';
import { COLOR_SLACK, MISMATCH_SLACK, ROOT, corpusScreens, measure } from './corpus.mjs';

describe('corpus', () => {
  for (const dir of corpusScreens().filter((screen) => existsSync(join(screen, 'expected.json')))) {
    test(relative(join(ROOT, 'corpus'), dir), () => {
      const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
      const now = measure(dir);
      assert.equal(now.diff.code, 0, `pixel-diff: ${now.diff.out}`);
      assert.equal(now.responsive.code, 0, `responsive-audit --fail: ${now.responsive.out}`);
      for (const [name, want] of Object.entries(expected.sections)) {
        const got = now.sections[name];
        assert.ok(got, `section ${name} is gone`);
        if (want.missing) {
          assert.ok(got.missing, `section ${name} was missing and is now found`);
          continue;
        }
        assert.deepEqual([got.dTop, got.dHeight], [want.dTop, want.dHeight], `section ${name}: Δ top / Δ height`);
        assert.ok(
          got.mismatch <= want.mismatch + MISMATCH_SLACK,
          `section ${name}: mismatch ${got.mismatch}% > ${want.mismatch}% + ${MISMATCH_SLACK}`,
        );
        assert.ok(got.color <= want.color + COLOR_SLACK, `section ${name}: colour ${got.color}% > ${want.color}% + ${COLOR_SLACK}`);
      }
      assert.deepEqual(now.spacingFlags, expected.spacingFlags, 'spacing flags');
    });
  }
});
