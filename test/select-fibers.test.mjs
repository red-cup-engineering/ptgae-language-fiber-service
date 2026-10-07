import test from "node:test";
import assert from "node:assert/strict";
import { selectPtgaeFibers } from "../src/select-fibers.mjs";

const resources = {
  claimStatus: {
    version: "0.1.0",
    statuses: [
      { id: "observed", label: "Observed", rendering: "Observed: {claim}" },
      { id: "unknown", label: "Unknown", rendering: "Unknown: {claim}" },
    ],
  },
  registers: {
    version: "0.1.0",
    registers: [
      { id: "technical", rules: ["Name the actual failure boundary."] },
      { id: "public-service", rules: ["Use ordinary words when they preserve meaning."] },
    ],
  },
  accessibility: { version: "0.1.0", rules: { headings: ["Use concrete headings."] } },
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
