const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OLD_FUNCTION,
  NEW_FUNCTION,
  OLD_OBSERVER,
  NEW_OBSERVER,
  patchBody
} = require('../hotfix_novahair_popup_observer.cjs');

test('replaces the recursive hidden-attribute observer exactly once', () => {
  const source = `<script>${OLD_FUNCTION}${OLD_OBSERVER}</script>`;
  const result = patchBody(source);

  assert.equal(result.changed, true);
  assert.equal(result.body.includes(OLD_FUNCTION), false);
  assert.equal(result.body.includes(OLD_OBSERVER), false);
  assert.equal(result.body.includes(NEW_FUNCTION), true);
  assert.equal(result.body.includes(NEW_OBSERVER), true);
});

test('is idempotent after the hotfix is present', () => {
  const fixed = `<script>${NEW_FUNCTION}${NEW_OBSERVER}</script>`;
  const result = patchBody(fixed);

  assert.equal(result.changed, false);
  assert.equal(result.body, fixed);
});

test('refuses an unexpected page-body shape', () => {
  assert.throws(() => patchBody('<main>unrelated page</main>'), /Expected one popup function/);
});
