# Mode diagnostic

Le diagnostic frontend est désactivé par défaut en production. Il peut être activé dans `Paramètres > Performances`, ou en développement avec `VITE_TWELIA_DEBUG=1`.

Les événements ont un niveau `TRACE`, `DEBUG`, `INFO`, `WARN` ou `ERROR`, un horodatage ISO, un module et un contexte de corrélation. Les identifiants de compte sont remplacés par une référence locale non réversible pour l’usage courant.

Le backend expose un diagnostic système nettoyé comprenant version, plateforme, architecture, système, chemins, mémoire approximative, sessions, état du coffre et taille du client. La version WebView reste `null` plutôt que d’être devinée.

Avant affichage ou export :

- les clés contenant password, token, cookie, secret ou authorization sont remplacées ;
- les jetons Bearer/JWT et valeurs sensibles présentes dans un message sont masqués ;
- les adresses e-mail sont anonymisées ;
- aucun contenu du coffre n’est exporté ;
- aucune donnée permettant de rejouer une session n’est retournée par la commande de statut.

Le diagnostic ne modifie pas le client, le trafic ou la mémoire du jeu. Il ne permet aucune injection, falsification ou extraction de secret.
