# TONA — Comprendre la guerre cognitive

Dossier web d'éducation permanente sur la **guerre cognitive** et la **guerre narrative** :
comprendre le « champ de bataille de l'esprit » et s'en défendre. Pensé pour le grand
public non initié en première intention, et comme hub de référence à terme.

**Site JAMstack 100 % statique** — aucun build, aucune dépendance serveur. Il suffit de
servir les fichiers. Prêt pour GitHub Pages.

## Structure

```
tona/
├── index.html            Accueil — expérience de sensibilisation + hub
├── comprendre.html       Les fondamentaux (vulgarisation)
├── belgique.html         Étude de cas : la guerre narrative en Belgique
├── se-defendre.html      Guide de résilience
├── ressources.html       Glossaire, outils, bibliographie
├── 404.html
├── robots.txt · sitemap.xml · .nojekyll
└── assets/
    ├── css/style.css     Système de design « Signal & Interférence »
    ├── js/main.js        Interactions (vanilla JS, sans dépendance)
    └── img/              favicon.svg · og-cover.png
```

## Publier sur GitHub Pages

1. Placez ces fichiers **à la racine** du dépôt `ouaisfieu/tona` et poussez sur `main`.
2. Dépôt → **Settings › Pages** → *Build and deployment* → **Deploy from a branch**,
   branche `main`, dossier `/ (root)`. Enregistrez.
3. Le site sera en ligne sous quelques minutes à l'adresse :
   **https://ouaisfieu.github.io/tona/**

> Le fichier `.nojekyll` garantit que GitHub Pages sert les fichiers tels quels.

### Nom de domaine personnalisé (optionnel)

Ajoutez un fichier `CNAME` contenant votre domaine (ex. `tona.example.org`), puis
remplacez l'URL de base `https://ouaisfieu.github.io/tona/` dans les balises `<link rel="canonical">`,
les métadonnées Open Graph, `sitemap.xml` et `robots.txt`.

## Aperçu en local

Les liens internes étant relatifs, un simple serveur statique suffit :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

## SEO intégré

Titres et descriptions uniques par page · URL canoniques · Open Graph + Twitter Cards ·
données structurées JSON-LD (`WebSite`, `Organization`, `Article`, `BreadcrumbList`) ·
`sitemap.xml` + `robots.txt` · HTML sémantique, images décrites, navigation au clavier,
`prefers-reduced-motion` respecté.

## Vidéo intégrée

La vidéo est un lecteur **à chargement direct** (iframe `youtube-nocookie`, format 16:9
responsive). Pour **changer de vidéo**, une seule chose à modifier dans `index.html` :
l'identifiant `jFRt-axDNNI` dans l'attribut `src` de l'`<iframe>` (un commentaire le
signale juste au-dessus). Pour une autre plateforme (Vimeo, PeerTube…), collez son URL
d'intégration à la place de la valeur de `src`.

## Modifier le contenu

Tout est en HTML lisible. Le contenu éditorial vit directement dans chaque page ;
le style est centralisé dans `assets/css/style.css` (variables de couleurs et de typo
en tête de fichier).

## Licence

- **Contenu éditorial** : [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.fr)
- **Code** (HTML/CSS/JS) : MIT

Certaines sources mobilisées dans le débat public sur ce sujet sont elles-mêmes engagées
et doivent être lues de manière critique. Ce dossier vise à *informer sans amplifier*.
