import { createMemo, createResource } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { PluginFs } from "@/plugin/fs"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogAlert } from "../ui/dialog-alert"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useToast } from "../ui/toast"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useKeybind } from "../context/keybind"

type Val = { type: "add" } | { type: "item"; item: PluginFs.Item }

function scope(scope: PluginFs.Scope) {
  return PluginFs.label(scope).toLowerCase()
}

export function DialogPlugin() {
  const dialog = useDialog()
  const toast = useToast()
  const sdk = useSDK()
  const sync = useSync()
  const keybind = useKeybind()
  const [items, { refetch }] = createResource(PluginFs.list)

  const options = createMemo(() => [
    {
      title: "Add plugin",
      value: { type: "add" } as Val,
      category: "Actions",
      description: "Copy a local .ts or .js file into a managed plugin directory",
    },
    ...(items() ?? []).map((item) => ({
      title: item.name,
      value: { type: "item", item } as Val,
      category: PluginFs.label(item.scope),
      description: `${scope(item.scope)} • ${item.dir}`,
      footer: item.path,
    })),
  ])

  async function reload(message: string) {
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    await refetch()
    toast.show({
      variant: "info",
      message,
      duration: 3000,
    })
    dialog.replace(() => <DialogPlugin />)
  }

  async function pickScope() {
    return new Promise<PluginFs.Scope | null>((resolve) => {
      dialog.replace(
        () => (
          <DialogSelect
            title="Plugin scope"
            options={[
              {
                title: "Current project",
                value: "project" as const,
                footer: PluginFs.root("project"),
              },
              {
                title: "Global",
                value: "global" as const,
                footer: PluginFs.root("global"),
              },
            ]}
            onSelect={(option) => resolve(option.value)}
          />
        ),
        () => resolve(null),
      )
    })
  }

  async function add() {
    const file = await DialogPrompt.show(dialog, "Add plugin", {
      placeholder: "/absolute/path/to/plugin.ts",
    })
    if (!file?.trim()) {
      dialog.replace(() => <DialogPlugin />)
      return
    }
    const next = await pickScope()
    if (!next) {
      dialog.replace(() => <DialogPlugin />)
      return
    }
    await PluginFs.add(file.trim(), next)
      .then((item) => reload(`Added ${item.name}`))
      .catch((err) => {
        toast.error(err)
        dialog.replace(() => <DialogPlugin />)
      })
  }

  async function detail(item: PluginFs.Item) {
    await DialogAlert.show(dialog, item.name, `Scope: ${scope(item.scope)}\nPath: ${item.path}`)
    dialog.replace(() => <DialogPlugin />)
  }

  async function remove(item: PluginFs.Item) {
    const ok = await DialogConfirm.show(dialog, "Remove plugin", `Remove ${item.name}?\n${item.path}`)
    if (!ok) {
      dialog.replace(() => <DialogPlugin />)
      return
    }
    await PluginFs.remove(item)
      .then(() => reload(`Removed ${item.name}`))
      .catch((err) => {
        toast.error(err)
        dialog.replace(() => <DialogPlugin />)
      })
  }

  return (
    <DialogSelect
      title="Plugins"
      options={options()}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "remove",
          onTrigger: (option) => {
            if (option.value.type !== "item") return
            void remove(option.value.item)
          },
        },
      ]}
      onSelect={(option) => {
        if (option.value.type === "add") {
          void add()
          return
        }
        void detail(option.value.item)
      }}
    />
  )
}
