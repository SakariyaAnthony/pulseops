import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, ShieldCheck, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { Segmented } from "@/components/shared/segmented";
import { InlineError } from "@/components/shared/states";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useUsersQuery } from "@/hooks/queries";
import { api } from "@/lib/api/client";
import type { UserFilters, UserRole, UserRow } from "@/lib/api/users";
import { formatRelative } from "@/lib/format";
import { useSession } from "@/store/session";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function UsersPage() {
  const role = useSession((state) => state.role);
  const me = useSession((state) => state.email);
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserFilters["role"]>("all");
  const [status, setStatus] = useState<UserFilters["status"]>("all");
  const filters: UserFilters = {
    search: useDebounced(search),
    role: roleFilter,
    status,
  };
  const query = useUsersQuery(filters, role === "admin");

  useEffect(() => {
    document.title = "Users · PulseOps";
  }, []);

  const update = useMutation({
    mutationFn: (input: { id: string; role?: UserRole; isActive?: boolean }) =>
      api.updateUser(input.id, { role: input.role, isActive: input.isActive }),
    onSuccess: async (user) => {
      await client.invalidateQueries({ queryKey: ["users"] });
      toast.success(`${user.name} updated`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (role !== "admin") {
    return (
      <div>
        <PageHeader eyebrow="Configure" title="Users" />
        <Panel title="Admins only">
          <p className="text-sm leading-6 text-dim">
            Only an admin can see and manage accounts. Ask an admin if you need
            a role change. If you were promoted recently, sign out and back in.
          </p>
        </Panel>
      </div>
    );
  }

  const data = query.data;
  return (
    <div>
      <PageHeader
        eyebrow="Configure"
        title="Users"
        description="Everyone who has an account. Admins can change roles and switch accounts off. A disabled user is signed out and cannot sign in again until you turn them back on."
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat icon={Users} label="Accounts" value={data?.totals.all} />
        <Stat
          icon={ShieldCheck}
          label="Active admins"
          value={data?.totals.admins}
        />
        <Stat icon={UserX} label="Disabled" value={data?.totals.disabled} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute"
            aria-hidden
          />
          <Input
            aria-label="Search users"
            placeholder="Search name or email"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Segmented
          label="Role"
          value={roleFilter}
          onChange={setRoleFilter}
          options={[
            { id: "all", label: "All roles" },
            { id: "admin", label: "Admins" },
            { id: "member", label: "Members" },
          ]}
        />
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { id: "all", label: "Any status" },
            { id: "active", label: "Active" },
            { id: "disabled", label: "Disabled" },
          ]}
        />
      </div>

      {query.isLoading ? (
        <Skeleton className="h-80" />
      ) : query.isError ? (
        <InlineError
          title="Could not load users"
          message={
            query.error instanceof Error
              ? query.error.message
              : "The API did not respond."
          }
          onRetry={() => void query.refetch()}
          pending={query.isFetching}
        />
      ) : (
        <Panel>
          {data && data.users.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-mute">
                  <tr>
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="py-2 pr-3 font-medium">Role</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 text-right font-medium">
                      Projects
                    </th>
                    <th className="py-2 pr-3 font-medium">Joined</th>
                    <th className="py-2 font-medium">Last sign-in</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((user) => (
                    <UserRowView
                      key={user.id}
                      user={user}
                      isSelf={user.email === me}
                      busy={
                        update.isPending && update.variables?.id === user.id
                      }
                      onRole={(next) =>
                        update.mutate({ id: user.id, role: next })
                      }
                      onActive={(next) =>
                        update.mutate({ id: user.id, isActive: next })
                      }
                    />
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-mute">
                Showing {data.users.length} of {data.total}. You cannot demote
                or disable yourself, and the last active admin is protected.
              </p>
            </div>
          ) : (
            <p className="text-sm text-dim">No users match these filters.</p>
          )}
        </Panel>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value?: number;
}) {
  return (
    <section className="glass shadow-card flex items-center gap-4 rounded-xl2 px-5 py-4">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet/15 text-violet">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-mute">
          {label}
        </p>
        <p className="num text-2xl font-semibold text-ink">{value ?? "—"}</p>
      </div>
    </section>
  );
}

function when(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? "Never" : formatRelative(time);
}

function UserRowView({
  user,
  isSelf,
  busy,
  onRole,
  onActive,
}: {
  user: UserRow;
  isSelf: boolean;
  busy: boolean;
  onRole: (role: UserRole) => void;
  onActive: (active: boolean) => void;
}) {
  const joined = Date.parse(user.createdAt);
  return (
    <tr className={cn("border-t border-line", !user.isActive && "opacity-70")}>
      <td className="py-3 pr-3">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-medium text-ink">
              {user.name}
              {isSelf ? (
                <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] text-dim">
                  You
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-mute">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="py-3 pr-3">
        <Select
          value={user.role}
          onValueChange={(next) => onRole(next as UserRole)}
          disabled={isSelf || busy}
        >
          <SelectTrigger
            aria-label={`Role for ${user.name}`}
            className="h-8 w-32"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="member">Member</SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td className="py-3 pr-3">
        <label className="flex items-center gap-2 text-xs text-dim">
          <Switch
            checked={user.isActive}
            disabled={isSelf || busy}
            onCheckedChange={onActive}
            aria-label={`${user.isActive ? "Disable" : "Enable"} ${user.name}`}
          />
          <span className={user.isActive ? "text-success" : "text-danger"}>
            {user.isActive ? "Active" : "Disabled"}
          </span>
        </label>
      </td>
      <td className="num py-3 pr-3 text-right text-ink">{user.projectCount}</td>
      <td className="py-3 pr-3 text-xs text-dim">
        {Number.isNaN(joined) ? "—" : new Date(joined).toLocaleDateString()}
      </td>
      <td className="py-3 text-xs text-dim">{when(user.lastLoginAt)}</td>
    </tr>
  );
}
