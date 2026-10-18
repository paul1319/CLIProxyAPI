import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { StatusLamp } from '@/components/ui/StatusLamp';
import { IconEye, IconEyeOff, IconGlobe } from '@/components/ui/icons';
import { useAuthStore, useLanguageStore, useNotificationStore } from '@/stores';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import type { ApiError } from '@/types';
import { LegacyBackendError } from '@/services/api/legacyBackendProbe';
import styles from './LoginPage.module.scss';

type RedirectState = { from?: { pathname?: string } };

const UI_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

/** Host part of a base URL for compact display ("localhost:8317"); falls back to the input. */
const hostOf = (base: string): string => {
  try {
    return new URL(base).host || base;
  } catch {
    return base;
  }
};

/** Maps an API error to a localized, user-facing message. */
function getLocalizedErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof LegacyBackendError) return t('login.error_legacy_backend');
  const apiError = error as Partial<ApiError>;
  const status = typeof apiError.status === 'number' ? apiError.status : undefined;
  const code = typeof apiError.code === 'string' ? apiError.code : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof apiError.message === 'string'
        ? apiError.message
        : typeof error === 'string'
          ? error
          : '';

  const withHttpStatus = (summary: string) => {
    if (!status) {
      return summary;
    }

    const genericAxiosMessage = `Request failed with status code ${status}`;
    const detail = message.trim();
    const backendDetail =
      detail && detail !== genericAxiosMessage
        ? ` (${t('login.error_backend_detail')}: ${detail})`
        : '';

    return `HTTP ${status}: ${summary}${backendDetail}`;
  };

  // HTTP status codes first.
  if (status === 401) {
    return withHttpStatus(t('login.error_unauthorized'));
  }
  if (status === 403) {
    return withHttpStatus(t('login.error_forbidden'));
  }
  if (status === 404) {
    return withHttpStatus(t('login.error_not_found'));
  }
  if (status && status >= 500) {
    return withHttpStatus(t('login.error_server'));
  }

  // Then axios error codes.
  if (code === 'ECONNABORTED' || message.toLowerCase().includes('timeout')) {
    return t('login.error_timeout');
  }
  if (code === 'ERR_NETWORK' || message.toLowerCase().includes('network error')) {
    return t('login.error_network');
  }
  if (code === 'ERR_CERT_AUTHORITY_INVALID' || message.toLowerCase().includes('certificate')) {
    return t('login.error_ssl');
  }

  // CORS failures.
  if (message.toLowerCase().includes('cors') || message.toLowerCase().includes('cross-origin')) {
    return t('login.error_cors');
  }

  // Generic fallback.
  return withHttpStatus(t('login.error_invalid'));
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotificationStore();
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const login = useAuthStore((state) => state.login);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const storedBase = useAuthStore((state) => state.apiBase);
  const storedKey = useAuthStore((state) => state.managementKey);
  const storedRememberPassword = useAuthStore((state) => state.rememberPassword);

  const [apiBase, setApiBase] = useState('');
  const [managementKey, setManagementKey] = useState('');
  const [showCustomBase, setShowCustomBase] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(true);
  const [autoLoginSuccess, setAutoLoginSuccess] = useState(false);
  const [error, setError] = useState('');

  const serverInputId = useId();
  const serverHintId = useId();
  const keyInputId = useId();
  const errorId = useId();

  const detectedBase = useMemo(() => detectApiBaseFromLocation(), []);
  const languageOptions = useMemo(
    () =>
      LANGUAGE_ORDER.map((lang) => ({
        value: lang,
        label: t(LANGUAGE_LABEL_KEYS[lang]),
      })),
    [t]
  );
  const handleLanguageChange = useCallback(
    (selectedLanguage: string) => {
      if (!isSupportedLanguage(selectedLanguage)) {
        return;
      }
      setLanguage(selectedLanguage);
    },
    [setLanguage]
  );

  useEffect(() => {
    const init = async () => {
      try {
        const autoLoggedIn = await restoreSession();
        if (autoLoggedIn) {
          setAutoLoginSuccess(true);
          // Hold the "connected" state briefly before redirecting.
          setTimeout(() => {
            const redirect = (location.state as RedirectState | null)?.from?.pathname || '/';
            navigate(redirect, { replace: true });
          }, 1500);
        } else {
          setApiBase(storedBase || detectedBase);
          setManagementKey(storedKey || '');
          setRememberPassword(storedRememberPassword || Boolean(storedKey));
        }
      } finally {
        // On auto-login success the splash stays up via autoLoginSuccess.
        setAutoLoading(false);
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!managementKey.trim()) {
      setError(t('login.error_required'));
      return;
    }

    const baseToUse = apiBase ? normalizeApiBase(apiBase) : detectedBase;
    setLoading(true);
    setError('');
    try {
      await login({
        apiBase: baseToUse,
        managementKey: managementKey.trim(),
        rememberPassword,
      });
      showNotification(t('common.connected_status'), 'success');
      navigate('/', { replace: true });
    } catch (err: unknown) {
      // Shown inline under the button; a toast would only repeat it.
      setError(getLocalizedErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  }, [
    apiBase,
    detectedBase,
    login,
    managementKey,
    navigate,
    rememberPassword,
    showNotification,
    t,
  ]);

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loading) void handleSubmit();
  };

  const resetServer = () => {
    setApiBase(detectedBase);
    setShowCustomBase(false);
  };

  if (isAuthenticated && !autoLoading && !autoLoginSuccess) {
    const redirect = (location.state as RedirectState | null)?.from?.pathname || '/';
    return <Navigate to={redirect} replace />;
  }

  // Splash while restoring a saved session (and briefly after it succeeds).
  const showSplash = autoLoading || autoLoginSuccess;
  const currentBase = apiBase || storedBase || detectedBase;
  const keyToggleLabel = showKey ? t('login.hide_key') : t('login.show_key');

  return (
    <div className={styles.page}>
      <div className={styles.corner}>
        <IconGlobe size={14} className={styles.cornerIcon} aria-hidden="true" />
        <Select
          className={styles.languageSelect}
          value={language}
          options={languageOptions}
          onChange={handleLanguageChange}
          fullWidth={false}
          size="sm"
          ariaLabel={t('language.switch')}
        />
      </div>

      <main className={styles.column}>
        <header className={styles.brand}>
          <div className={styles.wordmarkRow}>
            <img src={INLINE_LOGO_JPEG} alt="" width={28} height={28} className={styles.logo} />
            <h1 className={styles.wordmark}>CLIProxyAPI</h1>
          </div>
          <p className={styles.subtitle}>{t('login.subtitle')}</p>
        </header>

        {showSplash ? (
          <div className={styles.splash} role="status" aria-live="polite">
            <div className={styles.progress} data-done={autoLoginSuccess}>
              <span className={styles.progressBar} />
            </div>
            <p className={styles.splashText}>
              {autoLoginSuccess && <StatusLamp state="ok" size={6} />}
              <span>
                {t(autoLoginSuccess ? 'login.connected_to' : 'login.connecting_to', {
                  host: hostOf(storedBase || detectedBase),
                })}
              </span>
            </p>
          </div>
        ) : (
          <form className={styles.card} onSubmit={handleFormSubmit} noValidate>
            {showCustomBase ? (
              <div className={styles.serverEdit}>
                <div className={styles.fieldHead}>
                  <label className={styles.fieldLabel} htmlFor={serverInputId}>
                    {t('login.server_input_label')}
                  </label>
                  <button type="button" className={styles.textButton} onClick={resetServer}>
                    {t('login.server_reset')}
                  </button>
                </div>
                <input
                  id={serverInputId}
                  className={`input ${styles.monoInput}`}
                  value={apiBase}
                  onChange={(event) => setApiBase(event.target.value)}
                  placeholder={t('login.custom_connection_placeholder')}
                  aria-describedby={serverHintId}
                  autoComplete="url"
                  spellCheck={false}
                  autoFocus
                />
                <p className={styles.fieldHint} id={serverHintId}>
                  {t('login.custom_connection_hint')}
                </p>
              </div>
            ) : (
              <div className={styles.serverRow}>
                <span className={styles.serverLabel}>{t('login.server_label')}</span>
                <span className={styles.serverValue} title={currentBase}>
                  {currentBase}
                </span>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => setShowCustomBase(true)}
                  aria-label={t('login.server_change_aria')}
                >
                  {t('login.server_change')}
                </button>
              </div>
            )}

            <div className={styles.fields}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={keyInputId}>
                  {t('login.key_label')}
                </label>
                <div className={styles.keyControl}>
                  <input
                    id={keyInputId}
                    className={`input ${styles.keyInput}`}
                    type={showKey ? 'text' : 'password'}
                    name="cpa-management-key"
                    autoComplete="current-password"
                    placeholder={t('login.management_key_placeholder')}
                    value={managementKey}
                    onChange={(event) => setManagementKey(event.target.value)}
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby={error ? errorId : undefined}
                    autoFocus={!showCustomBase}
                  />
                  <button
                    type="button"
                    className={styles.keyToggle}
                    onClick={() => setShowKey((prev) => !prev)}
                    aria-label={keyToggleLabel}
                    title={keyToggleLabel}
                    aria-pressed={showKey}
                  >
                    {showKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  </button>
                </div>
              </div>

              <SelectionCheckbox
                checked={rememberPassword}
                onChange={setRememberPassword}
                label={t('login.remember_device')}
                labelClassName={styles.checkboxLabel}
              />

              <Button type="submit" fullWidth loading={loading} className={styles.submit}>
                {loading ? t('login.submitting') : t('login.connect_button')}
              </Button>

              {error && (
                <div className={styles.error} id={errorId} role="alert">
                  {error}
                </div>
              )}
            </div>
          </form>
        )}

        {UI_VERSION && (
          <p className={styles.footer}>{t('login.ui_version', { version: UI_VERSION })}</p>
        )}
      </main>
    </div>
  );
}
