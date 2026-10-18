// Section → group registry for the visual editor.
//
// Each section renders its settings as headed groups (<SettingGroup group="…">). This registry is
// the single source for a group's title, its order inside the section and the field ids it owns,
// so the left section index (group anchors, unsaved dots, error counts) and the rendered groups
// cannot drift. tests/configSettingLayout.test.ts renders every section and checks that each field
// anchor sits inside the group listed here.

import type { ConfigTabId } from './constants';

export type ConfigGroupDef = {
  /** Globally unique group id; DOM id via configGroupDomId. */
  id: string;
  /** i18n key of the group heading. */
  titleKey: string;
  /** Field ids (search index ids) rendered inside this group, in display order. */
  fields: readonly string[];
};

const V = (key: string) => `config_management.visual.${key}`;
const G = (key: string) => `config_management.groups.${key}`;

export const CONFIG_SECTION_GROUPS: Record<ConfigTabId, readonly ConfigGroupDef[]> = {
  connectivity: [
    {
      id: 'server',
      titleKey: G('server'),
      fields: ['host', 'port', 'authDir', 'githubToken', 'trustedProxies'],
    },
    { id: 'apiKeys', titleKey: V('api_keys.label'), fields: ['apiKeys'] },
    { id: 'tls', titleKey: G('tls'), fields: ['tlsEnable', 'tlsCert', 'tlsKey'] },
    {
      id: 'remote',
      titleKey: V('sections.remote.title'),
      fields: [
        'rmAllowRemote',
        'rmDisableControlPanel',
        'rmDisableAutoUpdatePanel',
        'rmSecretKey',
        'rmPanelRepo',
      ],
    },
    {
      id: 'discovery',
      titleKey: V('serverExtras.discoveryTitle'),
      fields: [
        'discoveryEnabled',
        'discoveryServiceName',
        'discoveryServiceType',
        'discoverySubtypes',
        'discoveryInterfacesInclude',
        'discoveryInterfacesExclude',
        'discoveryAuthRequired',
        'discoveryAdvertiseManagement',
      ],
    },
  ],
  network: [
    { id: 'requests', titleKey: G('requests'), fields: ['proxyUrl', 'passthroughHeaders'] },
    {
      id: 'routing',
      titleKey: G('routing'),
      fields: [
        'routingStrategy',
        'routingResetFirstMaxFiveHour',
        'forceModelPrefix',
        'routingSessionAffinity',
        'routingSessionAffinityTTL',
        'routingSessionAffinitySubagents',
      ],
    },
    {
      id: 'retry',
      titleKey: G('retry'),
      fields: [
        'requestRetry',
        'maxRetryCredentials',
        'maxRetryInterval',
        'disableCooling',
        'saveCooldownStatus',
        'transientErrorCooldownSeconds',
      ],
    },
    {
      id: 'credentials',
      titleKey: G('credentials'),
      fields: ['authAutoRefreshWorkers', 'wsAuth'],
    },
    {
      id: 'media',
      titleKey: G('media'),
      fields: ['disableImageGeneration', 'gptImage2BaseModel', 'videoResultAuthCacheTTL'],
    },
  ],
  logging: [
    {
      id: 'logs',
      titleKey: G('logs'),
      fields: [
        'debug',
        'commercialMode',
        'loggingToFile',
        'logsMaxTotalSizeMb',
        'errorLogsMaxFiles',
      ],
    },
    {
      id: 'usage',
      titleKey: G('usage'),
      fields: ['usageStatisticsEnabled', 'redisUsageQueueRetentionSeconds'],
    },
  ],
  streaming: [
    {
      id: 'streaming',
      titleKey: G('streaming'),
      fields: ['streamingKeepaliveSeconds', 'streamingBootstrapRetries'],
    },
    { id: 'nonstream', titleKey: G('nonstream'), fields: ['streamingNonstreamKeepalive'] },
  ],
  advanced: [
    {
      id: 'claude',
      titleKey: V('additions.claudeTitle'),
      fields: [
        'claudeModelLevelCooling',
        'claudeDisableCloakMode',
        'claudeCodeDisableCloakingModelList',
      ],
    },
    {
      id: 'claudeHeaders',
      titleKey: V('sections.headers.claude_title'),
      fields: [
        'claudeHeaderUserAgent',
        'claudeHeaderPackageVersion',
        'claudeHeaderRuntimeVersion',
        'claudeHeaderOs',
        'claudeHeaderArch',
        'claudeHeaderTimezone',
        'claudeHeaderTimeout',
        'claudeHeaderStabilizeDeviceProfile',
      ],
    },
    {
      id: 'codex',
      titleKey: V('additions.codexTitle'),
      fields: [
        'codexDisableCloaking',
        'codexModelLevelCooling',
        'codexStreamBootstrapBuffering',
        'codexStreamBootstrapTimeout',
        'codexOptimizeMultiAgentV2',
        'codexOrphanDelegationCompatibility',
        'codexResponseSteering',
      ],
    },
    {
      id: 'codexHeaders',
      titleKey: V('sections.headers.codex_title'),
      fields: ['codexHeaderUserAgent', 'codexHeaderBetaFeatures'],
    },
    {
      id: 'liveRelay',
      titleKey: V('additions.liveRelayTitle'),
      fields: [
        'codexLiveMediaRelayEnabled',
        'codexLiveMediaRelayMaxSessions',
        'codexLiveMediaRelayDisablePrivateRemoteIPs',
        'codexLiveMediaRelayPublicIP',
        'codexLiveMediaRelayUDPPortMin',
        'codexLiveMediaRelayUDPPortMax',
        'codexLiveMediaRelayICEServers',
      ],
    },
    {
      id: 'antigravity',
      titleKey: V('sections.advanced.antigravity_title'),
      fields: [
        'quotaAntigravityCredits',
        'antigravityConnectionPoolEnabled',
        'antigravityConnectionPoolIdleTimeout',
        'antigravityConnectionPoolMaxIdleConnsPerHost',
        'antigravitySignatureCacheEnabled',
        'antigravitySignatureBypassStrict',
        'antigravitySensitiveWords',
      ],
    },
    { id: 'devin', titleKey: V('sections.advanced.devin_title'), fields: ['devinSensitiveWords'] },
    { id: 'xai', titleKey: V('additions.xaiTitle'), fields: ['xaiInjectXSearch'] },
    {
      id: 'plugins',
      titleKey: V('sections.advanced.plugins_title'),
      fields: ['pluginsEnabled', 'pluginStoreSources', 'pluginStoreAuth'],
    },
  ],
  payload: [
    {
      id: 'payloadDefault',
      titleKey: V('sections.payload.default_rules'),
      fields: ['payloadDefaultRules'],
    },
    {
      id: 'payloadDefaultRaw',
      titleKey: V('sections.payload.default_raw_rules'),
      fields: ['payloadDefaultRawRules'],
    },
    {
      id: 'payloadOverride',
      titleKey: V('sections.payload.override_rules'),
      fields: ['payloadOverrideRules'],
    },
    {
      id: 'payloadOverrideRaw',
      titleKey: V('sections.payload.override_raw_rules'),
      fields: ['payloadOverrideRawRules'],
    },
    {
      id: 'payloadFilter',
      titleKey: V('sections.payload.filter_rules'),
      fields: ['payloadFilterRules'],
    },
  ],
};

const GROUPS_BY_ID: ReadonlyMap<string, ConfigGroupDef> = new Map(
  Object.values(CONFIG_SECTION_GROUPS)
    .flat()
    .map((group) => [group.id, group])
);

export function findConfigGroup(groupId: string): ConfigGroupDef | undefined {
  return GROUPS_BY_ID.get(groupId);
}

/** DOM id of a group heading block (anchor target of the section index). */
export const configGroupDomId = (groupId: string) => `cfg-group-${groupId}`;

/** Short section names used by the section index, search results and the change list. */
export const configSectionNavKey = (sectionId: ConfigTabId) => `config_management.nav.${sectionId}`;
