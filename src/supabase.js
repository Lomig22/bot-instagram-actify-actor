/**
 * Minimal Supabase REST client using native fetch (Node 18+).
 * No Supabase SDK dependency.
 */

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
