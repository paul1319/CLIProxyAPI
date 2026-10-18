import type { ProviderBrand } from './types';

export interface ProviderModelCapabilities {
  maxContextLength: boolean;
  isCompat: boolean;
  configurationUpdate: boolean;
  modalities: boolean;
}

/** API-key model capabilities; aliases of CodexModel do not imply runtime support. */
export const getProviderModelCapabilities = (brand: ProviderBrand): ProviderModelCapabilities => ({
  maxContextLength: brand !== 'vertex',
  isCompat: brand !== 'vertex',
  configurationUpdate: brand === 'codex',
  modalities: brand === 'openaiCompatibility',
});
