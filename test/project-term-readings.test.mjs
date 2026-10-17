import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPtgaeTermReadings as project } from '../src/project-term-readings.mjs';

test('branch-origin readings preserve candidates without inventing evidence or authority', () => {
  const readings = [
    { surface: 'Semioverse', state: 'resolved', canonicalId: 'ni:///sha-256;abc', sourceRevision: 'source@1' },
    { surface: 'old-name', state: 'deprecated', canonicalId: 'term:old', replacementId: 'term:new', sourceRevision: 'source@2' },
    { surface: 'cell', state: 'ambiguous', readings: [
      { termId: 'science:cell', sourceRevision: 'source@1', locale: 'en-us' },
      { termId: 'computer:cell', sourceRevision: 'source@2', locale: 'en-US' },
    ] },
    { surface: 'unfamiliar', state: 'unresolved' },
  ];
  const p = project(readings, 'en-US');
  assert.equal(p.readings.length, 4);
  assert.equal(p.readings[2].readings.length, 2);
  assert.equal(p.readings[3].surface, 'unfamiliar');
  assert.equal(p.sourceIdentityVerified, false);
  assert.equal(p.evidenceForWorldClaim, false);
  assert.deepEqual(p.executableEffects, []);
  assert.deepEqual(project(readings, 'en-US'), p);
});

test('a different admitted BCP47 locale preserves its own candidate reading scope', () => {
  const p = project([{surface:'matiz',state:'ambiguous',readings:[
    {termId:'gloss:a',sourceRevision:'1',locale:'es-419'},
    {termId:'gloss:b',sourceRevision:'2',locale:'es-419'}
  ]}], 'es-419');
  assert.equal(p.locale, 'es-419');
  assert.equal(p.readings[0].state, 'ambiguous');
});

test('refuses absent evidence fields, duplicate alternatives, foreign locale, and invented status', () => {
  assert.throws(() => project([{surface:'?',state:'resolved'}],'en-US'), /canonicalId/);
  assert.throws(() => project([{surface:'x',state:'unresolved',canonicalId:'fake'}],'en-US'), /unresolved/);
  assert.throws(() => project([{surface:'x',state:'deprecated',canonicalId:'c',sourceRevision:'s',replacementId:'c'}],'en-US'), /distinct replacement/);
  assert.throws(() => project([{surface:'x',state:'ambiguous',readings:[
    {termId:'same',sourceRevision:'1'}, {termId:'same',sourceRevision:'1'}]}],'en-US'), /repeated/);
  assert.throws(() => project([{surface:'x',state:'ambiguous',readings:[
    {termId:'a',sourceRevision:'1',locale:'es-419'}, {termId:'b',sourceRevision:'2'}]}],'en-US'), /another locale/);
  assert.throws(() => project([{surface:'x',state:'authoritative'}],'en-US'), /unknown term/);
  assert.throws(() => project('x','en-US'), /array/);
});
