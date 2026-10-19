import {
  Activity,
  Bell,
  Boxes,
  Bug,
  Cpu,
  GitBranch,
  LayoutDashboard,
  Settings,
  ScanSearch,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  soon?: boolean;
  group: string;
};

export const NAV: NavItem[] = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard, group: "Monitor" },
  { to: "/services", label: "Services", icon: Boxes, group: "Monitor" },
  { to: "/endpoints", label: "API", icon: Activity, group: "Monitor" },
  { to: "/traces", label: "Traces", icon: GitBranch, soon: true, group: "Monitor" },
  { to: "/resources", label: "Resources", icon: Cpu, group: "Monitor" },
  { to: "/errors", label: "Errors", icon: Bug, group: "Monitor" },
  { to: "/scans", label: "Scans", icon: ScanSearch, group: "Scan" },
  { to: "/insights", label: "Insights", icon: Sparkles, group: "Detect" },
  { to: "/alerts", label: "Alerts", icon: Bell, group: "Detect" },
  { to: "/settings", label: "Settings", icon: Settings, group: "Configure" },
];
