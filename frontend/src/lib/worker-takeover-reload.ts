export const WORKER_RELOADED_KEY = "invoicerr-sw-reloaded"

type WorkerContainer = Pick<ServiceWorkerContainer, "controller" | "addEventListener">

/**
 * A worker taking over tabs that run the previous build reloads them, once: the sessionStorage flag
 * keeps a worker that claims twice in a row from turning this into a reload loop. A page no worker
 * served came from the network and already runs the current build, so the first install leaves it
 * alone instead of wiping what the user is typing.
 */
export function reloadOnWorkerTakeover(
  container: WorkerContainer,
  storage: Pick<Storage, "getItem" | "setItem">,
  reload: () => void,
): void {
  if (!container.controller) return
  container.addEventListener("controllerchange", () => {
    try {
      if (storage.getItem(WORKER_RELOADED_KEY) === "1") return
      storage.setItem(WORKER_RELOADED_KEY, "1")
    } catch {
      // Storage unavailable (private mode, blocked site data): reload anyway, once per event.
    }
    reload()
  })
}
