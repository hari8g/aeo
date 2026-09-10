/** Office roster helper. Floor extras stay off unless a caller opts in. */

export function enrichRoster(roster) {
  return { agents: [...(roster?.agents ?? [])] }
}
