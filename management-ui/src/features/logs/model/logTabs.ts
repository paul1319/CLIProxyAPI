export const LOG_TABS = ['live', 'errors'] as const;
export type LogTab = (typeof LOG_TABS)[number];

export const logTabDomId = (tab: LogTab) => `logs-tab-${tab}`;
export const logPanelDomId = (tab: LogTab) => `logs-panel-${tab}`;
