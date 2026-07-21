# `@twelia/mod-sdk`

SDK local pour développer un mod compatible avec le contrat Twelia v1.

Le guide complet se trouve dans [Développer un mod Twelia](../../docs/mods.md).

## Contenu

Le paquet fournit :

- les types TypeScript de `manifest.json` et de l’objet global `twelia` ;
- `defineMod`, un helper léger pour organiser `load` et `unload` ;
- `manifest.schema.json`, le schéma JSON strict du manifeste v1 ;
- `createTestRuntime`, un runtime en mémoire pour les tests Node.

Le SDK ne remplace pas le runtime Twelia et ne donne aucun accès natif supplémentaire.

## Installation locale

Dans le projet du mod :

```json
{
  "devDependencies": {
    "@twelia/mod-sdk": "file:C:/chemin/vers/Twelia/packages/mod-sdk"
  }
}
```

Puis installer les dépendances avec le gestionnaire de paquets du projet.

## Utiliser les types

```ts
import { defineMod } from "@twelia/mod-sdk";

export default defineMod({
  load(api) {
    api.log.info(`Session ${api.session.id}`);
    api.ui.mount({
      id: "hello",
      title: "Exemple",
      components: [{ type: "text", text: "Le mod est chargé", tone: "success" }],
    });
  },
});
```

Twelia ne résout pas les imports externes dans `dist/main.js`. Le SDK et les autres dépendances
utilisées par le code source doivent être intégrés au bundle final. Ne pas externaliser
`@twelia/mod-sdk` lors du build.

## Manifeste strict

Le type `ModManifest` et `manifest.schema.json` suivent les mêmes règles principales que le
validateur Rust.

`capabilities` est toujours obligatoire :

```json
{
  "schemaVersion": 1,
  "id": "dev.example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "dist/main.js",
  "capabilities": []
}
```

Aucune capacité n’est déduite. `network` et `game-entry` doivent correspondre exactement à leur
configuration associée.

## Runtime de test

La sous-entrée `@twelia/mod-sdk/testing` simule l’API sans lancer Twelia :

```ts
import { createTestRuntime } from "@twelia/mod-sdk/testing";

const runtime = createTestRuntime({
  session: { id: "test-session", accountId: "test-account" },
  settings: { greeting: "Bonjour" },
  storage: { launches: 2 },
});

const uninstall = runtime.install();
runtime.api.on("load", () => runtime.api.log.info("Runtime chargé"));

await runtime.emit("load", {});
await runtime.emit("session.ready", runtime.api.session);

console.assert(runtime.logs.length > 0);
console.assert(runtime.storage.get("launches") === 2);

uninstall();
```

Dans un test de mod réel, installer le runtime avant d’importer le bundle afin que celui-ci trouve
`globalThis.twelia`, puis déclencher les événements attendus avec `emit`.

Le résultat expose :

- `api`, l’objet `twelia` simulé ;
- `emit`, pour publier un événement ;
- `logs`, `panels`, `commands` et `storage`, pour vérifier les effets ;
- `install`, pour installer temporairement `globalThis.twelia`.

Les options permettent d’injecter des doubles pour HTTP, les fichiers, les secrets, le jeu et les
autres services externes.

## Validation et surveillance

Depuis la racine du dépôt Twelia :

```text
pnpm mod validate <dossier-du-mod>
pnpm mod dev <dossier-du-mod>
```

- `validate` vérifie le manifeste et les fichiers d’entrée ;
- `dev` relance la validation à chaque modification ;
- le rechargement du runtime reste explicite depuis la page Mods de Twelia.
