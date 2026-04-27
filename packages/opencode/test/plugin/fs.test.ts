import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { PluginFs } from "../../src/plugin/fs"

describe("plugin.fs", () => {
  test("lists project and global plugins with scope", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir({ git: true })
    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = global.path

    try {
      await Filesystem.write(path.join(global.path, "plugins", "global.ts"), "export default {}")
      await Filesystem.write(path.join(project.path, ".opencode", "plugin", "project.js"), "export default {}")

      await Instance.provide({
        directory: project.path,
        async fn() {
          const items = await PluginFs.list()
          expect(items).toContainEqual({
            name: "global",
            path: path.join(global.path, "plugins", "global.ts"),
            dir: "plugins",
            scope: "global",
          })
          expect(items).toContainEqual({
            name: "project",
            path: path.join(project.path, ".opencode", "plugin", "project.js"),
            dir: "plugin",
            scope: "project",
          })
        },
      })
    } finally {
      await Instance.disposeAll()
      ;(Global.Path as { config: string }).config = prev
    }
  })

  test("adds a plugin into the selected scope", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir({ git: true })
    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = global.path

    try {
      const src = path.join(project.path, "sample.ts")
      await Filesystem.write(src, "export default {}")

      await Instance.provide({
        directory: project.path,
        async fn() {
          const item = await PluginFs.add(src, "project")
          expect(item.path).toBe(path.join(project.path, ".opencode", "plugins", "sample.ts"))
          expect(await Filesystem.readText(item.path)).toBe("export default {}")
        },
      })
    } finally {
      await Instance.disposeAll()
      ;(Global.Path as { config: string }).config = prev
    }
  })

  test("removes a managed plugin file", async () => {
    await using project = await tmpdir({ git: true })

    await Instance.provide({
      directory: project.path,
      async fn() {
        const file = path.join(project.path, ".opencode", "plugins", "remove.ts")
        await Filesystem.write(file, "export default {}")
        await PluginFs.remove(file)
        expect(await Filesystem.exists(file)).toBe(false)
      },
    })

    await Instance.disposeAll()
  })
})
