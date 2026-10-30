import { createHash } from "node:crypto";
import { canonicalJson } from "@red-cup-engineering/json-services-section";
import { projectPtgaeTermReadings } from "./project-term-readings.mjs";

const REQUIRED_REQUEST_FIELDS = [
  "bundleVersion",
  "audience",
  "contentClass",
  "locale",
  "register",
  "claimStatus",
  "accessibilityProfile",
];
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const REQUIRED_FIBERS = ["claimStatus", "registers", "accessibility", "sourcePreservation"];
const OPTIONAL_FIBERS = [
  "lexicon", "terminology", "localization", "generationConstraints", "syntaxDirectness",
  "surfaceForm", "corpusCanonicality", "lintRules", "safeRewriteRules",
];
const FIBER_NAMES = [...REQUIRED_FIBERS, ...OPTIONAL_FIBERS];
const LOCALIZED_FIBERS = FIBER_NAMES.filter(name => name !== "sourcePreservation");

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function requestHash(request) {
  return createHash("sha256").update(canonicalJson(request)).digest("hex");
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

  // Syntax alone does not attest that the *loaded* language fibers support a locale.
  let locale;
  try {
    [locale] = Intl.getCanonicalLocales(request.locale);
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
  if (typeof resources.bundleVersion !== "string" || !resources.bundleVersion) {
    throw new TypeError("resources.bundleVersion is required to select a source-qualified PTGAE bundle");
  }
  if (!VERSION.test(request.bundleVersion) || !VERSION.test(resources.bundleVersion)) {
    throw new RangeError("invalid PTGAE bundle version");
  }
  if (resources.bundleVersion !== request.bundleVersion) {
    throw new RangeError("PTGAE bundle version mismatch");
  }

  for (const resource of REQUIRED_FIBERS) {
    if (!resources[resource]) throw new TypeError(`resources.${resource} is required`);
  }
  // All selected *linguistic* fibers, including editor diagnostics and
  // rewrite policies, must be actual locale-qualified resources. Bare rule
  // arrays cannot identify which grammar edition they constrain. These rules
  // are downstream PTGAE policy; they are not shared English grammar.
  for (const resource of LOCALIZED_FIBERS) {
    const fiber=resources[resource];
    if(fiber==null)continue;
    if(typeof fiber!=="object"||Array.isArray(fiber))
      throw new TypeError(`resources.${resource} must be a locale-qualified fiber object`);
    const labels=["language","locale"].filter(key=>Object.hasOwn(fiber,key));
    if(labels.length===0)
      throw new TypeError(`resources.${resource}.language is required`);
    for(const label of labels){
      const language=fiber[label];
      if(typeof language!=="string"||language.length===0)
        throw new TypeError(`resources.${resource}.${label} is required`);
      let sourceLocale;
      try {[sourceLocale]=Intl.getCanonicalLocales(language);}
      catch {throw new RangeError(`invalid language tag in resources.${resource}.${label}`);}
      if(sourceLocale!==locale)
        throw new RangeError(`unsupported PTGAE locale: ${request.locale} (resources.${resource}.${label} is ${language})`);
    }
  }

  // A selected source resource must carry its own independently versioned
  // edition. This does not claim all fibers share the bundle's version.
  for (const name of FIBER_NAMES) {
    const resource = resources[name];
    if (resource == null) continue;
    if (typeof resource !== "object" || Array.isArray(resource) || typeof resource.version !== "string" || !VERSION.test(resource.version)) {
      throw new TypeError(`resources.${name}.version must be a semantic version`);
    }
  }
  if (request.terminologyVersion != null) {
    if (typeof request.terminologyVersion !== "string" || !VERSION.test(request.terminologyVersion)) {
      throw new TypeError("request.terminologyVersion must be a semantic version");
    }
    if (resources.terminology?.version !== request.terminologyVersion) {
      throw new RangeError("requested PTGAE terminology version was not selected");
    }
  }

  // There is exactly one accessibility profile in the current source fiber.
  // The *resource* must name it: otherwise a random request string could
  // impersonate a selected profile without any corresponding rules.
  const profile=resources.accessibility.profileId;
  if(typeof profile!=="string"||profile.length===0)
    throw new TypeError("resources.accessibility.profileId is required");
  if(request.accessibilityProfile!==profile)
    throw new RangeError(`unknown PTGAE accessibility profile: ${request.accessibilityProfile}`);

  // Optional term readings are a downstream PTGAE *linguistic* projection, not
  // new English parsing or SignCell testimony. The original request hash
  // includes these source-qualified alternatives and preserves their order.
  const termReadings = request.termResolutions === undefined
    ? null : projectPtgaeTermReadings(request.termResolutions, locale);

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
    syntaxDirectness: resources.syntaxDirectness ?? null,
    surfaceForm: resources.surfaceForm ?? null,
    corpusCanonicality: resources.corpusCanonicality ?? null,
    lintRules: resources.lintRules ?? null,
    safeRewriteRules: resources.safeRewriteRules ?? null,
  };
  const missingFibers = OPTIONAL_FIBERS.filter(name => fibers[name] === null);
  fibers.missing = [...missingFibers];
  const fiberCoverage = missingFibers.length === 0 ? "complete" : "partial";

  const fiberVersions = Object.fromEntries(
    FIBER_NAMES.filter(name => resources[name] != null).map(name => [name, resources[name].version]),
  );

  // Hash the normalized JSON VALUE of each supplied resource so receipts distinguish
  // identical coordinates evaluated against different language resources. These hashes
  // do NOT attest the bytes, path, commit, authority or custody of the original JSON
  // files: the selector receives parsed objects, not authenticated source bytes.
  const resourceHashes = {};
  for (const [name, value] of Object.entries(resources)) {
    if (name === "bundleVersion" || value === undefined) continue;
    resourceHashes[name] = createHash("sha256").update(canonicalJson(value)).digest("hex");
  }

  // The selection identity depends on the actual resolved parsed content,
  // not the wall clock. Hashes do not authenticate a source blob or issuer.
  const requestDigest = requestHash(request);
  const selectionHash = createHash("sha256").update(canonicalJson({
    bundleVersion: request.bundleVersion, requestHash: requestDigest,
    resourceHashes, missingFibers, fiberCoverage,
  })).digest("hex");

  return {
    bundleVersion: request.bundleVersion,
    request: structuredClone(request),
    selectedAt,
    fibers,
    ...(termReadings === null ? {} : { termReadings }),
    receipt: {
      bundleVersion: request.bundleVersion,
      fiberVersions,
      requestHash: requestDigest,
      exceptionsApplied: [],
      resourceHashes,
      missingFibers: [...missingFibers],
      fiberCoverage,
      selectionHash,
    },
  };
}
