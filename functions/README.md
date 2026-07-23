# Cloud Functions — autorité serveur sur le classement

Ces fonctions rendent le classement **inviolable** : le total d'un joueur est
recalculé côté serveur à partir de ses résultats, et lui seul (via ces fonctions,
qui tournent avec les droits admin) écrit `/leaderboard`. Les règles Firestore
interdisent désormais l'écriture de `/leaderboard` côté joueur, si bien qu'un
total ne peut plus être gonflé depuis la console.

Fonctions en **1re génération** (déclencheurs Firestore classiques + callable) :
suffisant pour ce besoin et déployable avec un jeu de droits minimal.

## Fonctions (`index.js`)

- `classementSurResultat` — déclencheur sur `users/{uid}/results/{rid}` : recalcule.
- `classementSurProfil` — déclencheur sur `users/{uid}/state/profile` : rafraîchit le pseudo.
- `classementSurBanni` — déclencheur sur `banned/{uid}` : retire (suspension) ou restaure (réactivation).
- `backfillClassement` — **callable, réservé à l'auteur** : recalcule le classement de tous les joueurs existants. À appeler **une fois** après le premier déploiement.

Le total dérive de `users/{uid}/results/{date}.xp` (source de vérité, écrite par le joueur).

## Prérequis au déploiement

1. **Plan Blaze** (paiement à l'usage) activé sur le projet `donjons-definitions`.
   Le quota gratuit couvre très largement le trafic d'un mots-croisés quotidien
   (coût réel ≈ 0 €), mais Firebase exige une facturation liée pour les Functions.
2. **Droits du compte de service** de déploiement
   (`FIREBASE_SERVICE_ACCOUNT_DONJONS_DEFINITIONS`) :
   - Cloud Functions Admin
   - Cloud Build Editor
   - Artifact Registry Administrator
   - Service Account User (sur le compte de service d'exécution `…@appspot.gserviceaccount.com`)
   - Service Usage Admin (pour activer les API au 1er déploiement)
   - **Firebase Extensions Viewer** (lecture seule ; `firebase deploy` inspecte les
     extensions au passage) — `roles/firebaseextensions.viewer`
   - (Eventarc Admin n'est utile qu'en 2e génération ; inoffensif s'il est présent.)

## Séquence de mise en ligne (en deux temps, pour ne jamais geler le classement)

Le verrou des règles (`/leaderboard` en écriture = admin seul) et l'arrêt de
l'écriture côté client ne doivent prendre effet **qu'une fois la Function en
ligne**. Sinon, plus personne n'écrit le classement et il gèle.

1. **Temps 1 — additif :** déployer la Function **sans** toucher aux règles ni au
   client (le joueur écrit encore sa fiche ; la Function écrit la même valeur, en
   double, sans conflit). Vérifier qu'une résolution met bien le classement à jour.
2. **Backfill :** appeler `backfillClassement` une fois (connecté en auteur) pour
   recalculer les fiches existantes.
3. **Temps 2 — bascule :** déployer le verrou des règles + l'arrêt de l'écriture
   côté client. La Function devient seule à écrire le classement.

Déploiement manuel possible à tout moment :

```bash
firebase deploy --only functions --project donjons-definitions
firebase deploy --only firestore:rules --project donjons-definitions
```

## Tests

`npm run test:classement` (émulateurs auth + firestore + functions) vérifie que :
écrire un résultat fait calculer le total côté serveur, qu'un second résultat le
met à jour, qu'un joueur **ne peut plus forger** sa propre fiche, et que supprimer
un résultat fait redescendre le total.
