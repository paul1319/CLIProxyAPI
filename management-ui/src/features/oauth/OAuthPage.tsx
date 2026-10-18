import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { MetaDot, PageHeader } from '@/components/common/PageHeader';
import { IconFileText } from '@/components/ui/icons';
import { useAuthStore, useThemeStore } from '@/stores';
import iconVertex from '@/assets/icons/vertex.svg';
import { KIMI_DISPLAY_NAME } from '@/features/providers/kimi';
import {
  PickerGroup,
  ProviderRow,
  SponsorRow,
  type RowStatus,
  type SponsorSiteEntry,
} from './components/ProviderPicker';
import { OAuthFlowDialog, type DialogHeading } from './components/OAuthFlowDialog';
import { VertexImportDialog } from './components/VertexImportDialog';
import {
  useOAuthFlows,
  usePluginOAuthProviders,
  type ProviderFlowState,
} from './hooks/useOAuthFlows';
import { useVertexImport } from './hooks/useVertexImport';
import { useConnectedCounts } from './hooks/useConnectedCounts';
import { connectedCountFor } from './connectedCounts';
import {
  isSponsor,
  OAUTH_PROVIDERS,
  resolveThemedIcon,
  supportsManualCallback,
  type OAuthProviderCard,
} from './providers';
import styles from './OAuthPage.module.scss';

/** Dialog focus id for Vertex: not an OAuth provider, so it uses a reserved id. */
const VERTEX_DIALOG_ID = '__vertex__';
const VERTEX_LABEL = 'Vertex AI';

type DialogTarget = { kind: 'oauth'; id: string } | { kind: 'vertex' };

/**
 * Add account: a picker list of sign-in methods plus a focused flow dialog.
 *
 * "Connect" starts sign-in immediately. The dialog can be closed at any time; the flow keeps
 * polling while this page stays mounted, and the row's status cell mirrors its progress.
 * The last dialog target is kept after closing so content does not vanish mid-exit-animation.
 */
export function OAuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const apiBase = useAuthStore((state) => state.apiBase);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const pluginProviders = usePluginOAuthProviders(apiBase);
  const providerCards = useMemo<OAuthProviderCard[]>(
    () => [...OAUTH_PROVIDERS, ...pluginProviders],
    [pluginProviders]
  );
  const counts = useConnectedCounts(apiBase);

  const focusedRef = useRef<string | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const flows = useOAuthFlows({
    providerCards,
    isFocused: (provider) => focusedRef.current === provider,
  });
  const vertexImport = useVertexImport({
    isFocused: () => focusedRef.current === VERTEX_DIALOG_ID,
    onCredentialAdded: flows.recordCredentialAdded,
  });

  const labelOf = (card: OAuthProviderCard) =>
    card.kind === 'plugin'
      ? card.title
      : typeof card.label === 'string'
        ? card.label
        : t(card.label.key);

  const methodOf = (card: OAuthProviderCard) =>
    card.kind === 'plugin'
      ? t('auth_login.method_plugin')
      : t(card.flow === 'device' ? 'auth_login.method_device' : 'auth_login.method_browser');

  const captionOf = (card: OAuthProviderCard) => {
    const method = methodOf(card);
    return card.kind === 'builtin' && card.domain ? `${card.domain} · ${method}` : method;
  };

  const iconOf = (card: OAuthProviderCard) =>
    card.kind === 'plugin' ? card.icon : resolveThemedIcon(card.icon, resolvedTheme);

  const headingOf = (card: OAuthProviderCard): DialogHeading => ({
    title:
      card.kind === 'plugin'
        ? t('auth_login.plugin_oauth_title', { name: card.title })
        : t(card.titleKey),
    caption: captionOf(card),
    icon: iconOf(card),
  });

  const sponsorOf = (card: OAuthProviderCard) =>
    isSponsor(card)
      ? { url: card.sponsor.signUpUrl, label: t('auth_login.kimi_sign_up_button') }
      : undefined;

  const rowStatusOf = (state: ProviderFlowState | undefined): RowStatus | undefined => {
    switch (state?.status) {
      case 'waiting':
        return { lamp: 'warn', live: true, text: t('auth_login.tile_waiting') };
      case 'success':
        return { lamp: 'ok', text: t('auth_login.tile_success') };
      case 'error':
        return { lamp: 'fault', text: t('auth_login.tile_error'), title: state.error };
      default:
        return undefined;
    }
  };

  const actionLabelOf = (state: ProviderFlowState | undefined) =>
    state?.status === 'waiting'
      ? t('auth_login.resume')
      : state?.status === 'error'
        ? t('auth_login.details')
        : t('auth_login.connect');

  const countOf = (id: string) => (counts ? connectedCountFor(counts, id) : null);

  const openProvider = (card: OAuthProviderCard) => {
    focusedRef.current = card.id;
    setDialog({ kind: 'oauth', id: card.id });
    setDialogOpen(true);
    // An attempt in progress / failed / just succeeded → reopen it; otherwise start right away.
    if (!flows.states[card.id]?.status) void flows.startAuth(card.id);
  };

  const openVertex = () => {
    focusedRef.current = VERTEX_DIALOG_ID;
    setDialog({ kind: 'vertex' });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (dialog?.kind === 'oauth') flows.dismissSuccess(dialog.id);
    if (dialog?.kind === 'vertex' && vertexImport.vertex.result) vertexImport.resetForAnother();
    focusedRef.current = null;
    setDialogOpen(false);
  };

  const viewAuthFiles = () => navigate('/auth-files');

  const dialogCard =
    dialog?.kind === 'oauth' ? providerCards.find((card) => card.id === dialog.id) : undefined;
  const sponsorCards = providerCards.filter(isSponsor);
  const regularCards = providerCards.filter((card) => !isSponsor(card));

  const sponsorSites: SponsorSiteEntry[] = sponsorCards.map((card) => ({
    id: card.id,
    name: labelOf(card),
    region: t(card.sponsor.siteKey),
    status: rowStatusOf(flows.states[card.id]),
    signUpUrl: card.sponsor.signUpUrl,
  }));
  const sponsorCount = counts
    ? sponsorCards.reduce((sum, card) => sum + connectedCountFor(counts, card.id), 0)
    : null;
  const sponsorCountTitle = counts
    ? sponsorCards
        .map((card) => `${card.domain ?? labelOf(card)}: ${connectedCountFor(counts, card.id)}`)
        .join(' · ')
    : undefined;

  const waitingCount = Object.values(flows.states).filter(
    (state) => state.status === 'waiting'
  ).length;

  const meta = (
    <>
      <span>{t('auth_login.page_meta')}</span>
      {waitingCount > 0 && (
        <>
          <MetaDot />
          <span className={styles.metaWaiting}>
            {t('auth_login.meta_waiting', { count: waitingCount })}
          </span>
        </>
      )}
      {flows.addedCount > 0 && (
        <>
          <MetaDot />
          <span className={styles.metaAdded}>
            {t('auth_login.meta_added', { count: flows.addedCount })}
          </span>
        </>
      )}
    </>
  );

  return (
    <div className={styles.page}>
      <PageHeader title={t('nav.oauth', { defaultValue: 'Add account' })} meta={meta} />

      <div className={styles.groups}>
        <PickerGroup title={t('auth_login.group_sign_in')}>
          {sponsorCards.length > 0 && (
            <SponsorRow
              icon={iconOf(sponsorCards[0])}
              title={KIMI_DISPLAY_NAME}
              caption={t('auth_login.sponsor_kimi_caption')}
              sponsoredLabel={t('auth_login.sponsored')}
              signUpLabel={t('auth_login.sponsor_sign_up')}
              sites={sponsorSites}
              count={sponsorCount}
              countTitle={sponsorCountTitle}
              onOpen={(siteId) => {
                const card = sponsorCards.find((sponsor) => sponsor.id === siteId);
                if (card) openProvider(card);
              }}
            />
          )}
          {regularCards.map((card) => {
            const state = flows.states[card.id];
            return (
              <ProviderRow
                key={card.id}
                icon={iconOf(card)}
                name={labelOf(card)}
                caption={captionOf(card)}
                count={countOf(card.id)}
                status={rowStatusOf(state)}
                action={{
                  kind: 'dialog',
                  label: actionLabelOf(state),
                  onClick: () => openProvider(card),
                }}
              />
            );
          })}
        </PickerGroup>

        <PickerGroup title={t('auth_login.group_import')}>
          <ProviderRow
            icon={iconVertex}
            name={VERTEX_LABEL}
            caption={t('vertex_import.file_label')}
            count={countOf('vertex')}
            status={
              vertexImport.vertex.loading
                ? { lamp: 'warn', live: true, text: t('auth_login.importing') }
                : undefined
            }
            action={{ kind: 'dialog', label: t('auth_login.import'), onClick: openVertex }}
          />
          <ProviderRow
            icon={<IconFileText size={16} />}
            name={t('auth_login.credential_file_title')}
            caption={t('auth_login.credential_file_caption')}
            action={{
              kind: 'link',
              label: t('auth_login.credential_file_action'),
              to: '/auth-files',
            }}
          />
        </PickerGroup>
      </div>

      {dialogCard && (
        <OAuthFlowDialog
          open={dialogOpen && dialog?.kind === 'oauth'}
          providerId={dialogCard.id}
          heading={headingOf(dialogCard)}
          state={flows.states[dialogCard.id] ?? {}}
          text={(suffix) => flows.providerText(dialogCard.id, suffix)}
          supportsCallback={supportsManualCallback(dialogCard)}
          sponsor={sponsorOf(dialogCard)}
          onStart={() => void flows.startAuth(dialogCard.id)}
          onCancel={() => void flows.cancelAuth(dialogCard.id)}
          onCallbackChange={(value) => flows.setCallbackInput(dialogCard.id, value)}
          onCallbackSubmit={() => void flows.submitCallback(dialogCard.id)}
          onViewAuthFiles={viewAuthFiles}
          onClose={closeDialog}
        />
      )}

      <VertexImportDialog
        open={dialogOpen && dialog?.kind === 'vertex'}
        heading={{
          title: t('vertex_import.title'),
          caption: t('vertex_import.file_label'),
          icon: iconVertex,
        }}
        vertex={vertexImport.vertex}
        onPickFile={vertexImport.pickFile}
        onLocationChange={vertexImport.setLocation}
        onImport={() => void vertexImport.importCredential()}
        onImportAnother={vertexImport.resetForAnother}
        onViewAuthFiles={viewAuthFiles}
        onClose={closeDialog}
      />
    </div>
  );
}
