use super::manifest::ModManifest;
use crate::error::AppError;
use reqwest::{
    Method, Url,
    blocking::Client,
    header::{HeaderMap, HeaderName, HeaderValue},
    redirect::Policy,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, io::Read, str::FromStr, time::Duration};

const MAX_HTTP_REQUEST_BYTES: usize = 64 * 1024;
const MAX_HTTP_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_HTTP_HEADERS: usize = 32;
const MIN_HTTP_TIMEOUT_MS: u64 = 500;
const MAX_HTTP_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModHttpRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    json: Option<Value>,
    #[serde(default = "default_timeout_ms")]
    timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModHttpResponse {
    status: u16,
    ok: bool,
    url: String,
    headers: BTreeMap<String, String>,
    body: String,
}

pub struct ModHttpClient {
    client: Client,
}

impl ModHttpClient {
    pub fn new() -> Result<Self, AppError> {
        let client = Client::builder()
            .redirect(Policy::none())
            .user_agent(format!("Twelia/{} ModRuntime", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(http_transport)?;
        Ok(Self { client })
    }

    pub fn execute(&self, manifest: &ModManifest, payload: &str) -> Result<Value, AppError> {
        if !manifest.allows_capability("network") {
            return Err(http_error(
                "la capacité network n’est pas accordée à ce mod",
            ));
        }
        if payload.len() > MAX_HTTP_REQUEST_BYTES {
            return Err(http_error("requête HTTP trop volumineuse"));
        }
        let request: ModHttpRequest = serde_json::from_str(payload)
            .map_err(|error| http_error(format!("requête HTTP invalide: {error}")))?;
        let url = Url::parse(&request.url)
            .map_err(|error| http_error(format!("URL HTTP invalide: {error}")))?;
        validate_allowed_url(manifest, &url)?;
        let method = Method::from_bytes(request.method.to_ascii_uppercase().as_bytes())
            .map_err(|_| http_error("méthode HTTP invalide"))?;
        if !matches!(
            method,
            Method::GET
                | Method::POST
                | Method::PUT
                | Method::PATCH
                | Method::DELETE
                | Method::HEAD
        ) {
            return Err(http_error("méthode HTTP non autorisée"));
        }
        if !(MIN_HTTP_TIMEOUT_MS..=MAX_HTTP_TIMEOUT_MS).contains(&request.timeout_ms) {
            return Err(http_error(
                "délai HTTP compris entre 500 et 30000 ms attendu",
            ));
        }
        if request.headers.len() > MAX_HTTP_HEADERS {
            return Err(http_error("trop d’en-têtes HTTP"));
        }
        if request.body.is_some() && request.json.is_some() {
            return Err(http_error("body et json sont mutuellement exclusifs"));
        }

        let mut headers = HeaderMap::new();
        for (name, value) in request.headers {
            let name = HeaderName::from_str(&name)
                .map_err(|_| http_error("nom d’en-tête HTTP invalide"))?;
            if matches!(
                name.as_str(),
                "cookie" | "host" | "content-length" | "connection"
            ) {
                return Err(http_error(format!(
                    "en-tête HTTP interdit: {}",
                    name.as_str()
                )));
            }
            let value = HeaderValue::from_str(&value)
                .map_err(|_| http_error(format!("valeur invalide pour {}", name.as_str())))?;
            headers.insert(name, value);
        }

        let mut builder = self
            .client
            .request(method, url)
            .headers(headers)
            .timeout(Duration::from_millis(request.timeout_ms));
        if let Some(body) = request.body {
            if body.len() > MAX_HTTP_REQUEST_BYTES {
                return Err(http_error("corps HTTP trop volumineux"));
            }
            builder = builder.body(body);
        } else if let Some(json) = request.json {
            let bytes = serde_json::to_vec(&json)
                .map_err(|error| http_error(format!("corps JSON invalide: {error}")))?;
            if bytes.len() > MAX_HTTP_REQUEST_BYTES {
                return Err(http_error("corps JSON trop volumineux"));
            }
            builder = builder.json(&json);
        }

        let response = builder.send().map_err(http_transport)?;
        let status = response.status();
        let final_url = response.url().clone();
        validate_allowed_url(manifest, &final_url)?;
        let mut response_headers = BTreeMap::new();
        for (name, value) in response.headers().iter().take(MAX_HTTP_HEADERS) {
            if matches!(
                name.as_str(),
                "set-cookie" | "authorization" | "proxy-authorization"
            ) {
                continue;
            }
            if let Ok(value) = value.to_str() {
                response_headers.insert(name.to_string(), value.chars().take(2_048).collect());
            }
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_HTTP_RESPONSE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| {
                http_error(format!("lecture de la réponse HTTP impossible: {error}"))
            })?;
        if bytes.len() > MAX_HTTP_RESPONSE_BYTES {
            return Err(http_error("réponse HTTP supérieure à 256 Kio"));
        }
        let body = String::from_utf8(bytes)
            .map_err(|_| http_error("réponse HTTP binaire non prise en charge"))?;
        serde_json::to_value(ModHttpResponse {
            status: status.as_u16(),
            ok: status.is_success(),
            url: final_url.to_string(),
            headers: response_headers,
            body,
        })
        .map_err(|error| http_error(format!("réponse HTTP invalide: {error}")))
    }
}

fn validate_allowed_url(manifest: &ModManifest, url: &Url) -> Result<(), AppError> {
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(http_error(
            "seules les URL HTTPS sans identifiants sont autorisées",
        ));
    }
    let origin = url.origin().ascii_serialization();
    let allowed = manifest.network.iter().any(|candidate| {
        Url::parse(candidate)
            .ok()
            .is_some_and(|candidate| candidate.origin().ascii_serialization() == origin)
    });
    if !allowed {
        return Err(http_error(format!(
            "origine réseau non déclarée dans le manifeste: {origin}"
        )));
    }
    Ok(())
}

fn default_timeout_ms() -> u64 {
    10_000
}

fn http_transport(error: reqwest::Error) -> AppError {
    http_error(if error.is_timeout() {
        "délai de la requête HTTP dépassé".into()
    } else {
        format!("requête HTTP impossible: {error}")
    })
}

fn http_error(message: impl Into<String>) -> AppError {
    AppError::Mods(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn manifest() -> ModManifest {
        ModManifest {
            schema_version: 1,
            id: "dev.twelia.http".into(),
            name: "HTTP".into(),
            version: "1.0.0".into(),
            api_version: 1,
            entry: "main.js".into(),
            game_entry: None,
            network: vec!["https://api.example.com".into()],
            capabilities: vec!["network".into()],
            settings: BTreeMap::new(),
            description: None,
            author: None,
            homepage: None,
            license: None,
            repository: None,
            min_twelia_version: None,
        }
    }

    #[test]
    fn accepts_only_declared_https_origins() {
        let manifest = manifest();
        assert!(
            validate_allowed_url(
                &manifest,
                &Url::parse("https://api.example.com/v1").unwrap()
            )
            .is_ok()
        );
        assert!(
            validate_allowed_url(
                &manifest,
                &Url::parse("https://other.example.com/v1").unwrap()
            )
            .is_err()
        );
        assert!(
            validate_allowed_url(&manifest, &Url::parse("http://api.example.com/v1").unwrap())
                .is_err()
        );
    }
}
