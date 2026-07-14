export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

export function matchesSearch(search: string, ...values: Array<string | undefined>): boolean {
  const tokens = normalizeSearchText(search).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = normalizeSearchText(values.filter(Boolean).join(" "));
  return tokens.every((token) => haystack.includes(token));
}

export function commandFilter(value: string, search: string, keywords: string[] = []): number {
  return matchesSearch(search, value, ...keywords) ? 1 : 0;
}
