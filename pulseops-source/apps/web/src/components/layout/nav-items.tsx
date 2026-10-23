import {
  Activity,
  Bell,
  Boxes,
  Bug,
  Cpu,
  Gauge,
  // GitBranch,
  LayoutDashboard,
  Settings,
  UserRound,
  Users,
  ScanSearch,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  soon?: boolean;
  /** Shown to admins only. */
  admin?: boolean;
  group: string;
};

export const NAV: NavItem[] = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard, group: "Monitor" },
  { to: "/services", label: "Services", icon: Boxes, group: "Monitor" },
  { to: "/endpoints", label: "API", icon: Activity, group: "Monitor" },
  { to: "/vitals", label: "Web Vitals", icon: Gauge, group: "Monitor" },
  // Traces is not started yet. Re-enable this entry (and the GitBranch import) when it is.
  // { to: "/traces", label: "Traces", icon: GitBranch, soon: true, group: "Monitor" },
  { to: "/resources", label: "Resources", icon: Cpu, group: "Monitor" },
  { to: "/errors", label: "Errors", icon: Bug, group: "Monitor" },
  { to: "/scans", label: "Assets", icon: ScanSearch, group: "Scan" },
  { to: "/insights", label: "Insights", icon: Sparkles, group: "Detect" },
  { to: "/alerts", label: "Alerts", icon: Bell, group: "Detect" },
  { to: "/profile", label: "Profile", icon: UserRound, group: "Configure" },
  { to: "/users", label: "Users", icon: Users, group: "Configure", admin: true },
  { to: "/settings", label: "Settings", icon: Settings, group: "Configure" },
];
