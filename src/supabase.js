/**
 * Minimal Supabase REST client using native fetch (Node 18+).
 * No Supabase SDK dependency.
 */

/**
 * Fetch every existing username from the Supabase table, paginating past the
 * default 1000-row limit. Used to skip already-known profiles before the
 * costly profile-enrichment scrape (cross-run de-duplication).
 *
 * @param {{ url: string, key: string, table: string }} config
 * @returns {Promise<Set<string>>}
 */
export async function fetchExistingUsernames(config) {
  const { url, key, table } = config || {};
  const usernames = new Set();
  if (!url || !key || !table) return usernames;

  const base = `${url.replace(/\/$/, '')}/rest/v1/${table}`;
  const pageSize = 1000;
  let offset = 0;

  try {
    for (;;) {
      const endpoint = `${base}?select=username&limit=${pageSize}&offset=${offset}`;
      const response = await fetch(endpoint, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(
          `Erreur Supabase (lecture usernames) : HTTP ${response.status} ${response.statusText} ${body}`.trim(),
        );
        break;
      }

      const rows = await response.json();
      for (const row of rows) {
        if (row && row.username) usernames.add(row.username);
      }

      if (!Array.isArray(rows) || rows.length < pageSize) break;
      offset += pageSize;
    }
  } catch (err) {
    const error = err && err.message ? err.message : String(err);
    console.error(`Erreur réseau Supabase (lecture usernames) : ${error}`);
  }

  return usernames;
}

/**
 * Insert a single lead into a Supabase table via the PostgREST endpoint.
 * Duplicates (e.g. conflicting unique username) are ignored silently.
 *
 * @param {object} lead - The lead row to insert.
 * @param {{ url: string, key: string, table: string }} config
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function pushLeadToSupabase(lead, config) {
  const { url, key, table } = config || {};

  if (!url || !key || !table) {
    return { success: false, error: 'Configuration Supabase incomplète' };
  }

  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/${table}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'resolution=ignore-duplicates',
      },
      body: JSON.stringify(lead),
    });

    // 409 = conflict (duplicate). Treat as a silent no-op success.
    if (response.status === 409) {
      return { success: true };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = `HTTP ${response.status} ${response.statusText} ${body}`.trim();
      console.error(`Erreur Supabase pour @${lead && lead.username} : ${error}`);
      return { success: false, error };
    }

    return { success: true };
  } catch (err) {
    const error = err && err.message ? err.message : String(err);
    console.error(`Erreur réseau Supabase pour @${lead && lead.username} : ${error}`);
    return { success: false, error };
  }
}
