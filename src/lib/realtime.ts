// One broadcast channel per game. Operator sends 'state' events; viewers receive
// them — no table exposure to anon required.
export function gameChannelName(gameId: string): string {
  return `game:${gameId}`
}
