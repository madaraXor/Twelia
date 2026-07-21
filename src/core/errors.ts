export type TweliaErrorCategory =
  | "storage"
  | "authentication"
  | "network"
  | "distribution"
  | "runtime"
  | "mods"
  | "platform"
  | "unknown";

export type TweliaError = {
  code: string;
  category: TweliaErrorCategory;
  message: string;
  recoverable: boolean;
  diagnosticId?: string;
};

export function toTweliaError(error: unknown, fallbackCode = "TWELIA_UNKNOWN"): TweliaError {
  if (isTweliaError(error)) return error;
  return {
    code: fallbackCode,
    category: "unknown",
    message: error instanceof Error ? error.message : "Une erreur inattendue est survenue.",
    recoverable: true,
  };
}

export function isTweliaError(value: unknown): value is TweliaError {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TweliaError>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.recoverable === "boolean"
  );
}
