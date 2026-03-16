import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Config } from "../config/config"
import path from "path"
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import { lazy } from "@/util/lazy"
import { withTimeout } from "@/util/timeout"
import type ParcelWatcher from "@parcel/watcher"
import { Flag } from "@/flag/flag"
import { Filesystem } from "@/util/filesystem"

const SUBSCRIBE_TIMEOUT_MS = 10_000

declare const OPENCODE_LIBC: string | undefined

export namespace PluginWatcher {
  const log = Log.create({ service: "plugin.watcher" })

  export const Event = {
    Reloaded: BusEvent.define(
      "plugin.watcher.reloaded",
      z.object({
        file: z.string(),
      }),
    ),
  }

  const watcher = lazy((): typeof import("@parcel/watcher") | undefined => {
    try {
      const binding = require(
        `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${OPENCODE_LIBC || "glibc"}` : ""}`,
      )
      return createWrapper(binding) as typeof import("@parcel/watcher")
    } catch (err) {
      log.error("failed to load watcher binding", { err })
      return
    }
  })

  function match(file: string) {
    const ext = path.extname(file)
    if (ext !== ".ts" && ext !== ".js") return false
    const norm = file.replaceAll("\\", "/")
    return norm.includes("/plugin/") || norm.includes("/plugins/")
  }

  const state = Instance.state(
    async () => {
      log.info("init")
      const backend = (() => {
        if (process.platform === "win32") return "windows"
        if (process.platform === "darwin") return "fs-events"
        if (process.platform === "linux") return "inotify"
      })()
      if (!backend) {
        log.error("watcher backend not supported", { platform: process.platform })
        return {}
      }

      const w = watcher()
      if (!w) return {}

      const box = {
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      }

      const kick = (file: string) => {
        if (box.timer) clearTimeout(box.timer)
        box.timer = setTimeout(() => {
          box.timer = undefined
          log.info("plugin changed, reloading instance", { file })
          Bus.publish(Event.Reloaded, { file })
          void Instance.dispose().catch((err) => {
            log.error("failed to dispose instance after plugin change", { file, err })
          })
        }, 150)
      }

      const subscribe: ParcelWatcher.SubscribeCallback = (err, evts) => {
        if (err) return
        for (const evt of evts) {
          if (evt.type !== "create" && evt.type !== "update" && evt.type !== "delete") continue
          if (!match(evt.path)) continue
          kick(evt.path)
        }
      }

      const cfg = await Config.directories()
      const roots = Array.from(new Set(cfg.flatMap((dir) => [path.join(dir, "plugin"), path.join(dir, "plugins")])))

      const subs: ParcelWatcher.AsyncSubscription[] = []
      for (const root of roots) {
        const ok = await Filesystem.exists(root)
        if (!ok) continue

        const pending = w.subscribe(root, subscribe, { backend })
        const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
          log.error("failed to subscribe to plugin dir", { root, err })
          pending.then((s) => s.unsubscribe()).catch(() => {})
          return undefined
        })
        if (sub) {
          log.info("watching plugin dir", { root })
          subs.push(sub)
        }
      }

      return { subs, box }
    },
    async (state) => {
      if (state.box?.timer) clearTimeout(state.box.timer)
      if (!state.subs) return
      await Promise.all(state.subs.map((sub) => sub?.unsubscribe()))
    },
  )

  export function init() {
    if (Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER) {
      return
    }
    state()
  }
}
