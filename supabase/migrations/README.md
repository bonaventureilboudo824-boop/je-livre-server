# Supabase (projet dtporejrpnndhffbiiim)

Les migrations sont appliquées directement dans Supabase ; ce dossier en garde une trace.

- `miroir_firebase_vers_supabase` : copie automatique chaque minute (pg_cron) du catalogue public Firebase
  (boutiques approuvées, produits, Reels, pubs, statistiques) vers Supabase via `public.jl_sync_from_firebase()`.
  Temporaire : à désactiver (`select cron.unschedule('jl_sync_firebase');`) le jour où l'appli écrit directement dans Supabase.
- Le jeton de notification des boutiques (`fcmToken`) n'est jamais copié.

**Mise à jour (bascule)** : la copie automatique `jl_sync_firebase` a été arrêtée. Supabase est maintenant la source du catalogue (boutiques, produits, Reels, commentaires, j'aime, statistiques, pubs, lieux). Le serveur lit les prix des produits dans Supabase ; `CATALOGUE_SOURCE=firebase` ramène l'ancien comportement en urgence.
