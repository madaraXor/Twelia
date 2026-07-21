use crate::error::AppError;
use serde::Deserialize;
use serde_json::Value;
#[cfg(test)]
use std::sync::Arc;
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::AppHandle;

const MAX_GAME_EVENT_BYTES: usize = 64 * 1024;
const MAX_GAME_SIDE_MESSAGE_BYTES: usize = 48 * 1024;
const OBSERVE_INTERVAL: Duration = Duration::from_millis(250);
const MOVE_INTERVAL: Duration = Duration::from_millis(750);
const COMBAT_INTERVAL: Duration = Duration::from_millis(250);
const MAX_SAFE_GAME_ID: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModGameCommand {
    ObserveMap,
    MoveToCell(u16),
    ChangeMap(String),
    AttackMonster(i64),
    JoinPartyFight { fight_id: i64, fighter_id: i64 },
    ObserveFight,
    SetFightPlacement(u16),
    MoveInFight(u16),
    CastFightSpell { spell_id: i64, target_cell_id: u16 },
    FightReady,
    FinishFightTurn,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CellPayload {
    cell_id: u16,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectionPayload {
    direction: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MonsterPayload {
    group_id: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PartyFightPayload {
    fight_id: i64,
    fighter_id: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FightSpellPayload {
    spell_id: i64,
    target_cell_id: u16,
}

impl ModGameCommand {
    pub fn parse(name: &str, payload: &str) -> Result<Self, AppError> {
        if payload.len() > 4 * 1024 {
            return Err(AppError::Mods("commande de jeu trop volumineuse".into()));
        }
        match name {
            "observe-map" => {
                require_empty_payload(payload)?;
                Ok(Self::ObserveMap)
            }
            "move-to-cell" => {
                let payload: CellPayload = parse_payload(payload)?;
                if payload.cell_id > 559 {
                    return Err(AppError::Mods(
                        "la cellule cible doit être comprise entre 0 et 559".into(),
                    ));
                }
                Ok(Self::MoveToCell(payload.cell_id))
            }
            "change-map" => {
                let payload: DirectionPayload = parse_payload(payload)?;
                if !matches!(
                    payload.direction.as_str(),
                    "left" | "right" | "top" | "bottom"
                ) {
                    return Err(AppError::Mods(
                        "direction de changement de carte invalide".into(),
                    ));
                }
                Ok(Self::ChangeMap(payload.direction))
            }
            "attack-monster" => {
                let payload: MonsterPayload = parse_payload(payload)?;
                validate_game_id(payload.group_id, "groupe de monstres")?;
                Ok(Self::AttackMonster(payload.group_id))
            }
            "join-party-fight" => {
                let payload: PartyFightPayload = parse_payload(payload)?;
                validate_game_id(payload.fight_id, "combat")?;
                validate_game_id(payload.fighter_id, "combattant")?;
                Ok(Self::JoinPartyFight {
                    fight_id: payload.fight_id,
                    fighter_id: payload.fighter_id,
                })
            }
            "observe-fight" => {
                require_empty_payload(payload)?;
                Ok(Self::ObserveFight)
            }
            "set-fight-placement" => {
                let payload: CellPayload = parse_payload(payload)?;
                validate_cell_id(payload.cell_id)?;
                Ok(Self::SetFightPlacement(payload.cell_id))
            }
            "move-in-fight" => {
                let payload: CellPayload = parse_payload(payload)?;
                validate_cell_id(payload.cell_id)?;
                Ok(Self::MoveInFight(payload.cell_id))
            }
            "cast-fight-spell" => {
                let payload: FightSpellPayload = parse_payload(payload)?;
                validate_game_id(payload.spell_id, "sort")?;
                validate_cell_id(payload.target_cell_id)?;
                Ok(Self::CastFightSpell {
                    spell_id: payload.spell_id,
                    target_cell_id: payload.target_cell_id,
                })
            }
            "fight-ready" => {
                require_empty_payload(payload)?;
                Ok(Self::FightReady)
            }
            "finish-fight-turn" => {
                require_empty_payload(payload)?;
                Ok(Self::FinishFightTurn)
            }
            _ => Err(AppError::Mods(format!("commande de jeu inconnue: {name}"))),
        }
    }

    fn bridge_call(&self) -> (&'static str, Value) {
        match self {
            Self::ObserveMap => ("observeMap", serde_json::json!({})),
            Self::MoveToCell(cell_id) => ("moveToCell", serde_json::json!({ "cellId": cell_id })),
            Self::ChangeMap(direction) => {
                ("changeMap", serde_json::json!({ "direction": direction }))
            }
            Self::AttackMonster(group_id) => {
                ("attackMonster", serde_json::json!({ "groupId": group_id }))
            }
            Self::JoinPartyFight {
                fight_id,
                fighter_id,
            } => (
                "joinPartyFight",
                serde_json::json!({ "fightId": fight_id, "fighterId": fighter_id }),
            ),
            Self::ObserveFight => ("observeFight", serde_json::json!({})),
            Self::SetFightPlacement(cell_id) => (
                "setFightPlacement",
                serde_json::json!({ "cellId": cell_id }),
            ),
            Self::MoveInFight(cell_id) => ("moveInFight", serde_json::json!({ "cellId": cell_id })),
            Self::CastFightSpell {
                spell_id,
                target_cell_id,
            } => (
                "castFightSpell",
                serde_json::json!({
                    "spellId": spell_id,
                    "targetCellId": target_cell_id,
                }),
            ),
            Self::FightReady => ("fightReady", serde_json::json!({})),
            Self::FinishFightTurn => ("finishFightTurn", serde_json::json!({})),
        }
    }

    fn rate_limit(&self) -> Option<(&'static str, Duration)> {
        match self {
            Self::ObserveMap => Some(("observe-map", OBSERVE_INTERVAL)),
            Self::ObserveFight => Some(("observe-fight", OBSERVE_INTERVAL)),
            Self::MoveToCell(_) | Self::ChangeMap(_) => Some(("movement", MOVE_INTERVAL)),
            Self::AttackMonster(_) | Self::JoinPartyFight { .. } => {
                Some(("fight-transition", MOVE_INTERVAL))
            }
            Self::SetFightPlacement(_)
            | Self::MoveInFight(_)
            | Self::CastFightSpell { .. }
            | Self::FightReady
            | Self::FinishFightTurn => Some(("combat", COMBAT_INTERVAL)),
        }
    }
}

pub trait ModGameControl: Send + Sync {
    fn execute(
        &self,
        mod_id: &str,
        session_id: &str,
        command: ModGameCommand,
    ) -> Result<(), AppError>;

    fn install_game_entry(
        &self,
        _mod_id: &str,
        _session_id: &str,
        _source: &str,
    ) -> Result<(), AppError> {
        Err(AppError::Mods(
            "les scripts exécutés dans la vue du jeu ne sont pas disponibles".into(),
        ))
    }

    fn unload_game_entry(&self, _mod_id: &str, _session_id: &str) -> Result<(), AppError> {
        Ok(())
    }

    fn send_game_entry_message(
        &self,
        _mod_id: &str,
        _session_id: &str,
        _event: &str,
        _payload: &str,
    ) -> Result<(), AppError> {
        Err(AppError::Mods(
            "ce mod ne dispose pas d’un script dans la vue du jeu".into(),
        ))
    }
}

#[derive(Default)]
#[cfg(test)]
pub struct UnavailableModGameControl;

#[cfg(test)]
impl ModGameControl for UnavailableModGameControl {
    fn execute(
        &self,
        _mod_id: &str,
        _session_id: &str,
        _command: ModGameCommand,
    ) -> Result<(), AppError> {
        Err(AppError::Mods(
            "le pont entre les mods et le jeu n’est pas disponible".into(),
        ))
    }
}

#[cfg(test)]
pub fn unavailable_game_control() -> Arc<dyn ModGameControl> {
    Arc::new(UnavailableModGameControl)
}

pub struct TauriModGameControl {
    app: AppHandle,
    last_commands: Mutex<HashMap<(String, String, &'static str), Instant>>,
}

impl TauriModGameControl {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            last_commands: Mutex::new(HashMap::new()),
        }
    }

    fn allow_command(
        &self,
        mod_id: &str,
        session_id: &str,
        operation: &'static str,
        interval: Duration,
    ) -> Result<bool, AppError> {
        let mut commands = self
            .last_commands
            .lock()
            .map_err(|_| AppError::Mods("limiteur de commandes de jeu empoisonné".into()))?;
        let key = (mod_id.to_owned(), session_id.to_owned(), operation);
        let now = Instant::now();
        if commands
            .get(&key)
            .is_some_and(|previous| now.duration_since(*previous) < interval)
        {
            return Ok(false);
        }
        commands.insert(key, now);
        Ok(true)
    }

    #[cfg(desktop)]
    fn eval_session(&self, session_id: &str, script: String) -> Result<(), AppError> {
        use tauri::Manager;

        validate_session_id(session_id)?;
        let webview = self
            .app
            .get_webview(&format!("game-{session_id}"))
            .ok_or_else(|| AppError::Mods("vue du jeu introuvable pour cette session".into()))?;
        webview
            .eval(script)
            .map_err(|error| AppError::Mods(format!("commande de jeu impossible: {error}")))
    }

    #[cfg(mobile)]
    fn eval_session(&self, _session_id: &str, _script: String) -> Result<(), AppError> {
        let _ = &self.app;
        Err(AppError::Mods(
            "le contrôle du jeu par les mods est actuellement disponible sur ordinateur uniquement"
                .into(),
        ))
    }
}

impl ModGameControl for TauriModGameControl {
    fn execute(
        &self,
        mod_id: &str,
        session_id: &str,
        command: ModGameCommand,
    ) -> Result<(), AppError> {
        if let Some((operation, interval)) = command.rate_limit()
            && !self.allow_command(mod_id, session_id, operation, interval)?
        {
            if matches!(command, ModGameCommand::ObserveMap) {
                return Ok(());
            }
            return Err(AppError::Mods(
                "les commandes de jeu sont trop rapprochées".into(),
            ));
        }
        let (name, payload) = command.bridge_call();
        let name = serde_json::to_string(name)
            .map_err(|error| AppError::Mods(format!("commande de jeu invalide: {error}")))?;
        self.eval_session(
            session_id,
            format!(
                "(() => {{ const bridge = window.__TWELIA_MOD_GAME_BRIDGE__; if (!bridge) throw new Error('pont de mods indisponible'); bridge.command({name}, {payload}); }})();"
            ),
        )
    }

    fn install_game_entry(
        &self,
        mod_id: &str,
        session_id: &str,
        source: &str,
    ) -> Result<(), AppError> {
        super::manifest::validate_mod_id(mod_id)?;
        let mod_id_json = serde_json::to_string(mod_id)
            .map_err(|error| AppError::Mods(format!("identifiant de mod invalide: {error}")))?;
        let session_json = serde_json::to_string(&serde_json::json!({ "id": session_id }))
            .map_err(|error| AppError::Mods(format!("session de mod invalide: {error}")))?;
        self.eval_session(
            session_id,
            format!(
                r#"(() => {{
  const bridge = window.__TWELIA_MOD_CONTENT_BRIDGE__;
  if (!bridge) throw new Error("pont gameEntry indisponible");
  bridge.install({mod_id_json}, {session_json}, function (tweliaGame) {{
{source}
  }});
}})();
//# sourceURL=twelia-mod/{mod_id}/game.js"#
            ),
        )
    }

    fn unload_game_entry(&self, mod_id: &str, session_id: &str) -> Result<(), AppError> {
        super::manifest::validate_mod_id(mod_id)?;
        let mod_id = serde_json::to_string(mod_id)
            .map_err(|error| AppError::Mods(format!("identifiant de mod invalide: {error}")))?;
        self.eval_session(
            session_id,
            format!("window.__TWELIA_MOD_CONTENT_BRIDGE__?.unload({mod_id});"),
        )
    }

    fn send_game_entry_message(
        &self,
        mod_id: &str,
        session_id: &str,
        event: &str,
        payload: &str,
    ) -> Result<(), AppError> {
        super::manifest::validate_mod_id(mod_id)?;
        validate_game_side_event_name(event)?;
        let payload = validate_game_side_payload(payload)?;
        let mod_id = serde_json::to_string(mod_id)
            .map_err(|error| AppError::Mods(format!("identifiant de mod invalide: {error}")))?;
        let event = serde_json::to_string(event)
            .map_err(|error| AppError::Mods(format!("événement gameEntry invalide: {error}")))?;
        self.eval_session(
            session_id,
            format!(
                "(() => {{ const bridge = window.__TWELIA_MOD_CONTENT_BRIDGE__; if (!bridge) throw new Error('pont gameEntry indisponible'); bridge.dispatch({mod_id}, {event}, {payload}); }})();"
            ),
        )
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModGameSideEvent {
    pub channel_id: u64,
    pub sequence: u64,
    pub mod_id: String,
    pub event: String,
    pub payload: Value,
}

pub fn parse_mod_game_side_event(title: &str) -> Option<ModGameSideEvent> {
    const PREFIX: &str = "__TWELIA_MOD_CONTENT_EVENT__:";
    if title.len() > MAX_GAME_EVENT_BYTES {
        return None;
    }
    let signal = title.strip_prefix(PREFIX)?;
    let mut parts = signal.splitn(6, ':');
    let channel_id = parts.next()?.parse().ok()?;
    let sequence = parts.next()?.parse().ok()?;
    let attempt = parts.next()?;
    let mod_id = parts.next()?;
    let event = parts.next()?;
    let payload = parts.next()?;
    if attempt.is_empty() || !attempt.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    super::manifest::validate_mod_id(mod_id).ok()?;
    validate_game_side_event_name(event).ok()?;
    let payload = validate_game_side_payload(payload).ok()?;
    Some(ModGameSideEvent {
        channel_id,
        sequence,
        mod_id: mod_id.to_owned(),
        event: event.to_owned(),
        payload,
    })
}

pub fn mod_game_side_ready_sequence(title: &str) -> Option<u64> {
    let sequence = title.strip_prefix("__TWELIA_MOD_CONTENT_READY__:")?;
    (!sequence.is_empty() && sequence.chars().all(|character| character.is_ascii_digit()))
        .then(|| sequence.parse().ok())?
}

fn validate_game_side_event_name(event: &str) -> Result<(), AppError> {
    if event.is_empty()
        || event.len() > 80
        || !event.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '.' | '-' | '_')
        })
    {
        return Err(AppError::Mods("nom d’événement gameEntry invalide".into()));
    }
    Ok(())
}

fn validate_game_side_payload(payload: &str) -> Result<Value, AppError> {
    if payload.len() > MAX_GAME_SIDE_MESSAGE_BYTES {
        return Err(AppError::Mods("message gameEntry trop volumineux".into()));
    }
    let payload: Value = serde_json::from_str(payload)
        .map_err(|error| AppError::Mods(format!("message gameEntry invalide: {error}")))?;
    if !payload.is_object() {
        return Err(AppError::Mods(
            "un message gameEntry doit contenir un objet".into(),
        ));
    }
    Ok(payload)
}

pub fn parse_mod_game_event(title: &str) -> Option<(String, Value)> {
    const PREFIX: &str = "__TWELIA_MOD_EVENT__:";
    if title.len() > MAX_GAME_EVENT_BYTES {
        return None;
    }
    let signal = title.strip_prefix(PREFIX)?;
    let mut parts = signal.splitn(3, ':');
    let sequence = parts.next()?;
    let event = parts.next()?;
    let payload = parts.next()?;
    if sequence.is_empty() || !sequence.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    if !matches!(
        event,
        "game.map" | "game.movement" | "game.fight" | "game.party-fight" | "game.action"
    ) {
        return None;
    }
    let payload: Value = serde_json::from_str(payload).ok()?;
    payload.is_object().then(|| (event.to_owned(), payload))
}

fn parse_payload<T: for<'de> Deserialize<'de>>(payload: &str) -> Result<T, AppError> {
    serde_json::from_str(payload)
        .map_err(|error| AppError::Mods(format!("paramètres de commande invalides: {error}")))
}

fn require_empty_payload(payload: &str) -> Result<(), AppError> {
    let payload: serde_json::Map<String, Value> = parse_payload(payload)?;
    if payload.is_empty() {
        Ok(())
    } else {
        Err(AppError::Mods(
            "cette commande de jeu n’accepte aucun paramètre".into(),
        ))
    }
}

fn validate_game_id(value: i64, label: &str) -> Result<(), AppError> {
    if value == 0 || value.unsigned_abs() > MAX_SAFE_GAME_ID as u64 {
        return Err(AppError::Mods(format!("identifiant de {label} invalide")));
    }
    Ok(())
}

fn validate_cell_id(value: u16) -> Result<(), AppError> {
    if value > 559 {
        return Err(AppError::Mods(
            "la cellule cible doit être comprise entre 0 et 559".into(),
        ));
    }
    Ok(())
}

fn validate_session_id(session_id: &str) -> Result<(), AppError> {
    if session_id.is_empty()
        || session_id.len() > 64
        || !session_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err(AppError::Mods("identifiant de session invalide".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_game_events() {
        let (event, payload) = parse_mod_game_event(
            r#"__TWELIA_MOD_EVENT__:12:game.map:{"ready":true,"monsters":[]}"#,
        )
        .unwrap();
        assert_eq!(event, "game.map");
        assert_eq!(payload["ready"], true);
    }

    #[test]
    fn rejects_unknown_or_malformed_game_events() {
        assert!(parse_mod_game_event("ordinary title").is_none());
        assert!(parse_mod_game_event("__TWELIA_MOD_EVENT__:x:game.map:{}").is_none());
        assert!(parse_mod_game_event("__TWELIA_MOD_EVENT__:1:game.secret:{}").is_none());
        assert!(parse_mod_game_event("__TWELIA_MOD_EVENT__:1:game.map:[]").is_none());
    }

    #[test]
    fn validates_session_identifiers() {
        assert!(validate_session_id("117f42b0-a75d-4b47-81d8-04ae8d64d53f").is_ok());
        assert!(validate_session_id("../main").is_err());
    }

    #[test]
    fn validates_scoped_game_commands() {
        assert_eq!(
            ModGameCommand::parse("change-map", r#"{"direction":"left"}"#).unwrap(),
            ModGameCommand::ChangeMap("left".into())
        );
        assert_eq!(
            ModGameCommand::parse("attack-monster", r#"{"groupId":-42}"#).unwrap(),
            ModGameCommand::AttackMonster(-42)
        );
        assert_eq!(
            ModGameCommand::parse("set-fight-placement", r#"{"cellId":123}"#).unwrap(),
            ModGameCommand::SetFightPlacement(123)
        );
        assert_eq!(
            ModGameCommand::parse("move-in-fight", r#"{"cellId":321}"#).unwrap(),
            ModGameCommand::MoveInFight(321)
        );
        assert_eq!(
            ModGameCommand::parse("cast-fight-spell", r#"{"spellId":8139,"targetCellId":365}"#,)
                .unwrap(),
            ModGameCommand::CastFightSpell {
                spell_id: 8139,
                target_cell_id: 365,
            }
        );
        assert!(ModGameCommand::parse("change-map", r#"{"direction":"north"}"#).is_err());
        assert!(ModGameCommand::parse("move-in-fight", r#"{"strategy":"retreat"}"#).is_err());
        assert!(ModGameCommand::parse("cast-fight-spell", r#"{"spellId":123}"#).is_err());
        assert!(ModGameCommand::parse("set-spell-id-overlay", r#"{"enabled":true}"#).is_err());
        assert!(ModGameCommand::parse("raw-script", "{}").is_err());
    }

    #[test]
    fn parses_scoped_game_side_events() {
        let event = parse_mod_game_side_event(
            r#"__TWELIA_MOD_CONTENT_EVENT__:987:4:1:dev.twelia.test:fight.action:{"status":"cast"}"#,
        )
        .unwrap();
        assert_eq!(event.channel_id, 987);
        assert_eq!(event.sequence, 4);
        assert_eq!(event.mod_id, "dev.twelia.test");
        assert_eq!(event.event, "fight.action");
        assert_eq!(event.payload["status"], "cast");
    }

    #[test]
    fn rejects_malformed_game_side_events() {
        assert!(parse_mod_game_side_event("ordinary title").is_none());
        assert!(
            parse_mod_game_side_event(r#"__TWELIA_MOD_CONTENT_EVENT__:987:4:1:Dev.Test:action:{}"#)
                .is_none()
        );
        assert!(
            parse_mod_game_side_event(r#"__TWELIA_MOD_CONTENT_EVENT__:987:4:1:dev.test:UPPER:{}"#)
                .is_none()
        );
        assert!(
            parse_mod_game_side_event(r#"__TWELIA_MOD_CONTENT_EVENT__:987:4:1:dev.test:action:[]"#)
                .is_none()
        );
    }

    #[test]
    fn parses_game_side_ready_signals() {
        assert_eq!(
            mod_game_side_ready_sequence("__TWELIA_MOD_CONTENT_READY__:12"),
            Some(12)
        );
        assert_eq!(
            mod_game_side_ready_sequence("__TWELIA_MOD_CONTENT_READY__:x"),
            None
        );
    }
}
