import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

function AuthLock() {
  useEffect(() => {
    const lock = () => {
      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
            localStorage.removeItem(k);
          }
        }
      } catch {}
    };
    window.addEventListener("pagehide", lock);
    window.addEventListener("beforeunload", lock);
    return () => {
      window.removeEventListener("pagehide", lock);
      window.removeEventListener("beforeunload", lock);
    };
  }, []);
  return <Outlet />;
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({
        to: "/auth",
        search: { redirect: location.href },
      });
    }
  },
  component: AuthLock,
});