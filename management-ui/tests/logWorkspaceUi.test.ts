import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dir = 'src/features/logs';
const page = readSource(`${dir}/LogsPage.tsx`);
const pageStyles = readSource(`${dir}/LogsPage.module.scss`);
const tabs = readSource(`${dir}/components/LogTabs.tsx`);
const toolbar = readSource(`${dir}/components/LogToolbar.tsx`);
const toolbarStyles = readSource(`${dir}/components/LogToolbar.module.scss`);
const popover = readSource(`${dir}/components/LogMorePopover.tsx`);
const viewer = readSource(`${dir}/components/LogViewer.tsx`);
const viewerStyles = readSource(`${dir}/components/LogViewer.module.scss`);
const row = readSource(`${dir}/components/LogRow.tsx`);
const statusBar = readSource(`${dir}/components/LogStatusBar.tsx`);
const filesStyles = readSource(`${dir}/components/LogFiles.module.scss`);
const layout = readSource('src/styles/layout.scss');

const block = (source: string, selector: string) =>
  source.match(
    new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]+)\\}`, 'm')
  )?.[1] ?? '';

// Structural guards complement the browser screenshots. The important contracts are a
// single flexible scrolling surface, real tabs, a non-modal popover and aligned rows.
describe('log workspace layout contract', () => {
  test('the log surface takes the remaining height instead of fixed height budgets', () => {
    const surface = block(viewerStyles, '.surface');
    const scroll = block(viewerStyles, '.scroll');
    expect(surface).toContain('flex: 1');
    expect(surface).toContain('min-height: 0');
    expect(scroll).toContain('flex: 1');
    expect(scroll).toContain('min-height: 0');
    expect(scroll).toContain('overflow: auto');
    for (const source of [viewerStyles, pageStyles, toolbarStyles]) {
      expect(source).not.toMatch(/calc\(100vh\s*-/);
      expect(source).not.toContain('resize: vertical');
      expect(source).not.toMatch(/\n\s*(?:height|min-height|max-height):\s*(?:360|420|480)px/);
    }
    // The shell gives the logs route a bounded, non-scrolling content area.
    expect(layout).toMatch(/&\.content-logs\s*\{[^}]*overflow: hidden;/);
    expect(layout).toMatch(/&\.main-content-logs\s*\{[^}]*min-height: 0;[^}]*overflow: hidden;/);
  });

  test('error files and fullscreen share the flexible viewport contract', () => {
    const files = block(filesStyles, '.panel');
    const fullscreen = block(pageStyles, '.workspaceFullscreen');
    expect(files).toContain('flex: 1');
    expect(files).toContain('min-height: 0');
    expect(files).not.toMatch(/\bheight:\s*\d+px/);
    expect(fullscreen).toContain('position: fixed');
    expect(fullscreen).toContain('height: 100dvh');
    expect(pageStyles).toContain(
      ':global(body.logs-fullscreen-active) :global(.page-transition__layer)'
    );
    // Escape belongs to an open sheet or confirmation before it exits fullscreen.
    expect(page).toContain("viewerOpen || !!document.querySelector('.modal-overlay')");
  });

  test('the page uses the shared header with a real tablist', () => {
    expect(page).toContain('<PageHeader');
    expect(page).toContain('role="tabpanel"');
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('role="tab"');
    expect(tabs).toContain('aria-selected={selected}');
    expect(tabs).toContain('aria-controls={logPanelDomId(tab)}');
    expect(tabs).not.toContain('aria-pressed');
  });

  test('secondary filters and display options live in a non-modal popover', () => {
    expect(popover).toContain('const [open, setOpen] = useState(false)');
    expect(popover).toContain('aria-haspopup="dialog"');
    expect(popover).toContain('aria-expanded={open}');
    expect(popover).toContain('role="dialog"');
    expect(popover).not.toContain('aria-modal');
    // Escape is captured so closing the popover never exits fullscreen as well.
    expect(popover).toContain("document.addEventListener('keydown', onKeyDown, true)");
    for (const source of [page, toolbar, popover]) {
      expect(source).not.toContain("from '@/components/ui/Modal'");
    }
    for (const key of [
      "'logsPage.showRawLogs'",
      "'logsPage.hideManagementLogs'",
      "'logsPage.wrapLogs'",
      "'logsPage.showIp'",
      "'logsPage.showSource'",
    ]) {
      expect(page).toContain(key);
    }
  });

  test('continuous reading is a labeled live/paused toggle, not an unlabeled icon', () => {
    expect(toolbar).toContain('aria-pressed={live.enabled}');
    expect(toolbar).toContain("t('logs.live')");
    expect(toolbar).toContain("t('logs.paused')");
    expect(toolbar).toContain("aria-label={t('logs.reading_enabled')}");
    expect(toolbar).not.toContain('IconTimer');
  });

  test('rows are aligned grid columns with one copy affordance and no per-row Button', () => {
    expect(block(viewerStyles, '.row')).toContain('grid-template-columns: var(--log-cols)');
    expect(viewerStyles).toContain('[time] 8ch [level] 5ch [status] 3ch');
    expect(viewerStyles).toContain('grid-column: status / rid');
    expect(viewerStyles).toContain('.row:hover .copy');
    expect(row).toContain("aria-label={t('logs.copy_line')}");
    expect(row).not.toContain('onDoubleClick');
    expect(row).not.toContain('<Button');
    expect(row).toContain('data-log-id={line.id}');
    expect(viewer).toContain('data-log-id={line.id}');
    expect(viewer).toContain('tabIndex={0}');
    expect(viewer).toContain("aria-label={t('logs.log_content')}");
    expect(page).toContain("useLocalStorage('logsPage.wrapLogs', false)");
  });

  test('background refresh retains loaded content and status stays outside the scroller', () => {
    expect(page).toContain('loading && logBuffer.buffer.length === 0');
    expect(page).toContain('onScroll={handleLogScroll}');
    expect(page).toContain('onResume={resumeFollowing}');
    expect(viewer).toContain('onScroll={onScroll}');
    expect(viewer).toContain('onClick={onResume}');
    expect(statusBar).toContain('<footer className={styles.statusBar}>');
    // The status bar is rendered after the scrolling region, not inside it.
    expect(viewer.indexOf('{statusBar}')).toBeGreaterThan(
      viewer.indexOf('className={styles.scroll}')
    );
  });

  test('routine buffer eviction does not add a persistent warning banner', () => {
    for (const source of [page, statusBar, viewer]) {
      expect(source).not.toContain("t('logs.buffer_evicted')");
      expect(source).not.toContain('logBuffer.evicted > 0');
    }
    // A lost reading position and a backend cursor reset remain actionable notices.
    expect(statusBar).toContain("t('logs.history_evicted')");
    expect(statusBar).toContain("t('logs.cursor_reset_notice')");
  });

  test('toolbar controls share one compact size, larger on touch layouts', () => {
    expect(toolbarStyles).toContain('--control: #{$control-sm}');
    expect(toolbarStyles).toContain('--control: 36px');
    expect(block(toolbarStyles, '.iconButton')).toContain('width: var(--control)');
    expect(block(toolbarStyles, '.search')).toContain('height: var(--control)');
    expect(toolbarStyles).not.toContain('--log-control-height');
  });

  test('the header carries a meta line like every other page', () => {
    expect(page).toContain('meta={headerMeta}');
    expect(page).toContain("t('logs.meta_lines', { count: logBuffer.buffer.length })");
    expect(page).toContain("t('logs.meta_updated', { time: updatedClock })");
    // The footer only appears when it adds something beyond the header count.
    expect(page).toContain('!showStatusBar ? null');
  });

  test('tabs match the Credentials underline spec: label flush with the title edge', () => {
    const tabsStyles = readSource(`${dir}/components/LogTabs.module.scss`);
    const tab = block(tabsStyles, '.tab');
    expect(tab).toContain('padding: 0;');
    expect(tab).not.toContain('margin-right');
    expect(tab).toContain('font-weight: 500');
    expect(tabsStyles).toContain('border-bottom: 1px solid var(--rule)');
  });

  test('logging-off empty state deep-links to the Log to file setting', () => {
    expect(page).toContain("'/config?field=loggingToFile'");
    expect(page).toContain("t('logs.enable_file_logging')");
    expect(viewer).toContain('className={styles.empty}');
  });

  test('the mobile filter strip fades the edge that still has chips beyond it', () => {
    expect(toolbar).toContain('strip.dataset.fadeEnd');
    expect(toolbarStyles).toContain("&[data-fade-end='true']");
    expect(toolbarStyles).toContain('mask-image');
  });

  test('popover filter chips are soft fills, not outlined pills', () => {
    const chip = block(toolbarStyles, '.chip');
    expect(chip).toContain('border: 0;');
    expect(chip).toContain('background: var(--well);');
  });

  test('all supported locales describe the toolbar, popover and tabs', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'ko', 'vi']) {
      const messages = JSON.parse(readSource(`src/i18n/locales/${locale}.json`));
      for (const key of [
        'tab_live',
        'tab_errors',
        'live',
        'paused',
        'more',
        'show_raw_logs',
        'wrap_lines',
        'hide_management_logs',
        'show_ip',
        'show_source',
        'level_warn_plus',
        'status_lines',
        'new_lines',
        'meta_lines',
        'meta_updated',
        'meta_file_logging_off',
        'empty_logging_off',
        'enable_file_logging',
      ]) {
        expect(messages.logs[key]).toBeTruthy();
      }
    }
  });
});
