/**
 * Sponsor shown as a plain muted link under the Proxy URL setting (Network section).
 * Front-end constant, unrelated to the backend config; edit this list to add or remove sponsors.
 * An empty list hides the link.
 */
export type Sponsor = {
  /** Sponsor name (shown as-is, not translated). */
  name: string;
  /** Link target. */
  url: string;
};

export const SPONSORS: readonly Sponsor[] = [
  {
    name: 'BestProxy.com',
    url: 'https://bestproxy.com/?keyword=ayh7otlb',
  },
];
