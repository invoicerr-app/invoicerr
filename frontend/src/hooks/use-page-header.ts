import { useEffect } from "react"

import type React from "react"
import { useSetPageHeader } from "@/components/page-header-provider"

export function usePageHeader(title: React.ReactNode, icon?: React.ReactNode, actions?: React.ReactNode) {
    const setPageHeader = useSetPageHeader()

    useEffect(() => {
        setPageHeader(title, icon, actions)
        return () => setPageHeader(null)
    })
}
