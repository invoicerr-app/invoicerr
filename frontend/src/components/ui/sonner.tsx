"use client"

import { Toaster as Sonner } from "sonner"

// The app's OWN theme state (`main.tsx` mounts `ThemeProvider` from this same file) — NOT the
// `next-themes` package's hook, which this file imported by mistake (shadcn's default snippet):
// that package has no provider mounted anywhere in this app, so its `useTheme()` never saw a real
// theme change and toasts stayed on whatever it defaults to regardless of the app's own light/dark
// state (reported directly: notifications still rendering dark on a light UI).
import { useTheme } from "@/components/theme-provider"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
