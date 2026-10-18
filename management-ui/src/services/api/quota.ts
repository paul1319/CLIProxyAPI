import { apiClient } from './client';
import type { ApiCallResult } from './apiCall';

export const QUOTA_REFRESH_INTERVAL_MS = 300_000;

export interface QuotaReadOptions {
  mode?: 'cached' | 'refresh' | 'force';
  automatic?: boolean;
  forceDetails?: boolean;
  observedAt?: string;
  stale?: boolean;
  errorStatus?: number;
  persistenceError?: boolean;
}

interface QuotaResponse {
  status_code: number;
  body?: unknown;
  observed_at?: string;
  server_time?: string;
  stale?: boolean;
  error_status?: number;
  persistence_error?: boolean;
}

const primaryResources = new Set(['usage', 'weekly', 'monthly', 'plugin']);

/** The server owns URLs, credentials, refresh intervals and durable observations. */
export const quotaApi = {
  async read(
    authIndex: string,
    resource: string,
    options: QuotaReadOptions = {},
    pluginId?: string
  ): Promise<ApiCallResult> {
    const input = { auth_index: authIndex, resource, ...(pluginId ? { plugin_id: pluginId } : {}) };
    const response =
      options.mode === 'cached'
        ? await apiClient.get<QuotaResponse>('/credentials/quota', { params: input })
        : await apiClient.post<QuotaResponse>('/credentials/quota/refresh', {
            ...input,
            force:
              options.mode === 'force' &&
              (primaryResources.has(resource) || options.forceDetails === true),
          });
    if (primaryResources.has(resource)) {
      if (
        response.observed_at &&
        !response.observed_at.startsWith('0001-') &&
        (!options.observedAt || Date.parse(response.observed_at) < Date.parse(options.observedAt))
      )
        options.observedAt = response.observed_at;
      options.stale ||= response.stale === true;
      options.errorStatus ||= response.error_status || undefined;
    }
    options.persistenceError ||= response.persistence_error === true;
    return {
      statusCode: response.status_code,
      body: response.body ?? null,
      bodyText: response.body == null ? '' : JSON.stringify(response.body),
      header: response.server_time ? { Date: [response.server_time] } : {},
    };
  },
};
