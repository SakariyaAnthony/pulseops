import { asRecord } from "@/lib/api/adapt";

export type UserRole = "admin" | "member";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string;
  projectCount: number;
};

export type UsersPage = {
  users: UserRow[];
  total: number;
  totals: { all: number; admins: number; disabled: number };
};

export type UserFilters = {
  search: string;
  role: "all" | UserRole;
  status: "all" | "active" | "disabled";
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function adaptUser(value: unknown): UserRow | null {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.email !== "string"
  )
    return null;
  return {
    id: record.id,
    email: record.email,
    name: str(record.name) || record.email,
    role: record.role === "admin" ? "admin" : "member",
    isActive: record.is_active !== false,
    createdAt: str(record.created_at),
    lastLoginAt: str(record.last_login_at),
    projectCount: count(record.project_count),
  };
}

export function adaptUsersPage(value: unknown): UsersPage {
  const record = asRecord(value);
  const list = record && Array.isArray(record.users) ? record.users : [];
  const totals = asRecord(record?.totals) ?? {};
  return {
    users: list.flatMap((item) => {
      const user = adaptUser(item);
      return user ? [user] : [];
    }),
    total: count(record?.total),
    totals: {
      all: count(totals.all),
      admins: count(totals.admins),
      disabled: count(totals.disabled),
    },
  };
}

// ---- Offline sample data. Used only when the API is not running, so the pages can still be shown. ----

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

let sampleUsers: UserRow[] = [
  {
    id: "u-demo",
    email: "demo@pulseops.dev",
    name: "Demo Operator",
    role: "admin",
    isActive: true,
    createdAt: ago(40 * DAY),
    lastLoginAt: ago(60_000),
    projectCount: 1,
  },
  {
    id: "u-ada",
    email: "ada@example.com",
    name: "Ada Lovelace",
    role: "member",
    isActive: true,
    createdAt: ago(12 * DAY),
    lastLoginAt: ago(3 * 3_600_000),
    projectCount: 2,
  },
  {
    id: "u-grace",
    email: "grace@example.com",
    name: "Grace Hopper",
    role: "admin",
    isActive: true,
    createdAt: ago(9 * DAY),
    lastLoginAt: ago(DAY),
    projectCount: 1,
  },
  {
    id: "u-alan",
    email: "alan@example.com",
    name: "Alan Turing",
    role: "member",
    isActive: false,
    createdAt: ago(5 * DAY),
    lastLoginAt: ago(4 * DAY),
    projectCount: 0,
  },
];

export function mockUsersPage(filters: UserFilters): UsersPage {
  const term = filters.search.trim().toLowerCase();
  const rows = sampleUsers.filter(
    (user) =>
      (!term ||
        user.email.toLowerCase().includes(term) ||
        user.name.toLowerCase().includes(term)) &&
      (filters.role === "all" || user.role === filters.role) &&
      (filters.status === "all" ||
        user.isActive === (filters.status === "active")),
  );
  return {
    users: rows,
    total: rows.length,
    totals: {
      all: sampleUsers.length,
      admins: sampleUsers.filter(
        (user) => user.role === "admin" && user.isActive,
      ).length,
      disabled: sampleUsers.filter((user) => !user.isActive).length,
    },
  };
}

export function mockUpdateUser(
  id: string,
  patch: { role?: UserRole; isActive?: boolean },
): UserRow {
  const target = sampleUsers.find((user) => user.id === id);
  if (!target) throw new Error("User not found");
  const activeAdmins = sampleUsers.filter(
    (user) => user.role === "admin" && user.isActive && user.id !== id,
  );
  if (
    target.email === "demo@pulseops.dev" &&
    (patch.role === "member" || patch.isActive === false)
  )
    throw new Error(
      "You cannot remove your own admin access or disable your own account",
    );
  if (
    target.role === "admin" &&
    activeAdmins.length === 0 &&
    (patch.role === "member" || patch.isActive === false)
  )
    throw new Error("At least one active admin is required");
  const next = {
    ...target,
    role: patch.role ?? target.role,
    isActive: patch.isActive ?? target.isActive,
  };
  sampleUsers = sampleUsers.map((user) => (user.id === id ? next : user));
  return next;
}
