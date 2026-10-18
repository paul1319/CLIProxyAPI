import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusLamp, type LampState } from '@/components/ui/StatusLamp';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconBookOpen,
  IconCode,
  IconExternalLink,
  IconGithub,
  IconRefreshCw,
  IconSearch,
} from '@/components/ui/icons';
import {
  useAuthStore,
  useConfigStore,
  useNotificationStore,
  useModelsStore,
  useThemeStore,
} from '@/stores';
import { configApi, versionApi } from '@/services/api';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { formatDateTimeValue } from '@/utils/format';
import { classifyModels } from '@/utils/models';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import iconGemini from '@/assets/icons/gemini.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconMeta from '@/assets/icons/meta.svg';
import iconDevinLight from '@/assets/icons/devin.svg';
import iconDevinDark from '@/assets/icons/devin-dark.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconGlm from '@/assets/icons/glm.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconGrokDark from '@/assets/icons/grok-dark.svg';
import iconDeepseek from '@/assets/icons/deepseek.svg';
import iconMinimax from '@/assets/icons/minimax.svg';
import styles from './SystemPage.module.scss';

const RELEASES_URL = 'https://github.com/router-for-me/CLIProxyAPI/releases';

const PROJECT_LINKS = [
  {
    href: 'https://github.com/router-for-me/CLIProxyAPI',
    labelKey: 'system_info.link_main_repo',
    icon: IconGithub,
  },
  {
    href: 'https://github.com/router-for-me/Cli-Proxy-API-Management-Center',
    labelKey: 'system_info.link_webui_repo',
    icon: IconCode,
  },
  { href: 'https://help.router-for.me/', labelKey: 'system_info.link_docs', icon: IconBookOpen },
] as const;

const MODEL_CATEGORY_ICONS: Record<string, string | { light: string; dark: string }> = {
  devin: { light: iconDevinLight, dark: iconDevinDark },
  gpt: { light: iconOpenaiLight, dark: iconOpenaiDark },
  claude: iconClaude,
  meta: iconMeta,
  gemini: iconGemini,
  qwen: iconQwen,
  kimi: { light: iconKimiDark, dark: iconKimiLight },
  glm: iconGlm,
  grok: { light: iconGrok, dark: iconGrokDark },
  deepseek: iconDeepseek,
  minimax: iconMinimax,
};

const CONNECTION_LAMP: Record<string, LampState> = {
  connected: 'ok',
  connecting: 'warn',
  disconnected: 'fault',
};

/** Keys removed by "Clear login data". */
const LOGIN_STORAGE_KEYS = [STORAGE_KEY_AUTH, 'isLoggedIn', 'apiBase', 'apiUrl', 'managementKey'];

type VersionCheck =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'latest' }
  | { status: 'update'; latest: string }
  | { status: 'current-missing' }
  | { status: 'error'; message: string };

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

const parseVersionSegments = (version?: string | null) => {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
};

const compareVersions = (latest?: string | null, current?: string | null) => {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return 1;
    if (l < c) return -1;
  }
  return 0;
};

function KeyValueRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.kvRow}>
      <dt className={styles.kvLabel}>{label}</dt>
      <dd className={styles.kvValue}>{children}</dd>
    </div>
  );
}

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const logout = useAuthStore((state) => state.logout);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [modelsNotice, setModelsNotice] = useState<string | null>(null);
  const [modelQuery, setModelQuery] = useState('');
  const [requestLogSaving, setRequestLogSaving] = useState(false);
  const [versionCheck, setVersionCheck] = useState<VersionCheck>({ status: 'idle' });

  const connected = connectionStatus === 'connected';
  const requestLogEnabled = config?.requestLog ?? false;
  const canEditRequestLog = connected && Boolean(config);

  const groupedModels = useMemo(
    () => classifyModels(models, { otherLabel: t('system_info.models_other') }),
    [models, t]
  );

  const filteredGroups = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    if (!query) return groupedModels;
    return groupedModels
      .map((group) => ({
        ...group,
        items: group.items.filter((model) =>
          `${model.name} ${model.alias ?? ''}`.toLowerCase().includes(query)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groupedModels, modelQuery]);

  const getIconForCategory = (categoryId: string): string | null => {
    const iconEntry = MODEL_CATEGORY_ICONS[categoryId];
    if (!iconEntry) return null;
    if (typeof iconEntry === 'string') return iconEntry;
    return resolvedTheme === 'dark' ? iconEntry.dark : iconEntry.light;
  };

  const resolveApiKeysForModels = useApiKeysForModels();

  const fetchModels = useCallback(
    async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
      if (connectionStatus !== 'connected' || !apiBase) {
        setModelsNotice(t('notification.connection_required'));
        return;
      }
      setModelsNotice(null);
      try {
        const apiKeys = await resolveApiKeysForModels({ force: forceRefresh });
        await fetchModelsFromStore(apiBase, apiKeys[0], forceRefresh);
      } catch (err: unknown) {
        const message = errorText(err);
        setModelsNotice(`${t('system_info.models_error')}${message ? `: ${message}` : ''}`);
      }
    },
    [connectionStatus, apiBase, resolveApiKeysForModels, fetchModelsFromStore, t]
  );

  const handleClearLoginStorage = () => {
    showConfirmation({
      title: t('system_info.clear_login_title'),
      message: t('system_info.clear_login_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: () => {
        logout();
        if (typeof localStorage === 'undefined') return;
        LOGIN_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
        showNotification(t('notification.login_storage_cleared'), 'success');
      },
    });
  };

  const handleRequestLogToggle = async (next: boolean) => {
    if (!canEditRequestLog || requestLogSaving || next === requestLogEnabled) return;

    const previous = requestLogEnabled;
    setRequestLogSaving(true);
    updateConfigValue('request-log', next);

    try {
      await configApi.updateRequestLog(next);
      clearCache('request-log');
      showNotification(t('notification.request_log_updated'), 'success');
    } catch (error: unknown) {
      const message = errorText(error);
      // Roll back the optimistic value so the switch shows the server's state.
      updateConfigValue('request-log', previous);
      showNotification(
        `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRequestLogSaving(false);
    }
  };

  const handleVersionCheck = useCallback(async () => {
    setVersionCheck({ status: 'checking' });
    try {
      const data = await versionApi.checkLatest();
      const latestRaw = data?.['latest-version'] ?? data?.latest_version ?? data?.latest ?? '';
      const latest = typeof latestRaw === 'string' ? latestRaw : String(latestRaw ?? '');

      if (!latest) {
        setVersionCheck({ status: 'error', message: '' });
        return;
      }

      const comparison = compareVersions(latest, serverVersion);
      if (comparison === null) {
        setVersionCheck({ status: 'current-missing' });
      } else if (comparison > 0) {
        setVersionCheck({ status: 'update', latest });
      } else {
        setVersionCheck({ status: 'latest' });
      }
    } catch (error: unknown) {
      setVersionCheck({ status: 'error', message: errorText(error) });
    }
  }, [serverVersion]);

  const handleRefresh = useCallback(async () => {
    await Promise.allSettled([fetchConfig(true), fetchModels({ forceRefresh: true })]);
  }, [fetchConfig, fetchModels]);

  useHeaderRefresh(handleRefresh, connected);

  useEffect(() => {
    fetchConfig().catch(() => {
      // The diagnostics switch stays disabled until the config loads.
    });
  }, [fetchConfig]);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  const unknown = <span className={styles.dash}>—</span>;
  const buildTime = formatDateTimeValue(serverBuildDate, i18n.language);
  const appVersion = __APP_VERSION__ || null;

  const versionStatus = (() => {
    switch (versionCheck.status) {
      case 'latest':
        return (
          <span className={styles.versionStatus}>
            <StatusLamp state="ok" size={6} />
            {t('system_info.version_is_latest')}
          </span>
        );
      case 'update':
        return (
          <span className={`${styles.versionStatus} ${styles.versionUpdate}`}>
            <StatusLamp state="warn" size={6} />
            {t('system_info.version_update_available', { version: versionCheck.latest })}
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.textLink}
            >
              {t('system_info.view_release')}
            </a>
          </span>
        );
      case 'current-missing':
        return (
          <span className={styles.versionStatus}>
            <StatusLamp state="idle" size={6} />
            {t('system_info.version_current_missing')}
          </span>
        );
      case 'error':
        return (
          <span className={`${styles.versionStatus} ${styles.versionError}`}>
            <StatusLamp state="fault" size={6} />
            {t('system_info.version_check_error')}
            {versionCheck.message ? `: ${versionCheck.message}` : ''}
          </span>
        );
      default:
        return null;
    }
  })();

  const modelsErrorText = modelsNotice ?? modelsError;
  const modelCount = models.length;

  return (
    <div className={styles.page}>
      <PageHeader title={t('nav.system_info')} meta={t('system_info.about_title')} />

      {/* ---------- Server ---------- */}
      <section className={styles.panel} aria-labelledby="about-server-title">
        <header className={styles.panelHeader}>
          <div className={styles.serverHeading}>
            <img src={INLINE_LOGO_JPEG} alt="" className={styles.logo} />
            <h2 id="about-server-title" className={styles.panelTitle}>
              {t('system_info.server_title')}
            </h2>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleVersionCheck()}
            loading={versionCheck.status === 'checking'}
          >
            {t('system_info.version_check_button')}
          </Button>
        </header>

        <dl className={styles.kvList}>
          <KeyValueRow label={t('footer.api_version')}>
            <span className={styles.versionCell}>
              <span className={styles.mono}>{serverVersion?.trim() || unknown}</span>
              {versionStatus}
            </span>
          </KeyValueRow>
          <KeyValueRow label={t('footer.build_date')}>
            <span className={styles.tabular}>{buildTime || unknown}</span>
          </KeyValueRow>
          <KeyValueRow label={t('system_info.backend_url')}>
            {apiBase ? <span className={styles.mono}>{apiBase}</span> : unknown}
          </KeyValueRow>
          <KeyValueRow label={t('system_info.connection')}>
            <span className={styles.versionStatus}>
              <StatusLamp state={CONNECTION_LAMP[connectionStatus] ?? 'idle'} size={6} />
              <span className={styles.ink}>{t(`common.${connectionStatus}_status`)}</span>
            </span>
          </KeyValueRow>
          <KeyValueRow label={t('footer.version')}>
            {appVersion ? <span className={styles.mono}>{appVersion}</span> : unknown}
          </KeyValueRow>
        </dl>

        <nav className={styles.links} aria-label={t('system_info.links_label')}>
          {PROJECT_LINKS.map(({ href, labelKey, icon: Icon }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              <Icon size={14} aria-hidden="true" />
              {t(labelKey)}
              <IconExternalLink size={12} className={styles.linkExternal} aria-hidden="true" />
            </a>
          ))}
        </nav>
      </section>

      {/* ---------- Diagnostics ---------- */}
      <section className={styles.panel} aria-labelledby="about-diagnostics-title">
        <header className={styles.panelHeader}>
          <h2 id="about-diagnostics-title" className={styles.panelTitle}>
            {t('system_info.diagnostics_title')}
          </h2>
        </header>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span className={styles.settingLabel} id="about-request-log-label">
              {t('basic_settings.request_log_title')}
            </span>
            <span className={styles.settingHint} id="about-request-log-hint">
              {t('basic_settings.request_log_warning')}
            </span>
          </div>
          <ToggleSwitch
            checked={requestLogEnabled}
            disabled={!canEditRequestLog || requestLogSaving}
            ariaLabel={t('basic_settings.request_log_enable')}
            ariaDescribedBy="about-request-log-hint"
            onChange={(value) => void handleRequestLogToggle(value)}
          />
        </div>
      </section>

      {/* ---------- Models ---------- */}
      <section className={styles.panel} aria-labelledby="about-models-title">
        <header className={styles.panelHeader}>
          <div className={styles.panelHeading}>
            <h2 id="about-models-title" className={styles.panelTitle}>
              {t('system_info.models_title')}
              {modelCount > 0 && <span className={styles.titleCount}>{modelCount}</span>}
            </h2>
            <p className={styles.panelMeta}>{t('system_info.models_desc')}</p>
          </div>
          <div className={styles.modelTools}>
            <label className={styles.search}>
              <IconSearch size={14} aria-hidden="true" className={styles.searchIcon} />
              <input
                type="search"
                className={`input ${styles.searchInput}`}
                placeholder={t('system_info.models_filter')}
                aria-label={t('system_info.models_filter')}
                value={modelQuery}
                onChange={(event) => setModelQuery(event.target.value)}
                disabled={modelCount === 0}
              />
            </label>
            <Button
              variant="ghost"
              size="sm"
              className={styles.iconButton}
              onClick={() => void fetchModels({ forceRefresh: true })}
              disabled={modelsLoading}
              aria-label={t('common.refresh')}
              title={t('common.refresh')}
            >
              <IconRefreshCw
                size={15}
                className={modelsLoading ? styles.spinning : undefined}
                aria-hidden="true"
              />
            </Button>
          </div>
        </header>

        {modelsErrorText && (
          <div className={styles.inlineError} role="alert">
            <span>{modelsErrorText}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void fetchModels({ forceRefresh: true })}
              disabled={modelsLoading}
            >
              {t('dashboard.retry')}
            </Button>
          </div>
        )}

        {modelsLoading && modelCount === 0 ? (
          <div className={styles.modelSkeleton} aria-busy="true">
            {[0, 1, 2].map((row) => (
              <div key={row} className={styles.modelSkeletonRow}>
                <Skeleton width={120} height={14} rounded={4} />
                <Skeleton width="60%" height={14} rounded={4} />
              </div>
            ))}
          </div>
        ) : modelCount === 0 ? (
          !modelsErrorText && <p className={styles.panelEmpty}>{t('system_info.models_empty')}</p>
        ) : filteredGroups.length === 0 ? (
          <p className={styles.panelEmpty}>
            {t('system_info.models_no_match', { query: modelQuery.trim() })}
          </p>
        ) : (
          <ul className={styles.modelGroups}>
            {filteredGroups.map((group) => {
              const iconSrc = getIconForCategory(group.id);
              return (
                <li key={group.id} className={styles.modelGroup}>
                  <div className={styles.groupLabel}>
                    <span className={styles.groupIcon} aria-hidden="true">
                      {iconSrc ? <img src={iconSrc} alt="" /> : group.label.charAt(0)}
                    </span>
                    <span className={styles.groupName}>{group.label}</span>
                    <span className={styles.groupCount}>{group.items.length}</span>
                  </div>
                  <ul className={styles.modelList}>
                    {group.items.map((model) => (
                      <li
                        key={`${model.name}-${model.alias ?? 'default'}`}
                        className={styles.modelItem}
                        title={model.description || undefined}
                      >
                        <span className={styles.modelName}>{model.name}</span>
                        {model.alias && <span className={styles.modelAlias}>{model.alias}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---------- Danger zone ---------- */}
      <section
        className={`${styles.panel} ${styles.dangerPanel}`}
        aria-labelledby="about-danger-title"
      >
        <header className={styles.panelHeader}>
          <h2 id="about-danger-title" className={styles.panelTitle}>
            {t('system_info.danger_title')}
          </h2>
        </header>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span className={styles.settingLabel}>{t('system_info.clear_login_title')}</span>
            <span className={styles.settingHint}>{t('system_info.clear_login_desc')}</span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className={styles.dangerButton}
            onClick={handleClearLoginStorage}
          >
            {t('system_info.clear_login_button')}
          </Button>
        </div>
      </section>
    </div>
  );
}
