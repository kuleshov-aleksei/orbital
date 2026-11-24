// Text channel slash commands. The server runs them (backend
// service/chatcmd) and stores the result on the message; this list only
// feeds the composer's "/" autocomplete.

export interface ChatCommandInfo {
  name: string
  usage: string
  description: string
}

export const CHAT_COMMANDS: ChatCommandInfo[] = [
  {
    name: "random",
    usage: "/random [min] <max> | <option1> <option2> …",
    description: "Random number or option",
  },
  {
    name: "vrandom",
    usage: "/vrandom <option1> <option2> …",
    description: "Spin a wheel of fortune",
  },
  { name: "d20", usage: "/d20", description: "Roll a twenty-sided die" },
  {
    name: "remindme",
    usage: "/remindme <2h | 2d6h | 1m | 19.11 14:00> [note]",
    description: "Remind me later in this channel",
  },
]

/** The "/name" being typed when the caret sits right after it at the very
 * start of the draft, else null. */
export function activeCommandQuery(text: string, caret: number): { query: string } | null {
  const m = /^\/([a-z0-9]*)$/i.exec(text.slice(0, caret))
  return m ? { query: m[1].toLowerCase() } : null
}

export function matchCommands(query: string): ChatCommandInfo[] {
  return CHAT_COMMANDS.filter((c) => c.name.startsWith(query))
}
