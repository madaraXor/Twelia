use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};
use walkdir::WalkDir;

pub mod installer;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledClientFile {
    pub relative_path: String,
    pub size: u64,
    pub sha256: String,
    pub source_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledManifest {
    pub version: String,
    pub generated_at: String,
    pub files: Vec<InstalledClientFile>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum IntegrityStatus {
    Valid,
    Missing,
    Corrupted,
    Unexpected,
    Modified,
    NonVerifiable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIntegrity {
    pub relative_path: String,
    pub status: IntegrityStatus,
    pub expected_sha256: Option<String>,
    pub actual_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub manifest_version: String,
    pub checked_files: usize,
    pub valid: bool,
    pub files: Vec<FileIntegrity>,
}

pub trait ClientIntegrityService {
    fn verify_installation(
        &self,
        manifest: &InstalledManifest,
    ) -> Result<IntegrityReport, AppError>;
    fn list_modified_files(
        &self,
        manifest: &InstalledManifest,
    ) -> Result<Vec<FileIntegrity>, AppError>;
}

pub struct FileSystemIntegrityService {
    root: PathBuf,
}

impl FileSystemIntegrityService {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    pub fn load_manifest(&self) -> Result<Option<InstalledManifest>, AppError> {
        let path = self.root.join("manifest.json");
        if !path.exists() {
            return Ok(None);
        }
        serde_json::from_slice(&fs::read(path).map_err(distribution_io)?)
            .map(Some)
            .map_err(|error| AppError::Distribution(error.to_string()))
    }
}

impl ClientIntegrityService for FileSystemIntegrityService {
    fn verify_installation(
        &self,
        manifest: &InstalledManifest,
    ) -> Result<IntegrityReport, AppError> {
        let mut files = Vec::new();
        let mut expected = HashSet::new();
        for item in &manifest.files {
            let relative = safe_relative_path(&item.relative_path)?;
            expected.insert(relative.clone());
            let absolute = self.root.join(&relative);
            if !absolute.exists() {
                files.push(FileIntegrity {
                    relative_path: item.relative_path.clone(),
                    status: IntegrityStatus::Missing,
                    expected_sha256: Some(item.sha256.clone()),
                    actual_sha256: None,
                });
                continue;
            }
            let metadata = fs::metadata(&absolute).map_err(distribution_io)?;
            if !metadata.is_file() {
                files.push(FileIntegrity {
                    relative_path: item.relative_path.clone(),
                    status: IntegrityStatus::NonVerifiable,
                    expected_sha256: Some(item.sha256.clone()),
                    actual_sha256: None,
                });
                continue;
            }
            let actual = sha256_file(&absolute)?;
            let status = if metadata.len() != item.size {
                IntegrityStatus::Corrupted
            } else if actual.eq_ignore_ascii_case(&item.sha256) {
                IntegrityStatus::Valid
            } else {
                IntegrityStatus::Modified
            };
            files.push(FileIntegrity {
                relative_path: item.relative_path.clone(),
                status,
                expected_sha256: Some(item.sha256.clone()),
                actual_sha256: Some(actual),
            });
        }
        if self.root.exists() {
            for entry in WalkDir::new(&self.root)
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().is_file())
            {
                let relative = entry
                    .path()
                    .strip_prefix(&self.root)
                    .map_err(|error| AppError::Distribution(error.to_string()))?
                    .to_path_buf();
                if relative == Path::new("manifest.json") || expected.contains(&relative) {
                    continue;
                }
                files.push(FileIntegrity {
                    relative_path: relative.to_string_lossy().replace('\\', "/"),
                    status: IntegrityStatus::Unexpected,
                    expected_sha256: None,
                    actual_sha256: Some(sha256_file(entry.path())?),
                });
            }
        }
        let valid = files
            .iter()
            .all(|file| file.status == IntegrityStatus::Valid);
        Ok(IntegrityReport {
            manifest_version: manifest.version.clone(),
            checked_files: files.len(),
            valid,
            files,
        })
    }
    fn list_modified_files(
        &self,
        manifest: &InstalledManifest,
    ) -> Result<Vec<FileIntegrity>, AppError> {
        Ok(self
            .verify_installation(manifest)?
            .files
            .into_iter()
            .filter(|file| file.status != IntegrityStatus::Valid)
            .collect())
    }
}

pub(crate) fn safe_relative_path(value: &str) -> Result<PathBuf, AppError> {
    let path = Path::new(value);
    if value.contains('\\')
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::Distribution(format!(
            "unsafe manifest path: {value}"
        )));
    }
    Ok(path.to_path_buf())
}

fn sha256_file(path: &Path) -> Result<String, AppError> {
    let mut file = fs::File::open(path).map_err(distribution_io)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(distribution_io)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex::encode(hasher.finalize()))
}
fn distribution_io(error: std::io::Error) -> AppError {
    AppError::Distribution(error.to_string())
}

pub fn directory_size(root: &Path) -> u64 {
    if !root.exists() {
        return 0;
    }
    WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.metadata().ok())
        .filter(|meta| meta.is_file())
        .map(|meta| meta.len())
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_modified_and_unsafe_files() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("game.bin"), b"official").unwrap();
        let manifest = InstalledManifest {
            version: "1".into(),
            generated_at: "now".into(),
            files: vec![InstalledClientFile {
                relative_path: "game.bin".into(),
                size: 8,
                sha256: sha256_file(&root.path().join("game.bin")).unwrap(),
                source_version: "1".into(),
            }],
        };
        let service = FileSystemIntegrityService::new(root.path().into());
        assert!(service.verify_installation(&manifest).unwrap().valid);
        fs::write(root.path().join("game.bin"), b"modified").unwrap();
        assert_eq!(
            service.list_modified_files(&manifest).unwrap()[0].status,
            IntegrityStatus::Modified
        );
        assert!(safe_relative_path("../escape").is_err());
    }
}
