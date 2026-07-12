use crate::error::AppError;
use crate::storage::validate_identifier;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredSession {
    pub session_data: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

impl StoredSession {
    pub fn is_expired(&self) -> bool {
        self.expires_at.is_some_and(|expiry| expiry <= Utc::now())
    }
}

pub trait SecureSessionStore: Send + Sync {
    fn save_session(&self, account_id: &str, session: &StoredSession) -> Result<(), AppError>;
    fn load_session(&self, account_id: &str) -> Result<Option<StoredSession>, AppError>;
    fn delete_session(&self, account_id: &str) -> Result<(), AppError>;
    fn status(&self) -> &'static str;
}

pub struct SystemSecureSessionStore;

#[cfg(not(target_os = "android"))]
fn is_missing_entry(error: &keyring::Error) -> bool {
    matches!(error, keyring::Error::NoEntry)
}

#[cfg(target_os = "android")]
fn is_missing_entry(error: &keyring_core::Error) -> bool {
    matches!(error, keyring_core::Error::NoEntry)
}

#[cfg(not(target_os = "android"))]
impl SystemSecureSessionStore {
    fn entry(account_id: &str) -> Result<keyring::Entry, AppError> {
        validate_identifier(account_id)?;
        keyring::Entry::new("app.twelia.client.session", account_id)
            .map_err(|error| AppError::Authentication(error.to_string()))
    }
}

#[cfg(target_os = "android")]
fn android_entry(account_id: &str) -> Result<keyring_core::Entry, AppError> {
    use std::sync::OnceLock;
    static INITIALIZED: OnceLock<Result<(), String>> = OnceLock::new();
    validate_identifier(account_id)?;
    let initialized = INITIALIZED.get_or_init(|| {
        android_native_keyring_store::Store::new()
            .map(|store| keyring_core::set_default_store(store))
            .map_err(|error| error.to_string())
    });
    if let Err(error) = initialized {
        return Err(AppError::Authentication(error.clone()));
    }
    keyring_core::Entry::new("app.twelia.client.session", account_id)
        .map_err(|error| AppError::Authentication(error.to_string()))
}

impl SecureSessionStore for SystemSecureSessionStore {
    fn save_session(&self, account_id: &str, session: &StoredSession) -> Result<(), AppError> {
        let serialized = serde_json::to_vec(session)
            .map_err(|error| AppError::Authentication(error.to_string()))?;
        #[cfg(not(target_os = "android"))]
        return Self::entry(account_id)?
            .set_secret(&serialized)
            .map_err(|error| AppError::Authentication(error.to_string()));
        #[cfg(target_os = "android")]
        return android_entry(account_id)?
            .set_secret(&serialized)
            .map_err(|error| AppError::Authentication(error.to_string()));
    }

    fn load_session(&self, account_id: &str) -> Result<Option<StoredSession>, AppError> {
        #[cfg(not(target_os = "android"))]
        let result = Self::entry(account_id)?.get_secret();
        #[cfg(target_os = "android")]
        let result = android_entry(account_id)?.get_secret();
        match result {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|error| AppError::Authentication(error.to_string())),
            Err(error) if is_missing_entry(&error) => Ok(None),
            Err(error) => Err(AppError::Authentication(error.to_string())),
        }
    }

    fn delete_session(&self, account_id: &str) -> Result<(), AppError> {
        #[cfg(not(target_os = "android"))]
        let result = Self::entry(account_id)?.delete_credential();
        #[cfg(target_os = "android")]
        let result = android_entry(account_id)?.delete_credential();
        match result {
            Ok(()) => Ok(()),
            Err(error) if is_missing_entry(&error) => Ok(()),
            Err(error) => Err(AppError::Authentication(error.to_string())),
        }
    }

    fn status(&self) -> &'static str {
        "system-secure-store"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, sync::Mutex};

    #[derive(Default)]
    struct MemoryStore(Mutex<HashMap<String, StoredSession>>);
    impl SecureSessionStore for MemoryStore {
        fn save_session(&self, id: &str, value: &StoredSession) -> Result<(), AppError> {
            self.0.lock().unwrap().insert(id.into(), value.clone());
            Ok(())
        }
        fn load_session(&self, id: &str) -> Result<Option<StoredSession>, AppError> {
            Ok(self.0.lock().unwrap().get(id).cloned())
        }
        fn delete_session(&self, id: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().remove(id);
            Ok(())
        }
        fn status(&self) -> &'static str {
            "memory"
        }
    }

    #[test]
    fn session_expiry_and_secure_deletion_are_independent() {
        let store = MemoryStore::default();
        let expired = StoredSession {
            session_data: "opaque".into(),
            created_at: Utc::now(),
            expires_at: Some(Utc::now() - chrono::Duration::seconds(1)),
        };
        let valid = StoredSession {
            session_data: "other".into(),
            created_at: Utc::now(),
            expires_at: None,
        };
        store.save_session("a", &expired).unwrap();
        store.save_session("b", &valid).unwrap();
        assert!(store.load_session("a").unwrap().unwrap().is_expired());
        store.delete_session("a").unwrap();
        assert!(store.load_session("a").unwrap().is_none());
        assert_eq!(
            store.load_session("b").unwrap().unwrap().session_data,
            "other"
        );
    }
}
