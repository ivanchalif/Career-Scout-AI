import { useState } from "react";
import { useUser, useClerk } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, User, LogOut, Radar, Mail, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/inbox", icon: Mail, label: "Email" },
  { href: "/profile", icon: User, label: "Profile" },
];

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem("sidebar-collapsed") === "true";
  } catch {
    return false;
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);

  const initials = user
    ? `${user.firstName?.charAt(0) ?? ""}${user.lastName?.charAt(0) ?? ""}`.toUpperCase() || user.emailAddresses[0]?.emailAddress?.charAt(0)?.toUpperCase() || "U"
    : "U";

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("sidebar-collapsed", String(next)); } catch {}
      return next;
    });
  }

  return (
    <TooltipProvider>
      <div className="flex min-h-screen bg-background" data-testid="app-layout">
        {/* Sidebar */}
        <aside
          className={`relative flex flex-col border-r border-border bg-sidebar shrink-0 transition-[width] duration-200 ease-in-out ${collapsed ? "w-16" : "w-60"}`}
        >
          {/* Logo + collapse toggle */}
          <div className="flex items-center border-b border-sidebar-border h-[60px] shrink-0">
            {!collapsed && (
              <div className="flex items-center gap-3 pl-4 flex-1 min-w-0">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600/20 shrink-0">
                  <Radar className="w-5 h-5 text-indigo-400" />
                </div>
                <span className="font-semibold text-foreground tracking-tight whitespace-nowrap overflow-hidden">
                  Career Scout
                </span>
              </div>
            )}
            <button
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              data-testid="sidebar-toggle"
              className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors ${collapsed ? "mx-auto" : "mr-3 ml-auto"}`}
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>

          {/* Account info */}
          <div className={`flex items-center gap-3 px-4 py-3 border-b border-sidebar-border overflow-hidden ${collapsed ? "justify-center px-2" : ""}`}>
            <Avatar className="w-8 h-8 shrink-0">
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback className="bg-indigo-700 text-white text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium text-foreground truncate max-w-[140px]">
                  {user?.firstName && user?.lastName
                    ? `${user.firstName} ${user.lastName}`
                    : user?.firstName || user?.emailAddresses[0]?.emailAddress?.split("@")[0]}
                </span>
                <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                  {user?.emailAddresses[0]?.emailAddress}
                </span>
              </div>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex flex-col gap-1 p-2 flex-1">
            {navItems.map(({ href, icon: Icon, label }) => {
              const active = location.startsWith(href);
              return (
                <Tooltip key={href} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Link href={href}>
                      <div
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                          active
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                        } ${collapsed ? "justify-center px-2" : ""}`}
                        data-testid={`nav-${label.toLowerCase()}`}
                      >
                        <Icon className="w-5 h-5 shrink-0" />
                        {!collapsed && (
                          <span className="text-sm font-medium whitespace-nowrap">{label}</span>
                        )}
                      </div>
                    </Link>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">{label}</TooltipContent>
                  )}
                </Tooltip>
              );
            })}
          </nav>

          {/* Sign out */}
          <div className="p-2 border-t border-sidebar-border">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  className={`w-full flex items-center gap-3 justify-start px-3 py-2.5 h-auto text-muted-foreground hover:text-destructive hover:bg-destructive/10 ${collapsed ? "justify-center px-2" : ""}`}
                  onClick={() => signOut({ redirectUrl: "/" })}
                  data-testid="sign-out-button"
                >
                  <LogOut className="w-5 h-5 shrink-0" />
                  {!collapsed && (
                    <span className="text-sm font-medium">Sign out</span>
                  )}
                </Button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">Sign out</TooltipContent>
              )}
            </Tooltip>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-auto">
          {children}
        </main>
      </div>
    </TooltipProvider>
  );
}
