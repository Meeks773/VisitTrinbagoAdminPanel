import { useLocation, Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@shared/schema";
import { categoryIcons } from "@/lib/category-config";
import { LayoutDashboard, Calendar, BarChart3, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import logoUrl from "@assets/visitTrinbago_1776640364814.png";

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  return (
    <Sidebar>
      <SidebarHeader className="p-5 pb-6 border-b border-sidebar-border">
        <Link href="/">
          <div className="cursor-pointer space-y-2" data-testid="link-dashboard">
            <img
              src={logoUrl}
              alt="#visitTrinbago"
              className="w-full max-w-[180px] h-auto dark:invert-0"
              data-testid="img-logo"
            />
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sidebar-accent-foreground/60">
              Content Manager
            </p>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.15em]">Overview</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/"}>
                  <Link href="/" data-testid="link-overview">
                    <LayoutDashboard className="h-4 w-4" />
                    <span className="font-semibold text-sm">Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/analytics"}>
                  <Link href="/analytics" data-testid="link-analytics">
                    <BarChart3 className="h-4 w-4" />
                    <span className="font-semibold text-sm">Analytics</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.15em]">Events</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.startsWith("/events")}>
                  <Link href="/events" data-testid="link-events">
                    <Calendar className="h-4 w-4" />
                    <span className="font-semibold text-sm">Event Calendar</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-[0.15em]">Categories</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {CATEGORIES.map((cat) => {
                const Icon = categoryIcons[cat as Category];
                const isActive = location.startsWith(`/category/${cat}`);
                return (
                  <SidebarMenuItem key={cat}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={`/category/${cat}`} data-testid={`link-category-${cat}`}>
                        <Icon className="h-4 w-4" />
                        <span className="font-semibold text-sm">{CATEGORY_LABELS[cat as Category]}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 border-t border-sidebar-border space-y-3">
        {user && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-sidebar-foreground/60 truncate" data-testid="text-current-user">
              {user.email}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full font-bold uppercase tracking-wide text-xs"
              onClick={() => logout()}
              data-testid="button-logout"
            >
              <LogOut className="h-3.5 w-3.5 mr-2" />
              Sign Out
            </Button>
          </div>
        )}
        <p className="text-[10px] font-bold text-sidebar-foreground/40 text-center uppercase tracking-[0.15em]">
          Admin Panel v1.0
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
