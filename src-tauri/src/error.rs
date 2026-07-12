use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Storage error: {0}")]
    Storage(String),
    #[error("Authentication storage error: {0}")]
    Authentication(String),
    #[error("Runtime error: {0}")]
    Runtime(String),
    #[error("Distribution error: {0}")]
    Distribution(String),
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    #[allow(dead_code)]
    #[error("Platform error: {0}")]
    Platform(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub category: &'static str,
    pub message: String,
    pub recoverable: bool,
    pub diagnostic_id: Option<String>,
}

impl From<AppError> for CommandError {
    fn from(error: AppError) -> Self {
        let (code, category, recoverable) = match error {
            AppError::Storage(_) => ("STORAGE_ERROR", "storage", true),
            AppError::Authentication(_) => ("SECURE_STORE_ERROR", "authentication", true),
            AppError::Runtime(_) => ("RUNTIME_ERROR", "runtime", true),
            AppError::Distribution(_) => ("DISTRIBUTION_ERROR", "distribution", true),
            AppError::InvalidInput(_) => ("INVALID_INPUT", "storage", true),
            AppError::Platform(_) => ("PLATFORM_ERROR", "platform", false),
        };
        Self {
            code,
            category,
            message: error.to_string(),
            recoverable,
            diagnostic_id: Some(uuid::Uuid::new_v4().to_string()),
        }
    }
}

pub type CommandResult<T> = Result<T, CommandError>;
