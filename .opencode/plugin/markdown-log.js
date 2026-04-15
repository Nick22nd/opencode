import path from "node:path"
import { mkdir } from "node:fs/promises"

function pick(parts) {
  const txt = parts
    .filter((part) => part.type === "text" && !part.synthetic && !part.ignored)
    .map((part) => part.text.trim())
    .filter(Boolean)
  if (txt.length) return txt.join("\n\n")
  return parts
    .filter((part) => part.type === "text" && !part.ignored)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
}

function wrap(text) {
  const len = Math.max(...Array.from(text.matchAll(/`+/g), (m) => m[0].length), 2) + 1
  const bar = "`".repeat(len)
  return `${bar}text\n${text || "(empty)"}\n${bar}`
}

function body(id, ask, reply) {
  return [`## ${id}`, `### 问题`, wrap(ask), `### 回答`, wrap(reply)].join("\n\n")
}

export default async function journal(input) {
  const file = path.join(input.directory, ".opencode", "chat-log.md")
  const ask = new Map()
  const reply = new Map()
  let seq = 0
  let lock = Promise.resolve()

  const push = (item) => {
    lock = lock.then(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      const out = Bun.file(file)
      const old = (await out.exists()) ? await out.text() : "# 对话记录\n"
      const id = (old.match(/^## \d+$/gm)?.length ?? 0) + 1
      await Bun.write(file, `${old.trimEnd()}\n\n${body(id, item.ask, item.reply)}\n`)
    })
    return lock
  }

  return {
    "chat.message": async (_input, output) => {
      const text = pick(output.parts)
      if (!text) return
      seq += 1
      ask.set(output.message.id, {
        id: seq,
        sid: output.message.sessionID,
        text,
      })
    },
    event: async ({ event }) => {
      if (event.type === "message.updated" && event.properties.info.role === "assistant") {
        reply.set(event.properties.info.id, {
          pid: event.properties.info.parentID,
          sid: event.properties.info.sessionID,
          parts: new Map(),
        })
        return
      }

      if (event.type === "message.part.updated" && event.properties.part.type === "text") {
        const item = reply.get(event.properties.part.messageID)
        if (!item) return
        const text = event.properties.part.text.trim()
        if (!text) return
        item.parts.set(event.properties.part.id, text)
        return
      }

      if (event.type !== "session.idle") return

      const list = new Map()
      for (const item of reply.values()) {
        if (item.sid !== event.properties.sessionID || !item.pid) continue
        list.set(item.pid, item)
      }

      const rows = Array.from(list.entries())
        .map(([id, item]) => {
          const msg = ask.get(id)
          const text = Array.from(item.parts.values())
            .map((part) => part.trim())
            .filter(Boolean)
            .join("\n\n")
          if (!msg || !text) return
          return {
            ask: msg.text,
            reply: text,
            id: msg.id,
          }
        })
        .filter(Boolean)
        .sort((a, b) => a.id - b.id)

      for (const item of rows) {
        await push(item)
      }

      for (const [id, item] of ask) {
        if (item.sid === event.properties.sessionID) ask.delete(id)
      }
      for (const [id, item] of reply) {
        if (item.sid === event.properties.sessionID) reply.delete(id)
      }
    },
  }
}
