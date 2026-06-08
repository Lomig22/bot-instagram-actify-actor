# Instagram BTP Lead Scraper

Apify Actor qui scrape Instagram par hashtags, identifie les **artisans du BTP français
sans site web visible**, score chaque lead, puis exporte les résultats vers un dataset
Apify et (optionnellement) une table Supabase.

Cible : électriciens, peintres, carreleurs, plaquistes, maçons, rénovateurs, etc. qui
n'ont pas encore de présence web — idéal pour de la prospection en marketing digital.

---

## ⚙️ Fonctionnement

Pour chaque hashtag fourni :

1. Lance l'actor [`apify/instagram-scraper`](https://apify.com/apify/instagram-scraper) pour récupérer les posts.
2. Normalise le profil propriétaire de chaque post.
3. **Filtre** : la bio doit mentionner un métier/signal BTP **et** ne contenir aucun site web détectable.
4. Applique les seuils d'abonnés et de publications.
5. **Déduplique** par username.
6. **Score** le lead (0–15) et le sauvegarde (dataset + Supabase).

Une pause aléatoire de 2 à 4 secondes est respectée entre chaque hashtag.

---

## 🚀 Déploiement sur Apify via GitHub

```bash
git init
git add .
git commit -m "init actor"
```

1. Pusher le repo sur GitHub (public ou privé).
2. Sur [console.apify.com](https://console.apify.com) → **Actors** → **Create new Actor** → **Link to GitHub repository**.
3. Sélectionner le repo, puis lancer le **Build**.
4. Lancer un premier run test avec `resultsPerHashtag: 20` pour valider.
5. Vérifier les logs et le dataset de sortie.
6. Configurer le **Scheduler** Apify pour un run hebdomadaire automatique.

---

## 📥 Paramètres d'entrée

| Paramètre | Type | Défaut | Description |
|---|---|---|---|
| `hashtags` | array | liste de 20 hashtags BTP | Hashtags à scraper (sans le `#`). |
| `resultsPerHashtag` | integer (20–500) | `150` | Nombre de posts récupérés par hashtag. |
| `minFollowers` | integer | `80` | Abonnés minimum pour qualifier un profil. |
| `maxFollowers` | integer | `25000` | Abonnés maximum pour qualifier un profil. |
| `minPosts` | integer | `5` | Publications minimum pour qualifier un profil. |
| `supabaseUrl` | string | — | URL du projet Supabase (optionnel). |
| `supabaseKey` | string (secret) | — | Clé `service_role` ou `anon` (optionnel). |
| `supabaseTable` | string | `leads` | Table Supabase cible. |
| `proxyEnabled` | boolean | `true` | Utiliser le proxy résidentiel Apify. |

---

## 📤 Format de sortie

Chaque lead qualifié est poussé dans le dataset `leads-btp-qualified` :

```json
{
  "username": "renov_pro_31",
  "full_name": "Rénov Pro Toulouse",
  "biography": "Artisan rénovation 🏠 Devis gratuit ☎️ 06 12 34 56 78 — Toulouse 31",
  "followers_count": 1240,
  "following_count": 980,
  "posts_count": 47,
  "profile_url": "https://www.instagram.com/renov_pro_31/",
  "business_category": "Home Improvement",
  "is_verified": false,
  "score": 12,
  "score_breakdown": [
    "business_account(+3)",
    "followers_ideal(+3)",
    "rich_bio(+1)",
    "enough_posts(+1)",
    "public_account(+1)",
    "phone_in_bio(+2)",
    "cta_in_bio(+1)",
    "location_in_bio(+1)"
  ],
  "source_hashtag": "renovationinterieure",
  "scraped_at": "2026-06-08T10:15:00.000Z",
  "status": "new"
}
```

Un objet de synthèse est également écrit dans la clé `OUTPUT` du key-value store :

```json
{ "totalScraped": 3000, "totalQualified": 184, "qualificationRate": 6.13, "runAt": "..." }
```

---

## 🗄️ Table Supabase

À créer dans l'éditeur SQL de Supabase avant le premier run avec export :

```sql
create table leads (
  id uuid default gen_random_uuid() primary key,
  username text unique not null,
  full_name text,
  biography text,
  followers_count integer,
  following_count integer,
  posts_count integer,
  profile_url text,
  business_category text,
  is_verified boolean default false,
  score integer default 0,
  score_breakdown jsonb,
  source_hashtag text,
  scraped_at timestamptz,
  status text default 'new',
  created_at timestamptz default now()
);

create index leads_score_idx on leads(score desc);
create index leads_status_idx on leads(status);
create index leads_scraped_at_idx on leads(scraped_at desc);
```

> La contrainte `unique` sur `username` combinée à `Prefer: resolution=ignore-duplicates`
> garantit qu'un même artisan n'est jamais inséré deux fois.

---

## 🎯 Système de scoring (0 à 15)

| Critère | Points | Logique |
|---|---|---|
| Compte professionnel | +3 | `businessCategoryName` non vide |
| Fourchette idéale d'abonnés | +3 | 200 – 5000 abonnés |
| Fourchette acceptable d'abonnés | +1 | 100–200 ou 5000–15000 |
| Bio riche | +1 | bio de plus de 40 caractères |
| Posts suffisants | +1 | au moins 10 publications |
| Compte public | +1 | profil non privé |
| Ratio following/followers élevé | +1 | `following > followers × 0.8` |
| Téléphone dans la bio | +2 | numéro mobile 06/07 |
| Call-to-action dans la bio | +1 | `devis`, `contact`, `appel`, `rdv`, `gratuit` |
| Ville / département dans la bio | +1 | n° de département FR ou ville courante |

Le tableau `score_breakdown` liste les critères validés (utile pour le debug et le tri).

---

## ✅ Bonnes pratiques

- **Fréquence des runs** : un run hebdomadaire suffit pour la plupart des bassins
  d'artisans ; au-delà, les profils se répètent et le taux de qualification chute.
- **Rotation des hashtags** : alterner les hashtags métier (électricien, carreleur…)
  et les hashtags génériques (artisanbtp, renovationmaison…) pour élargir le vivier.
- **Seuils recommandés** : `minFollowers: 80–150`, `maxFollowers: 25000`,
  `minPosts: 5`. Les très gros comptes ont généralement déjà un site web.
- **Proxy** : garder `proxyEnabled: true` (résidentiel) pour réduire les blocages.
- **Volume** : démarrer avec `resultsPerHashtag: 20` pour les tests, puis monter à
  150–300 en production.
- **Priorisation commerciale** : trier les leads par `score desc` et contacter en
  priorité ceux avec téléphone + CTA dans la bio (score ≥ 10).

---

## 🛠️ Stack technique

- Node.js 18+ (ESModules, `fetch` natif)
- Dépendance unique : [`apify`](https://www.npmjs.com/package/apify)
- Client Supabase maison via l'API REST PostgREST (aucun SDK)
