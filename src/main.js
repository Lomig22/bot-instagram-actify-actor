/**
 * Instagram BTP Lead Scraper — Apify Actor entry point.
 *
 * Two-stage pipeline per hashtag (required by apify/instagram-scraper):
 *   Stage 1 — scrape the hashtag for posts, collect unique owner usernames.
 *             (Hashtag posts do NOT carry bio / followers / external URL.)
 *   Stage 2 — scrape those usernames with resultsType 'details' to obtain the
 *             full profile (bio, followers, external URL, business category…).
 *
 * Then: filter (BTP + no website + thresholds), deduplicate, score, persist
 * (Apify dataset + optional Supabase).
 */

import { Actor } from 'apify';
import { isBtpProfile, hasNoWebsite, isForeignProfile } from './filters.js';
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
 * Read all items from a finished run's default dataset.
 */
async function getRunItems(run) {
  if (!run || !run.defaultDatasetId) return [];
  const { items } = await Actor.apifyClient.dataset(run.defaultDatasetId).listItems();
  return items || [];
}

/**
 * Normalize a "details" result from instagram-scraper into a uniform profile.
 * Field names follow the current scraper's profile-details output.
 */
function normalizeProfile(item) {
  const externalUrl = firstOf(
    item.externalUrl,
    Array.isArray(item.externalUrls) && item.externalUrls.length ? item.externalUrls[0]?.url : undefined,
  );

  return {
    username: firstOf(item.username, item.ownerUsername),
    fullName: firstOf(item.fullName, item.ownerFullName),
    biography: firstOf(item.biography, ''),
    followersCount: Number(firstOf(item.followersCount, 0)) || 0,
    followingCount: Number(firstOf(item.followsCount, item.followingCount, 0)) || 0,
    postsCount: Number(firstOf(item.postsCount, 0)) || 0,
    externalUrl,
    businessCategoryName: firstOf(item.businessCategoryName, item.businessCategory),
    isVerified: Boolean(item.verified),
    isPrivate: Boolean(item.private),
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
    excludeForeign = true,
    excludeVerified = true,
    supabaseUrl,
    supabaseKey,
    supabaseTable = 'leads',
    proxyEnabled = true,
  } = input;

  // Proxy is passed to the child scraper as a standard Apify proxy object.
  const proxy = proxyEnabled
    ? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] }
    : { useApifyProxy: false };

  const supabaseConfig =
    supabaseUrl && supabaseKey
      ? { url: supabaseUrl, key: supabaseKey, table: supabaseTable }
      : null;

  const seenUsernames = new Set();

  let totalScraped = 0;
  let totalQualified = 0;
  const runAt = new Date().toISOString();

  console.log(`🚀 Démarrage — ${hashtags.length} hashtags, ${resultsPerHashtag} résultats/hashtag`);

  for (const hashtag of hashtags) {
    try {
      console.log(`\n🔎 Hashtag #${hashtag}`);

      // ── Stage 1: hashtag posts → unique owner usernames ──
      // Hit the hashtag page directly (directUrls). Using search+searchType
      // routes through a Google scrape that returns 0 results for IG tags.
      const postsRun = await Actor.call(INSTAGRAM_SCRAPER_ACTOR, {
        directUrls: [`https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`],
        resultsType: 'posts',
        resultsLimit: resultsPerHashtag,
        proxy,
      });
      const posts = await getRunItems(postsRun);
      totalScraped += posts.length;

      const owners = [];
      const ownerSet = new Set();
      for (const post of posts) {
        const username = post.ownerUsername;
        if (username && !ownerSet.has(username) && !seenUsernames.has(username)) {
          ownerSet.add(username);
          owners.push(username);
        }
      }

      if (owners.length === 0) {
        console.log(`   Aucun propriétaire exploitable pour #${hashtag}`);
        await randomSleep(2000, 4000);
        continue;
      }

      console.log(`   ${posts.length} posts → ${owners.length} profils uniques à enrichir`);

      // ── Stage 2: profile details for each owner ──
      const detailsRun = await Actor.call(INSTAGRAM_SCRAPER_ACTOR, {
        directUrls: owners.map((u) => `https://www.instagram.com/${u}/`),
        resultsType: 'details',
        resultsLimit: owners.length,
        proxy,
      });
      const details = await getRunItems(detailsRun);

      for (const item of details) {
        const profile = normalizeProfile(item);
        if (!profile.username) continue;

        // Filter: BTP trade signal in bio.
        if (!isBtpProfile(profile)) continue;

        // Filter: no detectable website.
        if (!hasNoWebsite(profile)) continue;

        // Filter: exclude clearly foreign (non-France) profiles.
        if (excludeForeign && isForeignProfile(profile)) continue;

        // Filter: exclude verified accounts (already established notoriety).
        if (excludeVerified && profile.isVerified) continue;

        // Filter: follower / post thresholds.
        if (profile.followersCount < minFollowers || profile.followersCount > maxFollowers) {
          continue;
        }
        if (profile.postsCount < minPosts) continue;

        // Deduplicate by username (across hashtags).
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

        // Write to the run's default dataset so the Output tab + CSV export work.
        await Actor.pushData(lead);

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
