import { createMemoryHistory, MemoryRouter, type BaseRouterProps } from "@solidjs/router"
import { onCleanup } from "solid-js"
import { call } from "./bridge"

export function createRouter(initial: string) {
  return function VSCodeRouter(props: BaseRouterProps) {
    const history = createMemoryHistory()
    if (initial !== "/") history.set({ value: initial, replace: true, scroll: false })
    onCleanup(history.listen((value) => { void call({ method: "route", route: value }) }))
    return <MemoryRouter {...props} history={history} />
  }
}
