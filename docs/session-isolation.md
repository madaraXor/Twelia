# Isolation des sessions

État vérifié le 12 juillet 2026.

## Garanties déjà implémentées

Chaque `accountId` est validé côté Rust et ne peut contenir que des caractères ASCII alphanumériques, `-` ou `_`. Twelia crée ensuite :

```text
accounts/<accountId>/
├── cache/
├── runtime/
├── logs/
└── temp/
```

Le gestionnaire refuse une seconde session active pour le même compte. Les métadonnées JSON ne contiennent aucun secret ; les sessions opaques sont placées dans un coffre distinct. La suppression d’un profil efface le secret de session puis l’espace local validé. Des tests Rust couvrent l’isolation des chemins et la traversée de répertoire.

## Matrice Tauri/WebView

| Plateforme | Primitive Tauri 2 étudiée                                                                                                                | Décision Twelia                                                                                                           | Validation actuelle                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Windows    | `WebviewOptions.dataDirectory` permet un répertoire de données distinct                                                                  | Une webview enfant par compte utilise `accounts/<id>/runtime/webview` et s’affiche dans la zone de son onglet             | Validé en compilation                                        |
| Linux      | Répertoire runtime Twelia séparé ; le comportement exact dépend de WebKitGTK                                                             | Prototype nécessaire avant activation                                                                                     | Non testé                                                    |
| macOS      | `dataDirectory` n’est pas disponible ; `dataStoreIdentifier` nécessite macOS 14+                                                         | Utiliser un identifiant de data store lorsque disponible, sinon refuser de promettre l’isolation complète                 | Non testé                                                    |
| Android    | Les sessions s’affichent dans des iframes du WebView principal, chacune sur un sous-domaine persistant `profile-<id>.localhost` distinct | Séparer nativement cookies, localStorage, IndexedDB et Cache Storage par profil, tout en conservant un seul WebView Tauri | Implémenté, validation multi-compte sur appareil à compléter |
| iOS        | Hors cible MVP, mais `dataStoreIdentifier` existe à partir d’iOS 17                                                                      | Aucun engagement                                                                                                          | Non testé                                                    |

Sources : [API WebView Tauri 2](https://v2.tauri.app/reference/javascript/api/namespacewebview/) et [permissions WebView](https://v2.tauri.app/reference/acl/core-permissions/).

## Stockage sécurisé

Sur desktop, `SystemSecureSessionStore` utilise le gestionnaire d’identifiants natif choisi par `keyring` : Credential Manager sous Windows, Keychain sous macOS et Secret Service sous Linux. Sur Android, l’implémentation ciblée utilise `android-native-keyring-store`, qui chiffre un `SharedPreferences` avec une clé Android Keystore.

Le coffre Android a été compilé et exécuté sur un appareil réel. Les scénarios instrumentés de migration, d’expiration et de suppression sur plusieurs versions Android restent à compléter.

## Cycle de vie

- L’onglet actif peut rendre et recevoir les actions utilisateur.
- Lors d’un changement d’onglet, une session `running` devient `suspended` si l’option est active.
- Quand le document passe en arrière-plan, toutes les sessions `running` sont suspendues.
- Une session masquée reste montée. Lorsque les changements automatiques d’onglet sont activés, Twelia demande au runtime de continuer son activité en arrière-plan afin de détecter les événements du jeu.
- La restauration reconstruit d’abord l’interface ; les runtimes ne sont créés qu’ensuite.

## Chargement réel

Sous Windows, le serveur local lié uniquement à `127.0.0.1` sert le runtime à une webview enfant de la fenêtre principale. React synchronise sa position et sa taille avec toute la zone située sous la barre d’onglets ; changer d’onglet masque la webview sans perdre sa session. Chaque profil conserve son propre dossier WebView2. Les demandes `window.open` d’Ankama Connect créent une fenêtre d’authentification séparée qui partage explicitement l’environnement WebView2 de la session : le callback conserve ainsi son lien avec la page appelante, tandis que le jeu reste dans son onglet.

Sur Android, le runtime est servi à une iframe plein écran. Chaque session reçoit une origine locale distincte sous `localhost`, ce qui empêche deux profils de partager les stockages web ou les cookies associés au runtime. L’authentification s’ouvre dans le navigateur système et revient dans l’application par lien profond. Cette isolation par origine n’est pas la même primitive que les dossiers WebView2 distincts de Windows ; elle doit donc rester couverte par des tests multi-compte sur appareil réel. Linux et macOS restent à prototyper avant de promettre le même niveau de support.
