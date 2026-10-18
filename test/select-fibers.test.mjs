import test from "node:test";
import assert from "node:assert/strict";
import { selectPtgaeFibers } from "../src/select-fibers.mjs";
import { canonicalJson } from "@red-cup-engineering/json-services-section";
import { createHash } from "node:crypto";

const resources = {
  bundleVersion: "0.1.0",
  claimStatus: {
    language: "en-US",
    version: "0.1.0",
    statuses: [
      { id: "observed", label: "Observed", rendering: "Observed: {claim}" },
      { id: "unknown", label: "Unknown", rendering: "Unknown: {claim}" },
    ],
  },
  registers: {
    language: "en-US",
    version: "0.1.0",
    registers: [
      { id: "technical", rules: ["Name the actual failure boundary."] },
      { id: "public-service", rules: ["Use ordinary words when they preserve meaning."] },
    ],
  },
  accessibility: { language: "en-US", version: "0.1.1", profileId: "default", rules: { headings: ["Use concrete headings."] } },
  sourcePreservation: { version: "0.1.0", classes: [{ id: "quotation", defaultAction: "preserve" }] },
};

const request = {
  bundleVersion: "0.1.0",
  audience: "engineers",
  contentClass: "incident-receipt",
  locale: "en-US",
  register: "technical",
  claimStatus: "Observed",
  accessibilityProfile: "default",
  exceptionIds: [],
};

test("selects the requested claim and register fibers", () => {
  const result = selectPtgaeFibers({
    request,
    resources,
    selectedAt: "2026-10-07T00:00:00.000Z",
  });

  assert.equal(result.fibers.claimStatus.id, "observed");
  assert.equal(result.fibers.register.id, "technical");
  assert.equal(result.fibers.lexicon, null);
  assert.equal(result.fibers.localization, null);
  assert.equal(result.receipt.fiberVersions.claimStatus, "0.1.0");
  assert.equal(result.receipt.fiberVersions.registers, "0.1.0");
  assert.match(result.receipt.requestHash, /^[0-9a-f]{64}$/u);
});

test("preserves unknown as an explicit status instead of zero capacity", () => {
  const result = selectPtgaeFibers({
    request: { ...request, claimStatus: "Unknown" },
    resources,
    selectedAt: "2026-10-07T00:00:00.000Z",
  });

  assert.equal(result.fibers.claimStatus.id, "unknown");
  assert.equal(result.fibers.claimStatus.label, "Unknown");
});

test("refuses a register the bundle does not define", () => {
  assert.throws(
    () => selectPtgaeFibers({
      request: { ...request, register: "vibes" },
      resources,
    }),
    /unknown PTGAE register/u,
  );
});

test("refuses missing required bundle fibers rather than inventing defaults", () => {
  const incomplete = { ...resources };
  delete incomplete.sourcePreservation;
  assert.throws(
    () => selectPtgaeFibers({ request, resources: incomplete }),
    /resources\.sourcePreservation is required/u,
  );
});


test("rejects non-empty exception requests without authority verification", () => {
  assert.throws(
    () => selectPtgaeFibers({
      request: { ...request, exceptionIds: ["assumed-approval"] },
      resources,
    }),
    /verified authority-scoped resolver/u,
  );
});

test("rejects invalid BCP 47 language tags while not asserting locale support", () => {
  assert.throws(
    () => selectPtgaeFibers({
      request: { ...request, locale: "en_US" },
      resources,
    }),
    /invalid PTGAE BCP 47/u,
  );
});

test("refuses an explicitly declared conflicting bundle version", () => {
  assert.throws(
    () => selectPtgaeFibers({
      request,
      resources: { ...resources, bundleVersion: "9.9.9" },
    }),
    /bundle version mismatch/u,
  );
});

test("content hashes distinguish different fibers under identical coordinates", () => {
  const options = { request, resources, selectedAt: "2026-10-07T00:00:00.000Z" };
  const before = selectPtgaeFibers(options);
  const changed = selectPtgaeFibers({
    ...options,
    resources: { ...resources, accessibility: { ...resources.accessibility, rule: "a changed rule" } },
  });
  assert.match(before.receipt.resourceHashes.accessibility, /^[0-9a-f]{64}$/u);
  assert.notEqual(before.receipt.resourceHashes.accessibility, changed.receipt.resourceHashes.accessibility);
  assert.equal(before.receipt.requestHash, changed.receipt.requestHash);
  assert.deepEqual(before.receipt.exceptionsApplied, []);
});

test("valid BCP 47 tags are not accepted as translations of the en-US source", () => {
  for (const locale of ["fr-FR", "en-GB", "es-419"]) {
    assert.throws(
      () => selectPtgaeFibers({ request: { ...request, locale }, resources }),
      /unsupported PTGAE locale/u,
    );
  }
  const canonicalCase = selectPtgaeFibers({ request: { ...request, locale: "en-us" }, resources });
  assert.equal(canonicalCase.fibers.register.id, "technical");
});

test("refuses source bundles without an admitted version or locale-qualified fibers", () => {
  const { bundleVersion, ...unversioned } = resources;
  assert.throws(
    () => selectPtgaeFibers({ request, resources: unversioned }),
    /resources.bundleVersion is required/u,
  );
  const different = { ...resources, accessibility: { ...resources.accessibility, language: "en-GB" } };
  assert.throws(
    () => selectPtgaeFibers({ request, resources: different }),
    /unsupported PTGAE locale/u,
  );
  const unspecified = { ...resources, claimStatus: { ...resources.claimStatus, language: undefined } };
  assert.throws(
    () => selectPtgaeFibers({ request, resources: unspecified }),
    /resources.claimStatus.language is required/u,
  );
});

test("refuses a translated or unspecified optional fiber mixed into en-US", () => {
  const mixed = { ...resources, localization: { language: "fr-FR", version: "0.1.0", strings: {} } };
  assert.throws(
    () => selectPtgaeFibers({ request, resources: mixed }),
    /unsupported PTGAE locale/u,
  );
  const missing = { ...resources, lexicon: { version: "0.1.0", words: [] } };
  assert.throws(
    () => selectPtgaeFibers({ request, resources: missing }),
    /resources.lexicon.language is required/u,
  );
  const sameLocale = { ...resources, lexicon: { language: "en-US", version: "0.1.0", words: [] } };
  const result = selectPtgaeFibers({ request, resources: sameLocale });
  assert.equal(result.fibers.lexicon.language, "en-US");
});

test("returns original syntax, surface and corpus fibers rather than discarding them", () => {
  const selectedResources = {
    ...resources,
    syntaxDirectness: { fiber:"syntax-directness", version:"0.1.0", language:"en-US", rules:["Name the actor."] },
    surfaceForm: { fiber:"surface-form", version:"0.1.0", language:"en-US", headings:["Use concrete headings."] },
    corpusCanonicality: { fiber:"corpus-canonicality", version:"0.1.0", language:"en-US", exclusions:["generatedDraft"] },
  };
  const result = selectPtgaeFibers({request, resources:selectedResources, selectedAt:"2026-10-17T20:00:00Z"});
  assert.equal(result.fibers.syntaxDirectness, selectedResources.syntaxDirectness);
  assert.equal(result.fibers.surfaceForm, selectedResources.surfaceForm);
  assert.equal(result.fibers.corpusCanonicality, selectedResources.corpusCanonicality);
  assert.equal(result.receipt.fiberVersions.syntaxDirectness,"0.1.0");
  assert.equal(result.receipt.fiberVersions.surfaceForm,"0.1.0");
  assert.equal(result.receipt.fiberVersions.corpusCanonicality,"0.1.0");
  assert.match(result.receipt.resourceHashes.corpusCanonicality,/^[0-9a-f]{64}$/u);
  assert.throws(
    () => selectPtgaeFibers({
      request,
      resources:{...selectedResources,surfaceForm:{...selectedResources.surfaceForm,language:"es-ES"}},
    }),
    /unsupported PTGAE locale/u,
  );
  assert.equal(selectPtgaeFibers({request,resources}).fibers.surfaceForm,null);
});


test("projects old English-branch PTGAE terms through the actual selected bundle, without truth or authority", () => {
  const original = selectPtgaeFibers({request,resources,selectedAt:"2026-10-17T00:00:00Z"});
  const withTerms = selectPtgaeFibers({
    request:{...request,termResolutions:[
      {surface:"Semioverse",state:"resolved",canonicalId:"ni:///sha-256;token",sourceRevision:"source@1"},
      {surface:"cell",state:"ambiguous",readings:[
        {termId:"science:cell",sourceRevision:"source@1",locale:"en-us"},
        {termId:"computer:cell",sourceRevision:"source@2",locale:"en-US"}]},
      {surface:"former-name",state:"deprecated",canonicalId:"old",replacementId:"new",sourceRevision:"source@3"},
      {surface:"unknown-term",state:"unresolved"},
    ]},
    resources,selectedAt:"2026-10-17T00:00:00Z",
  });
  assert.equal(withTerms.termReadings.kind,"ptgae.term-reading-projection.v0.1");
  assert.equal(withTerms.termReadings.readings.length,4);
  assert.equal(withTerms.termReadings.readings[1].state,"ambiguous");
  assert.equal(withTerms.termReadings.readings[1].readings.length,2);
  assert.equal(withTerms.termReadings.readings[3].surface,"unknown-term");
  assert.equal(withTerms.termReadings.sourceIdentityVerified,false);
  assert.equal(withTerms.termReadings.evidenceForWorldClaim,false);
  assert.deepEqual(withTerms.termReadings.executableEffects,[]);
  assert.notEqual(original.receipt.requestHash,withTerms.receipt.requestHash);
  assert.equal(original.termReadings,undefined);
});

test("refuses fabricated resolved terms, collapsed ambiguity, foreign-locale reading and implicit authority", () => {
  const select = termResolutions => selectPtgaeFibers({
    request:{...request,termResolutions},resources,selectedAt:"2026-10-17T00:00:00Z",
  });
  assert.throws(()=>select([{surface:"x",state:"resolved"}]),/canonicalId/);
  assert.throws(()=>select([{surface:"x",state:"unresolved",canonicalId:"invented"}]),/unresolved/);
  assert.throws(()=>select([{surface:"x",state:"deprecated",canonicalId:"a",
    replacementId:"a",sourceRevision:"r"}]),/distinct replacement/);
  assert.throws(()=>select([{surface:"x",state:"ambiguous",readings:[
    {termId:"same",sourceRevision:"1"},{termId:"same",sourceRevision:"1"}]}]),/repeated/);
  assert.throws(()=>select([{surface:"x",state:"ambiguous",readings:[
    {termId:"a",sourceRevision:"1",locale:"es-419"},
    {termId:"b",sourceRevision:"2",locale:"en-US"}]}]),/another locale/);
  assert.throws(()=>select([{surface:"x",state:"both-true-and-false"}]),/unknown term resolution state/);
  assert.throws(()=>select([{surface:"x",state:"resolved",canonicalId:"id",
    sourceRevision:"rev",authority:"publish"}]),/admitted fields/);
});


test("fiber hashing reuses Data RFC8785 JCS rather than a leaf stableJson implementation",()=>{
  const options={request,resources,selectedAt:"2026-10-17T20:00:00.000Z"};
  const original=selectPtgaeFibers(options);
  const same=selectPtgaeFibers({
    ...options,
    request:Object.fromEntries(Object.entries(request).reverse()),
    resources:{
      ...resources,
      accessibility:Object.fromEntries(Object.entries(resources.accessibility).reverse()),
    },
  });
  assert.equal(original.receipt.requestHash,same.receipt.requestHash);
  assert.equal(original.receipt.resourceHashes.accessibility,same.receipt.resourceHashes.accessibility);
  const expected=createHash("sha256").update(canonicalJson(request)).digest("hex");
  assert.equal(original.receipt.requestHash,expected);
  const resourceExpected=createHash("sha256").update(canonicalJson(resources.accessibility)).digest("hex");
  assert.equal(original.receipt.resourceHashes.accessibility,resourceExpected);
});

test("JCS refuses non-JSON data in a language selector before claiming stable identity",()=>{
  assert.throws(()=>selectPtgaeFibers({
    request:{...request,nonfinite:Infinity},resources,
  }),/invalid-json-value|finite/u);
  const hostile={...resources.accessibility};
  Object.defineProperty(hostile,"hiddenPolicy",{
    enumerable:true,get(){throw Error("getter should not execute");},
  });
  assert.throws(()=>selectPtgaeFibers({
    request,resources:{...resources,accessibility:hostile},
  }),/invalid-json-value|accessor/u);
  assert.throws(()=>selectPtgaeFibers({
    request,resources:{...resources,accessibility:{...resources.accessibility,invalid:"\uD800"}},
  }),/unicode-scalar|surrogate/u);
});


test("PTGAE editor and rewrite fibers cannot silently cross language editions",()=>{
  for(const [name,language] of [["lintRules","fr-FR"],["safeRewriteRules","es-419"]]){
    assert.throws(()=>selectPtgaeFibers({
      request,resources:{...resources,[name]:{language,version:"0.1.0",rules:[]}},
    }),/unsupported PTGAE locale/u);
    assert.throws(()=>selectPtgaeFibers({
      request,resources:{...resources,[name]:[]},
    }),/locale-qualified fiber object/u);
    const admitted=selectPtgaeFibers({
      request,resources:{...resources,[name]:{language:"en-US",version:"0.1.0",rules:[]}},
    });
    assert.equal(admitted.fibers[name].language,"en-US");
    assert.equal(admitted.receipt.fiberVersions[name],"0.1.0");
  }
});

test("contradictory language and locale declarations cannot disguise a source fiber",()=>{
  assert.throws(()=>selectPtgaeFibers({
    request,resources:{...resources,surfaceForm:{
      language:"en-US",locale:"fr-FR",version:"0.1.0",rules:[]}},
  }),/unsupported PTGAE locale/u);
  const matching=selectPtgaeFibers({
    request,resources:{...resources,surfaceForm:{
      language:"en-us",locale:"en-US",version:"0.1.0",rules:[]}},
  });
  assert.equal(matching.fibers.surfaceForm.version,"0.1.0");
});

test("accessibility profile must exist in its current source, not only the request",()=>{
  assert.throws(()=>selectPtgaeFibers({
    request:{...request,accessibilityProfile:"invented"},resources,
  }),/unknown PTGAE accessibility profile/u);
  assert.throws(()=>selectPtgaeFibers({
    request,resources:{...resources,accessibility:{language:"en-US",version:"0.1.0",rules:{}}},
  }),/resources.accessibility.profileId is required/u);
  const source=selectPtgaeFibers({request,resources});
  assert.equal(source.fibers.accessibility.profileId,"default");
  assert.equal(source.receipt.fiberVersions.accessibility,"0.1.1");
});
