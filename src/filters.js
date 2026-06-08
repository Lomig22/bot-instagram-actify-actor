/**
 * Profile filtering logic for BTP lead qualification.
 *
 * Two responsibilities:
 *   - isBtpProfile(): does the bio mention a BTP trade / artisan signal?
 *   - hasNoWebsite(): is the profile free of any detectable website?
 */

/**
 * Lowercase a string and strip diacritics (accents).
 * Returns an empty string for null/undefined/empty input.
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
function normalize(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// BTP trade keywords + generic construction terms + artisan commercial signals.
// All matching is done on normalized (lowercased, accent-free) text, so the
// list below is kept as-is for readability — each entry is normalized at runtime.
const BTP_KEYWORDS = [
  // Direct trades
  'electricien', 'électricien', 'elec', 'carreleur', 'carrelage', 'faience', 'faïence',
  'plaquiste', 'plombier', 'peintre', 'maçon', 'macon', 'maconnerie', 'maçonnerie',
  'charpentier', 'charpente', 'couvreur', 'toiture', 'couverture', 'menuisier', 'menuiserie',
  'serrurier', 'serrurerie', 'chauffagiste', 'chauffage', 'climatisation', 'clim',
  'isolation', 'isolant', 'carrossier', 'façadier', 'facadier', 'etancheur', 'étancheur',
  'terrassier', 'terrassement', 'pisciniste', 'piscine', 'ferronnier', 'ferronnerie',
  'vitrerie', 'vitrier', 'parqueteur', 'parquet',
  // Generic BTP terms
  'artisan', 'btp', 'batiment', 'bâtiment', 'renovation', 'rénovation', 'travaux',
  'construction', 'habitat', 'logement', 'chantier', 'devis', 'rge', 'qualibat',
  'pro du bat',
  // Artisan commercial indicators
  'devis gratuit', 'devis sur mesure', 'contactez-nous', 'on se déplace',
  'intervention rapide', 'auto-entrepreneur', 'auto entrepreneur', 'micro-entreprise',
  'micro entreprise', 'entreprise individuelle', 'siren', 'siret',
];

// Pre-normalize keywords once at module load.
const NORMALIZED_BTP_KEYWORDS = BTP_KEYWORDS.map(normalize);

/**
 * Returns true if the profile bio contains at least one BTP trade / artisan keyword.
 *
 * @param {{ biography?: string|null }} profile
 * @returns {boolean}
 */
export function isBtpProfile(profile) {
  const bio = normalize(profile && profile.biography);
  if (!bio) return false;

  for (const keyword of NORMALIZED_BTP_KEYWORDS) {
    if (keyword && bio.includes(keyword)) return true; // short-circuit
  }
  return false;
}

// Link aggregator services — presence implies the artisan already has an online presence.
const LINK_AGGREGATORS = [
  'linktr.ee', 'linktree', 'bio.link', 'lnk.bio', 'taplink',
  'beacons.ai', 'msha.ke', 'hoo.be',
];

// Common TLDs followed by a slash, whitespace, or end-of-string.
const TLD_PATTERN = /\.(fr|com|net|io|co|eu)(\/|\s|$)/;

/**
 * Returns true if NO website is detectable for the profile (= still a qualified lead).
 * Returns false as soon as any website signal is found (= disqualified).
 *
 * @param {{ externalUrl?: string|null, biography?: string|null }} profile
 * @returns {boolean}
 */
export function hasNoWebsite(profile) {
  if (!profile) return true;

  // 1. Explicit external URL field on the profile.
  if (profile.externalUrl && String(profile.externalUrl).trim() !== '') {
    return false;
  }

  // 2. Scan the biography for website signals.
  const bio = normalize(profile.biography);
  if (bio) {
    if (bio.includes('http://') || bio.includes('https://') || bio.includes('www.')) {
      return false;
    }
    if (TLD_PATTERN.test(bio)) {
      return false;
    }
    for (const aggregator of LINK_AGGREGATORS) {
      if (bio.includes(aggregator)) return false;
    }
  }

  // 3. Nothing found → no website detected.
  return true;
}
