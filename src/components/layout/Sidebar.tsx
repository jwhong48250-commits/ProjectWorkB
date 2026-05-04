import { useEffect, useMemo, useState, useRef, useId } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import {
  Home,
  History,
  Plus,
  Mic,
  Users,
  LayoutGrid,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  FileText,
  ListTodo,
  Link2,
  Gauge,
  Building2,
  UserRound,
  X,
  CalendarDays,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Check,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import Tooltip from "../ui/Tooltip";
import { useAuth } from "../../context/AuthContext";
import {
  getCurrentWorkspaceId,
  getCurrentWorkspaceRole,
  setCurrentWorkspaceId,
  setCurrentWorkspaceRole,
  WORKSPACE_CHANGED_EVENT,
  WORKSPACE_ROLE_CHANGED_EVENT,
} from "../../utils/workspace";
import { useWorkspaceLogo } from "../../utils/workspaceLogo";
import { useProfileImage } from "../../utils/profileImage";
import {
  fetchMyWorkspaces,
  type WorkspaceListItem,
} from "../../api/workspaces";

interface Workspace {
  id: number;
  name: string;
  initial: string;
  color: string;
  role: string;
}

function colorForWorkspace(id: number): string {
  const palette = [
    "#6b78f6",
    "#22c55e",
    "#f97316",
    "#ec4899",
    "#eab308",
    "#14b8a6",
    "#8b5cf6",
    "#64748b",
  ];
  return palette[Math.abs(id) % palette.length];
}

function initialForName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toUpperCase() : "?";
}

function toUiWorkspace(w: WorkspaceListItem): Workspace {
  return {
    id: w.id,
    name: w.name,
    initial: initialForName(w.name),
    color: colorForWorkspace(w.id),
    role: w.role,
  };
}

// ── 워크스페이스 셀렉터 서브컴포넌트 ─────────────────────────────────────────
interface WorkspaceSelectorProps {
  collapsed: boolean;
}

function WorkspaceSelector({ collapsed }: WorkspaceSelectorProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<number>(() =>
    getCurrentWorkspaceId()
  );
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const profileImage = useProfileImage(user?.id);

  const current = useMemo(
    () => workspaces.find((w) => w.id === currentId) ?? workspaces[0],
    [workspaces, currentId]
  );

  function loadWorkspaces() {
    let mounted = true;
    const request = fetchMyWorkspaces()
      .then((rows) => {
        if (!mounted) return;
        const ui = rows.map(toUiWorkspace);
        setWorkspaces(ui);

        const stored = getCurrentWorkspaceId();
        const next = ui.some((w) => w.id === stored) ? stored : ui[0]?.id;
        if (next && next !== stored) setCurrentWorkspaceId(next);
        if (next) setCurrentId(next);

        const currentWs = ui.find((w) => w.id === (next ?? stored)) ?? ui[0];
        if (currentWs) setCurrentWorkspaceRole(currentWs.role);
      })
      .catch(() => {
        // 목록 API가 실패해도 앱이 완전히 멈추지 않도록 빈 목록 유지
        if (!mounted) return;
        setWorkspaces([]);
      });

    return {
      request,
      cancel: () => {
        mounted = false;
      },
    };
  }

  // 워크스페이스 목록 로드 + 현재 선택 보정
  useEffect(() => {
    const loader = loadWorkspaces();
    return () => {
      loader.cancel();
    };
  }, []);

  useEffect(() => {
    function handleWorkspaceChanged(event: Event) {
      const nextId = (event as CustomEvent<{ id: number }>).detail?.id;
      if (Number.isFinite(nextId) && nextId > 0) setCurrentId(nextId);

      const loader = loadWorkspaces();
      loader.request.finally(() => loader.cancel());
    }

    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
    return () => {
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
    };
  }, []);

  // 외부 클릭·ESC로 닫기, 포커스 복귀
  useEffect(() => {
    if (!open) return;
    function handleDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function select(ws: Workspace) {
    setCurrentId(ws.id);
    setOpen(false);
    triggerRef.current?.focus();
    setCurrentWorkspaceId(ws.id);
    setCurrentWorkspaceRole(ws.role);
    navigate("/");
  }

  if (!current) {
    // 로딩/빈 목록일 때 레이아웃 유지
    return (
      <div
        className={clsx("flex items-center", collapsed ? "justify-center" : "")}
      >
        <span className="text-sm text-muted-foreground truncate">
          워크스페이스
        </span>
      </div>
    );
  }

  function renderWorkspaceAvatar(ws: Workspace, size: "sm" | "md") {
    const sizeClass = size === "sm" ? "w-5 h-5 text-[10px]" : "w-6 h-6 text-xs";

    if (profileImage) {
      return (
        <img
          src={profileImage}
          alt={user?.name ?? ws.name}
          className={clsx(sizeClass, "rounded object-cover shrink-0")}
        />
      );
    }

    return (
      <span
        className={clsx(
          sizeClass,
          "rounded flex items-center justify-center text-white font-bold shrink-0"
        )}
        style={{ backgroundColor: ws.color }}
        aria-hidden="true"
      >
        {ws.initial}
      </span>
    );
  }

  // 아이콘(아바타)은 collapsed 상태에서도 표시
  const avatar = renderWorkspaceAvatar(current, "md");

  if (collapsed) {
    return (
      <Tooltip label={current.name} placement="right" block={false}>
        <div className="flex justify-center">{avatar}</div>
      </Tooltip>
    );
  }

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      {/* 트리거 */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`현재 워크스페이스: ${current.name}. 클릭해 변경`}
        className="flex items-center gap-2 w-full rounded px-1 py-0.5 hover:bg-sidebar-hover transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {avatar}
        <span className="flex-1 text-sm font-medium truncate text-sidebar-foreground text-left">
          {current.name}
        </span>
        <ChevronDown
          size={13}
          className={clsx(
            "text-muted-foreground shrink-0 transition-transform duration-150",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {/* 드롭다운 */}
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="워크스페이스 목록"
          className="absolute left-0 top-full mt-1 z-50 w-full bg-card border border-border rounded-lg shadow-lg py-1 overflow-hidden"
        >
          {workspaces.map((ws) => {
            const isSelected = ws.id === currentId;
            return (
              <li key={ws.id} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onClick={() => select(ws)}
                  className={clsx(
                    "flex items-center gap-2 w-full px-2.5 py-1.5 text-sm transition-colors",
                    isSelected
                      ? "bg-sidebar-active text-accent"
                      : "text-foreground hover:bg-muted"
                  )}
                >
                  {renderWorkspaceAvatar(ws, "sm")}
                  <span className="flex-1 truncate text-left">{ws.name}</span>
                  {isSelected && (
                    <Check
                      size={13}
                      className="text-accent shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface NavItemDef {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  adminOnly?: boolean;
  /** 워크스페이스 뷰어에게 숨김 (회의 생성 등) */
  hideFromViewer?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItemDef[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "홈",
    items: [
      { to: "/", label: "홈 대시보드", icon: Home },
      { to: "/history", label: "회의 히스토리", icon: History },
      { to: "/calendar", label: "전체 캘린더", icon: CalendarDays },
    ],
  },
  {
    label: "회의",
    items: [
      {
        to: "/meetings/new",
        label: "회의 생성 · 예약",
        icon: Plus,
        hideFromViewer: true,
      },
    ],
  },
  {
    label: "회의 후",
    items: [
      { to: "/meetings/post", label: "회의록 · 보고서", icon: FileText },
      { to: "/meetings/wbs-select", label: "WBS · 태스크", icon: ListTodo },
    ],
  },
  {
    label: "설정",
    items: [
      {
        to: "/settings/workspace",
        label: "워크스페이스",
        icon: LayoutGrid,
        adminOnly: true,
      },
      {
        to: "/settings/members",
        label: "멤버 · 권한",
        icon: Users,
        adminOnly: true,
      },
      {
        to: "/settings/departments",
        label: "부서 관리",
        icon: Building2,
        adminOnly: true,
      },
      { to: "/settings/voice", label: "화자 등록", icon: Mic },
      {
        to: "/settings/integrations",
        label: "연동 관리",
        icon: Link2,
        adminOnly: true,
      },
      { to: "/settings/device", label: "장비 설정", icon: Gauge, adminOnly: true },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function Sidebar({
  collapsed,
  onToggle,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const { user } = useAuth();
  const settingsPath = "/settings/my";
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspaceId());
  const [workspaceRole, setWorkspaceRoleState] = useState(() => getCurrentWorkspaceRole());
  const workspaceLogoUrl = useWorkspaceLogo(workspaceId);
  const profileImage = useProfileImage(user?.id);
  const isWorkspaceAdmin = workspaceRole === "admin";

  useEffect(() => {
    function handleWorkspaceChanged(event: Event) {
      const nextId = (event as CustomEvent<{ id: number }>).detail?.id;
      if (Number.isFinite(nextId) && nextId > 0) setWorkspaceId(nextId);
    }

    function handleWorkspaceRoleChanged(event: Event) {
      const nextRole = (event as CustomEvent<{ role: string }>).detail?.role;
      setWorkspaceRoleState(nextRole || getCurrentWorkspaceRole());
    }

    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
    window.addEventListener(WORKSPACE_ROLE_CHANGED_EVENT, handleWorkspaceRoleChanged);
    return () => {
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
      window.removeEventListener(WORKSPACE_ROLE_CHANGED_EVENT, handleWorkspaceRoleChanged);
    };
  }, []);

  // 모바일: ESC로 닫기
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMobileClose?.();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {/* 모바일 백드롭 */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        id="nav_side_menu"
        aria-label="주 내비게이션 패널"
        {...(mobileOpen ? { "aria-modal": true } : {})}
        className={clsx(
          "flex flex-col bg-sidebar border-r border-sidebar-border text-sidebar-foreground h-screen",
          // 모바일: 고정 오버레이
          "fixed inset-y-0 left-0 z-50 w-64",
          "transition-[transform,width] duration-200 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // 데스크톱(md+): flow-in, 너비 전환
          "md:relative md:z-auto md:translate-x-0 md:shrink-0",
          collapsed ? "md:w-12" : "md:w-56"
        )}
      >
        {/* 헤더 — 워크스페이스 셀렉터 */}
        <div
          className={clsx(
            "flex gap-2 border-b border-sidebar-border shrink-0",
            collapsed
              ? "flex-col items-center justify-center px-1.5 py-2"
              : "items-center justify-between px-2.5 py-2.5"
          )}
        >
          {/* 로고 (collapsed 시에는 홈 링크 역할) */}
          {collapsed ? (
            <>
              <Tooltip label="홈으로 이동" placement="right" block={false}>
                <Link
                  to="/"
                  className="flex items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  aria-label="홈으로 이동"
                >
                  <img
                    src={workspaceLogoUrl}
                    alt="Workb 로고"
                    className="w-6 h-6 rounded object-cover shrink-0"
                  />
                </Link>
              </Tooltip>
            </>
          ) : (
            /* 펼쳐진 상태: 로고 + 워크스페이스 셀렉터 */
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Link
                to="/"
                className="flex items-center shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                aria-label="홈으로 이동"
                tabIndex={-1}
              >
                <img
                  src={workspaceLogoUrl}
                  alt="Workb 로고"
                  className="w-6 h-6 rounded object-cover"
                />
              </Link>
              <WorkspaceSelector collapsed={false} />
            </div>
          )}

          {/* 데스크톱 전용: 헤더 접기/펼치기 버튼 */}
          <button
            onClick={onToggle}
            aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            aria-controls="nav_side_menu"
            aria-expanded={!collapsed}
            className="hidden md:flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground transition-colors shrink-0"
          >
            {collapsed ? (
              <PanelLeftOpen size={14} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={14} aria-hidden="true" />
            )}
          </button>
        </div>

        {/* 내비게이션 스크롤 영역 */}
        <nav
          className="flex-1 overflow-y-auto py-2"
          role="navigation"
          aria-label="주 내비게이션"
        >
          {NAV_GROUPS.map((group, groupIdx) => {
            const items = group.items.filter((item) => {
              if (item.adminOnly && !isWorkspaceAdmin) return false;
              if (item.hideFromViewer && workspaceRole === "viewer")
                return false;
              return true;
            });
            if (items.length === 0) return null;

            return (
              <div key={group.label} className={groupIdx > 0 ? "mt-1" : ""}>
                {/* 그룹 레이블 */}
                {!collapsed ? (
                  <div className="mx-3 mt-3 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-micro font-medium text-muted-foreground/60 uppercase tracking-widest">
                        {group.label}
                      </span>
                      <div className="flex-1 border-t border-sidebar-border" />
                    </div>
                  </div>
                ) : groupIdx > 0 ? (
                  <div className="mx-2.5 my-2 border-t border-sidebar-border" />
                ) : null}

                {/* 아이템 */}
                <div className="px-1.5">
                  {items.map((item) => (
                    <Tooltip
                      key={item.to}
                      label={collapsed ? item.label : ""}
                      placement="right"
                      block
                    >
                      <NavLink
                        to={item.to}
                        end={item.to === "/"}
                        aria-current={undefined}
                        className={({ isActive }) =>
                          clsx(
                            "flex items-center gap-2.5 w-full px-2 py-1.5 rounded text-sm transition-colors",
                            "text-sidebar-foreground hover:bg-sidebar-hover cursor-pointer",
                            collapsed ? "justify-center" : "",
                            isActive &&
                              "bg-sidebar-active text-accent font-medium"
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon
                              size={15}
                              className={clsx(
                                "shrink-0",
                                isActive ? "text-accent" : ""
                              )}
                              aria-hidden="true"
                            />
                            {!collapsed && (
                              <span className="flex-1 truncate">
                                {item.label}
                              </span>
                            )}
                            {!collapsed && item.badge && item.badge > 0 && (
                              <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-accent-foreground text-micro font-medium">
                                {item.badge}
                              </span>
                            )}
                          </>
                        )}
                      </NavLink>
                    </Tooltip>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* 가장자리 핸들 토글 (데스크톱 전용) */}
        <button
          onClick={onToggle}
          aria-label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
          aria-controls="nav_side_menu"
          aria-expanded={!collapsed}
          className={clsx(
            "hidden md:flex absolute top-1/2 -translate-y-1/2 translate-x-1/2 z-10",
            "items-center justify-center w-5 h-9 rounded-r-md",
            "bg-sidebar border border-sidebar-border",
            "text-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground",
            "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
            "right-0"
          )}
        >
          {collapsed ? (
            <ChevronsRight size={13} aria-hidden="true" />
          ) : (
            <ChevronsLeft size={13} aria-hidden="true" />
          )}
        </button>

        {/* 푸터 */}
        <div className="border-t border-sidebar-border py-1.5 px-1.5 shrink-0">
          {/* 설정 */}
          <Tooltip label={collapsed ? "마이페이지" : ""} placement="right" block>
            <NavLink
              to={settingsPath}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2.5 w-full px-2 py-1.5 rounded text-sm transition-colors text-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground",
                  collapsed ? "justify-center" : "",
                  isActive && "bg-sidebar-active text-accent"
                )
              }
            >
              {profileImage ? (
                <img
                  src={profileImage}
                  alt={user?.name ?? "마이페이지"}
                  className="w-[15px] h-[15px] rounded-full object-cover shrink-0"
                />
              ) : (
                <UserRound size={15} className="shrink-0" aria-hidden="true" />
              )}
              {!collapsed && <span className="flex-1">마이페이지</span>}
            </NavLink>
          </Tooltip>

          {/* 고객지원 — 페이지로 이동 */}
          <Tooltip label={collapsed ? "고객지원" : ""} placement="right" block>
            <NavLink
              to="/support"
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2.5 w-full px-2 py-1.5 rounded text-sm transition-colors text-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground",
                  collapsed ? "justify-center" : "",
                  isActive && "bg-sidebar-active text-accent"
                )
              }
            >
              <HelpCircle size={15} className="shrink-0" aria-hidden="true" />
              {!collapsed && <span className="flex-1">고객지원</span>}
            </NavLink>
          </Tooltip>

          {/* 모바일: 닫기 버튼 */}
          <button
            onClick={onMobileClose}
            className={clsx(
              "md:hidden flex items-center gap-2.5 w-full px-2 py-1.5 rounded text-sm text-muted-foreground",
              "hover:bg-sidebar-hover hover:text-sidebar-foreground transition-colors"
            )}
            aria-label="사이드바 닫기"
          >
            <X size={15} aria-hidden="true" />
            <span>닫기</span>
          </button>

          {/* 데스크톱: 접기/펼치기 토글 — 항상 노출 */}
          <Tooltip
            label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            placement="right"
            block
          >
            <button
              onClick={onToggle}
              aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
              aria-controls="nav_side_menu"
              aria-expanded={!collapsed}
              className={clsx(
                "hidden md:flex items-center gap-2.5 w-full px-2 py-1.5 rounded text-sm text-muted-foreground",
                "hover:bg-sidebar-hover hover:text-sidebar-foreground transition-colors",
                collapsed ? "justify-center" : ""
              )}
            >
              {collapsed ? (
                <PanelLeftOpen size={15} aria-hidden="true" />
              ) : (
                <>
                  <PanelLeftClose size={15} aria-hidden="true" />
                  <span>접기</span>
                </>
              )}
            </button>
          </Tooltip>
        </div>
      </aside>
    </>
  );
}
