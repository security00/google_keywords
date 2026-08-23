const STEAM_ONLINE_RE = /Steam在线\s*([\d,]+)人/;

export function parseSteamPlayerCount(reason: string | null | undefined): number | null {
  if (!reason) return null;
  const match = reason.match(STEAM_ONLINE_RE);
  if (!match) return null;
  const count = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(count) ? count : null;
}

export function reasonWithoutSteamPlayerCount(reason: string | null | undefined): string {
  if (!reason) return "";
  return reason
    .replace(STEAM_ONLINE_RE, "")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}
