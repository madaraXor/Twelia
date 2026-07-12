# Recherche sur la distribution du client

État vérifié le 10 juillet 2026.

## Contraintes retenues

Twelia ne contient pas de ressources DOFUS Touch, ne contourne pas l’authentification et ne redistribue pas le client. Le dossier `client-officiel` est considéré en lecture seule hors opération explicite d’installation, de mise à jour ou de réparation. La couche desktop modifiée est générée séparément dans `client-runtime`.

## Projets étudiés

### Lindo

[Lindo](https://github.com/prixe/lindo) est un client Electron GPL-3.0 pour Windows, macOS et Linux. Son README avertit explicitement qu’il n’est pas officiellement conforme aux conditions d’utilisation. Son architecture et sa licence empêchent toute copie directe dans Twelia sans décision de licence. Il peut uniquement servir à identifier les problèmes généraux d’un gestionnaire de versions ; aucune URL ou routine n’a été reprise.

### DofuEmu

[DofuEmu](https://github.com/angine67/DofuEmu) est un client Electron dont le dépôt ne contient actuellement pas de fichier de licence. Il télécharge le manifeste mobile, applique des adaptations et ajoute des fonctions de jeu. Twelia n’en reprend aucun code : seules l’architecture générale et l’origine de distribution ont été comparées, puis réimplémentées de façon indépendante et minimale.

## Ce qui est implémenté

Le module Rust `distribution` définit un manifeste local original :

```ts
type InstalledClientFile = {
  relativePath: string;
  size: number;
  sha256: string;
  sourceVersion: string;
};
```

La vérification :

1. refuse les chemins absolus ou contenant `..` ;
2. calcule SHA-256 en lecture seule ;
3. distingue les fichiers valides, manquants, corrompus, inattendus, modifiés et non vérifiables ;
4. ne répare jamais silencieusement ;
5. n’active aucune mise à jour sans manifeste local validé.

## Distribution activée

Twelia lit actuellement `manifest.json` et `assetMap.json` sur `dt-proxy-production-login.ankama-games.com`, télécharge uniquement les chemins sûrs annoncés, limite la taille des réponses, calcule SHA-256 et installe depuis `downloads/` par remplacement atomique avec retour arrière. La version applicative est lue depuis la fiche App Store de DOFUS Touch et la version du build depuis le script téléchargé.

La compatibilité refuse une mise à jour si l’une des transformations attendues ne correspond plus au script distribué. Cela évite d’installer silencieusement un runtime cassé. L’origine reste non documentée comme API publique et Ankama indique que l’utilisation sur PC via une application non officielle n’est pas autorisée ; l’interface conserve donc un avertissement explicite.
