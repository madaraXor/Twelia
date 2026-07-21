use crate::error::AppError;
use serde::Serialize;
use serde_json::{Map, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

const MAX_PANEL_JSON_BYTES: usize = 64 * 1024;
const MAX_PANELS_PER_INSTANCE: usize = 8;
const MAX_COMPONENTS_PER_PANEL: usize = 100;
const MAX_COMPONENT_DEPTH: usize = 4;
const MAX_OPTIONS_PER_SELECT: usize = 50;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUiPanelSnapshot {
    pub mod_id: String,
    pub session_id: String,
    pub id: String,
    pub title: String,
    pub components: Vec<Value>,
    pub revision: u64,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct ModUiPanelKey {
    mod_id: String,
    session_id: String,
    panel_id: String,
}

#[derive(Debug)]
struct ModUiPanelRecord {
    snapshot: ModUiPanelSnapshot,
    actions: HashSet<String>,
}

#[derive(Debug, Default)]
pub struct ModUiStore {
    panels: Mutex<HashMap<ModUiPanelKey, ModUiPanelRecord>>,
    next_revision: AtomicU64,
}

impl ModUiStore {
    pub fn mount(&self, mod_id: &str, session_id: &str, payload: &str) -> Result<(), AppError> {
        if payload.len() > MAX_PANEL_JSON_BYTES {
            return Err(ui_error("interface trop volumineuse"));
        }
        let value: Value = serde_json::from_str(payload)
            .map_err(|error| ui_error(format!("interface JSON invalide: {error}")))?;
        let panel = object(&value, "interface")?;
        allowed_fields(panel, &["id", "title", "components"], "interface")?;
        let id = required_string(panel, "id", 64, "interface")?;
        validate_identifier(&id, "identifiant d’interface")?;
        let title = required_string(panel, "title", 80, "interface")?;
        let components = panel
            .get("components")
            .and_then(Value::as_array)
            .ok_or_else(|| ui_error("components doit être un tableau"))?;
        let mut component_count = 0;
        let mut actions = HashSet::new();
        let mut component_ids = HashSet::new();
        validate_components(
            components,
            0,
            &mut component_count,
            &mut actions,
            &mut component_ids,
        )?;

        let key = ModUiPanelKey {
            mod_id: mod_id.to_owned(),
            session_id: session_id.to_owned(),
            panel_id: id.clone(),
        };
        let mut panels = self
            .panels
            .lock()
            .map_err(|_| ui_error("verrou des interfaces de mods empoisonné"))?;
        if !panels.contains_key(&key)
            && panels
                .keys()
                .filter(|candidate| {
                    candidate.mod_id == mod_id && candidate.session_id == session_id
                })
                .count()
                >= MAX_PANELS_PER_INSTANCE
        {
            return Err(ui_error("trop d’interfaces pour ce mod"));
        }
        let revision = self.next_revision.fetch_add(1, Ordering::Relaxed) + 1;
        panels.insert(
            key,
            ModUiPanelRecord {
                snapshot: ModUiPanelSnapshot {
                    mod_id: mod_id.to_owned(),
                    session_id: session_id.to_owned(),
                    id,
                    title,
                    components: components.clone(),
                    revision,
                },
                actions,
            },
        );
        Ok(())
    }

    pub fn unmount(&self, mod_id: &str, session_id: &str, panel_id: &str) -> Result<(), AppError> {
        validate_identifier(panel_id, "identifiant d’interface")?;
        self.panels
            .lock()
            .map_err(|_| ui_error("verrou des interfaces de mods empoisonné"))?
            .remove(&ModUiPanelKey {
                mod_id: mod_id.to_owned(),
                session_id: session_id.to_owned(),
                panel_id: panel_id.to_owned(),
            });
        Ok(())
    }

    pub fn clear_instance(&self, mod_id: &str, session_id: &str) {
        if let Ok(mut panels) = self.panels.lock() {
            panels.retain(|key, _| key.mod_id != mod_id || key.session_id != session_id);
        }
    }

    pub fn list(&self, session_id: &str) -> Vec<ModUiPanelSnapshot> {
        let mut panels = self
            .panels
            .lock()
            .map(|panels| {
                panels
                    .values()
                    .filter(|panel| panel.snapshot.session_id == session_id)
                    .map(|panel| panel.snapshot.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        panels.sort_by(|left, right| {
            left.mod_id
                .cmp(&right.mod_id)
                .then_with(|| left.id.cmp(&right.id))
        });
        panels
    }

    pub fn validate_action(
        &self,
        mod_id: &str,
        session_id: &str,
        panel_id: &str,
        action_id: &str,
    ) -> Result<(), AppError> {
        validate_identifier(panel_id, "identifiant d’interface")?;
        validate_identifier(action_id, "identifiant d’action")?;
        let panels = self
            .panels
            .lock()
            .map_err(|_| ui_error("verrou des interfaces de mods empoisonné"))?;
        let panel = panels
            .get(&ModUiPanelKey {
                mod_id: mod_id.to_owned(),
                session_id: session_id.to_owned(),
                panel_id: panel_id.to_owned(),
            })
            .ok_or_else(|| ui_error("interface de mod introuvable"))?;
        if !panel.actions.contains(action_id) {
            return Err(ui_error("action inconnue pour cette interface"));
        }
        Ok(())
    }
}

fn validate_components(
    components: &[Value],
    depth: usize,
    count: &mut usize,
    actions: &mut HashSet<String>,
    component_ids: &mut HashSet<String>,
) -> Result<(), AppError> {
    if depth > MAX_COMPONENT_DEPTH {
        return Err(ui_error("interface trop profondément imbriquée"));
    }
    for component in components {
        *count += 1;
        if *count > MAX_COMPONENTS_PER_PANEL {
            return Err(ui_error("interface contenant trop de composants"));
        }
        validate_component(component, depth, count, actions, component_ids)?;
    }
    Ok(())
}

fn validate_component(
    value: &Value,
    depth: usize,
    count: &mut usize,
    actions: &mut HashSet<String>,
    component_ids: &mut HashSet<String>,
) -> Result<(), AppError> {
    let component = object(value, "composant")?;
    if let Some(id) = component.get("id").and_then(Value::as_str) {
        validate_identifier(id, "identifiant de composant")?;
        if !component_ids.insert(id.to_owned()) {
            return Err(ui_error("identifiant de composant dupliqué"));
        }
    }
    let kind = required_string(component, "type", 24, "composant")?;
    match kind.as_str() {
        "section" => {
            allowed_fields(component, &["type", "id", "title", "children"], "section")?;
            optional_identifier(component, "section")?;
            optional_string(component, "title", 80, "section")?;
            let children = component
                .get("children")
                .and_then(Value::as_array)
                .ok_or_else(|| ui_error("children doit être un tableau"))?;
            validate_components(children, depth + 1, count, actions, component_ids)
        }
        "row" => {
            allowed_fields(component, &["type", "id", "children"], "row")?;
            optional_identifier(component, "row")?;
            let children = component
                .get("children")
                .and_then(Value::as_array)
                .ok_or_else(|| ui_error("children doit être un tableau"))?;
            validate_components(children, depth + 1, count, actions, component_ids)
        }
        "text" => {
            allowed_fields(component, &["type", "id", "text", "style", "tone"], "texte")?;
            optional_identifier(component, "texte")?;
            required_string(component, "text", 2_000, "texte")?;
            optional_enum(
                component,
                "style",
                &["body", "heading", "caption", "code"],
                "texte",
            )?;
            optional_tone(component, "texte")
        }
        "badge" => {
            allowed_fields(component, &["type", "id", "text", "tone"], "badge")?;
            optional_identifier(component, "badge")?;
            required_string(component, "text", 80, "badge")?;
            optional_tone(component, "badge")
        }
        "button" => {
            allowed_fields(
                component,
                &["type", "id", "label", "variant", "disabled"],
                "bouton",
            )?;
            register_action(component, actions, "bouton")?;
            required_string(component, "label", 80, "bouton")?;
            optional_enum(
                component,
                "variant",
                &["primary", "secondary", "danger", "ghost"],
                "bouton",
            )?;
            optional_bool(component, "disabled", "bouton")
        }
        "input" => {
            allowed_fields(
                component,
                &["type", "id", "label", "value", "placeholder", "disabled"],
                "champ",
            )?;
            register_action(component, actions, "champ")?;
            optional_string(component, "label", 80, "champ")?;
            optional_string(component, "value", 512, "champ")?;
            optional_string(component, "placeholder", 128, "champ")?;
            optional_bool(component, "disabled", "champ")
        }
        "textarea" => {
            allowed_fields(
                component,
                &["type", "id", "label", "value", "placeholder", "disabled"],
                "zone de texte",
            )?;
            register_action(component, actions, "zone de texte")?;
            optional_string(component, "label", 80, "zone de texte")?;
            optional_multiline_string(component, "value", 16_000, "zone de texte")?;
            optional_multiline_string(component, "placeholder", 256, "zone de texte")?;
            optional_bool(component, "disabled", "zone de texte")
        }
        "select" => {
            allowed_fields(
                component,
                &["type", "id", "label", "value", "options", "disabled"],
                "sélection",
            )?;
            register_action(component, actions, "sélection")?;
            optional_string(component, "label", 80, "sélection")?;
            optional_string(component, "value", 128, "sélection")?;
            optional_bool(component, "disabled", "sélection")?;
            let options = component
                .get("options")
                .and_then(Value::as_array)
                .ok_or_else(|| ui_error("options doit être un tableau"))?;
            if options.len() > MAX_OPTIONS_PER_SELECT {
                return Err(ui_error("sélection contenant trop d’options"));
            }
            for option in options {
                let option = object(option, "option")?;
                allowed_fields(option, &["value", "label"], "option")?;
                required_string(option, "value", 128, "option")?;
                required_string(option, "label", 128, "option")?;
            }
            Ok(())
        }
        "switch" => {
            allowed_fields(
                component,
                &["type", "id", "label", "value", "disabled"],
                "interrupteur",
            )?;
            register_action(component, actions, "interrupteur")?;
            required_string(component, "label", 80, "interrupteur")?;
            optional_bool(component, "value", "interrupteur")?;
            optional_bool(component, "disabled", "interrupteur")
        }
        "number" | "slider" => {
            let label = if kind == "slider" {
                "curseur"
            } else {
                "nombre"
            };
            allowed_fields(
                component,
                &[
                    "type",
                    "id",
                    "label",
                    "value",
                    "minimum",
                    "maximum",
                    "step",
                    "placeholder",
                    "disabled",
                ],
                label,
            )?;
            register_action(component, actions, label)?;
            optional_string(component, "label", 80, label)?;
            optional_string(component, "placeholder", 128, label)?;
            optional_bool(component, "disabled", label)?;
            let value = optional_number(component, "value", label)?;
            let minimum = optional_number(component, "minimum", label)?;
            let maximum = optional_number(component, "maximum", label)?;
            let step = optional_number(component, "step", label)?;
            if minimum.zip(maximum).is_some_and(|(min, max)| min > max)
                || step.is_some_and(|step| step <= 0.0)
                || value.is_some_and(|value| {
                    minimum.is_some_and(|minimum| value < minimum)
                        || maximum.is_some_and(|maximum| value > maximum)
                })
            {
                return Err(ui_error(format!("bornes invalides pour {label}")));
            }
            Ok(())
        }
        "progress" => {
            allowed_fields(component, &["type", "id", "label", "value"], "progression")?;
            optional_identifier(component, "progression")?;
            optional_string(component, "label", 80, "progression")?;
            let value = optional_number(component, "value", "progression")?.unwrap_or(0.0);
            if !(0.0..=100.0).contains(&value) {
                return Err(ui_error("la progression doit être comprise entre 0 et 100"));
            }
            Ok(())
        }
        "collapsible" => {
            allowed_fields(
                component,
                &["type", "id", "title", "open", "children"],
                "section repliable",
            )?;
            optional_identifier(component, "section repliable")?;
            required_string(component, "title", 80, "section repliable")?;
            optional_bool(component, "open", "section repliable")?;
            let children = component
                .get("children")
                .and_then(Value::as_array)
                .ok_or_else(|| ui_error("children doit être un tableau"))?;
            validate_components(children, depth + 1, count, actions, component_ids)
        }
        "table" => {
            allowed_fields(component, &["type", "columns", "rows"], "tableau")?;
            let columns = component
                .get("columns")
                .and_then(Value::as_array)
                .ok_or_else(|| ui_error("tableau.columns doit être un tableau"))?;
            let rows = component
                .get("rows")
                .and_then(Value::as_array)
                .ok_or_else(|| ui_error("tableau.rows doit être un tableau"))?;
            if columns.is_empty() || columns.len() > 12 || rows.len() > 100 {
                return Err(ui_error("dimensions de tableau invalides"));
            }
            let mut column_keys = HashSet::new();
            for column in columns {
                let column = object(column, "colonne")?;
                allowed_fields(column, &["key", "label"], "colonne")?;
                let key = required_string(column, "key", 64, "colonne")?;
                validate_identifier(&key, "identifiant de colonne")?;
                required_string(column, "label", 80, "colonne")?;
                if !column_keys.insert(key) {
                    return Err(ui_error("identifiant de colonne dupliqué"));
                }
            }
            for row in rows {
                let row = object(row, "ligne")?;
                if row.keys().any(|key| !column_keys.contains(key))
                    || row.values().any(|value| {
                        !value.is_null()
                            && !value.is_string()
                            && !value.is_number()
                            && !value.is_boolean()
                    })
                {
                    return Err(ui_error("ligne de tableau invalide"));
                }
            }
            Ok(())
        }
        "separator" => {
            allowed_fields(component, &["type"], "séparateur")?;
            Ok(())
        }
        _ => Err(ui_error(format!("type de composant inconnu: {kind}"))),
    }
}

fn register_action(
    component: &Map<String, Value>,
    actions: &mut HashSet<String>,
    label: &str,
) -> Result<(), AppError> {
    let id = required_string(component, "id", 64, label)?;
    validate_identifier(&id, "identifiant d’action")?;
    if !actions.insert(id) {
        return Err(ui_error("identifiant d’action dupliqué"));
    }
    Ok(())
}

fn object<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>, AppError> {
    value
        .as_object()
        .ok_or_else(|| ui_error(format!("{label} doit être un objet")))
}

fn allowed_fields(
    object: &Map<String, Value>,
    allowed: &[&str],
    label: &str,
) -> Result<(), AppError> {
    if let Some(field) = object
        .keys()
        .find(|field| !allowed.contains(&field.as_str()))
    {
        return Err(ui_error(format!("champ inconnu dans {label}: {field}")));
    }
    Ok(())
}

fn required_string(
    object: &Map<String, Value>,
    field: &str,
    max_chars: usize,
    label: &str,
) -> Result<String, AppError> {
    let value = object
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| ui_error(format!("{label}.{field} doit être une chaîne")))?;
    if value.is_empty() || value.chars().count() > max_chars || value.chars().any(char::is_control)
    {
        return Err(ui_error(format!("{label}.{field} est invalide")));
    }
    Ok(value.to_owned())
}

fn optional_string(
    object: &Map<String, Value>,
    field: &str,
    max_chars: usize,
    label: &str,
) -> Result<(), AppError> {
    let Some(value) = object.get(field) else {
        return Ok(());
    };
    let value = value
        .as_str()
        .ok_or_else(|| ui_error(format!("{label}.{field} doit être une chaîne")))?;
    if value.chars().count() > max_chars || value.chars().any(char::is_control) {
        return Err(ui_error(format!("{label}.{field} est invalide")));
    }
    Ok(())
}

fn optional_multiline_string(
    object: &Map<String, Value>,
    field: &str,
    max_chars: usize,
    label: &str,
) -> Result<(), AppError> {
    let Some(value) = object.get(field) else {
        return Ok(());
    };
    let value = value
        .as_str()
        .ok_or_else(|| ui_error(format!("{label}.{field} doit être une chaîne")))?;
    if value.chars().count() > max_chars
        || value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(ui_error(format!("{label}.{field} est invalide")));
    }
    Ok(())
}

fn optional_bool(object: &Map<String, Value>, field: &str, label: &str) -> Result<(), AppError> {
    if object.get(field).is_some_and(|value| !value.is_boolean()) {
        return Err(ui_error(format!("{label}.{field} doit être un booléen")));
    }
    Ok(())
}

fn optional_number(
    object: &Map<String, Value>,
    field: &str,
    label: &str,
) -> Result<Option<f64>, AppError> {
    let Some(value) = object.get(field) else {
        return Ok(None);
    };
    value
        .as_f64()
        .filter(|value| value.is_finite())
        .map(Some)
        .ok_or_else(|| ui_error(format!("{label}.{field} doit être un nombre fini")))
}

fn optional_identifier(object: &Map<String, Value>, label: &str) -> Result<(), AppError> {
    let Some(value) = object.get("id") else {
        return Ok(());
    };
    let value = value
        .as_str()
        .ok_or_else(|| ui_error(format!("{label}.id doit être une chaîne")))?;
    validate_identifier(value, &format!("identifiant de {label}"))
}

fn optional_enum(
    object: &Map<String, Value>,
    field: &str,
    allowed: &[&str],
    label: &str,
) -> Result<(), AppError> {
    let Some(value) = object.get(field) else {
        return Ok(());
    };
    let value = value
        .as_str()
        .ok_or_else(|| ui_error(format!("{label}.{field} doit être une chaîne")))?;
    if !allowed.contains(&value) {
        return Err(ui_error(format!(
            "valeur inconnue pour {label}.{field}: {value}"
        )));
    }
    Ok(())
}

fn optional_tone(object: &Map<String, Value>, label: &str) -> Result<(), AppError> {
    optional_enum(
        object,
        "tone",
        &["default", "muted", "info", "success", "warning", "danger"],
        label,
    )
}

fn validate_identifier(value: &str, label: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(ui_error(format!("{label} invalide")));
    }
    Ok(())
}

fn ui_error(message: impl Into<String>) -> AppError {
    AppError::Mods(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mounts_updates_and_clears_a_valid_panel() {
        let store = ModUiStore::default();
        store
            .mount(
                "dev.test",
                "session-a",
                r#"{
                    "id":"main",
                    "title":"Combats",
                    "components":[
                        {"type":"text","text":"Deux combats","tone":"info"},
                        {"type":"row","children":[
                            {"type":"button","id":"refresh","label":"Actualiser"},
                            {"type":"badge","text":"2","tone":"success"}
                        ]},
                        {"type":"textarea","id":"profile","label":"Profil","value":"{\n  \"version\": 1\n}"}
                    ]
                }"#,
            )
            .unwrap();
        let panels = store.list("session-a");
        assert_eq!(panels.len(), 1);
        assert_eq!(panels[0].title, "Combats");
        store
            .validate_action("dev.test", "session-a", "main", "refresh")
            .unwrap();
        store
            .validate_action("dev.test", "session-a", "main", "profile")
            .unwrap();

        store
            .mount(
                "dev.test",
                "session-a",
                r#"{"id":"main","title":"Carte","components":[]}"#,
            )
            .unwrap();
        assert_eq!(store.list("session-a")[0].title, "Carte");
        store.clear_instance("dev.test", "session-a");
        assert!(store.list("session-a").is_empty());
    }

    #[test]
    fn rejects_unknown_components_and_duplicate_actions() {
        let store = ModUiStore::default();
        assert!(
            store
                .mount(
                    "dev.test",
                    "session-a",
                    r#"{"id":"main","title":"Non","components":[{"type":"html","value":"<b>x</b>"}]}"#,
                )
                .is_err()
        );
        assert!(
            store
                .mount(
                    "dev.test",
                    "session-a",
                    r#"{"id":"main","title":"Non","components":[{"type":"button","id":"same","label":"A"},{"type":"input","id":"same"}]}"#,
                )
                .is_err()
        );
    }

    #[test]
    fn validates_rich_safe_components() {
        let store = ModUiStore::default();
        store
            .mount(
                "dev.test",
                "session-a",
                r#"{
                  "id":"rich",
                  "title":"Rich",
                  "components":[
                    {"type":"switch","id":"enabled","label":"Activé","value":true},
                    {"type":"number","id":"count","value":3,"minimum":1,"maximum":10},
                    {"type":"slider","id":"speed","value":50,"minimum":0,"maximum":100},
                    {"type":"progress","label":"Travail","value":75},
                    {"type":"collapsible","title":"Détails","open":true,"children":[
                      {"type":"text","text":"Prêt"}
                    ]},
                    {"type":"table","columns":[{"key":"name","label":"Nom"}],"rows":[
                      {"name":"Entrée"}
                    ]}
                  ]
                }"#,
            )
            .unwrap();
        store
            .validate_action("dev.test", "session-a", "rich", "enabled")
            .unwrap();
        store
            .validate_action("dev.test", "session-a", "rich", "speed")
            .unwrap();
    }
}
