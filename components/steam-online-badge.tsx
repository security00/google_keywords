import { Users } from "lucide-react";

import { parseSteamPlayerCount } from "@/lib/game-steam-players";

export function SteamOnlineBadge({ reason }: { reason?: string | null }) {
  const count = parseSteamPlayerCount(reason);
  if (count === null) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
      <Users className="h-3 w-3" />
      Steam 在线 {count.toLocaleString("en-US")}
    </span>
  );
}
