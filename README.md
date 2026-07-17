# verbicruciste

Atelier personnel de mots croisés à visée pédagogique : un dictionnaire de mots et de définitions organisé en listes (une par séquence), un générateur de grilles resserrées et bornées, un rendu SVG imprimable. Tout est rédigé par l'autrice : 100 % des mots et 100 % des définitions viennent de vous, sans lexique externe.

**Application en ligne : https://nomeansno1981.github.io/Cruciverbiste/**

## Utilisation rapide

1. Créez une liste (une par séquence), ajoutez vos mots : un par un, séparés par des points-virgules (« lancelot ; guenièvre ; charrette »), ou en collant une liste entière. Les définitions sont optionnelles : vous pouvez les rédiger plus tard, au moment où le mot sort dans une grille.
2. Réglez le nombre de mots à utiliser et les dimensions maximales (largeur, hauteur), puis générez. Régénérez autant de fois que souhaité : l'algorithme maximise les croisements dans la boîte demandée.
3. Enregistrez les grilles réussies, exportez la grille vide ou le corrigé en SVG, imprimez en PDF via le bouton dédié.

## Sauvegarde et synchronisation entre deux Macs

Les données vivent dans le navigateur (IndexedDB), par machine et par navigateur. Pour passer d'un Mac à l'autre :

1. Sur le premier Mac : « Exporter (sauvegarde) », puis rangez le fichier JSON dans iCloud Drive ou Google Drive.
2. Sur le second Mac : « Importer une sauvegarde » et choisissez ce fichier.

Le fichier JSON contient tout : listes, mots, définitions et grilles enregistrées. Les sauvegardes issues d'anciennes versions du format sont migrées automatiquement à l'import.

L'export .tsv est une commodité pour tableur : une ligne par mot, suivie de ses définitions en colonnes. La sauvegarde complète reste le JSON.

## Développement

Aucune étape de build : `index.html` contient toute l'application (HTML, CSS, JavaScript).

Tests de fumée dans Chromium headless (génération réelle d'une grille, persistance IndexedDB, rechargement) :

```
npm install
npm test
```

## Déploiement

À chaque push sur `main`, le workflow GitHub Actions publie `index.html` sur la branche `gh-pages`, servie par GitHub Pages.
