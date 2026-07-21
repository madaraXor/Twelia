/* global window, document, MutationObserver */
/* eslint-disable no-unused-vars, no-empty */

(function installTweliaAudioBridge() {
  if (window.__TWELIA_AUDIO_BRIDGE__) return;
  window.__TWELIA_AUDIO_BRIDGE__ = true;
  var muted = false;
  var howlerWasMuted;
  var mediaMuteStates = new WeakMap();
  var webAudioGains = [];
  var webAudioContexts = [];
  var webAudioGainByContext = new WeakMap();
  var originalAudioConnect = window.AudioNode && window.AudioNode.prototype.connect;
  var originalAudioDisconnect = window.AudioNode && window.AudioNode.prototype.disconnect;

  function masterGainFor(context) {
    var existing = webAudioGainByContext.get(context);
    if (existing) return existing;
    var master = context.createGain();
    master.gain.value = muted ? 0 : 1;
    webAudioGainByContext.set(context, master);
    webAudioGains.push(master);
    webAudioContexts.push(context);
    originalAudioConnect.call(master, context.destination);
    return master;
  }

  if (originalAudioConnect) {
    window.AudioNode.prototype.connect = function (destination, output, input) {
      if (this.context && destination === this.context.destination) {
        var master = masterGainFor(this.context);
        if (arguments.length >= 3) return originalAudioConnect.call(this, master, output, 0);
        if (arguments.length >= 2) return originalAudioConnect.call(this, master, output);
        return originalAudioConnect.call(this, master);
      }
      return originalAudioConnect.apply(this, arguments);
    };
  }

  if (originalAudioDisconnect) {
    window.AudioNode.prototype.disconnect = function (destination, output, input) {
      if (this.context && destination === this.context.destination) {
        var master = webAudioGainByContext.get(this.context);
        if (master) {
          if (arguments.length >= 3) return originalAudioDisconnect.call(this, master, output, 0);
          if (arguments.length >= 2) return originalAudioDisconnect.call(this, master, output);
          return originalAudioDisconnect.call(this, master);
        }
      }
      return originalAudioDisconnect.apply(this, arguments);
    };
  }

  function applyMutedState() {
    webAudioGains.forEach(function (master) {
      master.gain.value = muted ? 0 : 1;
    });
    if (!muted) {
      webAudioContexts.forEach(function (context) {
        if (context.state === "suspended" && typeof context.resume === "function") {
          context.resume().catch(function () {});
        }
      });
    }
    if (window.Howler && typeof window.Howler.mute === "function") {
      if (muted) {
        if (howlerWasMuted === undefined) howlerWasMuted = Boolean(window.Howler._muted);
        window.Howler.mute(true);
      } else if (howlerWasMuted !== undefined) {
        window.Howler.mute(howlerWasMuted);
        howlerWasMuted = undefined;
      }
    }
    document.querySelectorAll("audio,video").forEach(function (media) {
      if (muted) {
        if (!mediaMuteStates.has(media)) mediaMuteStates.set(media, media.muted);
        media.muted = true;
      } else if (mediaMuteStates.has(media)) {
        media.muted = mediaMuteStates.get(media);
        mediaMuteStates.delete(media);
      }
    });
  }

  window.__TWELIA_SET_MUTED__ = function (nextMuted) {
    muted = Boolean(nextMuted);
    applyMutedState();
  };

  new MutationObserver(applyMutedState).observe(document, { childList: true, subtree: true });
  window.setInterval(applyMutedState, 1000);
})();

(function installTweliaAttentionBridge() {
  if (window.__TWELIA_ATTENTION_BRIDGE__) return;
  window.__TWELIA_ATTENTION_BRIDGE__ = true;
  var sequence = 0;
  var attempts = 0;
  var timer;

  function forward(kind) {
    sequence += 1;
    document.title = "__TWELIA_ATTENTION__:" + kind + ":" + sequence;
  }

  function installListeners() {
    var connection = window.connectionManager;
    var gui = window.gui;
    var playerData = gui && gui.playerData;
    var characters = playerData && playerData.characters;
    if (!connection || typeof connection.on !== "function" || !characters) return false;

    function onTurn(message) {
      if (!message || typeof characters.canControlCharacterId !== "function") return;
      if (characters.canControlCharacterId(message.id)) forward("combat-turn");
    }

    connection.on("GameFightTurnStartMessage", onTurn);
    connection.on("GameFightTurnResumeMessage", onTurn);
    connection.on("GameFightTurnStartSlaveMessage", onTurn);
    connection.on("PartyInvitationMessage", function () {
      forward("party-invitation");
    });
    connection.on("PartyMemberInFightMessage", function (message) {
      var currentGui = window.gui;
      var data = currentGui && currentGui.playerData;
      if (!data || !message || !message.fightMap) return;
      if (data.isFighting && !data.isSpectator) return;
      if (
        data.labyrinthData &&
        typeof data.labyrinthData.isInTheLabyrinth === "function" &&
        data.labyrinthData.isInTheLabyrinth()
      )
        return;
      if (!data.position || data.position.mapId !== message.fightMap.mapId) return;
      forward("group-fight");
    });
    return true;
  }

  function tryInstall() {
    attempts += 1;
    if (installListeners() || attempts >= 1200) window.clearInterval(timer);
  }

  timer = window.setInterval(tryInstall, 250);
  tryInstall();
})();

(function installTweliaShortcutBridge() {
  if (window.__TWELIA_SHORTCUT_BRIDGE__) return;
  window.__TWELIA_SHORTCUT_BRIDGE__ = true;
  window.__TWELIA_SHORTCUTS__ = window.__TWELIA_SHORTCUTS__ || [];
  var sequence = 0;

  function acceleratorFor(event) {
    var parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.metaKey) parts.push("Meta");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    var code =
      event.code === "Comma" ? "Comma" : event.code.replace(/^Key/, "").replace(/^Digit/, "");
    if (!/^(Control|Meta|Alt|Shift)(Left|Right)$/.test(event.code)) parts.push(code);
    return parts.join("+");
  }

  window.addEventListener(
    "keydown",
    function (event) {
      var target = event.target;
      if (
        target &&
        target.closest &&
        target.closest("input, textarea, select, [contenteditable='true']")
      )
        return;
      var accelerator = acceleratorFor(event);
      if (window.__TWELIA_SHORTCUTS__.indexOf(accelerator) === -1) return;
      sequence += 1;
      event.preventDefault();
      event.stopImmediatePropagation();
      document.title = "__TWELIA_SHORTCUT__:" + accelerator + ":" + sequence;
    },
    true,
  );
})();

(function installTweliaModContentBridge() {
  if (window.__TWELIA_MOD_CONTENT_BRIDGE__) return;
  var instances = Object.create(null);
  var outboundQueue = [];
  var channelId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  var nextSequence = 1;
  var retryTimer = null;

  function validEventName(value) {
    return typeof value === "string" && /^[a-z0-9._-]{1,80}$/.test(value);
  }

  function validModId(value) {
    return (
      typeof value === "string" &&
      /^[a-z0-9.-]{1,128}$/.test(value) &&
      value[0] !== "." &&
      value[0] !== "-" &&
      value[value.length - 1] !== "." &&
      value[value.length - 1] !== "-" &&
      value.indexOf("..") === -1
    );
  }

  function utf8Length(value) {
    try {
      return unescape(encodeURIComponent(value)).length;
    } catch (_) {
      return value.length * 4;
    }
  }

  function safePayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("un message gameEntry doit contenir un objet");
    }
    var serialized = JSON.stringify(payload);
    if (utf8Length(serialized) > 48000) {
      throw new RangeError("message gameEntry trop volumineux");
    }
    return serialized;
  }

  function pumpQueue() {
    window.clearTimeout(retryTimer);
    retryTimer = null;
    var item = outboundQueue[0];
    if (!item) return;
    item.attempt += 1;
    document.title =
      "__TWELIA_MOD_CONTENT_EVENT__:" +
      channelId +
      ":" +
      item.sequence +
      ":" +
      item.attempt +
      ":" +
      item.modId +
      ":" +
      item.event +
      ":" +
      item.payload;
    retryTimer = window.setTimeout(pumpQueue, 300);
  }

  function enqueue(modId, event, payload) {
    if (!validModId(modId) || !validEventName(event)) {
      throw new TypeError("identifiant ou événement gameEntry invalide");
    }
    if (outboundQueue.length >= 128) {
      throw new Error("file de messages gameEntry saturée");
    }
    outboundQueue.push({
      sequence: nextSequence++,
      attempt: 0,
      modId: modId,
      event: event,
      payload: safePayload(payload),
    });
    if (outboundQueue.length === 1) pumpQueue();
  }

  function deliver(instance, event, payload) {
    var listeners = (instance.handlers[event] || []).slice();
    listeners.forEach(function (listener) {
      try {
        var result = listener(payload);
        if (result && typeof result.then === "function") {
          result.catch(function (error) {
            enqueue(instance.modId, "log", {
              level: "error",
              message:
                "Handler game.js rejeté (" +
                event +
                ") : " +
                String((error && error.message) || error),
            });
          });
        }
      } catch (error) {
        enqueue(instance.modId, "log", {
          level: "error",
          message:
            "Handler game.js en erreur (" +
            event +
            ") : " +
            String((error && error.message) || error),
        });
      }
    });
  }

  function createApi(instance) {
    function on(event, handler) {
      if (!validEventName(event) || typeof handler !== "function") {
        throw new TypeError("tweliaGame.on attend un événement et une fonction");
      }
      var listeners = instance.handlers[event] || [];
      listeners.push(handler);
      instance.handlers[event] = listeners;
      return function () {
        var current = instance.handlers[event];
        if (!current) return;
        var index = current.indexOf(handler);
        if (index !== -1) current.splice(index, 1);
      };
    }
    function log(level, message) {
      enqueue(instance.modId, "log", {
        level: level,
        message: String(message)
          .replace(/[\r\n]+/g, " ")
          .slice(0, 4096),
      });
    }
    return Object.freeze({
      session: Object.freeze(instance.session),
      on: on,
      emit: function (event, payload) {
        enqueue(instance.modId, String(event), payload || {});
      },
      log: Object.freeze({
        debug: function (message) {
          log("debug", message);
        },
        info: function (message) {
          log("info", message);
        },
        warn: function (message) {
          log("warn", message);
        },
        error: function (message) {
          log("error", message);
        },
      }),
    });
  }

  function unload(modId) {
    var instance = instances[modId];
    if (!instance) return;
    deliver(instance, "unload", {});
    delete instances[modId];
  }

  function install(modId, session, initializer) {
    if (!validModId(modId) || typeof initializer !== "function") {
      throw new TypeError("installation gameEntry invalide");
    }
    unload(modId);
    var instance = {
      modId: modId,
      session: { id: String((session && session.id) || "") },
      handlers: Object.create(null),
    };
    instances[modId] = instance;
    try {
      var result = initializer(createApi(instance));
      if (result && typeof result.then === "function") {
        result.catch(function (error) {
          enqueue(modId, "log", {
            level: "error",
            message:
              "Initialisation game.js rejetée : " + String((error && error.message) || error),
          });
        });
      }
    } catch (error) {
      delete instances[modId];
      enqueue(modId, "log", {
        level: "error",
        message: "Initialisation game.js impossible : " + String((error && error.message) || error),
      });
      throw error;
    }
  }

  function dispatch(modId, event, payload) {
    if (!validEventName(event)) throw new TypeError("événement gameEntry invalide");
    var instance = instances[modId];
    if (!instance) throw new Error("gameEntry du mod non chargé");
    safePayload(payload);
    deliver(instance, event, payload);
  }

  function ack(sequence) {
    var item = outboundQueue[0];
    if (!item || item.sequence !== Number(sequence)) return;
    window.clearTimeout(retryTimer);
    retryTimer = null;
    outboundQueue.shift();
    pumpQueue();
  }

  Object.defineProperty(window, "__TWELIA_MOD_CONTENT_BRIDGE__", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ install: install, unload: unload, dispatch: dispatch, ack: ack }),
  });
  document.title = "__TWELIA_MOD_CONTENT_READY__:" + channelId;
})();

(function installTweliaModGameBridge() {
  if (window.__TWELIA_MOD_GAME_BRIDGE__) return;
  var sequence = 0;
  var connectionListenersInstalled = false;
  var installAttempts = 0;
  var installTimer;
  var snapshotTimer;
  var fightSnapshotTimer;

  function emit(type, payload) {
    var serialized;
    try {
      serialized = JSON.stringify(payload);
    } catch (error) {
      serialized = JSON.stringify({
        status: "failed",
        message: "sérialisation du résultat impossible",
      });
      type = "game.movement";
    }
    if (serialized.length > 60000) return;
    sequence += 1;
    document.title = "__TWELIA_MOD_EVENT__:" + sequence + ":" + type + ":" + serialized;
  }

  function integer(value) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : null;
  }

  function scalar(value) {
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      return value;
    }
    return null;
  }

  function sameId(left, right) {
    return String(left) === String(right);
  }

  function validCellIds(values, limit) {
    var cells = [];
    var seen = Object.create(null);
    Array.from(values || []).some(function (value) {
      var cellId = integer(value);
      if (cellId === null || cellId < 0 || cellId > 559 || seen[cellId]) return false;
      seen[cellId] = true;
      cells.push(cellId);
      return cells.length >= limit;
    });
    return cells;
  }

  function possibleFightPlacements() {
    var foreground = window.foreground;
    return validCellIds(
      foreground && foreground.tapOptions && foreground.tapOptions.possiblePlacements,
      120,
    );
  }

  function reachableFightCells(controlledId, enabled) {
    var engine = window.isoEngine;
    if (!enabled || !engine || typeof engine.displayUserMovementZone !== "function") return [];
    try {
      engine.displayUserMovementZone();
      var cells = (engine._walkAreaLayer && engine._walkAreaLayer.cellInfos) || {};
      return Object.keys(cells)
        .slice(0, 120)
        .map(integer)
        .filter(function (cellId) {
          if (cellId === null || cellId < 0 || cellId > 559) return false;
          var actors =
            (engine.actorManager &&
              engine.actorManager.getActorsOnCell &&
              engine.actorManager.getActorsOnCell(cellId)) ||
            [];
          return !actors.some(function (actor) {
            return !sameId(
              actor && (actor.actorId != null ? actor.actorId : actor.id),
              controlledId,
            );
          });
        });
    } catch (_) {
      return [];
    }
  }

  function monsterMember(light) {
    if (!light) return null;
    var info = light.staticInfos || {};
    var id = integer(light.creatureGenericId);
    var level = integer(info.level);
    var grade = integer(light.grade);
    return {
      id: id,
      name: String(info.nameId || id || "Monstre"),
      level: level,
      grade: grade,
      boss: Boolean(info.isBoss),
      miniBoss: Boolean(info.isMiniBoss),
    };
  }

  function mapSnapshot() {
    var engine = window.isoEngine;
    var manager = window.actorManager;
    var renderer = engine && engine.mapRenderer;
    var map = renderer && renderer.map;
    var user = manager && manager.userActor;
    var playerData = window.gui && window.gui.playerData;
    if (!engine || !manager || !map || !user) {
      return {
        ready: false,
        mapId: null,
        subAreaId: scalar(playerData && playerData.position && playerData.position.subAreaId),
        playerCellId: null,
        fighting: Boolean(playerData && playerData.isFighting),
        neighbours: {},
        monsters: [],
        observedAt: Date.now(),
      };
    }

    var groups = [];
    var actors = manager.actors || {};
    Object.keys(actors).some(function (key) {
      if (groups.length >= 48) return true;
      var actor = actors[key];
      var data = actor && actor.data;
      if (!data || data.type !== "GameRolePlayGroupMonsterInformations") return false;
      var staticInfos = data.staticInfos || {};
      var rawMembers = [];
      if (staticInfos.mainCreatureLightInfos) rawMembers.push(staticInfos.mainCreatureLightInfos);
      if (Array.isArray(staticInfos.underlings)) {
        rawMembers = rawMembers.concat(staticInfos.underlings.slice(0, 15));
      }
      var members = rawMembers.map(monsterMember).filter(Boolean);
      var totalLevel = members.reduce(function (total, member) {
        return total + (member.level || 0);
      }, 0);
      groups.push({
        id: scalar(data.contextualId != null ? data.contextualId : actor.actorId),
        cellId: integer(
          actor.cellId != null ? actor.cellId : data.disposition && data.disposition.cellId,
        ),
        totalLevel: totalLevel,
        members: members,
      });
      return false;
    });
    groups.sort(function (left, right) {
      return (left.cellId || 0) - (right.cellId || 0);
    });

    var neighbours = {};
    ["left", "right", "top", "bottom"].forEach(function (direction) {
      var neighbourId = scalar(map[direction + "NeighbourId"]);
      if (neighbourId != null && neighbourId !== 0) neighbours[direction] = neighbourId;
    });

    return {
      ready: true,
      mapId: scalar(map.id != null ? map.id : renderer.mapId),
      subAreaId: scalar(playerData && playerData.position && playerData.position.subAreaId),
      playerCellId: integer(user.cellId),
      fighting: Boolean(playerData && playerData.isFighting),
      neighbours: neighbours,
      monsters: groups,
      observedAt: Date.now(),
    };
  }

  function observeMap() {
    emit("game.map", mapSnapshot());
  }

  function movement(status, cellId, message, arrivedCellId) {
    emit("game.movement", {
      status: status,
      targetCellId: cellId,
      arrivedCellId: integer(arrivedCellId),
      message: message || null,
      observedAt: Date.now(),
    });
  }

  function moveToCell(value) {
    var cellId = integer(value);
    var engine = window.isoEngine;
    var manager = window.actorManager;
    var user = manager && manager.userActor;
    var playerData = window.gui && window.gui.playerData;
    if (cellId === null || cellId < 0 || cellId > 559) {
      movement("rejected", cellId, "cellule invalide");
      return;
    }
    if (!engine || !manager || !user || typeof engine._movePlayerOnMap !== "function") {
      movement("rejected", cellId, "la carte n’est pas prête");
      return;
    }
    if (playerData && playerData.isFighting) {
      movement("rejected", cellId, "déplacement de carte indisponible en combat");
      return;
    }
    if (user.cellId === cellId) {
      movement("arrived", cellId, "déjà sur cette cellule", cellId);
      observeMap();
      return;
    }
    if (user.moving || engine.isMovementWaitingForConfirmation) {
      movement("rejected", cellId, "un déplacement est déjà en cours");
      return;
    }

    var callbackCalled = false;
    try {
      var destination = engine._movePlayerOnMap(cellId, false, function (error, arrivedCellId) {
        callbackCalled = true;
        if (error) movement("failed", cellId, String(error.message || error));
        else movement("arrived", cellId, null, arrivedCellId);
        observeMap();
      });
      if (destination == null && !callbackCalled) {
        movement("failed", cellId, "aucun chemin accessible");
      } else if (!callbackCalled) {
        movement("requested", cellId, null);
      }
    } catch (error) {
      movement("failed", cellId, String((error && error.message) || error));
    }
  }

  function action(kind, status, message, details) {
    emit("game.action", {
      kind: kind,
      status: status,
      message: message || null,
      details: details || {},
      observedAt: Date.now(),
    });
  }

  function changeMap(payload) {
    var direction = payload && payload.direction;
    var engine = window.isoEngine;
    var renderer = engine && engine.mapRenderer;
    var user = engine && engine.actorManager && engine.actorManager.userActor;
    var playerData = window.gui && window.gui.playerData;
    if (["left", "right", "top", "bottom"].indexOf(direction) === -1) {
      action("change-map", "rejected", "direction invalide");
      return;
    }
    if (
      !engine ||
      !renderer ||
      !renderer.map ||
      !user ||
      typeof engine.gotoNeighbourMap !== "function"
    ) {
      action("change-map", "rejected", "la carte n’est pas prête");
      return;
    }
    if (playerData && playerData.isFighting) {
      action("change-map", "rejected", "changement de carte indisponible en combat");
      return;
    }
    if (user.moving || engine.isMovementWaitingForConfirmation || engine.isMapChanging) {
      action("change-map", "rejected", "une transition est déjà en cours");
      return;
    }
    var neighbourId = renderer.map[direction + "NeighbourId"];
    if (neighbourId == null || Number(neighbourId) === 0) {
      action("change-map", "rejected", "aucune carte voisine dans cette direction");
      return;
    }
    var candidates = [];
    for (var cellId = 0; cellId < 560; cellId += 1) {
      try {
        if (renderer.isWalkable(cellId) && renderer.getFirstMapFlag(cellId) === direction) {
          candidates.push(cellId);
        }
      } catch (_) {}
    }
    if (!candidates.length) {
      action("change-map", "failed", "aucune cellule de sortie accessible");
      return;
    }
    var target = candidates[Math.floor(Math.random() * candidates.length)];
    try {
      action("change-map", "requested", null, {
        direction: direction,
        targetCellId: target,
        neighbourMapId: scalar(neighbourId),
      });
      engine.gotoNeighbourMap(direction, target, 0, 0);
    } catch (error) {
      action("change-map", "failed", String((error && error.message) || error));
    }
  }

  function attackMonster(payload) {
    var groupId = integer(payload && payload.groupId);
    var engine = window.isoEngine;
    var actor = engine && engine.actorManager && engine.actorManager.actors[groupId];
    var playerData = window.gui && window.gui.playerData;
    if (!engine || typeof engine.attackActor !== "function" || !actor) {
      action("attack-monster", "rejected", "groupe de monstres introuvable");
      return;
    }
    if (playerData && playerData.isFighting) {
      action("attack-monster", "rejected", "un combat est déjà actif");
      return;
    }
    if (!actor.data || actor.data.type !== "GameRolePlayGroupMonsterInformations") {
      action("attack-monster", "rejected", "la cible n’est pas un groupe de monstres");
      return;
    }
    try {
      action("attack-monster", "requested", null, {
        groupId: groupId,
        cellId: integer(actor.cellId),
      });
      engine.attackActor(groupId);
    } catch (error) {
      action("attack-monster", "failed", String((error && error.message) || error));
    }
  }

  function joinPartyFight(payload) {
    var fightId = integer(payload && payload.fightId);
    var fighterId = integer(payload && payload.fighterId);
    var manager = window.gui && window.gui.fightManager;
    var playerData = window.gui && window.gui.playerData;
    if (!manager || typeof manager.joinSpectator !== "function" || !fightId || !fighterId) {
      action("join-party-fight", "rejected", "invitation de combat invalide");
      return;
    }
    if (playerData && playerData.isFighting && !playerData.isSpectator) {
      action("join-party-fight", "rejected", "ce personnage combat déjà");
      return;
    }
    try {
      manager.joinSpectator(fightId, fighterId);
      action("join-party-fight", "requested", null, { fightId: fightId, fighterId: fighterId });
    } catch (error) {
      action("join-party-fight", "failed", String((error && error.message) || error));
    }
  }

  function fightSnapshot() {
    var gui = window.gui;
    var playerData = gui && gui.playerData;
    var manager = gui && gui.fightManager;
    var characters = playerData && playerData.characters;
    var controlledId = characters && integer(characters.controlledCharacterId);
    var fighting = Boolean(playerData && playerData.isFighting && manager && manager.isInFight());
    if (!fighting) {
      return {
        active: false,
        preparation: false,
        battle: false,
        isMyTurn: false,
        currentFighterId: null,
        controlledFighterId: controlledId,
        fighters: [],
        spells: [],
        possiblePlacements: [],
        reachableCells: [],
        observedAt: Date.now(),
      };
    }

    var preparation = Boolean(manager.isInFightPreparation && manager.isInFightPreparation());
    var battle = Boolean(manager.isInBattle && manager.isInBattle());
    var isMyTurn = Boolean(
      characters &&
      characters.canControlCharacterId &&
      characters.canControlCharacterId(manager.currentFighterId) &&
      window.foreground &&
      window.foreground.fightIsUserTurn,
    );

    var fighters = [];
    var available =
      typeof manager.getAvailableFighters === "function" ? manager.getAvailableFighters() : {};
    Object.keys(available || {}).some(function (key) {
      if (fighters.length >= 32) return true;
      var fighter = available[key];
      var data = (fighter && fighter.data) || {};
      var stats = data.stats || {};
      var actor =
        window.actorManager &&
        window.actorManager.getActor &&
        window.actorManager.getActor(fighter.id);
      fighters.push({
        id: scalar(fighter.id),
        cellId: integer(actor && actor.cellId),
        ally: Boolean(manager.isFighterOnUsersTeam && manager.isFighterOnUsersTeam(fighter.id)),
        alive: data.alive !== false,
        lifePoints: integer(stats.lifePoints),
        maxLifePoints: integer(stats.maxLifePoints),
        actionPoints: integer(stats.actionPoints),
        movementPoints: integer(stats.movementPoints),
      });
      return false;
    });

    var spells = [];
    var controlled =
      characters && characters.getControlledCharacter && characters.getControlledCharacter();
    var spellData = controlled && controlled.spellData;
    var spellList =
      spellData &&
      spellData.getSpellListDependingOnGameMode &&
      spellData.getSpellListDependingOnGameMode();
    Object.keys(spellList || {}).some(function (key) {
      if (spells.length >= 48) return true;
      var spell = spellList[key];
      if (!spell) return false;
      var id = integer(spell.id);
      if (id == null) id = integer(key);
      // The client stores the equipped weapon in the spell collection under ID 0.
      // It is not a castable spell and the native mod API intentionally rejects it.
      if (id == null || id <= 0) return false;
      var level = integer(spell.level);
      var status = null;
      try {
        status = integer(
          typeof spellData.getSpellStatus === "function"
            ? spellData.getSpellStatus(id)
            : spellData._spellsStatus && spellData._spellsStatus[key],
        );
      } catch (_) {
        status = integer(spellData._spellsStatus && spellData._spellsStatus[key]);
      }
      // Status 0 is an internal/unavailable entry, not a spell exposed to the player.
      if (status === 0) return false;
      function property(name) {
        try {
          return integer(spell.getProperty(name, level));
        } catch (_) {
          return null;
        }
      }
      var disabled = Boolean(spell.isDisabled);
      spells.push({
        id: id,
        name: String(typeof spell.getName === "function" ? spell.getName() : id),
        level: level,
        status: status,
        usable: !disabled && (status == null || status === 2),
        disabled: disabled,
        position: integer(spell.position),
        spellLevelId: integer(spell.spellLevel && spell.spellLevel.id),
        apCost: property("apCost"),
        minRange: property("minRange"),
        range: property("range"),
      });
      return false;
    });

    return {
      active: true,
      preparation: preparation,
      battle: battle,
      currentFighterId: scalar(manager.currentFighterId),
      isMyTurn: isMyTurn,
      controlledFighterId: controlledId,
      fighters: fighters,
      spells: spells,
      possiblePlacements: preparation ? possibleFightPlacements() : [],
      reachableCells: reachableFightCells(controlledId, battle && isMyTurn),
      observedAt: Date.now(),
    };
  }

  function observeFight() {
    emit("game.fight", fightSnapshot());
  }

  function setFightPlacement(payload) {
    var cellId = integer(payload && payload.cellId);
    var snapshot = fightSnapshot();
    var engine = window.isoEngine;
    var foreground = window.foreground;
    if (cellId === null || cellId < 0 || cellId > 559) {
      action("set-fight-placement", "rejected", "cellule de placement invalide");
      return;
    }
    if (!snapshot.active || !snapshot.preparation || !engine || !foreground) {
      action("set-fight-placement", "rejected", "le combat nâ€™est pas en phase de placement", {
        cellId: cellId,
      });
      return;
    }
    if (snapshot.possiblePlacements.indexOf(cellId) === -1) {
      action(
        "set-fight-placement",
        "rejected",
        "cette cellule de placement nâ€™est pas disponible",
        {
          cellId: cellId,
          possiblePlacementCount: snapshot.possiblePlacements.length,
        },
      );
      return;
    }
    var actor =
      engine.actorManager &&
      engine.actorManager.getActor &&
      engine.actorManager.getActor(snapshot.controlledFighterId);
    actor = actor || (engine.actorManager && engine.actorManager.userActor);
    var currentCellId = integer(actor && actor.cellId);
    if (currentCellId === cellId) {
      action("set-fight-placement", "skipped", "la cellule de dÃ©part actuelle est conservÃ©e", {
        cellId: cellId,
        fromCellId: currentCellId,
      });
      return;
    }
    var occupants =
      (engine.actorManager &&
        engine.actorManager.getActorsOnCell &&
        engine.actorManager.getActorsOnCell(cellId)) ||
      [];
    if (occupants.length) {
      action("set-fight-placement", "rejected", "cette cellule de placement est occupÃ©e", {
        cellId: cellId,
      });
      return;
    }
    try {
      if (typeof engine._tapFightPlacement === "function") {
        engine._tapFightPlacement(0, 0, { cell: cellId }, foreground.tapOptions);
      } else if (window.dofus && typeof window.dofus.sendMessage === "function") {
        window.dofus.sendMessage("GameFightPlacementPositionRequestMessage", { cellId: cellId });
      } else {
        throw new Error("commande native de placement introuvable");
      }
      action("set-fight-placement", "requested", null, {
        fromCellId: currentCellId,
        targetCellId: cellId,
      });
      scheduleFightSnapshot();
    } catch (error) {
      action("set-fight-placement", "failed", String((error && error.message) || error), {
        cellId: cellId,
      });
    }
  }

  function moveInFight(payload) {
    var cellId = integer(payload && payload.cellId);
    var snapshot = fightSnapshot();
    var engine = window.isoEngine;
    if (cellId === null || cellId < 0 || cellId > 559) {
      action("move-in-fight", "rejected", "cellule de combat invalide");
      return;
    }
    if (
      !snapshot.active ||
      !snapshot.battle ||
      !snapshot.isMyTurn ||
      !engine ||
      typeof engine._displayPathInFight !== "function" ||
      typeof engine._tapFight !== "function"
    ) {
      action("move-in-fight", "rejected", "ce nâ€™est pas le tour de ce personnage", {
        cellId: cellId,
      });
      return;
    }
    var controlled = snapshot.fighters.find(function (fighter) {
      return sameId(fighter.id, snapshot.controlledFighterId);
    });
    var fromCellId = integer(controlled && controlled.cellId);
    if (fromCellId === cellId) {
      action("move-in-fight", "skipped", "le personnage est dÃ©jÃ  sur cette cellule", {
        cellId: cellId,
      });
      return;
    }
    if (snapshot.reachableCells.indexOf(cellId) === -1) {
      action("move-in-fight", "rejected", "cette cellule nâ€™est pas accessible pendant ce tour", {
        cellId: cellId,
        reachableCellCount: snapshot.reachableCells.length,
      });
      return;
    }
    try {
      var path = engine._displayPathInFight(cellId);
      if (!path || !Array.isArray(path.reachable) || path.reachable.indexOf(cellId) === -1) {
        action("move-in-fight", "rejected", "aucun chemin de combat valide", { cellId: cellId });
        return;
      }
      var confirmBox = window.foreground && window.foreground.confirmBox;
      var staleConfirmationClosed = Boolean(confirmBox && confirmBox.isOpen);
      if (staleConfirmationClosed && typeof confirmBox.close === "function") confirmBox.close();
      engine._tapFight(0, 0, { cell: cellId });
      var confirmationOpened = Boolean(confirmBox && confirmBox.isOpen);
      if (confirmationOpened) engine._tapFight(0, 0, { cell: cellId });
      var confirmationStillOpen = Boolean(confirmBox && confirmBox.isOpen);
      if (confirmationStillOpen) {
        if (typeof confirmBox.close === "function") confirmBox.close();
        if (typeof engine._resetWalkLayer === "function") engine._resetWalkLayer();
        action(
          "move-in-fight",
          "failed",
          "la confirmation du dÃ©placement nâ€™a pas pu Ãªtre validÃ©e",
          {
            targetCellId: cellId,
          },
        );
        return;
      }
      action("move-in-fight", "requested", null, {
        fromCellId: fromCellId,
        targetCellId: cellId,
        pathLength: path.reachable.length,
        movementPointCost: integer(path.costMP),
        confirmationAutoValidated: confirmationOpened,
      });
      scheduleFightSnapshot();
    } catch (error) {
      if (engine && typeof engine._resetWalkLayer === "function") engine._resetWalkLayer();
      action("move-in-fight", "failed", String((error && error.message) || error), {
        cellId: cellId,
      });
    }
  }

  function castFightSpell(payload) {
    var spellId = integer(payload && payload.spellId);
    var targetCellId = integer(payload && payload.targetCellId);
    var snapshot = fightSnapshot();
    var manager = window.gui && window.gui.fightManager;
    var foreground = window.foreground;
    var engine = window.isoEngine;
    if (
      spellId === null ||
      spellId <= 0 ||
      targetCellId === null ||
      targetCellId < 0 ||
      targetCellId > 559
    ) {
      action("cast-fight-spell", "rejected", "sort ou cellule cible invalide", {
        spellId: spellId,
        targetCellId: targetCellId,
      });
      return;
    }
    if (
      !snapshot.active ||
      !snapshot.battle ||
      !snapshot.isMyTurn ||
      !manager ||
      !foreground ||
      !engine
    ) {
      action("cast-fight-spell", "rejected", "ce nâ€™est pas le tour de ce personnage", {
        spellId: spellId,
      });
      return;
    }
    var controlled = snapshot.fighters.find(function (fighter) {
      return sameId(fighter.id, snapshot.controlledFighterId);
    });
    var spellSnapshot = snapshot.spells.find(function (spell) {
      return spell.id === spellId;
    });
    if (
      !controlled ||
      !spellSnapshot ||
      !spellSnapshot.usable ||
      (spellSnapshot.apCost != null &&
        controlled.actionPoints != null &&
        controlled.actionPoints < spellSnapshot.apCost)
    ) {
      action("cast-fight-spell", "rejected", "sort indisponible", {
        spellId: spellId,
        actionPoints: controlled && controlled.actionPoints,
        apCost: spellSnapshot && spellSnapshot.apCost,
      });
      return;
    }
    try {
      foreground.selectSpell(snapshot.controlledFighterId, spellId);
      var range = (engine._spellRangeLayer && engine._spellRangeLayer.cellInfos) || {};
      if (
        !range[targetCellId] ||
        (typeof engine.isOutsight === "function" && engine.isOutsight(targetCellId))
      ) {
        foreground.deselectSpell();
        action("cast-fight-spell", "rejected", "la cellule cible nâ€™est pas Ã  portÃ©e", {
          spellId: spellId,
          targetCellId: targetCellId,
          rangeCellCount: Object.keys(range).length,
        });
        return;
      }
      manager.castSpell(spellId, targetCellId, snapshot.controlledFighterId);
      foreground.deselectSpell();
      action("cast-fight-spell", "cast", null, {
        spellId: spellId,
        targetCellId: targetCellId,
        apCost: spellSnapshot.apCost,
        actionPointsBefore: controlled.actionPoints,
      });
      scheduleFightSnapshot();
    } catch (error) {
      try {
        foreground.deselectSpell();
      } catch (_) {}
      action("cast-fight-spell", "failed", String((error && error.message) || error), {
        spellId: spellId,
        targetCellId: targetCellId,
      });
    }
  }

  function fightReady() {
    var manager = window.gui && window.gui.fightManager;
    if (!manager || !manager.isInFightPreparation || !manager.isInFightPreparation()) {
      action("fight-ready", "rejected", "le combat n’est pas en préparation");
      return;
    }
    window.dofus.sendMessage("GameFightReadyMessage", { isReady: true });
    action("fight-ready", "requested");
  }

  function finishFightTurn() {
    var snapshot = fightSnapshot();
    var manager = window.gui && window.gui.fightManager;
    if (!snapshot.active || !snapshot.battle || !snapshot.isMyTurn || !manager) {
      action("finish-fight-turn", "rejected", "ce n’est pas le tour de ce personnage");
      return;
    }
    if (manager.getIsTurnEndRequestPending && manager.getIsTurnEndRequestPending()) {
      action("finish-fight-turn", "skipped", "la fin du tour est déjà demandée");
      return;
    }
    manager.finishTurn();
    action("finish-fight-turn", "requested");
  }

  function command(name, payload) {
    switch (name) {
      case "observeMap":
        return observeMap();
      case "moveToCell":
        return moveToCell(payload && payload.cellId);
      case "changeMap":
        return changeMap(payload);
      case "attackMonster":
        return attackMonster(payload);
      case "joinPartyFight":
        return joinPartyFight(payload);
      case "observeFight":
        return observeFight();
      case "setFightPlacement":
        return setFightPlacement(payload);
      case "moveInFight":
        return moveInFight(payload);
      case "castFightSpell":
        return castFightSpell(payload);
      case "fightReady":
        return fightReady();
      case "finishFightTurn":
        return finishFightTurn();
      default:
        throw new Error("commande du pont inconnue");
    }
  }

  function scheduleSnapshot() {
    window.clearTimeout(snapshotTimer);
    snapshotTimer = window.setTimeout(observeMap, 120);
  }

  function scheduleFightSnapshot() {
    window.clearTimeout(fightSnapshotTimer);
    fightSnapshotTimer = window.setTimeout(observeFight, 180);
  }

  function installConnectionListeners() {
    if (connectionListenersInstalled) return true;
    var connection = window.connectionManager;
    if (!connection || typeof connection.on !== "function") return false;
    [
      "CurrentMapMessage",
      "MapComplementaryInformationsDataMessage",
      "MapComplementaryInformationsDataInHouseMessage",
      "MapComplementaryInformationsWithCoordsMessage",
      "MapComplementaryInformationsWithObstacleOverride",
      "GameRolePlayShowActorMessage",
      "GameRolePlayShowActorListMessage",
      "GameContextRemoveElementMessage",
      "GameContextRemoveMultipleElementsMessage",
      "GameMapMovementMessage",
    ].forEach(function (event) {
      connection.on(event, scheduleSnapshot);
    });
    [
      "GameFightJoinMessage",
      "GameFightStartMessage",
      "GameFightTurnStartMessage",
      "GameFightTurnStartPlayingMessage",
      "GameFightTurnResumeMessage",
      "GameFightTurnStartSlaveMessage",
      "GameFightTurnEndMessage",
      "GameFightEndMessage",
      "GameActionFightSpellCastMessage",
      "GameFightRefreshFighterMessage",
      "GameMapMovementMessage",
    ].forEach(function (event) {
      connection.on(event, scheduleFightSnapshot);
    });
    connection.on("PartyMemberInFightMessage", function (message) {
      emit("game.party-fight", {
        fightId: scalar(message && message.fightId),
        fighterId: scalar(message && message.memberId),
        memberName: String((message && message.memberName) || ""),
        mapId: scalar(message && message.fightMap && message.fightMap.mapId),
        secondsBeforeFightStart: integer(message && message.secondsBeforeFightStart),
        observedAt: Date.now(),
      });
    });
    connectionListenersInstalled = true;
    scheduleSnapshot();
    scheduleFightSnapshot();
    return true;
  }

  function tryInstallListeners() {
    installAttempts += 1;
    if (installConnectionListeners() || installAttempts >= 1200) {
      window.clearInterval(installTimer);
    }
  }

  window.__TWELIA_MOD_GAME_BRIDGE__ = Object.freeze({
    command: command,
    observeMap: observeMap,
    moveToCell: moveToCell,
  });
  installTimer = window.setInterval(tryInstallListeners, 250);
  tryInstallListeners();
})();
