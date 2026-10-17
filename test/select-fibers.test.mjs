import test from "node:test";
import assert from "node:assert/strict";
import { selectPtgaeFibers } from "../src/select-fibers.mjs";

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
  accessibility: { language: "en-US", version: "0.1.0", rules: { headings: ["Use concrete headings."] } },
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
