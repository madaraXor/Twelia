<p align="center">
  <img src="public/twelia-icon.png" width="112" alt="Logo Twelia">
</p>

<h1 align="center">Twelia</h1>

<p align="center">
  Un espace de travail non officiel pour organiser plusieurs profils et sessions DOFUS Touch.
</p>

<p align="center">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-1.88%2B-000000?logo=rust&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
</p>

> [!WARNING]
> Twelia est un projet communautaire indépendant, sans affiliation avec Ankama. Son utilisation n’est pas officiellement approuvée. Elle peut présenter des risques pour votre compte ; aucune absence de sanction ne peut être garantie.

## À propos

Twelia réunit plusieurs sessions de jeu dans une seule application : onglets sur ordinateur, menu flottant en plein écran sur Android. Chaque profil possède son propre espace de travail et peut conserver sa session sans enregistrer le mot de passe du compte.

Le dépôt ne contient ni ressources ni fichiers propriétaires de DOFUS Touch. Le client est récupéré au moment de l’installation, vérifié en SHA-256, puis préparé localement dans un runtime distinct.

## Fonctionnalités

- profils et sessions multiples avec restauration de l’espace de travail ;
- vue du jeu intégrée et redimensionnée avec la fenêtre ;
- stockage distinct par profil et secrets placés dans le coffre natif ;
- authentification Ankama dans le navigateur sur Android ;
- changement automatique de session pour les tours de combat et invitations configurées ;
- interface React basée sur Tailwind CSS et les composants shadcn/ui ;
- interface Android en paysage, immersive et adaptée aux écrans à encoche ;
- installation, mise à jour et réparation atomiques du client ;
- diagnostics nettoyés des informations sensibles.

## État du projet

Twelia est en développement actif et doit être considérée comme une version expérimentale.

| Plateforme    | État                             |
| ------------- | -------------------------------- |
| Windows       | Développement et tests manuels   |
| Android ARM64 | Build et tests sur appareil réel |
| Linux / macOS | Non validé                       |
| iOS           | Non pris en charge               |

Les comportements du client distant peuvent changer sans préavis et nécessiter une mise à jour de la couche de compatibilité.

## Prérequis

Pour le développement desktop :

- Node.js 22 ou plus récent ;
- pnpm 9 ;
- Rust 1.88 ou plus récent ;
- les [prérequis système de Tauri 2](https://v2.tauri.app/start/prerequisites/).

Après avoir cloné le dépôt :

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm tauri dev
```

Commandes utiles :

```bash
pnpm dev           # interface web uniquement
pnpm test          # tests TypeScript
pnpm lint          # ESLint
pnpm build         # typecheck et build frontend
pnpm tauri build   # application desktop
```

## Développement Android

Installer Android Studio, le SDK Android 36, le NDK, Java et la cible Rust Android :

```bash
rustup target add aarch64-linux-android
pnpm tauri android dev
```

Le projet natif dans `src-tauri/gen/android` est versionné, car il contient les adaptations maintenues par Twelia. Il ne faut donc pas relancer `pnpm tauri android init` après un clonage normal.

Pour produire un APK ARM64 de développement :

```bash
pnpm tauri android build --debug --apk --target aarch64
```

Sous Windows, le **Mode développeur** doit être activé dans `Paramètres → Système → Espace développeurs`. Le build Android crée un lien symbolique vers la bibliothèque Rust ; sans ce réglage, il échoue avec `Creation symbolic link is not allowed for this system`.

La signature d’une version Android distribuable doit être configurée séparément. Voir [la documentation Android](docs/android.md).

## Organisation du dépôt

```text
src/                         Interface React et logique TypeScript
src/components/ui/           Composants shadcn/ui
src-tauri/src/               Backend Rust et gestion des sessions
src-tauri/gen/android/       Projet Android natif maintenu
src-tauri/icons/             Icônes générées pour les plateformes
assets/branding/             Sources de l’identité visuelle
docs/                        Architecture, sécurité et limites
```

## Sécurité et confidentialité

- Twelia ne demande et n’enregistre jamais le mot de passe Ankama.
- Les métadonnées de profils ne contiennent aucun secret de session.
- Les identifiants utilisés dans les chemins sont validés côté Rust.
- Les exports de diagnostic passent par un mécanisme central de masquage.
- Aucun bot, macro, autoclic, contrôle groupé ou modification de gameplay n’est inclus.

Merci de ne jamais publier de jeton, cookie, capture contenant des données personnelles, fichier `key.properties`, keystore ou rapport non vérifié dans une issue.

Pour les détails techniques, consulter [l’isolation des sessions](docs/session-isolation.md), [la distribution du client](docs/game-distribution-research.md), [les diagnostics](docs/diagnostics.md), [les fondations du système de mods](docs/mods.md) et [Android](docs/android.md).

## Licence

Le code propre à Twelia est distribué sous licence [GNU GPL version 3 ou ultérieure](LICENSE). Les versions modifiées et redistribuées doivent respecter les mêmes libertés et fournir leur code source selon les conditions de cette licence.

La licence ne couvre pas les marques, noms, illustrations, ressources ou fichiers appartenant à Ankama ou à d’autres ayants droit. Aucun fichier propriétaire de DOFUS Touch n’est inclus dans ce dépôt.
