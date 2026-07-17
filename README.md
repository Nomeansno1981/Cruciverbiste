# verbicruciste

Atelier personnel de mots croisés à visée pédagogique : un dictionnaire de mots et de définitions organisé en listes (une par séquence), un générateur de grilles resserrées et bornées, un rendu SVG imprimable. Tout est rédigé par l'autrice : 100 % des mots et 100 % des définitions viennent de vous, sans lexique externe.

**Application en ligne : https://nomeansno1981.github.io/Cruciverbiste/**

## Utilisation rapide

1. Créez une liste (une par séquence), ajoutez vos mots : un par un, séparés par des points-virgules (« lancelot ; guenièvre ; charrette »), ou en collant une liste entière. Les définitions sont optionnelles : vous pouvez les rédiger plus tard, au moment où le mot sort dans une grille.
2. Réglez le nombre de mots à utiliser et les dimensions maximales (largeur, hauteur), puis générez. Régénérez autant de fois que souhaité : l'algorithme maximise les croisements dans la boîte demandée.
3. Enregistrez les grilles réussies, exportez la grille vide ou le corrigé en SVG, imprimez en PDF via le bouton dédié.

## Définitions différées et multiples

- Un mot peut vivre sans définition : le dictionnaire affiche son compteur (« 0 définition ») et le signale discrètement. La génération et l'impression restent possibles, la mention « définition à compléter » prenant la place du texte manquant.
- À l'affichage d'une grille, chaque mot sans définition propose un champ « Définir... ». Le texte validé est enregistré dans le dictionnaire, donc mémorisé pour toutes les grilles suivantes.
- Un mot peut porter plusieurs définitions. L'éditeur dépliable du dictionnaire (crayon sur la ligne du mot) permet d'en ajouter, modifier ou supprimer. Dans une grille, un sélecteur choisit celle qui s'applique; le défaut est la dernière définition utilisée, sinon la première. Le crayon sur la ligne d'une définition la modifie, et la modification est répercutée au dictionnaire.
- Les grilles enregistrées conservent, pour chaque mot, l'identifiant de la définition choisie et son texte au moment de l'enregistrement : elles restent fidèles même si le dictionnaire évolue ensuite.

## Connexion et synchronisation

À l'ouverture, l'application demande une connexion avec votre compte Google (une fois par navigateur). Les listes, mots, définitions et grilles enregistrées sont stockés en ligne (Firebase Firestore, offre gratuite) et synchronisés en direct : avec le même compte Google sur les deux Macs, une modification faite sur l'un apparaît aussitôt sur l'autre, sans export ni import.

- À la première connexion d'un navigateur, les données locales des versions précédentes sont reprises automatiquement.
- Les règles de sécurité Firestore (`firestore.rules`) réservent à chaque compte la lecture et l'écriture de ses propres données. Le bloc `firebaseConfig` de `index.html` identifie le projet; il n'est pas secret.
- « Déconnexion » (en haut à droite) détache le navigateur du compte.
- « Exporter (sauvegarde) » reste disponible en filet de sécurité; « Importer une sauvegarde » remplace le contenu en ligne par celui du fichier JSON (les anciens formats sont migrés).
- L'export .tsv est une commodité pour tableur : une ligne par mot, suivie de ses définitions en colonnes.

Modes techniques via l'URL : `#local` pour un fonctionnement purement local sans connexion (IndexedDB), `#emu` pour viser les émulateurs Firebase (tests).

## Développement

Aucune étape de build : `index.html` contient toute l'application (HTML, CSS, JavaScript).

Tests dans Chromium headless :

```
npm install
npm test          # mode local : génération réelle, IndexedDB, définitions différées
npm run test:sync # synchronisation : deux navigateurs sur les émulateurs Firebase (Java requis)
```

## Déploiement

À chaque push sur `main`, le workflow GitHub Actions publie `index.html` sur la branche `gh-pages`, servie par GitHub Pages.
