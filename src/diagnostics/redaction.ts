const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[REDACTED]"],
  [
    /\b(password|passwd|mot_de_passe|token|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi,
    "$1=[REDACTED]",
  ],
  [/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, "•••@$1"],
  [/\b(eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/g, "[JWT REDACTED]"],
];

export function redactSensitiveData(message: string): string {
  return SENSITIVE_PATTERNS.reduce(
    (sanitized, [pattern, replacement]) => sanitized.replace(pattern, replacement),
    message,
  );
}

export function anonymousReference(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `local-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function sanitizeObject(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveData(value);
  if (Array.isArray(value)) return value.map(sanitizeObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (/password|token|cookie|secret|authorization|sessionData/i.test(key)) {
          return [key, "[REDACTED]"];
        }
        return [key, sanitizeObject(item)];
      }),
    );
  }
  return value;
}
