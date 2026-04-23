import { useUser, useClerk } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, User, LogOut, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/profile", icon: User, label: "Profile" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [location] = useLocation();

  const initials = user
    ? `${user.firstName?.charAt(0) ?? ""}${user.lastName?.charAt(0) ?? ""}`.toUpperCase() || user.emailAddresses[0]?.emailAddress?.charAt(0)?.toUpperCase() || "U"
    : "U";

  return (
    <TooltipProvider>
      <div className="flex min-h-screen bg-background" data-testid="app-layout">
        {/* Sidebar */}
        <aside className="flex flex-col w-16 md:w-60 border-r border-border bg-sidebar shrink-0">
          {/* Logo */}
          <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600/20">
              <Radar className="w-5 h-5 text-indigo-400" />
            </div>
            <span className="hidden md:block font-semibold text-foreground tracking-tight">
              Career Scout
            </span>
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
                        }`}
                        data-testid={`nav-${label.toLowerCase()}`}
                      >
                        <Icon className="w-5 h-5 shrink-0" />
                        <span className="hidden md:block text-sm font-medium">{label}</span>
                      </div>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="md:hidden">
                    {label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </nav>

          {/* User menu */}
          <div className="p-2 border-t border-sidebar-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full flex items-center gap-3 justify-start px-3 py-2.5 h-auto"
                  data-testid="user-menu-trigger"
                >
                  <Avatar className="w-7 h-7 shrink-0">
                    <AvatarImage src={user?.imageUrl} />
                    <AvatarFallback className="bg-indigo-700 text-white text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden md:flex flex-col items-start min-w-0">
                    <span className="text-sm font-medium text-foreground truncate max-w-[120px]">
                      {user?.firstName || user?.emailAddresses[0]?.emailAddress?.split("@")[0]}
                    </span>
                    <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                      {user?.emailAddresses[0]?.emailAddress}
                    </span>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <User className="w-4 h-4 mr-2" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => signOut({ redirectUrl: "/" })}
                  className="text-destructive focus:text-destructive"
                  data-testid="sign-out-button"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
