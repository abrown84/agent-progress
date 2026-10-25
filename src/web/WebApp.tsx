import { useEffect, useState } from "react";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { DashboardPage } from "./pages/DashboardPage";
import { getPublicConfig } from "./api";

type Route = "landing" | "login" | "signup" | "dashboard";

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "") || "";
  if (hash.startsWith("login")) return "login";
  if (hash.startsWith("signup")) return "signup";
  if (hash.startsWith("dashboard")) return "dashboard";
  return "landing";
}

export function WebApp() {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [allowSignups, setAllowSignups] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    void getPublicConfig().then((c) => setAllowSignups(c.allowSignups));
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (r: Route) => {
    window.location.hash = r === "landing" ? "" : `/${r}`;
  };

  switch (route) {
    case "login":
      return <LoginPage onGo={go} allowSignups={allowSignups} />;
    case "signup":
      return <SignupPage onGo={go} allowSignups={allowSignups} />;
    case "dashboard":
      return <DashboardPage onGo={go} />;
    default:
      return <LandingPage onGo={go} allowSignups={allowSignups} />;
  }
}
