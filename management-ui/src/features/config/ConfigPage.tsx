import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { prefersReducedMotion } from '@/hooks/motion';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useVisualConfig } from '@/hooks/useVisualConfig';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import {
  CONFIG_MODE_STORAGE_KEY,
  CONFIG_SECTION_STORAGE_KEY,
  LEGACY_EDITOR_MODE_STORAGE_KEY,
  configPanelDomId,
  type ConfigEditorMode,
  type ConfigTabId,
} from './constants';
import { revealTopOf } from './dom';
import { configGroupDomId, configSectionNavKey } from './groups';
import {
  buildHeaderMeta,
  CONFIG_FIELD_COUNT,
  countSectionErrors,
  countTotalErrors,
  readSavedMode,
  readSavedSection,
  resolveDirtyFieldIds,
  resolveDirtyTabs,
  resolveErrorFieldIds,
  resolveStatus,
} from './uiState';
import { findConfigFieldById } from './searchIndex';
import { isMacPlatform, isModShortcut, modShortcutLabel } from './shortcuts';
import { shouldReloadVisualDraft, useConfigDocument } from './hooks/useConfigDocument';
import { useActiveGroup } from './hooks/useActiveGroup';
import { useFieldJump } from './hooks/useFieldJump';
import { useSourceSearch } from './hooks/useSourceSearch';
import { ConfigSearch } from './components/ConfigSearch';
import { ConfigStatusMeta } from './components/ConfigStatusMeta';
import { DiffModal } from './components/DiffModal';
import { ModeSwitch } from './components/ModeSwitch';
import { SaveBar, type SaveBarChange } from './components/SaveBar';
import { SectionNav, SectionSelect } from './components/SectionNav';
import { SectionSkeleton } from './components/SectionSkeleton';
import { SourcePanel, SourceSearchBar } from './components/SourcePanel';
import { FIELDS_ROOT_CLASS } from './components/fields/FieldPrimitives';
import { DirtyFieldsContext } from './components/fields/settingState';
import { SectionAdvanced } from './components/sections/SectionAdvanced';
import { SectionConnectivity } from './components/sections/SectionConnectivity';
import { SectionLogging } from './components/sections/SectionLogging';
import { SectionNetwork } from './components/sections/SectionNetwork';
import { SectionPayload } from './components/sections/SectionPayload';
import { SectionStreaming } from './components/sections/SectionStreaming';
import styles from './ConfigPage.module.scss';

const IS_MAC = isMacPlatform();

export function ConfigPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const requestedFieldEntry = useMemo(() => {
    const fieldId = new URLSearchParams(location.search).get('field');
    return findConfigFieldById(fieldId);
  }, [location.search]);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.isCurrentLayer : true;
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isCompact = useMediaQuery('(max-width: 960px)');
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sourceSearchInputRef = useRef<HTMLInputElement | null>(null);

  const {
    visualValues,
    visualDirty,
    visualDirtyFields,
    visualParseError,
    visualValidationErrors,
    visualHasPayloadValidationErrors,
    loadVisualValuesFromYaml,
    rebaseVisualValuesFromYaml,
    applyVisualChangesToYaml,
    setVisualValues,
  } = useVisualConfig();

  const [mode, setMode] = useState<ConfigEditorMode>(() =>
    requestedFieldEntry ? 'visual' : readSavedMode(localStorage.getItem(CONFIG_MODE_STORAGE_KEY))
  );
  const [activeSection, setActiveSection] = useState<ConfigTabId>(
    () =>
      requestedFieldEntry?.sectionId ??
      readSavedSection(localStorage.getItem(CONFIG_SECTION_STORAGE_KEY))
  );
  const handledRequestedFieldRef = useRef<string | null>(null);

  // The retired simple/full editor mode left a persisted key behind; clear it.
  useEffect(() => {
    localStorage.removeItem(LEGACY_EDITOR_MODE_STORAGE_KEY);
  }, []);

  const doc = useConfigDocument({
    mode,
    visualDirty,
    visualParseError,
    loadVisualValuesFromYaml,
    rebaseVisualValuesFromYaml,
    applyVisualChangesToYaml,
  });
  const sourceSearch = useSourceSearch();

  const disableControls = connectionStatus !== 'connected';
  const hasVisualModeError = !!visualParseError;
  const hasVisualValidationErrors =
    mode === 'visual' &&
    (Object.values(visualValidationErrors).some(Boolean) || visualHasPayloadValidationErrors);

  const unsavedChangesDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    }),
    [t]
  );

  useUnsavedChangesGuard({
    enabled: isCurrentLayer,
    shouldBlock: doc.isDirty,
    dialog: unsavedChangesDialog,
  });

  // Closing or reloading the tab with unsaved edits asks the browser to confirm.
  useEffect(() => {
    if (!isCurrentLayer || !doc.isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [doc.isDirty, isCurrentLayer]);

  // The shell refresh button reloads the editor too (with the discard confirmation when dirty).
  const { isDirty: docIsDirty, handleReload, loadConfig } = doc;
  const handleHeaderRefresh = useCallback(
    () => (docIsDirty ? handleReload() : loadConfig()),
    [docIsDirty, handleReload, loadConfig]
  );
  useHeaderRefresh(handleHeaderRefresh, isCurrentLayer);

  // Invalid YAML: switch to source mode; once fixed, visual mode can be entered again.
  useEffect(() => {
    if (mode !== 'visual' || !visualParseError) return;

    setMode('source');
    localStorage.setItem(CONFIG_MODE_STORAGE_KEY, 'source');
    showNotification(
      t('config_management.visual_mode_unavailable_detail', { message: visualParseError }),
      'error'
    );
  }, [mode, showNotification, t, visualParseError]);

  // Dirty hand-over between visual and source:
  // → source: materialize visual dirty fields for viewing without recording a source edit;
  // → visual: source drafts must be saved or discarded first; a view-only round trip keeps the
  //   field-level dirty state.
  const handleModeChange = useCallback(
    (nextMode: ConfigEditorMode) => {
      if (nextMode === mode) return;
      if (nextMode === 'visual' && doc.sourceDirty) {
        showNotification(t('config_management.source_changes_before_visual'), 'warning');
        return;
      }

      if (nextMode === 'source') {
        if (visualDirty) {
          // content may be an earlier local source preview, not a server readback.
          const nextContent = applyVisualChangesToYaml(doc.content, 'draft');
          if (nextContent !== doc.content) {
            doc.syncContentFromVisual(nextContent);
          }
        }
      } else if (shouldReloadVisualDraft(doc.sourceDirty, visualParseError)) {
        const result = loadVisualValuesFromYaml(doc.content);
        if (!result.ok) {
          showNotification(
            t('config_management.visual_mode_unavailable_detail', { message: result.error }),
            'error'
          );
          return;
        }
      }

      setMode(nextMode);
      localStorage.setItem(CONFIG_MODE_STORAGE_KEY, nextMode);
    },
    [
      applyVisualChangesToYaml,
      doc,
      loadVisualValuesFromYaml,
      mode,
      showNotification,
      t,
      visualDirty,
      visualParseError,
    ]
  );

  const handleSectionChange = useCallback((sectionId: ConfigTabId) => {
    setActiveSection(sectionId);
    localStorage.setItem(CONFIG_SECTION_STORAGE_KEY, sectionId);
  }, []);

  /** Section picked in the index: show it from the top. */
  const handleNavSectionChange = useCallback(
    (sectionId: ConfigTabId) => {
      handleSectionChange(sectionId);
      requestAnimationFrame(() => revealTopOf(layoutRef.current));
    },
    [handleSectionChange]
  );

  const handleGroupJump = useCallback((groupId: string) => {
    document.getElementById(configGroupDomId(groupId))?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  }, []);

  const { jumpToField } = useFieldJump({
    values: visualValues,
    setActiveSection: handleSectionChange,
  });

  useEffect(() => {
    if (!requestedFieldEntry || handledRequestedFieldRef.current === requestedFieldEntry.fieldId) {
      return;
    }

    handledRequestedFieldRef.current = requestedFieldEntry.fieldId;
    localStorage.setItem(CONFIG_MODE_STORAGE_KEY, 'visual');
    jumpToField(requestedFieldEntry);

    const nextSearchParams = new URLSearchParams(location.search);
    nextSearchParams.delete('field');
    const nextSearch = nextSearchParams.toString();
    void navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
        hash: location.hash,
      },
      { replace: true }
    );
  }, [
    jumpToField,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    requestedFieldEntry,
  ]);

  const errorCounts = useMemo(
    () => countSectionErrors(visualValidationErrors, visualHasPayloadValidationErrors),
    [visualHasPayloadValidationErrors, visualValidationErrors]
  );
  const dirtyTabs = useMemo(() => resolveDirtyTabs(visualDirtyFields), [visualDirtyFields]);
  const dirtyFieldIds = useMemo(() => resolveDirtyFieldIds(visualDirtyFields), [visualDirtyFields]);
  const dirtyFieldIdSet = useMemo(() => new Set(dirtyFieldIds), [dirtyFieldIds]);
  const errorFieldIds = useMemo(
    () => resolveErrorFieldIds(visualValidationErrors),
    [visualValidationErrors]
  );
  const errorFieldIdSet = useMemo(() => new Set(errorFieldIds), [errorFieldIds]);
  const totalErrors = useMemo(
    () => countTotalErrors(visualValidationErrors, visualHasPayloadValidationErrors),
    [visualHasPayloadValidationErrors, visualValidationErrors]
  );
  const activeGroup = useActiveGroup(activeSection, mode === 'visual' && !isCompact);

  const status = resolveStatus({
    disconnected: disableControls,
    loading: doc.loading,
    loadFailed: Boolean(doc.error),
    yamlError: hasVisualModeError,
    validationBlocked: hasVisualValidationErrors,
    saving: doc.saving,
    dirty: doc.isDirty,
  });
  const headerMeta = buildHeaderMeta({
    fieldCount: CONFIG_FIELD_COUNT,
    status,
    dirtyCount: dirtyFieldIds.length,
    sourceDirty: doc.sourceDirty,
    errorCount: mode === 'visual' ? totalErrors : 0,
  });

  const saveDisabled =
    disableControls ||
    doc.loading ||
    doc.saving ||
    !doc.isDirty ||
    doc.diffModalOpen ||
    hasVisualModeError ||
    hasVisualValidationErrors;

  const saveShortcut = modShortcutLabel('s', IS_MAC);
  const searchShortcut = modShortcutLabel('k', IS_MAC);
  const { handleSave, diffModalOpen } = doc;

  // ⌘S opens the save review; ⌘K focuses the search of the current mode.
  useEffect(() => {
    if (!isCurrentLayer) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSave = isModShortcut(event, 's');
      const isSearch = isModShortcut(event, 'k');
      if (!isSave && !isSearch) return;
      event.preventDefault();
      if (diffModalOpen || document.querySelector('[aria-modal="true"]')) return;
      if (isSave) {
        if (!saveDisabled) void handleSave();
        return;
      }
      const input = mode === 'visual' ? searchInputRef.current : sourceSearchInputRef.current;
      input?.focus();
      input?.select();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [diffModalOpen, handleSave, isCurrentLayer, mode, saveDisabled]);

  const focusSourceSearch = useCallback(() => {
    sourceSearchInputRef.current?.focus();
    sourceSearchInputRef.current?.select();
  }, []);

  const saveBarChanges = useMemo<SaveBarChange[]>(
    () =>
      dirtyFieldIds.flatMap((fieldId) => {
        const entry = findConfigFieldById(fieldId);
        if (!entry) return [];
        const label = t(entry.labelKey);
        return [
          {
            fieldId,
            label: entry.qualifierKey ? `${label} · ${t(entry.qualifierKey)}` : label,
            section: t(configSectionNavKey(entry.sectionId)),
          },
        ];
      }),
    [dirtyFieldIds, t]
  );

  const handleJumpToChange = useCallback(
    (fieldId: string) => {
      const entry = findConfigFieldById(fieldId);
      if (entry) jumpToField(entry);
    },
    [jumpToField]
  );

  const handleGoToError = useCallback(() => {
    const entry = findConfigFieldById(errorFieldIds[0]);
    if (entry) {
      jumpToField(entry);
      return;
    }
    if (visualHasPayloadValidationErrors) {
      handleNavSectionChange('payload');
    }
  }, [errorFieldIds, handleNavSectionChange, jumpToField, visualHasPayloadValidationErrors]);

  const saveBarStatus: { text: string; tone: 'busy' | 'error' | 'muted' } | null =
    doc.recoveryRequired
      ? { text: t('config_management.precise_save_recovery_required'), tone: 'error' }
      : status.key === 'saving' || status.key === 'loading'
        ? { text: t(status.labelKey), tone: 'busy' }
        : status.key === 'disconnected'
          ? { text: t(status.shortLabelKey), tone: 'muted' }
          : status.key === 'yaml_error'
            ? { text: t(status.labelKey), tone: 'error' }
            : null;

  const sectionDisabled =
    disableControls || doc.loading || doc.saving || doc.diffModalOpen || doc.recoveryRequired;
  const sectionProps = {
    values: visualValues,
    validationErrors: visualValidationErrors,
    disabled: sectionDisabled,
    onChange: setVisualValues,
  };
  const initialLoading = doc.loading && !doc.serverYaml;

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'connectivity':
        return <SectionConnectivity {...sectionProps} />;
      case 'network':
        return <SectionNetwork {...sectionProps} />;
      case 'logging':
        return <SectionLogging {...sectionProps} />;
      case 'streaming':
        return <SectionStreaming {...sectionProps} />;
      case 'advanced':
        return <SectionAdvanced {...sectionProps} />;
      case 'payload':
        return (
          <SectionPayload
            {...sectionProps}
            hasPayloadValidationErrors={visualHasPayloadValidationErrors}
          />
        );
    }
  };

  const saveBar = (
    <SaveBar
      visible={isCurrentLayer && doc.isDirty}
      changes={saveBarChanges}
      sourceDirty={doc.sourceDirty}
      errorCount={mode === 'visual' ? totalErrors : 0}
      statusText={saveBarStatus?.text ?? null}
      statusTone={saveBarStatus?.tone}
      saving={doc.saving}
      saveDisabled={saveDisabled}
      discardDisabled={doc.loading || doc.saving}
      shortcutLabel={saveShortcut}
      onSave={handleSave}
      onDiscard={doc.handleDiscard}
      onJumpToField={mode === 'visual' ? handleJumpToChange : undefined}
      onGoToError={mode === 'visual' ? handleGoToError : undefined}
    />
  );

  const sectionName = t(configSectionNavKey(activeSection));

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('config_management.title')}
        meta={
          <ConfigStatusMeta segments={headerMeta} busy={status.key === 'loading' || doc.saving} />
        }
        actions={
          <div className={styles.headerActions}>
            {mode === 'visual' ? (
              <ConfigSearch
                inputRef={searchInputRef}
                shortcutLabel={searchShortcut}
                disabled={disableControls || initialLoading}
                onJump={jumpToField}
              />
            ) : (
              <SourceSearchBar
                inputRef={sourceSearchInputRef}
                shortcutLabel={searchShortcut}
                search={sourceSearch}
                disabled={disableControls || doc.loading}
              />
            )}
            <ModeSwitch
              mode={mode}
              disabled={doc.saving || doc.loading || doc.diffModalOpen || doc.recoveryRequired}
              onChange={handleModeChange}
            />
            <Button
              variant="ghost"
              size="sm"
              className={styles.iconAction}
              onClick={doc.handleReload}
              disabled={doc.loading || doc.saving}
              aria-label={t('config_management.reload')}
              title={t('config_management.reload')}
            >
              <IconRefreshCw
                size={15}
                className={doc.loading ? styles.spinning : undefined}
                aria-hidden="true"
              />
            </Button>
          </div>
        }
      />

      {doc.error ? (
        <div className={styles.alert} role="alert">
          <span className={styles.alertText}>{doc.error}</span>
          <Button variant="secondary" size="sm" onClick={doc.handleReload} disabled={doc.loading}>
            {t('config_management.reload')}
          </Button>
        </div>
      ) : visualParseError ? (
        <div className={styles.alert} role="alert">
          <span className={styles.alertText}>
            {t('config_management.visual_mode_unavailable_detail', { message: visualParseError })}
          </span>
        </div>
      ) : null}

      {mode === 'visual' ? (
        <div
          ref={layoutRef}
          className={`${styles.layout} ${isCompact ? styles.layoutCompact : ''}`}
        >
          {isCompact ? (
            <SectionSelect
              active={activeSection}
              errorCounts={errorCounts}
              dirtyTabs={dirtyTabs}
              onChange={handleNavSectionChange}
            />
          ) : (
            <aside className={styles.index}>
              <SectionNav
                active={activeSection}
                errorCounts={errorCounts}
                dirtyTabs={dirtyTabs}
                dirtyFieldIds={dirtyFieldIdSet}
                errorFieldIds={errorFieldIdSet}
                activeGroup={activeGroup}
                onChange={handleNavSectionChange}
                onGroupJump={handleGroupJump}
              />
            </aside>
          )}
          <div className={`${styles.content} ${FIELDS_ROOT_CLASS}`}>
            <div
              id={configPanelDomId(activeSection)}
              role="region"
              aria-label={sectionName}
              aria-busy={initialLoading || undefined}
              className={styles.panel}
            >
              <DirtyFieldsContext.Provider value={dirtyFieldIdSet}>
                {initialLoading ? <SectionSkeleton /> : renderActiveSection()}
              </DirtyFieldsContext.Provider>
            </div>
            {saveBar}
          </div>
        </div>
      ) : (
        <div className={styles.source}>
          <SourcePanel
            search={sourceSearch}
            value={doc.content}
            onChange={doc.handleChange}
            theme={resolvedTheme}
            editable={!disableControls && !doc.loading && !doc.saving && !doc.diffModalOpen}
            onFindShortcut={focusSourceSearch}
          />
          {saveBar}
        </div>
      )}

      <DiffModal
        open={doc.diffModalOpen}
        original={doc.serverYaml}
        modified={doc.mergedYaml}
        onConfirm={doc.handleConfirmSave}
        onCancel={doc.closeDiff}
        loading={doc.saving}
      />
    </div>
  );
}
