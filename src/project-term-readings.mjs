/** PTGAE-specific interpretation of submitted term readings, downstream of English and
 * source-derived predications. No resolution is a source authentication, evidence
 * witness, semantic equivalence, or authority to rewrite the term. */
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const sourceFields = new Set(['surface', 'state', 'canonicalId', 'sourceRevision', 'replacementId', 'readings']);
const readingFields = new Set(['termId', 'sourceRevision', 'locale']);
const malformed = (index, reason) => new TypeError('PTGAE term reading ' + index + ': ' + reason);

/** Project supplied canonical, deprecated, ambiguous, or unresolved term reports
 * without conflating ambiguity with opposed evidence or upgrading source claims.
 * The caller must separately authenticate source revisions and term authorities. */
export function projectPtgaeTermReadings(terms, locale) {
  if (!Array.isArray(terms)) throw new TypeError('PTGAE term readings must be an array');
  if (!nonempty(locale)) throw new TypeError('PTGAE term readings require a locale');
  const [language] = Intl.getCanonicalLocales(locale);
  const projected = terms.map((term, index) => {
    if (!term || typeof term !== 'object' || Array.isArray(term)
        || Object.keys(term).some(key => !sourceFields.has(key))
        || !nonempty(term.surface)) {
      throw malformed(index, 'a source surface and admitted fields are required');
    }
    const extras = ['canonicalId', 'sourceRevision', 'replacementId', 'readings'];
    const absent = key => term[key] === undefined;
    switch (term.state) {
      case 'resolved':
        if (!nonempty(term.canonicalId) || !nonempty(term.sourceRevision)
            || !absent('replacementId') || !absent('readings')) {
          throw malformed(index, 'resolved terms require canonicalId and sourceRevision only');
        }
        break;
      case 'deprecated':
        if (!nonempty(term.canonicalId) || !nonempty(term.sourceRevision)
            || !nonempty(term.replacementId) || term.replacementId === term.canonicalId
            || !absent('readings')) {
          throw malformed(index, 'deprecated terms require a distinct replacement and source revision');
        }
        break;
      case 'ambiguous': {
        if (extras.slice(0, 3).some(key => !absent(key))
            || !Array.isArray(term.readings) || term.readings.length < 2) {
          throw malformed(index, 'ambiguity requires at least two distinct sourced alternatives');
        }
        const identifiers = new Set();
        for (const reading of term.readings) {
          if (!reading || typeof reading !== 'object' || Array.isArray(reading)
              || Object.keys(reading).some(key => !readingFields.has(key))
              || !nonempty(reading.termId) || !nonempty(reading.sourceRevision)) {
            throw malformed(index, 'each alternative requires a termId and sourceRevision');
          }
          if (reading.locale !== undefined) {
            let supplied;
            try { [supplied] = Intl.getCanonicalLocales(reading.locale); }
            catch { throw malformed(index, 'an alternative has an invalid BCP47 locale'); }
            if (supplied !== language) throw malformed(index, 'an alternative belongs to another locale');
          }
          const identity = JSON.stringify([reading.termId, reading.sourceRevision]);
          if (identifiers.has(identity)) throw malformed(index, 'an alternative was repeated');
          identifiers.add(identity);
        }
        break;
      }
      case 'unresolved':
        if (extras.some(key => !absent(key))) {
          throw malformed(index, 'unresolved terms must preserve their surface without invented references');
        }
        break;
      default:
        throw malformed(index, 'unknown term resolution state');
    }
    return Object.freeze({
      surface: term.surface, state: term.state,
      ...(term.canonicalId === undefined ? {} : { canonicalId: term.canonicalId }),
      ...(term.sourceRevision === undefined ? {} : { sourceRevision: term.sourceRevision }),
      ...(term.replacementId === undefined ? {} : { replacementId: term.replacementId }),
      ...(term.readings === undefined ? {} : { readings: Object.freeze(term.readings.map(r => Object.freeze({ ...r }))) }),
    });
  });
  return Object.freeze({
    kind: 'ptgae.term-reading-projection.v0.1', locale: language,
    readings: Object.freeze(projected), interpretationAuthority: 'caller-asserted',
    sourceIdentityVerified: false, evidenceForWorldClaim: false, executableEffects: Object.freeze([]),
  });
}
