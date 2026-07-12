use serde_json::Value;

const SENSITIVE_KEYS: &[&str] = &[
    "password",
    "passwd",
    "token",
    "cookie",
    "secret",
    "authorization",
    "sessiondata",
];

pub trait SensitiveDataRedactor: Send + Sync {
    fn redact_log_message(&self, message: &str) -> String;
    fn sanitize_diagnostic_report(&self, report: Value) -> Value;
}

#[derive(Default)]
pub struct DefaultRedactor;

impl SensitiveDataRedactor for DefaultRedactor {
    fn redact_log_message(&self, message: &str) -> String {
        let mut output = message.to_string();
        for marker in ["password=", "token=", "cookie=", "authorization="] {
            let mut search_from = 0;
            while let Some(relative_start) = output[search_from..].to_ascii_lowercase().find(marker)
            {
                let start = search_from + relative_start;
                let value_start = start + marker.len();
                let value_end = output[value_start..]
                    .find(|character: char| {
                        character.is_whitespace() || character == ',' || character == ';'
                    })
                    .map_or(output.len(), |offset| value_start + offset);
                output.replace_range(value_start..value_end, "[REDACTED]");
                search_from = value_start + "[REDACTED]".len();
            }
        }
        output
    }

    fn sanitize_diagnostic_report(&self, report: Value) -> Value {
        sanitize_value(report)
    }
}

fn sanitize_value(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| {
                    let normalized = key.to_lowercase();
                    if SENSITIVE_KEYS.iter().any(|item| normalized.contains(item)) {
                        (key, Value::String("[REDACTED]".into()))
                    } else {
                        (key, sanitize_value(value))
                    }
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(sanitize_value).collect()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn removes_secrets_from_logs_and_reports() {
        let redactor = DefaultRedactor;
        assert_eq!(
            redactor.redact_log_message("token=abc123 status=ok"),
            "token=[REDACTED] status=ok"
        );
        let report = redactor.sanitize_diagnostic_report(json!({
            "configuration": { "accessToken": "abc", "theme": "dark" },
            "cookie": "sid=secret"
        }));
        let serialized = report.to_string();
        assert!(!serialized.contains("abc"));
        assert!(!serialized.contains("sid=secret"));
        assert!(serialized.contains("dark"));
    }
}
