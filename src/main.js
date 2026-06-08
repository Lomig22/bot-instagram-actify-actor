/**
 * Instagram BTP Lead Scraper — Apify Actor entry point.
 *
 * Pipeline per hashtag:
 *   1. Call apify/instagram-scraper for the hashtag.
 *   2. Normalize each scraped profile.
 *   3. Filter: must be a BTP profile AND have no detectable website.
 *   4. Deduplicate by username.
 *   5. Score and persist qualified leads (Apify dataset + optional Supabase).
 */

import { Actor } from 'apify';
import { isBtpProfile, hasNoWebsite } from './filters.js';
import { scoreProfile } from './scorer.js';
import { pushLeadToSupabase } from './supabase.js';

const INSTAGRAM_SCRAPER_ACTOR = 'apify/instagram-scraper';

/**
 * Sleep for a random number of milliseconds within [minMs, maxMs].
 */
function randomSleep(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Pick the first non-empty value among the provided candidates.
 */
function firstOf(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * Normalize a raw scraped item into a uniform profile object.
 * The instagram-scraper output shape varies by version, so we look the
 * relevant fields up in several places.
 */
function normalizeProfile(item) {
  const owner = item.owner || {};

  return {
    username: firstOf(item.ownerUsername, owner.username, item.username),
    fullName: firstOf(item.ownerFullName, owner.full_name, owner.fullName, item.fullName),
    biography: firstOf(item.biography, owner.biography, ''),
    followersCount: Number(
      firstOf(item.followersCount, owner.followersCount, owner.edge_followed_by?.count, 0),
    ) || 0,
    followingCount: Number(
      firstOf(item.followingCount, owner.followingCount, owner.edge_follow?.count, 0),
    ) || 0,
    postsCount: Number(
      firstOf(item.postsCount, owner.postsCount, owner.igTVVideoCount, 0),
    ) || 0,
    externalUrl: firstOf(item.externalUrl, owner.external_url, owner.externalUrl),
    businessCategoryName: firstOf(
      item.businessCategoryName,
      owner.businessCategoryName,
      owner.business_category_name,
    ),
    isVerified: Boolean(firstOf(item.isVerified, owner.isVerified, owner.is_verified, false)),
    isPrivate: Boolean(firstOf(item.private, owner.isPrivate, owner.is_private, false)),
  };
}

await Actor.init();

try {
  const input = (await Actor.getInput()) || {};
  const {
    hashtags = [],
    resultsPerHashtag = 150,
    minFollowers = 80,
    maxFollowers = 25000,
    minPosts = 5,
    supabaseUrl,
    supabaseKey,
    supabaseTable = 'leads',
    proxyEnabled = true,
  } = input;

  // Proxy configuration (residential group).
  let proxyConfiguration;
  if (proxyEnabled) {
    proxyConfiguration = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] });
  }

  const supabaseConfig =
    supabaseUrl && supabaseKey
      ? { url: supabaseUrl, key: supabaseKey, table: supabaseTable }
      : null;

  const dataset = await Actor.openDataset('leads-btp-qualified');
  const seenUsernames = new Set();

  let totalScraped = 0;
  let totalQualified = 0;
  const runAt = new Date().toISOString();

  console.log(`🚀 Démarrage — ${hashtags.length} hashtags, ${resultsPerHashtag} résultats/hashtag`);

  for (const hashtag of hashtags) {
    try {
      console.log(`\n🔎 Hashtag #${hashtag}`);

      const runInput = {
        hashtags: [hashtag],
        resultsLimit: resultsPerHashtag,
        scrapeType: 'posts',
        expandOwners: true,
        includeUserData: true,
        proxy: proxyConfiguration ? await proxyConfiguration.newUrl() : undefined,
      };

      const run = await Actor.call(INSTAGRAM_SCRAPER_ACTOR, runInput);
      const { items } = await Actor.apifyClient
        .dataset(run.defaultDatasetId)
        .listItems();

      totalScraped += items.length;

      for (const item of items) {
        const profile = normalizeProfile(item);
        if (!profile.username) continue;

        // Filter: BTP trade signal in bio.
        if (!isBtpProfile(profile)) continue;

        // Filter: no detectable website.
        if (!hasNoWebsite(profile)) continue;

        // Filter: follower / post thresholds.
        if (profile.followersCount < minFollowers || profile.followersCount > maxFollowers) {
          continue;
        }
        if (profile.postsCount < minPosts) continue;

        // Deduplicate by username.
        if (seenUsernames.has(profile.username)) continue;
        seenUsernames.add(profile.username);

        const { score, breakdown } = scoreProfile(profile);

        const lead = {
          username: profile.username,
          full_name: profile.fullName || null,
          biography: profile.biography || null,
          followers_count: profile.followersCount,
          following_count: profile.followingCount,
          posts_count: profile.postsCount,
          profile_url: `https://www.instagram.com/${profile.username}/`,
          business_category: profile.businessCategoryName || null,
          is_verified: profile.isVerified,
          score,
          score_breakdown: breakdown,
          source_hashtag: hashtag,
          scraped_at: new Date().toISOString(),
          status: 'new',
        };

        await dataset.pushData(lead);

        if (supabaseConfig) {
          await pushLeadToSupabase(lead, supabaseConfig);
        }

        totalQualified += 1;
        console.log(
          `✓ Lead qualifié : @${profile.username} | score: ${score} | followers: ${profile.followersCount}`,
        );
      }
    } catch (err) {
      console.error(`✗ Échec du hashtag #${hashtag} : ${err && err.message ? err.message : err}`);
      // Continue with the next hashtag.
    }

    // Random pause between hashtags to avoid predictable patterns.
    await randomSleep(2000, 4000);
  }

  const qualificationRate =
    totalScraped > 0 ? Number(((totalQualified / totalScraped) * 100).toFixed(2)) : 0;

  await Actor.setValue('OUTPUT', {
    totalScraped,
    totalQualified,
    qualificationRate,
    runAt,
  });

  console.log('\n────────────────────────────────────────');
  console.log('📊 Résumé du run');
  console.log(`   Profils scrapés     : ${totalScraped}`);
  console.log(`   Leads qualifiés     : ${totalQualified}`);
  console.log(`   Taux de qualification : ${qualificationRate}%`);
  console.log(`   Supabase            : ${supabaseConfig ? 'activé' : 'désactivé'}`);
  console.log('────────────────────────────────────────');
} finally {
  await Actor.exit();
}
