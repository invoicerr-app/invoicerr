import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "bg-muted animate-[pulse_1.6s_ease-in-out_infinite] rounded-md motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
