# Développer un mod Twelia

Ce document décrit le contrat public **v1** des mods Twelia. Il explique comment créer, tester et
faire fonctionner un mod sans dépendre des détails internes de l’application.

L’API v1 est stricte : Twelia ne complète pas un manifeste ambigu et n’accorde aucune capacité
implicitement. Un paquet invalide est refusé avant le démarrage de son code.

## Modèle d’exécution

Un mod est un paquet local contenant au minimum un `manifest.json` et un fichier JavaScript.

Pour chaque session de jeu, Twelia crée une instance séparée du mod :

```text
mod A + session 1 → runtime QuickJS 1
mod A + session 2 → runtime QuickJS 2
mod B + session 1 → runtime QuickJS 3
```

Deux comptes ne partagent donc ni variables JavaScript, ni minuteurs, ni état temporaire. Les
données persistantes et les secrets sont également isolés par mod et par compte.

Le paquet peut contenir deux types de scripts :

- `main.js` s’exécute dans QuickJS. Il contient la logique, les réglages, l’interface déclarative,
  le stockage et les appels vers les services Twelia. Il n’a accès ni à React, ni au DOM, ni aux
  objets internes du client du jeu ;
- `game.js` est facultatif et s’exécute directement dans la vue du jeu. Il est réservé aux besoins
  qui ne peuvent pas être couverts par l’API générique. Il dispose des mêmes accès que la page du
  jeu et demande donc la capacité sensible `game-entry`.

Un mod devrait rester entièrement dans `main.js` tant qu’il n’a pas un besoin précis de
`gameEntry`.

## Activer l’environnement de mods

Les mods sont désactivés par défaut.

1. Ouvrir les paramètres généraux de Twelia et activer l’exécution des mods.
2. Revenir à l’accueil et ouvrir la page **Mods**.
3. Créer un projet ou installer manuellement un paquet dans le dossier local des mods.
4. Activer le mod dans la page **Mods**.
5. Ouvrir une session de jeu. Une instance du mod sera créée pour cette session.

La page **Mods** permet aussi de modifier les réglages déclaratifs, d’ouvrir les fichiers du projet
et de recharger toutes les instances actives d’un mod. Le panneau latéral d’une session permet de
charger ou décharger ponctuellement une instance, d’afficher ses logs et de rendre son interface.

## Premier mod : un compteur de session

Cet exemple est volontairement neutre. Il affiche un message et conserve un compteur propre à
chaque compte. Il n’utilise ni réseau, ni `gameEntry`, ni permission particulière.

### Arborescence

```text
dev.example.counter/
├── manifest.json
└── dist/
    └── main.js
```

### Manifeste

```json
{
  "schemaVersion": 1,
  "id": "dev.example.counter",
  "name": "Compteur de session",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "dist/main.js",
  "capabilities": [],
  "settings": {
    "message": {
      "type": "string",
      "label": "Message",
      "default": "Bonjour depuis Twelia"
    },
    "step": {
      "type": "number",
      "label": "Incrément",
      "default": 1,
      "minimum": 1,
      "maximum": 10,
      "step": 1
    }
  },
  "description": "Un exemple minimal d’interface et de stockage local",
  "author": "Example"
}
```

Le tableau `capabilities` est obligatoire, même lorsqu’il est vide.

### Script principal

```js
let count = twelia.storage.get("count", 0);

function render(settings = twelia.settings.get()) {
  twelia.ui.update({
    id: "counter",
    title: "Compteur",
    components: [
      { type: "text", id: "message", text: settings.message, tone: "info" },
      { type: "text", id: "value", text: `Valeur : ${count}`, style: "heading" },
      {
        type: "row",
        children: [
          { type: "button", id: "increment", label: "+ Ajouter", variant: "primary" },
          { type: "button", id: "reset", label: "Réinitialiser", variant: "ghost" },
        ],
      },
    ],
  });
}

twelia.on("load", () => {
  twelia.log.info(`Compteur chargé pour la session ${twelia.session.id}`);
  render();
});

twelia.on("ui.action", ({ panelId, actionId }) => {
  if (panelId !== "counter") return;

  const settings = twelia.settings.get();
  if (actionId === "increment") count += settings.step;
  if (actionId === "reset") count = 0;

  twelia.storage.set("count", count);
  twelia.ui.patch("counter", { "value.text": `Valeur : ${count}` });
});

twelia.settings.onChange((settings) => render(settings));
```

Après avoir modifié `main.js`, utiliser **Recharger les instances** dans la page Mods.

## Le manifeste v1

Le manifeste est validé avant toute exécution. Les champs inconnus sont refusés.

### Champs principaux

| Champ              | Requis | Rôle                                                                 |
| ------------------ | ------ | -------------------------------------------------------------------- |
| `schemaVersion`    | oui    | Version du format de manifeste. Vaut `1`.                            |
| `id`               | oui    | Identifiant stable en minuscules, par exemple `dev.example.counter`. |
| `name`             | oui    | Nom affiché dans Twelia.                                             |
| `version`          | oui    | Version SemVer du mod.                                               |
| `apiVersion`       | oui    | Version de l’API demandée. Vaut `1`.                                 |
| `entry`            | oui    | Chemin relatif vers le JavaScript QuickJS.                           |
| `capabilities`     | oui    | Liste explicite des capacités accordées. Utiliser `[]` si aucune.    |
| `gameEntry`        | non    | Chemin relatif vers le script injecté dans la vue du jeu.            |
| `network`          | non    | Origines HTTPS autorisées pour les requêtes réseau.                  |
| `settings`         | non    | Réglages rendus et validés par Twelia.                               |
| `description`      | non    | Résumé du mod.                                                       |
| `author`           | non    | Auteur ou organisation.                                              |
| `homepage`         | non    | Page HTTPS du projet.                                                |
| `repository`       | non    | Dépôt HTTPS du projet.                                               |
| `license`          | non    | Identifiant ou nom de licence.                                       |
| `minTweliaVersion` | non    | Version minimale de Twelia au format SemVer stable.                  |

Les chemins d’entrée doivent rester dans le paquet, utiliser `/`, désigner un fichier `.js` normal
et ne contenir ni chemin absolu, ni `.` ou `..`, ni lien symbolique. Chaque entrée est limitée à
2 Mio.

### Capacités

Les capacités sont plates : il n’existe ni niveau, ni rôle, ni mode de confiance intermédiaire.

| Capacité              | API accordée                 | Configuration associée                              |
| --------------------- | ---------------------------- | --------------------------------------------------- |
| `network`             | `twelia.http`                | `network` doit contenir au moins une origine HTTPS. |
| `notifications`       | `twelia.notifications`       | Aucune.                                             |
| `clipboard.write`     | `twelia.clipboard.writeText` | Aucune.                                             |
| `files.user-selected` | `twelia.files`               | L’utilisateur choisit chaque fichier.               |
| `secrets`             | `twelia.secrets`             | Requise aussi pour un réglage de type `secret`.     |
| `game-entry`          | Injection de `gameEntry`     | `gameEntry` doit être présent.                      |

Les relations sont strictes et bidirectionnelles :

- déclarer `network` sans origine est une erreur ;
- fournir des origines sans la capacité `network` est une erreur ;
- déclarer `game-entry` sans `gameEntry` est une erreur ;
- fournir `gameEntry` sans la capacité `game-entry` est une erreur.

Le runtime expose exactement cette liste dans `twelia.capabilities` :

```js
if (twelia.capabilities.has("notifications")) {
  await twelia.notifications.show("Extension prête", "Le mod est chargé.");
}
```

## Cycle de vie et événements

Le module est évalué une fois au démarrage de chaque instance. Twelia émet ensuite :

1. `load` lorsque le runtime est initialisé ;
2. `session.ready` lorsque la session associée est disponible ;
3. éventuellement `session.suspended`, `session.resumed` ou `session.reloaded` ;
4. `unload` avant l’arrêt normal de l’instance.

`session.ready` contient `sessionId` et `accountId`. Les autres événements de cycle de vie ne
transportent actuellement aucune donnée.

```js
const stopListening = twelia.on("session.ready", ({ sessionId, accountId }) => {
  twelia.log.info(`Session ${sessionId}, compte ${accountId}`);
});

twelia.on("unload", stopListening, { once: true });
```

Un gestionnaire peut renvoyer une promesse. Une erreur synchrone ou asynchrone est envoyée dans les
logs du mod sans arrêter automatiquement les autres gestionnaires.

Les options `{ once: true }` et `{ signal }` permettent respectivement une écoute unique et une
désinscription contrôlée. La fonction renvoyée par `twelia.on` désinscrit immédiatement le
gestionnaire.

L’objet `twelia.api` expose la version du contrat, la version du runtime Twelia et les fonctionnalités
disponibles. Un mod peut ainsi vérifier une fonctionnalité avant de l’utiliser sans tester des
objets internes.

## Logs

```js
twelia.log.debug("Détail de diagnostic");
twelia.log.info("Initialisation terminée");
twelia.log.warn("Configuration incomplète");
twelia.log.error("Opération impossible");
```

Les logs sont associés au mod et à la session. Ils apparaissent dans le panneau latéral de la vue de
jeu. Les retours à la ligne sont neutralisés et un message est limité à 4 096 caractères. Le tampon
conserve au plus 1 000 entrées.

Ne jamais écrire un secret, un jeton ou le contenu sensible d’un fichier dans les logs.

## Réglages déclaratifs

Les réglages sont définis dans `manifest.json`, rendus dans la page Mods et validés côté Rust.

Types disponibles :

- `boolean` avec un `default` booléen facultatif ;
- `string` avec `default` et `placeholder` facultatifs ;
- `number` avec `default`, `minimum`, `maximum`, `step` et `placeholder` facultatifs ;
- `select` avec une liste non vide `options` et un `default` facultatif ;
- `secret`, sans valeur par défaut et avec la capacité `secrets`.

```js
const settings = twelia.settings.get();

const unsubscribe = twelia.settings.onChange((nextSettings) => {
  twelia.log.info(`Nouveau mode : ${nextSettings.mode}`);
});

twelia.on("unload", unsubscribe, { once: true });
```

Les réglages ordinaires sont communs à toutes les instances du mod. Les secrets ne sont jamais
retournés par `twelia.settings` : ils sont propres au compte et passent par `twelia.secrets`.

## Données persistantes

`twelia.storage` conserve des valeurs JSON par couple `(mod, compte)`.

```js
const preferences = twelia.storage.get("preferences", { compact: false });

twelia.storage.set("preferences", { ...preferences, compact: true });
twelia.storage.setMany({ lastView: "summary", launches: 4 });

const values = twelia.storage.getMany(["lastView", "launches"]);
twelia.storage.remove("lastView");
```

Une transaction remplace l’ensemble de l’instantané de manière atomique :

```js
twelia.storage.transaction((data) => {
  data.launches = (data.launches ?? 0) + 1;
  data.lastOpenedAt = new Date().toISOString();
});
```

Les migrations font évoluer le format des données sans enregistrer un état intermédiaire :

```js
twelia.storage.migrate(2, {
  1(data) {
    data.preferences ??= { compact: false };
  },
  2(data) {
    data.launches ??= 0;
  },
});
```

Une exception dans une transaction ou une migration conserve l’ancien document. `quota()` retourne
le nombre de clés et d’octets utilisés ainsi que les limites correspondantes.

Limites actuelles : 32 clés, 32 Kio par valeur et 256 Kio pour le document complet.

## Secrets

Avec la capacité `secrets`, un mod peut stocker une chaîne dans le trousseau sécurisé du système :

```js
const token = twelia.secrets.get("service-token");

if (!token) {
  twelia.secrets.set("service-token", "valeur-fournie-par-l-utilisateur");
}

twelia.secrets.remove("service-token");
```

Un secret est isolé par mod et par compte, limité à 8 Kio et supprimé avec les données locales du
compte. Le stockage JSON, l’interface des réglages et les logs ne reçoivent jamais automatiquement
sa valeur.

## Interface déclarative

Un runtime QuickJS ne manipule pas React ou le DOM. Il transmet un arbre JSON à Twelia :

- `twelia.ui.mount(panel)` crée un panneau ;
- `twelia.ui.update(panel)` remplace un panneau existant ;
- `twelia.ui.patch(panelId, changes)` modifie quelques propriétés ;
- `twelia.ui.unmount(panelId)` retire un panneau.

Les composants interactifs émettent `ui.action` avec `panelId`, `actionId` et `value`.

### Composants disponibles

| Composant           | Usage                                |
| ------------------- | ------------------------------------ |
| `section`, `row`    | Organisation des enfants.            |
| `collapsible`       | Section repliable.                   |
| `text`, `badge`     | Texte et statut non interactifs.     |
| `button`            | Action sans valeur.                  |
| `input`, `textarea` | Valeur textuelle.                    |
| `select`            | Valeur d’une option déclarée.        |
| `switch`            | Valeur booléenne.                    |
| `number`, `slider`  | Valeur numérique.                    |
| `progress`          | Progression comprise entre 0 et 100. |
| `table`             | Tableau de valeurs JSON primitives.  |
| `separator`         | Séparation visuelle.                 |

Les champs `id` doivent être uniques dans un panneau. Ils servent à la fois d’identifiants d’action
et de cibles pour `ui.patch` :

```js
twelia.ui.patch("status", {
  "message.text": "Synchronisation terminée",
  "message.tone": "success",
  "retry.disabled": true,
  "progress.value": 100,
});
```

Twelia refuse les types, champs et valeurs inconnus. Le HTML arbitraire et les gestionnaires
JavaScript intégrés au JSON ne sont jamais rendus.

Une instance peut publier jusqu’à 8 panneaux. Un panneau est limité à 64 Kio, 100 composants et une
profondeur de 4 niveaux. Un `select` accepte au plus 50 options ; une table accepte au plus 12
colonnes et 100 lignes.

## Minuteurs

```js
const timeout = twelia.time.setTimeout(() => {
  twelia.log.info("Délai terminé");
}, 500);

const interval = twelia.time.setInterval(async () => {
  await twelia.time.sleep(100);
  twelia.log.debug("État périodique vérifié");
}, 5_000);

await twelia.time.sleep(250);

twelia.time.clearTimeout(timeout);
twelia.time.clearInterval(interval);
```

Une instance peut avoir au plus 64 minuteurs actifs. Un délai doit être un entier compris entre 50
et 60 000 ms. Un intervalle attend la fin de son callback asynchrone avant de programmer
l’itération suivante, ce qui évite les chevauchements.

## Requêtes HTTP

La capacité `network` et une liste d’origines sont obligatoires :

```json
{
  "capabilities": ["network"],
  "network": ["https://api.example.com"]
}
```

Le chemin, la requête et les paramètres peuvent varier, mais l’origine doit correspondre exactement
à une entrée du manifeste :

```js
const response = await twelia.http.request({
  method: "GET",
  url: "https://api.example.com/status",
  timeoutMs: 5_000,
});

if (!response.ok) {
  throw new Error(`Service indisponible : HTTP ${response.status}`);
}

const status = JSON.parse(response.body);
```

Seules les méthodes `GET`, `POST`, `PUT`, `PATCH`, `DELETE` et `HEAD` sont acceptées. Les
redirections sont désactivées. Une requête est limitée à 64 Kio, une réponse à 256 Kio et 32
en-têtes. Le délai HTTP doit rester entre 500 et 30 000 ms.

Les en-têtes sensibles ou contrôlés par le transport, comme `Cookie`, `Host` et `Content-Length`,
sont refusés. Les réponses binaires ne sont pas prises en charge par cette première version.

`twelia.request(service, payload, options)` est la primitive asynchrone utilisée par les services
natifs. Pour les services intégrés, préférer les wrappers typés `twelia.http`,
`twelia.notifications`, `twelia.clipboard` et `twelia.files`. Une instance peut maintenir au plus
16 requêtes natives actives. Le délai par défaut est de 10 secondes ; les erreurs utilisent
notamment les codes `REQUEST_TIMEOUT`, `REQUEST_ABORTED` et `REQUEST_FAILED`.

## Services de plateforme

### Notifications

```js
await twelia.notifications.show("Tâche terminée", "Le traitement local est terminé.");
```

Demande la capacité `notifications`. Le titre est limité à 120 caractères et le corps à 500.

### Presse-papiers

```js
await twelia.clipboard.writeText("Texte copié par le mod");
```

Demande `clipboard.write`. L’API permet uniquement l’écriture : un mod ne peut pas lire le
presse-papiers.

### Fichiers choisis par l’utilisateur

```js
const selected = await twelia.files.pickText();
if (!selected.cancelled) {
  twelia.log.info(`Document sélectionné : ${selected.name}`);
}

await twelia.files.saveText("notes.txt", "Contenu à enregistrer");
```

Demande `files.user-selected`. Twelia ouvre toujours un sélecteur natif. Le mod reçoit le nom et le
contenu UTF-8, jamais un accès général au disque ni le chemin choisi. Un fichier est limité à 1 Mio.

## Commandes et raccourcis

Un mod peut enregistrer des actions dans la palette de commandes Twelia :

```js
const unregister = twelia.commands.register({
  id: "show-summary",
  title: "Afficher le résumé",
  description: "Ouvre le panneau principal du mod",
  shortcut: "Ctrl+Shift+U",
  execute() {
    twelia.log.info("Résumé demandé depuis la palette de commandes");
  },
});

twelia.on("unload", unregister, { once: true });
```

Les identifiants sont propres à l’instance. Un raccourci contient zéro ou plusieurs modificateurs et
exactement une touche principale. Les modificateurs reconnus sont `Ctrl`, `Meta`, `Alt` et `Shift`.
Une instance peut enregistrer au plus 32 commandes. Elles sont automatiquement retirées à son arrêt.

## Communication entre sessions

Les instances d’un même mod peuvent échanger un objet JSON localement :

```js
twelia.group.broadcast({ type: "theme.changed", theme: "compact" });

twelia.on("group.message", ({ fromSessionId, fromAccountId, message }) => {
  twelia.log.debug(`Message de ${fromSessionId} pour le compte ${fromAccountId}`);
  if (message.type === "theme.changed" && typeof message.theme === "string") {
    twelia.storage.set("theme", message.theme);
  }
});
```

L’émetteur ne reçoit pas son propre message. Un mod ne peut communiquer qu’avec ses propres
instances ; il ne peut ni contacter un autre mod, ni utiliser ce bus pour sortir de Twelia. Un
message est limité à 16 Kio.

## API générique du jeu

`twelia.game` expose uniquement des observations et commandes atomiques validées par Twelia. Cette
API ne choisit aucune stratégie et n’exécute pas de JavaScript arbitraire dans la vue.

Cette API et les `gameEntry` sont actuellement disponibles sur ordinateur uniquement.

### Événements

| Événement          | Contenu principal                                         |
| ------------------ | --------------------------------------------------------- |
| `game.map`         | Carte, cellule du joueur, voisins et acteurs observables. |
| `game.movement`    | État et résultat d’un déplacement.                        |
| `game.fight`       | Phase, tour, combattants, sorts et cellules disponibles.  |
| `game.party-fight` | Informations permettant de rejoindre un combat de groupe. |
| `game.action`      | Résultat ou refus d’une commande atomique.                |

`game.map` fournit notamment `ready`, `mapId`, `subAreaId`, `playerCellId`, `fighting`,
`observedAt`, `neighbours` et `monsters`. `game.fight` fournit les placements possibles pendant la
préparation, les cellules atteignables pendant un tour et la liste des sorts actuellement exposés
par le client.

### Commandes

| Méthode                                 | Effet demandé                                                             |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `observeMap()`                          | Publier un nouvel instantané `game.map`.                                  |
| `moveToCell(cellId)`                    | Utiliser le déplacement normal du client vers une cellule de `0` à `559`. |
| `changeMap(direction)`                  | Changer vers `left`, `right`, `top` ou `bottom`.                          |
| `attackMonster(groupId)`                | Interagir avec un groupe présent sur la carte courante.                   |
| `joinPartyFight(fightId, fighterId)`    | Rejoindre un combat de groupe observable.                                 |
| `observeFight()`                        | Publier un nouvel instantané `game.fight`.                                |
| `setFightPlacement(cellId)`             | Choisir une cellule de préparation autorisée.                             |
| `moveInFight(cellId)`                   | Se déplacer vers une cellule atteignable pendant le tour.                 |
| `castFightSpell(spellId, targetCellId)` | Lancer un sort disponible sur une cellule valide.                         |
| `fightReady()`                          | Confirmer la préparation.                                                 |
| `finishFightTurn()`                     | Terminer le tour courant.                                                 |

Chaque commande est liée à la session du runtime, bornée en fréquence et revérifiée juste avant son
exécution. Le mod doit attendre les événements d’état et de résultat au lieu de supposer qu’une
commande a réussi.

## `gameEntry`, en dernier recours

Un `gameEntry` est nécessaire uniquement lorsqu’une intégration visuelle ou une adaptation du
client n’est pas disponible dans l’API générique.

Extrait de manifeste correspondant :

```json
{
  "entry": "dist/main.js",
  "gameEntry": "dist/game.js",
  "capabilities": ["game-entry"]
}
```

`main.js` et `game.js` communiquent avec des messages JSON :

```js
// main.js
twelia.gameSide.send("overlay.visibility", { visible: true });

twelia.on("game-side.message", ({ type, payload }) => {
  twelia.log.debug(`${type}: ${JSON.stringify(payload)}`);
});
```

```js
// game.js
const dispose = tweliaGame.on("overlay.visibility", ({ visible }) => {
  document.documentElement.dataset.exampleOverlay = String(visible);
});

tweliaGame.emit("overlay.ready", { version: 1 });

tweliaGame.on("unload", () => {
  dispose();
  delete document.documentElement.dataset.exampleOverlay;
});
```

Les événements sont isolés par mod et par session. Leur nom accepte les minuscules, chiffres,
points, tirets et underscores. Un message provenant de `game.js` est limité à 48 Kio et passe par
une file bornée, ordonnée et acquittée. Twelia réinjecte les `gameEntry` actifs après une navigation
ou un rechargement de la vue.

Un `gameEntry` est du code privilégié. Il faut relire intégralement un mod tiers qui en déclare un.

## SDK TypeScript

Le paquet local [`@twelia/mod-sdk`](../packages/mod-sdk/README.md) fournit :

- les types du manifeste et de `twelia` ;
- `defineMod` pour organiser les gestionnaires `load` et `unload` ;
- le schéma JSON strict du manifeste ;
- un runtime de test pour Node.

Le SDK n’est pas chargé par Twelia. Si le code source utilise des imports, il doit être regroupé en
un seul fichier `dist/main.js` avant installation.

```js
import { defineMod } from "@twelia/mod-sdk";

export default defineMod({
  load(api) {
    api.log.info(`API ${api.api.version}, runtime ${api.api.runtimeVersion}`);
  },
  unload() {
    // Nettoyage supplémentaire éventuel.
  },
});
```

## Tester sans lancer Twelia

```js
import { createTestRuntime } from "@twelia/mod-sdk/testing";

const runtime = createTestRuntime({
  session: { id: "test-session", accountId: "test-account" },
  settings: { message: "Test", step: 2 },
});

const uninstall = runtime.install();
await import("../dist/main.js");

await runtime.emit("load", {});
await runtime.emit("session.ready", runtime.api.session);

console.assert(runtime.panels.has("counter"));
uninstall();
```

Le runtime de test conserve les logs, panneaux, commandes et valeurs persistantes en mémoire. Les
services HTTP, fichiers, secrets et jeu peuvent être remplacés par des doubles de test explicites.

## Outils de développement

Depuis la racine du dépôt Twelia :

```text
pnpm mod validate <dossier-du-mod>
pnpm mod dev <dossier-du-mod>
```

`validate` applique les mêmes règles essentielles que Twelia au manifeste, aux capacités, aux
réglages, aux origines réseau et aux fichiers d’entrée.

`dev` surveille récursivement le projet et relance la validation après chaque modification. Il ne
recharge pas silencieusement les runtimes : utiliser ensuite **Recharger les instances** dans
Twelia, afin de conserver un cycle de développement déterministe.

## Limites du runtime

| Ressource                | Limite actuelle      |
| ------------------------ | -------------------- |
| Mémoire QuickJS          | 16 Mio par instance  |
| Pile QuickJS             | 512 Kio              |
| Exécution continue       | 500 ms par opération |
| Initialisation           | 3 secondes           |
| Fichier d’entrée         | 2 Mio                |
| Minuteurs actifs         | 64                   |
| Requêtes natives actives | 16                   |
| Clés de stockage         | 32                   |
| Document de stockage     | 256 Kio              |
| Panneaux UI              | 8 par instance       |
| Commandes                | 32 par instance      |

Ces limites font partie du contrat de sécurité. Un mod doit découper les traitements longs, borner
ses propres files et attendre les événements au lieu d’effectuer une boucle active.

## Diagnostic

Lorsqu’un mod ne démarre pas :

1. exécuter `pnpm mod validate <dossier>` ;
2. vérifier que le nom du dossier correspond exactement à l’`id` du manifeste ;
3. vérifier que chaque capacité possède sa configuration associée ;
4. ouvrir les logs de la session dans le panneau des mods ;
5. recharger l’instance après une modification de `main.js`, `game.js` ou `manifest.json`.

Une erreur lors de l’évaluation du module empêche le démarrage. Une erreur dans un gestionnaire
d’événement est journalisée. Une opération qui dépasse la limite d’exécution peut arrêter le
runtime afin de protéger les autres sessions et l’application principale.
