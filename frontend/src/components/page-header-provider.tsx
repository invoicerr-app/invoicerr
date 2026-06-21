import { createContext, useCallback, useContext, useState } from "react"

import type React from "react"

type PageHeaderValue = {
    title: React.ReactNode
    icon: React.ReactNode
    actions: React.ReactNode
}

type PageHeaderSetter = (title: React.ReactNode, icon?: React.ReactNode, actions?: React.ReactNode) => void

const PageHeaderStateContext = createContext<PageHeaderValue | undefined>(undefined)
const PageHeaderSetterContext = createContext<PageHeaderSetter | undefined>(undefined)

export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
    const [value, setValue] = useState<PageHeaderValue>({ title: null, icon: null, actions: null })

    const setPageHeader = useCallback<PageHeaderSetter>((title, icon, actions) => {
        setValue({ title, icon: icon ?? null, actions: actions ?? null })
    }, [])

    return (
        <PageHeaderSetterContext.Provider value={setPageHeader}>
            <PageHeaderStateContext.Provider value={value}>
                {children}
            </PageHeaderStateContext.Provider>
        </PageHeaderSetterContext.Provider>
    )
}

export const usePageHeaderContext = () => {
    const context = useContext(PageHeaderStateContext)

    if (context === undefined) throw new Error("usePageHeaderContext must be used within a PageHeaderProvider")

    return context
}

export const useSetPageHeader = () => {
    const context = useContext(PageHeaderSetterContext)

    if (context === undefined) throw new Error("useSetPageHeader must be used within a PageHeaderProvider")

    return context
}
