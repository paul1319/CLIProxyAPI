import {
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageTransition } from '@/components/common/PageTransition';
import { MainRoutes } from '@/router/MainRoutes';
import { authFilesApi, pluginsApi } from '@/services/api';
import {
  IconChevronDown,
  IconGlobe,
  IconLogOut,
  IconMenu,
  IconMonitor,
  IconMoon,
  IconPanelLeft,
  IconRefreshCw,
  IconSidebarAuthFiles,
  IconSidebarConfig,
  IconSidebarDashboard,
  IconSidebarLogs,
  IconSidebarOauth,
  IconSidebarPlugins,
  IconSidebarQuota,
  IconSidebarSystem,
  IconSun,
  IconX,
} from '@/components/ui/icons';
import { StatusLamp, type LampState } from '@/components/ui/StatusLamp';
import { INLINE_LOGO_PNG } from '@/assets/logoInline';
import {
  useAuthStore,
  useConfigStore,
  useLanguageStore,
  useNotificationStore,
  useThemeStore,
} from '@/stores';
import { AUTH_FILES_CHANGED_EVENT } from '@/features/authFiles/authFilesEvents';
import {
  collectPluginResourceEntries,
  PLUGIN_RESOURCES_REFRESH_EVENT,
  resolvePluginAssetURL,
  type PluginResourceEntry,
} from '@/features/plugins/pluginResources';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';
import { getSidebarShortcutLabel, isSidebarToggleShortcut } from '@/utils/sidebarShortcut';
import type { AuthFileItem, Theme } from '@/types';
import { getPoolLampState, summarizePool, type PoolSummary } from './poolRail';

const sidebarIcons: Record<string, ReactNode> = {
  dashboard: <IconSidebarDashboard size={16} />,
  authFiles: <IconSidebarAuthFiles size={16} />,
  oauth: <IconSidebarOauth size={16} />,
  quota: <IconSidebarQuota size={16} />,
  config: <IconSidebarConfig size={16} />,
  logs: <IconSidebarLogs size={16} />,
  system: <IconSidebarSystem size={16} />,
};

interface SidebarNavLinkItem {
  kind?: 'link';
  path: string;
  labelKey?: string;
  metaKey?: string;
  label?: string;
  meta?: string;
  badge?: number;
  badgeLabel?: string;
  badgeTone?: LampState;
  icon: ReactNode;
}

interface SidebarNavDrawerItem {
  kind: 'drawer';
  id: string;
  label: string;
  meta?: string;
  icon: ReactNode;
  children: SidebarNavLinkItem[];
}

type SidebarNavItem = SidebarNavLinkItem | SidebarNavDrawerItem;

interface SidebarNavGroup {
  id: string;
  labelKey: string;
  items: SidebarNavItem[];
}

const NAV_TOOLTIP_ID = 'sidebar-nav-tooltip';
const NAV_TOOLTIP_VIEWPORT_MARGIN = 8;
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'cpa.sidebarCollapsed';
const POOL_REFRESH_INTERVAL_MS = 60 * 1000;
const POOL_RAIL_MAX_LAMPS = 48;

const LANGUAGE_SHORT_LABELS: Record<string, string> = {
  'zh-CN': '简',
  'zh-TW': '繁',
  en: 'EN',
  ru: 'RU',
  vi: 'VI',
  ko: 'KO',
};

const THEME_OPTIONS: Array<{ key: Theme; labelKey: string; icon: ReactNode }> = [
  { key: 'auto', labelKey: 'theme.auto', icon: <IconMonitor size={14} /> },
  { key: 'light', labelKey: 'theme.light', icon: <IconSun size={14} /> },
  { key: 'dark', labelKey: 'theme.dark', icon: <IconMoon size={14} /> },
];

const readCollapsedPreference = () => {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const formatHost = (apiBase: string) => apiBase.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

/** Close the menu when clicking outside it or pressing Escape. */
function useMenuDismiss(
  open: boolean,
  menuRef: RefObject<HTMLDivElement | null>,
  onClose: () => void
) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, menuRef, onClose]);
}

function PluginSidebarIcon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return showImage ? (
    <img src={src} alt="" onError={() => setFailed(true)} />
  ) : (
    <IconSidebarPlugins size={16} />
  );
}

function PoolRail({
  summary,
  compact,
  onNavigate,
}: {
  summary: PoolSummary | null;
  compact: boolean;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const total = summary?.total ?? 0;
  const serving = summary?.serving ?? 0;
  const attention = (summary?.failing ?? 0) + (summary?.cooling ?? 0);
  const caption = !summary
    ? '—'
    : total === 0
      ? t('sidebar.pool_empty')
      : t('sidebar.pool_serving', { serving, total });
  const visibleLamps = summary?.lamps.slice(0, POOL_RAIL_MAX_LAMPS) ?? [];
  const hiddenCount = (summary?.lamps.length ?? 0) - visibleLamps.length;
  const ariaLabel = `${t('sidebar.pool_label')}: ${caption}${
    attention > 0 ? `, ${t('sidebar.pool_problem', { count: attention })}` : ''
  }`;

  if (compact) {
    return (
      <NavLink
        to="/auth-files"
        className="pool-rail pool-rail-compact"
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={onNavigate}
      >
        <StatusLamp state={summary ? getPoolLampState(summary) : 'idle'} />
        <span className="pool-rail-fraction">
          {serving}/{total}
        </span>
      </NavLink>
    );
  }

  return (
    <NavLink to="/auth-files" className="pool-rail" aria-label={ariaLabel} onClick={onNavigate}>
      <span className="pool-rail-head">
        <span className="pool-rail-label">{t('sidebar.pool_label')}</span>
        <span className="pool-rail-fraction">{summary ? `${serving}/${total}` : '—'}</span>
      </span>
      {visibleLamps.length > 0 ? (
        <span className="pool-rail-lamps" aria-hidden="true">
          {visibleLamps.map((lamp) => (
            <span
              key={lamp.id}
              className={`pool-rail-lamp pool-rail-lamp-${lamp.state}`}
              title={lamp.label}
            />
          ))}
          {hiddenCount > 0 ? <span className="pool-rail-more">+{hiddenCount}</span> : null}
        </span>
      ) : null}
      <span className={`pool-rail-caption ${attention > 0 ? 'has-attention' : ''}`}>
        {attention > 0 ? t('sidebar.pool_problem', { count: attention }) : caption}
      </span>
    </NavLink>
  );
}

export function MainLayout() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const location = useLocation();

  const logout = useAuthStore((state) => state.logout);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);

  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);

  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsedPreference);
  const [poolFiles, setPoolFiles] = useState<AuthFileItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [railTooltip, setRailTooltip] = useState<{
    targetID: string;
    label: string;
    meta?: string;
    anchorTop: number;
    top: number;
  } | null>(null);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [pluginResources, setPluginResources] = useState<PluginResourceEntry[]>([]);
  const [expandedPluginResourceIDs, setExpandedPluginResourceIDs] = useState<Set<string>>(
    () => new Set()
  );
  const contentRef = useRef<HTMLDivElement | null>(null);
  const poolRequestRef = useRef(0);
  const railTooltipRef = useRef<HTMLDivElement | null>(null);
  const focusedRailItemRef = useRef<HTMLElement | null>(null);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileBarRef = useRef<HTMLElement | null>(null);

  const isLogsPage = location.pathname.startsWith('/logs');
  const isPluginResourcePage = location.pathname.startsWith('/plugin-pages');
  const showSidebarLabels = !sidebarCollapsed || sidebarOpen;
  const poolSummary = useMemo(() => (poolFiles ? summarizePool(poolFiles) : null), [poolFiles]);
  const host = formatHost(apiBase);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // Storage may be unavailable (private mode); the preference is then per-session.
    }
  }, [sidebarCollapsed]);

  // Keep the mobile bar height available to sticky elements (e.g. config field scroll margins).
  useLayoutEffect(() => {
    const updateHeaderHeight = () => {
      const height = mobileBarRef.current?.offsetHeight ?? 0;
      document.documentElement.style.setProperty('--header-height', `${height}px`);
    };

    updateHeaderHeight();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && mobileBarRef.current
        ? new ResizeObserver(updateHeaderHeight)
        : null;
    if (resizeObserver && mobileBarRef.current) {
      resizeObserver.observe(mobileBarRef.current);
    }
    window.addEventListener('resize', updateHeaderHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);

  useLayoutEffect(() => {
    if (!railTooltip) return;

    const updateRailTooltipPosition = () => {
      const tooltip = railTooltipRef.current;
      if (!tooltip) return;

      const halfHeight = tooltip.offsetHeight / 2;
      const minTop = NAV_TOOLTIP_VIEWPORT_MARGIN + halfHeight;
      const maxTop = Math.max(
        minTop,
        window.innerHeight - NAV_TOOLTIP_VIEWPORT_MARGIN - halfHeight
      );
      const top = Math.min(maxTop, Math.max(minTop, railTooltip.anchorTop));

      setRailTooltip((current) => {
        if (!current || current.targetID !== railTooltip.targetID || current.top === top) {
          return current;
        }
        return { ...current, top };
      });
    };

    updateRailTooltipPosition();
    window.addEventListener('resize', updateRailTooltipPosition);
    return () => window.removeEventListener('resize', updateRailTooltipPosition);
  }, [railTooltip]);

  // Keep the content center available to bottom overlays that align with the main area.
  useLayoutEffect(() => {
    const updateContentCenter = () => {
      const el = contentRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      document.documentElement.style.setProperty('--content-center-x', `${centerX}px`);
    };

    updateContentCenter();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && contentRef.current
        ? new ResizeObserver(updateContentCenter)
        : null;

    if (resizeObserver && contentRef.current) {
      resizeObserver.observe(contentRef.current);
    }

    window.addEventListener('resize', updateContentCenter);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateContentCenter);
      document.documentElement.style.removeProperty('--content-center-x');
    };
  }, []);

  const closeLanguageMenu = useCallback(() => setLanguageMenuOpen(false), []);
  useMenuDismiss(languageMenuOpen, languageMenuRef, closeLanguageMenu);

  const handleLanguageSelect = useCallback(
    (nextLanguage: string) => {
      if (!isSupportedLanguage(nextLanguage)) {
        return;
      }
      setLanguage(nextLanguage);
      setLanguageMenuOpen(false);
    },
    [setLanguage]
  );

  useEffect(() => {
    fetchConfig().catch(() => {
      // Ignore the initial failure; the login flow shows the user-facing prompt.
    });
  }, [fetchConfig]);

  const loadPluginResources = useCallback(async () => {
    if (connectionStatus !== 'connected' || !supportsPlugin) {
      setPluginResources([]);
      return;
    }

    try {
      const plugins = await pluginsApi.list();
      setPluginResources(collectPluginResourceEntries(plugins.plugins));
    } catch {
      setPluginResources([]);
    }
  }, [connectionStatus, supportsPlugin]);

  const loadPool = useCallback(async () => {
    const requestID = ++poolRequestRef.current;
    if (connectionStatus !== 'connected') {
      setPoolFiles(null);
      return;
    }

    try {
      const response = await authFilesApi.list();
      if (requestID !== poolRequestRef.current) return;
      setPoolFiles(Array.isArray(response?.files) ? response.files : null);
    } catch {
      if (requestID !== poolRequestRef.current) return;
      setPoolFiles(null);
    }
  }, [connectionStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPluginResources();
      void loadPool();
    }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadPool();
    }, POOL_REFRESH_INTERVAL_MS);

    window.addEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadPluginResources);
    window.addEventListener(AUTH_FILES_CHANGED_EVENT, loadPool);

    return () => {
      poolRequestRef.current += 1;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadPluginResources);
      window.removeEventListener(AUTH_FILES_CHANGED_EVENT, loadPool);
    };
  }, [apiBase, loadPluginResources, loadPool]);

  // Close the mobile drawer with Escape.
  useEffect(() => {
    if (!sidebarOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  const pluginResourceGroups = pluginResources.reduce<
    Array<{ pluginID: string; pluginTitle: string; entries: PluginResourceEntry[] }>
  >((groups, resource) => {
    const group = groups.find((item) => item.pluginID === resource.pluginID);
    if (group) {
      group.entries.push(resource);
      return groups;
    }

    groups.push({
      pluginID: resource.pluginID,
      pluginTitle: resource.pluginTitle,
      entries: [resource],
    });
    return groups;
  }, []);

  const pluginPageNavItems: SidebarNavItem[] = supportsPlugin
    ? pluginResourceGroups.flatMap((group): SidebarNavItem[] => {
        if (group.entries.length === 1) {
          const resource = group.entries[0];
          const pluginLogo = resolvePluginAssetURL(resource.pluginLogo, apiBase);
          return [
            {
              path: resource.route,
              label: resource.label,
              meta: resource.description,
              icon: <PluginSidebarIcon src={pluginLogo} />,
            },
          ];
        }

        const pluginLogo = resolvePluginAssetURL(group.entries[0]?.pluginLogo ?? '', apiBase);
        return [
          {
            kind: 'drawer',
            id: `plugin-pages-${group.pluginID}`,
            label: group.pluginTitle,
            meta: t('plugin_resource.page_count', { count: group.entries.length }),
            icon: <PluginSidebarIcon src={pluginLogo} />,
            children: group.entries.map((resource) => ({
              path: resource.route,
              label: resource.label,
              meta: resource.description,
              icon: <span className="nav-sub-dot" aria-hidden="true" />,
            })),
          },
        ];
      })
    : [];

  const credentialsCount = poolSummary?.total;

  const navGroups: SidebarNavGroup[] = [
    {
      id: 'pool',
      labelKey: 'nav_groups.pool',
      items: [
        {
          path: '/',
          labelKey: 'nav.dashboard',
          metaKey: 'nav_meta.dashboard',
          icon: sidebarIcons.dashboard,
        },
        {
          path: '/auth-files',
          labelKey: 'nav.auth_files',
          metaKey: 'nav_meta.auth_files',
          badge: credentialsCount,
          badgeLabel:
            typeof credentialsCount === 'number'
              ? t('sidebar.auth_files_count', { count: credentialsCount })
              : undefined,
          badgeTone: (poolSummary?.failing ?? 0) > 0 ? 'fault' : undefined,
          icon: sidebarIcons.authFiles,
        },
        {
          path: '/quota',
          labelKey: 'nav.quota_management',
          metaKey: 'nav_meta.quota_management',
          icon: sidebarIcons.quota,
        },
        {
          path: '/oauth',
          labelKey: 'nav.oauth',
          metaKey: 'nav_meta.oauth',
          icon: sidebarIcons.oauth,
        },
      ],
    },
    {
      id: 'service',
      labelKey: 'nav_groups.service',
      items: [
        {
          path: '/logs',
          labelKey: 'nav.logs',
          metaKey: 'nav_meta.logs',
          icon: sidebarIcons.logs,
        },
        {
          path: '/config',
          labelKey: 'nav.config_management',
          metaKey: 'nav_meta.config_management',
          icon: sidebarIcons.config,
        },
        {
          path: '/system',
          labelKey: 'nav.system_info',
          metaKey: 'nav_meta.system_info',
          icon: sidebarIcons.system,
        },
      ],
    },
    ...(pluginPageNavItems.length > 0
      ? [
          {
            id: 'plugin-pages',
            labelKey: 'nav_groups.plugin_pages',
            items: pluginPageNavItems,
          },
        ]
      : []),
  ];

  const handleRefreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    clearCache();
    const results = await Promise.allSettled([
      fetchConfig(true),
      loadPluginResources(),
      loadPool(),
      triggerHeaderRefresh(),
    ]);
    setRefreshing(false);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected && rejected.status === 'rejected') {
      const reason = rejected.reason;
      const message =
        typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : '';
      showNotification(
        `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
      return;
    }
    showNotification(t('notification.data_refreshed'), 'success');
  };

  const handleLogout = () => {
    showConfirmation({
      title: t('header.logout'),
      message: t('header.logout_confirm'),
      confirmText: t('header.logout'),
      variant: 'danger',
      onConfirm: logout,
    });
  };

  const togglePluginResourceDrawer = useCallback((drawerID: string) => {
    setExpandedPluginResourceIDs((current) => {
      const next = new Set(current);
      if (next.has(drawerID)) {
        next.delete(drawerID);
      } else {
        next.add(drawerID);
      }
      return next;
    });
  }, []);

  const showRailTooltip = useCallback(
    (event: SyntheticEvent<HTMLElement>, targetID: string, label: string, meta?: string) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const anchorTop = rect.top + rect.height / 2;
      setRailTooltip({ targetID, label, meta, anchorTop, top: anchorTop });
    },
    []
  );
  const hideRailTooltip = useCallback(() => setRailTooltip(null), []);
  const handleRailTooltipMouseEnter = useCallback(
    (event: ReactMouseEvent<HTMLElement>, targetID: string, label: string, meta?: string) => {
      const focusedItem = focusedRailItemRef.current;
      if (focusedItem && focusedItem !== event.currentTarget) return;
      showRailTooltip(event, targetID, label, meta);
    },
    [showRailTooltip]
  );
  const handleRailTooltipMouseLeave = useCallback(() => {
    if (!focusedRailItemRef.current) hideRailTooltip();
  }, [hideRailTooltip]);
  const handleRailTooltipFocus = useCallback(
    (event: SyntheticEvent<HTMLElement>, targetID: string, label: string, meta?: string) => {
      focusedRailItemRef.current = event.currentTarget;
      showRailTooltip(event, targetID, label, meta);
    },
    [showRailTooltip]
  );
  const handleRailTooltipBlur = useCallback(
    (event: SyntheticEvent<HTMLElement>, targetID: string, label: string, meta?: string) => {
      if (focusedRailItemRef.current === event.currentTarget) {
        focusedRailItemRef.current = null;
      }
      if (event.currentTarget.matches(':hover')) {
        showRailTooltip(event, targetID, label, meta);
      } else {
        hideRailTooltip();
      }
    },
    [hideRailTooltip, showRailTooltip]
  );

  const railTooltipHandlers = (targetID: string, label: string, meta?: string) =>
    showSidebarLabels
      ? {}
      : {
          onMouseEnter: (event: ReactMouseEvent<HTMLElement>) =>
            handleRailTooltipMouseEnter(event, targetID, label, meta),
          onMouseLeave: handleRailTooltipMouseLeave,
          onFocus: (event: SyntheticEvent<HTMLElement>) =>
            handleRailTooltipFocus(event, targetID, label, meta),
          onBlur: (event: SyntheticEvent<HTMLElement>) =>
            handleRailTooltipBlur(event, targetID, label, meta),
        };

  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const platform =
      (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent ||
      '';
    return /(Mac|iPhone|iPod|iPad)/i.test(platform);
  }, []);

  const shortcutText = getSidebarShortcutLabel(isMac);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isSidebarToggleShortcut(event)) {
        event.preventDefault();
        hideRailTooltip();
        setSidebarCollapsed((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hideRailTooltip]);

  const closeDrawer = () => {
    focusedRailItemRef.current = null;
    setSidebarOpen(false);
    hideRailTooltip();
  };

  const renderNavBadge = (item: SidebarNavLinkItem) =>
    typeof item.badge === 'number' ? (
      <>
        {item.badge > 0 ? (
          <span className="nav-badge" aria-hidden="true">
            {item.badge}
          </span>
        ) : null}
        {item.badgeLabel ? <span className="nav-badge-sr-only">{item.badgeLabel}</span> : null}
      </>
    ) : null;

  const renderNavLink = (item: SidebarNavLinkItem, className = 'nav-item') => {
    const itemLabel = item.label ?? (item.labelKey ? t(item.labelKey) : '');
    const itemMeta = item.meta ?? (item.metaKey ? t(item.metaKey) : '');
    const accessibleLabel = item.badgeLabel ? `${itemLabel}, ${item.badgeLabel}` : itemLabel;

    return (
      <NavLink
        key={item.path}
        to={item.path}
        end={item.path === '/'}
        className={({ isActive }) => `${className} ${isActive ? 'active' : ''}`}
        onClick={closeDrawer}
        aria-label={showSidebarLabels ? undefined : accessibleLabel}
        aria-describedby={
          !showSidebarLabels && itemMeta && railTooltip?.targetID === item.path
            ? NAV_TOOLTIP_ID
            : undefined
        }
        {...railTooltipHandlers(item.path, itemLabel, itemMeta)}
      >
        <span className="nav-icon">{item.icon}</span>
        {showSidebarLabels ? (
          <>
            <span className="nav-label">{itemLabel}</span>
            {renderNavBadge(item)}
          </>
        ) : item.badgeTone ? (
          <span className={`nav-dot nav-dot-${item.badgeTone}`} aria-hidden="true" />
        ) : null}
      </NavLink>
    );
  };

  const renderNavItem = (item: SidebarNavItem) => {
    if (item.kind !== 'drawer') {
      return renderNavLink(item);
    }

    const isActive = item.children.some((child) => child.path === location.pathname);
    const isOpen = isActive || expandedPluginResourceIDs.has(item.id);

    return (
      <div className={`nav-drawer ${isOpen ? 'open' : ''}`} key={item.id}>
        <button
          type="button"
          className={`nav-item nav-drawer-toggle ${isActive ? 'active' : ''} ${
            isOpen ? 'open' : ''
          }`}
          onClick={() => togglePluginResourceDrawer(item.id)}
          aria-label={showSidebarLabels ? undefined : item.label}
          aria-describedby={
            !showSidebarLabels && item.meta && railTooltip?.targetID === item.id
              ? NAV_TOOLTIP_ID
              : undefined
          }
          aria-expanded={isOpen}
          {...railTooltipHandlers(item.id, item.label, item.meta)}
        >
          <span className="nav-icon">{item.icon}</span>
          {showSidebarLabels && (
            <>
              <span className="nav-label">{item.label}</span>
              <span className="nav-drawer-caret" aria-hidden="true">
                <IconChevronDown size={14} />
              </span>
            </>
          )}
        </button>
        {isOpen ? (
          <div className="nav-sub-list">
            {item.children.map((child) => renderNavLink(child, 'nav-item nav-sub-item'))}
          </div>
        ) : null}
      </div>
    );
  };

  const mobileSidebarToggleLabel = sidebarOpen
    ? t('sidebar.toggle_collapse', { defaultValue: 'Close navigation' })
    : t('sidebar.toggle_expand', { defaultValue: 'Open navigation' });
  const sidebarToggleLabel = sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse');
  const connectionState: LampState =
    connectionStatus === 'connected' ? 'ok' : connectionStatus === 'connecting' ? 'warn' : 'fault';
  const connectionLabel =
    connectionStatus === 'connected'
      ? t('sidebar.connected')
      : connectionStatus === 'connecting'
        ? t('sidebar.connecting')
        : t('sidebar.disconnected');
  const activeThemeKey: Theme = theme === 'auto' || theme === 'dark' ? theme : 'light';

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''} ${
        isPluginResourcePage ? 'plugin-resource-shell' : ''
      }`}
    >
      <header className="mobile-bar" ref={mobileBarRef}>
        <button
          type="button"
          className="shell-icon-btn"
          onClick={() => setSidebarOpen((prev) => !prev)}
          title={mobileSidebarToggleLabel}
          aria-label={mobileSidebarToggleLabel}
          aria-expanded={sidebarOpen}
        >
          {sidebarOpen ? <IconX size={18} /> : <IconMenu size={18} />}
        </button>
        <NavLink to="/" className="mobile-bar-brand" onClick={closeDrawer}>
          <img src={INLINE_LOGO_PNG} alt="" className="sidebar-brand-logo" />
          <span>Account Poller</span>
        </NavLink>
        {poolSummary ? (
          <NavLink to="/auth-files" className="mobile-bar-pool" onClick={closeDrawer}>
            <StatusLamp state={getPoolLampState(poolSummary)} />
            <span>
              {poolSummary.serving}/{poolSummary.total}
            </span>
          </NavLink>
        ) : null}
      </header>

      <div className="main-body">
        <button
          type="button"
          className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`}
          onClick={() => setSidebarOpen(false)}
          aria-label={t('common.close')}
          aria-hidden={!sidebarOpen}
          tabIndex={sidebarOpen ? 0 : -1}
        />

        <aside
          className={`sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}
        >
          <div className="sidebar-header">
            <NavLink to="/" className="sidebar-brand" onClick={closeDrawer} title="Account Poller">
              <img src={INLINE_LOGO_PNG} alt="" className="sidebar-brand-logo" />
              {showSidebarLabels && <span className="sidebar-brand-title">Account Poller</span>}
            </NavLink>
            <button
              type="button"
              className="shell-icon-btn sidebar-collapse-btn"
              onClick={() => {
                hideRailTooltip();
                setSidebarCollapsed((prev) => !prev);
              }}
              aria-label={`${sidebarToggleLabel} (${shortcutText})`}
              title={`${sidebarToggleLabel} (${shortcutText})`}
            >
              <IconPanelLeft size={16} />
            </button>
          </div>

          <nav className="nav-section" aria-label={t('sidebar.subtitle')}>
            {navGroups.map((group, idx) => (
              <div className="nav-group" key={group.id}>
                {showSidebarLabels ? (
                  <div className="nav-group-label">{t(group.labelKey)}</div>
                ) : (
                  idx > 0 && <div className="nav-group-divider" aria-hidden="true" />
                )}
                {group.items.map((item) => renderNavItem(item))}
              </div>
            ))}
          </nav>

          <div className="sidebar-footer">
            <PoolRail summary={poolSummary} compact={!showSidebarLabels} onNavigate={closeDrawer} />

            {showSidebarLabels ? (
              <>
                <div className="sidebar-connection" title={apiBase}>
                  <StatusLamp state={connectionState} label={connectionLabel} size={6} />
                  <span className="sidebar-connection-host">{host || connectionLabel}</span>
                  {serverVersion ? (
                    <span className="sidebar-connection-version">{serverVersion}</span>
                  ) : null}
                </div>

                <div className="sidebar-controls">
                  <div className="theme-switch" role="radiogroup" aria-label={t('theme.switch')}>
                    {THEME_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        role="radio"
                        aria-checked={activeThemeKey === option.key}
                        className={`theme-switch-option ${
                          activeThemeKey === option.key ? 'active' : ''
                        }`}
                        onClick={() => setTheme(option.key)}
                        title={t(option.labelKey)}
                        aria-label={t(option.labelKey)}
                      >
                        {option.icon}
                      </button>
                    ))}
                  </div>

                  <div
                    className={`language-menu ${languageMenuOpen ? 'open' : ''}`}
                    ref={languageMenuRef}
                  >
                    <button
                      type="button"
                      className="shell-icon-btn language-trigger"
                      onClick={() => setLanguageMenuOpen((prev) => !prev)}
                      title={t('language.switch')}
                      aria-label={t('language.switch')}
                      aria-haspopup="menu"
                      aria-expanded={languageMenuOpen}
                    >
                      <IconGlobe size={14} />
                      <span>{LANGUAGE_SHORT_LABELS[language] ?? language}</span>
                    </button>
                    {languageMenuOpen && (
                      <div
                        className="shell-menu language-menu-popover"
                        role="menu"
                        aria-label={t('language.switch')}
                      >
                        {LANGUAGE_ORDER.map((lang) => (
                          <button
                            key={lang}
                            type="button"
                            className={`shell-menu-option ${language === lang ? 'active' : ''}`}
                            onClick={() => handleLanguageSelect(lang)}
                            role="menuitemradio"
                            aria-checked={language === lang}
                          >
                            <span>{t(LANGUAGE_LABEL_KEYS[lang])}</span>
                            {language === lang ? (
                              <span className="shell-menu-check" aria-hidden="true">
                                ✓
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className={`shell-icon-btn ${refreshing ? 'is-busy' : ''}`}
                    onClick={handleRefreshAll}
                    title={t('header.refresh_all')}
                    aria-label={t('header.refresh_all')}
                    aria-busy={refreshing}
                  >
                    <IconRefreshCw size={14} />
                  </button>
                  <button
                    type="button"
                    className="shell-icon-btn"
                    onClick={handleLogout}
                    title={t('header.logout')}
                    aria-label={t('header.logout')}
                  >
                    <IconLogOut size={14} />
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="shell-icon-btn"
                onClick={handleLogout}
                aria-label={t('header.logout')}
                {...railTooltipHandlers('logout', t('header.logout'))}
              >
                <IconLogOut size={16} />
              </button>
            )}
          </div>
        </aside>

        {railTooltip && (
          <div
            ref={railTooltipRef}
            id={NAV_TOOLTIP_ID}
            className="nav-tooltip"
            role="tooltip"
            style={{ top: railTooltip.top }}
          >
            <span className="nav-tooltip-label" aria-hidden="true">
              {railTooltip.label}
            </span>
            {railTooltip.meta ? <span className="nav-tooltip-meta">{railTooltip.meta}</span> : null}
          </div>
        )}

        <div
          className={`content${isLogsPage ? ' content-logs' : ''}${
            isPluginResourcePage ? ' content-plugin-resource' : ''
          }`}
          ref={contentRef}
        >
          <main
            className={`main-content${isLogsPage ? ' main-content-logs' : ''}${
              isPluginResourcePage ? ' main-content-plugin-resource' : ''
            }`}
          >
            <PageTransition
              render={(routeLocation) => <MainRoutes location={routeLocation} />}
              scrollContainerRef={contentRef}
            />
          </main>
        </div>
      </div>
    </div>
  );
}
