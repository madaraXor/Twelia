# Android

État vérifié sur un appareil ARM64 réel le 12 juillet 2026.

## Implémentation actuelle

- application verrouillée en paysage ;
- mode immersif avec barres système masquées et réapparition temporaire par glissement ;
- prise en charge des encoches via les bords courts de la fenêtre ;
- jeu intégré dans une iframe plein écran avec mise à l’échelle logique sur 1280 pixels ;
- zoom navigateur désactivé nativement et viewport verrouillé, sans supprimer les événements tactiles du jeu ;
- origine locale propre à chaque session pour isoler cookies et stockages web ;
- menu flottant shadcn/ui superposé au jeu pour naviguer entre les profils ;
- authentification ouverte dans le navigateur système puis renvoyée à Twelia par le lien profond `dofustouch://authorized` ;
- coffre basé sur Android Keystore ;
- téléchargement et préparation du client validés sur appareil réel.

Le fichier `src-tauri/gen/android/app/src/main/java/app/twelia/client/MainActivity.kt` contient les adaptations natives du mode immersif. Le projet `src-tauri/gen/android` est donc une source maintenue et doit être versionné. Les dossiers Gradle, les sorties de build, les propriétés locales et les clés de signature restent ignorés.

## Environnement de développement

Prérequis :

- Android Studio et ses outils en ligne de commande ;
- SDK Android 36 ;
- NDK installé depuis le SDK Manager ;
- JDK fourni par Android Studio ou Java compatible ;
- Rust avec la cible `aarch64-linux-android` ;
- un appareil avec le débogage USB activé ou un émulateur ARM64.

```bash
rustup target add aarch64-linux-android
pnpm install --frozen-lockfile
pnpm tauri android dev
```

Le projet Android étant déjà initialisé, ne pas exécuter `pnpm tauri android init` après un clonage normal.

## Build APK

```bash
pnpm tauri android build --debug --apk --target aarch64
```

Sous Windows, activer le **Mode développeur** dans `Paramètres → Système → Espace développeurs`. Tauri crée un lien symbolique vers `libtwelia_lib.so` dans `jniLibs` ; sans ce réglage, le build peut échouer avec `Creation symbolic link is not allowed for this system`.

Les APK, AAB, fichiers `local.properties`, keystores et propriétés de signature ne doivent jamais être ajoutés au dépôt.

## Points restant à valider

- persistance et suppression du coffre sur davantage de versions Android ;
- reprise après mise en veille prolongée et pression mémoire ;
- consommation mémoire avec plusieurs sessions simultanées ;
- clavier physique, lecteurs d’écran et appareils pliables ;
- procédure de signature et de distribution d’une version release.

Le fonctionnement constaté sur un appareil ne constitue pas une garantie pour tous les constructeurs ou toutes les versions d’Android.
