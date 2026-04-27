import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Glob } from "@/util/glob"
import path from "path"
import { rm } from "fs/promises"

export namespace PluginFs {
  const SEARCH = ["plugin", "plugins"] as const
  const TARGET = "plugins"

  export type Scope = "global" | "project"

  export type Item = {
    name: string
    path: string
    dir: string
    scope: Scope
  }

  function base(scope: Scope) {
    if (scope === "global") return Global.Path.config
    return Instance.worktree === "/" ? Instance.directory : Instance.worktree
  }

  function dirs(scope: Scope) {
    if (scope === "global") return SEARCH.map((name) => path.join(base(scope), name))
    return SEARCH.map((name) => path.join(base(scope), ".opencode", name))
  }

  function item(file: string, scope: Scope): Item {
    return {
      name: path.parse(file).name,
      path: Filesystem.resolve(file),
      dir: path.basename(path.dirname(file)),
      scope,
    }
  }

  function valid(file: string) {
    const ext = path.extname(file)
    return ext === ".js" || ext === ".ts"
  }

  function sort(a: Item, b: Item) {
    return a.name.localeCompare(b.name) || a.path.localeCompare(b.path)
  }

  export function label(scope: Scope) {
    return scope === "global" ? "Global" : "Project"
  }

  export function root(scope: Scope) {
    if (scope === "global") return path.join(base(scope), TARGET)
    return path.join(base(scope), ".opencode", TARGET)
  }

  async function scan(scope: Scope) {
    const files = await Promise.all(
      dirs(scope).map(async (dir) => {
        if (!(await Filesystem.exists(dir))) return []
        return Glob.scan("*.{ts,js}", {
          cwd: dir,
          absolute: true,
          dot: true,
          include: "file",
        })
      }),
    )
    return files
      .flat()
      .map((file) => item(file, scope))
      .toSorted(sort)
  }

  export async function list() {
    return (await Promise.all([scan("project"), scan("global")]))
      .flat()
      .toSorted((a, b) => a.scope.localeCompare(b.scope) || sort(a, b))
  }

  export async function find(ref: string) {
    const needle = ref.trim().toLowerCase()
    if (!needle) return []
    const resolved = path.isAbsolute(ref) ? Filesystem.resolve(ref).toLowerCase() : undefined
    return list().then((items) =>
      items.filter((item) => {
        if (resolved && item.path.toLowerCase() === resolved) return true
        if (item.path.toLowerCase() === needle) return true
        if (item.name.toLowerCase() === needle) return true
        if (`${item.scope}:${item.name}`.toLowerCase() === needle) return true
        if (`${label(item.scope).toLowerCase()}:${item.name}`.toLowerCase() === needle) return true
        return false
      }),
    )
  }

  export async function add(file: string, scope: Scope) {
    const src = Filesystem.resolve(Filesystem.windowsPath(file))
    if (!valid(src)) throw new Error("Plugin file must end in .ts or .js")
    if (!(await Filesystem.exists(src))) throw new Error(`Plugin file not found: ${src}`)
    const dst = path.join(root(scope), path.basename(src))
    if (Filesystem.resolve(dst) === src) return item(dst, scope)
    if (await Filesystem.exists(dst)) throw new Error(`Plugin already exists: ${dst}`)
    await Filesystem.write(dst, Buffer.from(await Bun.file(src).arrayBuffer()))
    return item(dst, scope)
  }

  export async function remove(file: string | Item) {
    const target = typeof file === "string" ? file : file.path
    await rm(target, {
      force: true,
    })
  }
}
