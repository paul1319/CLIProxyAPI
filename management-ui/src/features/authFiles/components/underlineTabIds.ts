/** Stable ids linking an underline tab to its panel (aria-controls / aria-labelledby). */
export const tabPanelId = (idPrefix: string, id: string) => `${idPrefix}-panel-${id}`;
export const tabId = (idPrefix: string, id: string) => `${idPrefix}-tab-${id}`;
