const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BASIC_GALLERY_NEW,
  BASIC_GALLERY_OLD,
  ENHANCED_GALLERY_NEW,
  ENHANCED_GALLERY_OLD,
  FONT_IMPORT,
  IMAGE_TARGETS,
  getModalImageSrc,
  patchBody
} = require('../optimize_novahair_live_images.cjs');

function imageTag(target) {
  const attributes = [
    target.id ? `id="${target.id}"` : '',
    target.classToken ? `class="${target.classToken}"` : '',
    `src="${target.url}"`
  ].filter(Boolean).join(' ');
  return `<img ${attributes}>`;
}

function fixture() {
  return [
    FONT_IMPORT,
    ...IMAGE_TARGETS.flatMap((target) => Array.from({ length: target.expectedMatches || 1 }, () => imageTag(target))),
    '<img id="ugcModalImg" src="https://example.test/review.png" alt="Review">',
    BASIC_GALLERY_OLD,
    ENHANCED_GALLERY_OLD
  ].join('\n');
}

test('patchBody sizes each target, preserves full gallery sources, and defers the modal image', () => {
  const patched = patchBody(fixture());

  assert.equal((patched.match(/data-full-src=/g) || []).length, 6);
  assert.match(patched, /width=40/);
  assert.match(patched, /width=120/);
  assert.match(patched, /width=200/);
  assert.match(patched, /width=900/);
  assert.ok(patched.includes(BASIC_GALLERY_NEW));
  assert.ok(patched.includes(ENHANCED_GALLERY_NEW));
  assert.equal(getModalImageSrc(patched), null);
  assert.ok(!patched.includes(FONT_IMPORT));
  assert.equal(patchBody(patched), patched);
});

test('patchBody refuses a partial or unexpected page body', () => {
  assert.throws(() => patchBody(FONT_IMPORT), /expected 1 matching image tag/);
});
