import { useEffect, useState } from "react"

import { Navigate } from "react-router"
import { signOut } from "@/lib/sign-out"

export default function LogoutPage() {
  const [isLoggedOut, setIsLoggedOut] = useState(false)

  useEffect(() => {
    void signOut().then(() => {
      setIsLoggedOut(true)
    })
  }, [])

  if (isLoggedOut) {
    return <Navigate to="/auth/sign-in" />
  }

  return null
}
