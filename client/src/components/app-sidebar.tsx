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
import { LayoutDashboard, Globe } from "lucide-react";

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer" data-testid="link-dashboard">
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary">
              <Globe className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">VisitTrinbago</h2>
              <p className="text-xs text-muted-foreground">Content Manager</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Overview</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/"}>
                  <Link href="/" data-testid="link-overview">
                    <LayoutDashboard className="h-4 w-4" />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Categories</SidebarGroupLabel>
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
                        <span>{CATEGORY_LABELS[cat as Category]}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <p className="text-xs text-muted-foreground text-center">
          Admin Panel v1.0
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
