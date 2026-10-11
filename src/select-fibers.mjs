import { createHash } from "node:crypto";

const REQUIRED_REQUEST_FIELDS = [
  "bundleVersion",
  "audience",
  "contentClass",
  "locale",
  "register",
  "claimStatus",
  "accessibilityProfile",
];

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestHash(request) {
  return createHash("sha256").update(stableJson(request)).digest("hex");
}

function findRegister(registers, id) {
  const found = registers.registers?.find((item) => item.id === id);
  if (!found) throw new RangeError(`unknown PTGAE register: ${id}`);
  return found;
}

function findClaimStatus(claimStatus, requested) {
  const needle = requested.toLowerCase();
  const found = claimStatus.statuses?.find(
    (item) => item.id === needle || item.label?.toLowerCase() === needle,
  );
  if (!found) throw new RangeError(`unknown PTGAE claim status: ${requested}`);
  return found;
}

/**
 * Select the PTGAE fibers required by one language-engine request.
 *
 * The service performs selection only. It does not invent missing lexicon,
 * terminology, localization, lint, or rewrite resources.
 */
export function selectPtgaeFibers({ request, resources, selectedAt = new Date().toISOString() }) {
  assertObject(request, "request");
  assertObject(resources, "resources");

  for (const field of REQUIRED_REQUEST_FIELDS) {
    if (typeof request[field] !== "string" || request[field].trim() === "") {
      throw new TypeError(`request.${field} must be a non-empty string`);
    }
  }

  // A valid language tag does not establish a supported locale or readable content.
  try {
    Intl.getCanonicalLocales(request.locale);
  } catch {
    throw new RangeError(`invalid PTGAE BCP 47 language tag: ${request.locale}`);
  }

  if (request.exceptionIds !== undefined && !Array.isArray(request.exceptionIds)) {
    throw new TypeError("request.exceptionIds must be an array");
  }
  // The 0.1 selector has no authority/scope verifier. Never attest a requested
  // exception was applied merely because its identifier was supplied.
  if (request.exceptionIds?.length) {
    throw new RangeError("PTGAE exceptions require a verified authority-scoped resolver");
  }
  if (resources.bundleVersion !== undefined && resources.bundleVersion !== request.bundleVersion) {
    throw new RangeError("PTGAE bundle version mismatch");
  }

  const required = ["claimStatus", "registers", "accessibility", "sourcePreservation"];
  for (const resource of required) {
    if (!resources[resource]) throw new TypeError(`resources.${resource} is required`);
  }

  const claim = findClaimStatus(resources.claimStatus, request.claimStatus);
  const register = findRegister(resources.registers, request.register);

  const fibers = {
    claimStatus: claim,
    register,
    accessibility: resources.accessibility,
    sourcePreservation: resources.sourcePreservation,
    lexicon: resources.lexicon ?? null,
    terminology: resources.terminology ?? null,
    localization: resources.localization ?? null,
    generationConstraints: resources.generationConstraints ?? null,
    lintRules: resources.lintRules ?? null,
    safeRewriteRules: resources.safeRewriteRules ?? null,
  };

  const fiberVersions = {};
  for (const [name, fiber] of Object.entries({
    claimStatus: resources.claimStatus,
    registers: resources.registers,
    accessibility: resources.accessibility,
    sourcePreservation: resources.sourcePreservation,
    lexicon: resources.lexicon,
    terminology: resources.terminology,
    localization: resources.localization,
    generationConstraints: resources.generationConstraints,
  })) {
    if (fiber?.version) fiberVersions[name] = fiber.version;
  }

  // Hash resolved source bytes in addition to the request so receipts distinguish
  // identical coordinates evaluated against different language resources.
  const resourceHashes = {};
  for (const [name, value] of Object.entries(resources)) {
    if (name === "bundleVersion" || value === undefined) continue;
    resourceHashes[name] = createHash("sha256").update(stableJson(value)).digest("hex");
  }

  return {
    bundleVersion: request.bundleVersion,
    request: structuredClone(request),
    selectedAt,
    fibers,
    receipt: {
      bundleVersion: request.bundleVersion,
      fiberVersions,
      requestHash: requestHash(request),
      exceptionsApplied: [],
      resourceHashes,
    },
  };
}
