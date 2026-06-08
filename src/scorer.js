/**
 * Lead scoring system.
 *
 * scoreProfile() rates a normalized profile from 0 to 15 based on how closely
 * it matches an ideal "artisan BTP without a website" prospect.
 */

/**
 * Lowercase + strip accents. Returns '' for empty input.
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

// French mobile phone numbers (06/07) with common separators.
const PHONE_PATTERN = /\b(0[67][\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2})\b/;

// Call-to-action words frequently used by artisans in their bio.
const CTA_WORDS = ['devis', 'contact', 'appel', 'rdv', 'gratuit'];

// French department numbers (01-95, 2A/2B) used as a location signal.
const DEPARTMENT_PATTERN = /\b(0[1-9]|[1-8][0-9]|9[0-5]|2[ab])\b/;

// A few common French city names as an additional location signal.
const COMMON_CITIES = [
  'paris', 'marseille', 'lyon', 'toulouse', 'nice', 'nantes', 'montpellier',
  'strasbourg', 'bordeaux', 'lille', 'rennes', 'reims', 'toulon', 'grenoble',
  'dijon', 'angers', 'nimes', 'nimes', 'clermont', 'tours', 'limoges', 'amiens',
  'metz', 'besancon', 'orleans', 'rouen', 'mulhouse', 'caen', 'nancy', 'avignon',
];

/**
 * Score a profile from 0 to 15.
 *
 * @param {object} profile - Normalized profile object.
 * @param {string} [profile.businessCategoryName]
 * @param {number} [profile.followersCount]
 * @param {number} [profile.followingCount]
 * @param {number} [profile.postsCount]
 * @param {string} [profile.biography]
 * @param {boolean} [profile.isPrivate]
 * @returns {{ score: number, breakdown: string[] }}
 */
export function scoreProfile(profile) {
  const breakdown = [];
  let score = 0;

  const followersCount = Number(profile.followersCount) || 0;
  const followingCount = Number(profile.followingCount) || 0;
  const postsCount = Number(profile.postsCount) || 0;
  const bioRaw = profile.biography || '';
  const bio = normalize(bioRaw);

  // Professional Instagram account (+3)
  if (profile.businessCategoryName && String(profile.businessCategoryName).trim() !== '') {
    score += 3;
    breakdown.push('business_account(+3)');
  }

  // Follower range (+3 ideal / +1 acceptable)
  if (followersCount >= 200 && followersCount <= 5000) {
    score += 3;
    breakdown.push('followers_ideal(+3)');
  } else if (
    (followersCount >= 100 && followersCount < 200) ||
    (followersCount > 5000 && followersCount <= 15000)
  ) {
    score += 1;
    breakdown.push('followers_acceptable(+1)');
  }

  // Rich bio (+1)
  if (bioRaw.length > 40) {
    score += 1;
    breakdown.push('rich_bio(+1)');
  }

  // Enough posts (+1)
  if (postsCount >= 10) {
    score += 1;
    breakdown.push('enough_posts(+1)');
  }

  // Public account (+1)
  if (!profile.isPrivate) {
    score += 1;
    breakdown.push('public_account(+1)');
  }

  // High following/followers ratio (+1)
  if (followingCount > followersCount * 0.8) {
    score += 1;
    breakdown.push('high_following_ratio(+1)');
  }

  // Phone number in bio (+2)
  if (PHONE_PATTERN.test(bioRaw)) {
    score += 2;
    breakdown.push('phone_in_bio(+2)');
  }

  // Call-to-action words in bio (+1)
  if (CTA_WORDS.some((word) => bio.includes(word))) {
    score += 1;
    breakdown.push('cta_in_bio(+1)');
  }

  // City / department mention in bio (+1)
  if (DEPARTMENT_PATTERN.test(bioRaw) || COMMON_CITIES.some((city) => bio.includes(city))) {
    score += 1;
    breakdown.push('location_in_bio(+1)');
  }

  return { score, breakdown };
}
