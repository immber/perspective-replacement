// English check for v0. Non-English requests get a 400.
export function isEnglish(languages: string[] | undefined): boolean {
  // TODO: decide behaviour when `languages` is missing (plan mentions tenant locale).
  if (!languages || languages.length === 0) return true;
  return languages.some((l) => l.toLowerCase().startsWith("en"));
}
