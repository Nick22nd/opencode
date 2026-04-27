import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Instance } from "../../project/instance"
import { PluginFs } from "../../plugin/fs"
import os from "os"
import path from "path"

function show(file: string) {
  const home = os.homedir()
  return file.startsWith(home) ? file.replace(home, "~") : file
}

function describe(item: PluginFs.Item) {
  return `${item.name} ${UI.Style.TEXT_DIM}${PluginFs.label(item.scope).toLowerCase()}`
}

function hint(scope: PluginFs.Scope) {
  return show(PluginFs.root(scope))
}

async function pickScope(input?: string): Promise<PluginFs.Scope> {
  if (input === "project" || input === "global") return input
  const picked = await prompts.select({
    message: "Location",
    options: [
      {
        label: "Current project",
        value: "project",
        hint: hint("project"),
      },
      {
        label: "Global",
        value: "global",
        hint: hint("global"),
      },
    ],
  })
  if (prompts.isCancel(picked)) throw new UI.CancelledError()
  return picked
}

async function pick(ref?: string) {
  const items = ref ? await PluginFs.find(ref) : await PluginFs.list()
  if (ref && !items.length) throw new Error(`Plugin not found: ${ref}`)
  if (!items.length) return
  if (items.length === 1) return items[0]
  const picked = await prompts.select({
    message: "Select plugin",
    options: items.map((item) => ({
      label: describe(item),
      value: item.path,
      hint: show(item.path),
    })),
  })
  if (prompts.isCancel(picked)) throw new UI.CancelledError()
  return items.find((item) => item.path === picked)
}

export const PluginCommand = cmd({
  command: "plugin",
  describe: "manage local TS/JS plugins",
  builder: (yargs) =>
    yargs.command(PluginListCommand).command(PluginAddCommand).command(PluginDetailCommand).command(PluginRemoveCommand).demandCommand(),
  async handler() {},
})

export const PluginListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list local TS/JS plugins",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Plugins")
        const items = await PluginFs.list()
        if (!items.length) {
          prompts.log.warn("No local plugins found")
          prompts.outro("Add plugins with: opencode plugin add")
          return
        }
        for (const item of items) {
          prompts.log.info(`${describe(item)}\n    ${UI.Style.TEXT_DIM}${show(item.path)}`)
        }
        prompts.outro(`${items.length} plugin` + (items.length === 1 ? "" : "s"))
      },
    })
  },
})

export const PluginAddCommand = cmd({
  command: "add [file]",
  describe: "add a local TS/JS plugin file",
  builder: (yargs) =>
    yargs
      .positional("file", {
        describe: "path to a local .ts or .js plugin file",
        type: "string",
      })
      .option("scope", {
        alias: ["s"],
        choices: ["project", "global"],
        describe: "where to install the plugin",
        type: "string",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add plugin")
        const file =
          args.file ||
          (await prompts.text({
            message: "Plugin file path",
            placeholder: path.join(process.cwd(), "plugin.ts"),
            validate: (x) => (x && x.trim() ? undefined : "Required"),
          }))
        if (prompts.isCancel(file)) throw new UI.CancelledError()
        const scope = await pickScope(args.scope)
        const item = await PluginFs.add(file.trim(), scope)
        prompts.log.success(`Added ${item.name} to ${PluginFs.label(scope).toLowerCase()} scope`)
        prompts.log.info(show(item.path))
        prompts.outro("Done")
      },
    })
  },
})

export const PluginDetailCommand = cmd({
  command: "detail [plugin]",
  describe: "show local plugin details",
  builder: (yargs) =>
    yargs.positional("plugin", {
      describe: "plugin name, scope:name, or absolute path",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Plugin details")
        const item = await pick(args.plugin)
        if (!item) {
          prompts.log.warn("No local plugins found")
          prompts.outro("Done")
          return
        }
        prompts.log.info(`Name  ${UI.Style.TEXT_DIM}${item.name}`)
        prompts.log.info(`Scope ${UI.Style.TEXT_DIM}${PluginFs.label(item.scope).toLowerCase()}`)
        prompts.log.info(`Path  ${UI.Style.TEXT_DIM}${show(item.path)}`)
        prompts.outro("Done")
      },
    })
  },
})

export const PluginRemoveCommand = cmd({
  command: "remove [plugin]",
  aliases: ["rm", "delete"],
  describe: "remove a local plugin file",
  builder: (yargs) =>
    yargs.positional("plugin", {
      describe: "plugin name, scope:name, or absolute path",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Remove plugin")
        const item = await pick(args.plugin)
        if (!item) {
          prompts.log.warn("No local plugins found")
          prompts.outro("Done")
          return
        }
        const ok = await prompts.confirm({
          message: `Remove ${item.name} from ${PluginFs.label(item.scope).toLowerCase()} scope?`,
          initialValue: false,
        })
        if (prompts.isCancel(ok) || !ok) throw new UI.CancelledError()
        await PluginFs.remove(item)
        prompts.log.success(`Removed ${item.name}`)
        prompts.outro("Done")
      },
    })
  },
})
