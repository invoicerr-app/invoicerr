import { describe, expect, it, vi } from "vitest"

import { reloadOnWorkerTakeover } from "./worker-takeover-reload"

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) }
}

function workerContainer(controlled: boolean) {
  const events = new EventTarget()
  return {
    controller: controlled ? ({} as ServiceWorker) : null,
    addEventListener: events.addEventListener.bind(events),
    takeOver: () => events.dispatchEvent(new Event("controllerchange")),
  }
}

describe("reloadOnWorkerTakeover", () => {
  it("reloads once when a new worker replaces the one that served this page", () => {
    const container = workerContainer(true)
    const reload = vi.fn()
    reloadOnWorkerTakeover(container, memoryStorage(), reload)

    container.takeOver()
    container.takeOver()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("leaves a page alone when the first worker ever installed takes control of it", () => {
    const container = workerContainer(false)
    const reload = vi.fn()
    reloadOnWorkerTakeover(container, memoryStorage(), reload)

    container.takeOver()

    expect(reload).not.toHaveBeenCalled()
  })
})
