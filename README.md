# verbicruciste

Atelier personnel de mots croisés à visée pédagogique : un dictionnaire de mots et de définitions organisé en listes (une par séquence), un générateur de grilles resserrées et bornées, un rendu SVG imprimable. Tout est rédigé par l'autrice : 100 % des mots et 100 % des définitions viennent de vous, sans lexique externe.

**Application en ligne : https://nomeansno1981.github.io/Cruciverbiste/**

## Utilisation rapide

1. Créez une liste (une par séquence), ajoutez vos mots : un par un, séparés par des points-virgules (« lancelot ; guenièvre ; charrette »), ou en collant une liste entière. Les définitions sont optionnelles : vous pouvez les rédiger plus tard, au moment où le mot sort dans une grille. Les doublons sont refusés automatiquement (un mot compte pour ses lettres de placement : « EPEE », « épée » et « Épée » sont le même mot); si le doublon arrive avec une définition nouvelle, elle rejoint le mot existant.
2. Réglez les dimensions maximales (largeur, hauteur), puis générez : l'application case autant de mots que possible dans la boîte en maximisant les croisements. Régénérez autant de fois que souhaité.
3. Enregistrez les grilles réussies, exportez la grille vide ou le corrigé en SVG, imprimez en PDF via le bouton dédié.

## Grands dictionnaires thématiques

Une liste peut contenir plusieurs centaines de mots sur un thème. La taille de la boîte détermine le nombre de mots d'une grille : l'application y case autant de mots que possible. Quand le dictionnaire dépasse la capacité de la boîte, le tirage des candidats applique une rotation : les mots les moins présents dans vos grilles enregistrées passent d'abord (hasard à égalité), si bien que les grilles successives couvrent tout le dictionnaire. Une fois la meilleure grille retenue, une passe d'extension y glisse encore des mots de toute la réserve qui épousent les trous (les moins utilisés d'abord), ce qui densifie fortement les croisements sur les grands dictionnaires. Deux formes d'un même mot (singulier et pluriel) ne cohabitent jamais dans une même grille. Enregistrez les grilles réussies au fil des tirages, et régénérez pour obtenir une autre grille du même thème.

Côté lettres : les accents se croisent avec leurs lettres nues (É avec E, Ç avec C) et réapparaissent au corrigé; les ligatures sont décomposées (CŒUR s'écrit C, O, E, U, R); apostrophes et esperluettes sont ignorées. Les chiffres entrent dans la grille, une case par chiffre (« 13th Age » occupe 7 cases : 1, 3, T, H, puis A, G, E), et un chiffre ne se croise qu'avec le même chiffre (0 et O restent distincts). Un espace ou un trait d'union dans un terme marque une frontière de mots : les lettres se suivent dans la grille, et un losange noir posé sur le trait entre les deux cases signale la coupure, à l'écran comme dans les exports SVG et à l'impression. « donjons et dragons » donne ainsi DONJONS|ET|DRAGONS; l'apostrophe ne coupe pas (« L'Appel de Cthulhu » n'est barré qu'entre LAPPEL, DE et CTHULHU).

## Définitions différées et multiples

- Un mot peut vivre sans définition : le dictionnaire affiche son compteur (« 0 définition ») et le signale discrètement. La génération et l'impression restent possibles, la mention « définition à compléter » prenant la place du texte manquant.
- Dans le texte d'une définition, `*titre*` s'affiche en italique et `**texte**` en gras, façon Markdown, partout où la définition se lit (grille, impression, dictionnaire). Les champs d'édition et les exports conservent le texte brut avec ses astérisques.
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

À chaque push sur `main`, le workflow GitHub Actions publie `index.html` sur la branche `gh-pages`, servie par GitHub Pages. Au passage, il inscrit au pied de la page le commit publié et sa date (« version abc1234 publiée le 18/07/2026 »). Si ce tampon manque ou date, votre navigateur affiche une copie périmée : fermez complètement l'onglet et rouvrez l'adresse (ou Cmd+Maj+R sur Mac).
