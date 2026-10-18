import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { AccountLimit } from '../src/features/quota/accountCardModel';
import i18n from '../src/i18n/index';
import { cooldownReasonText, formatCooldownLine } from '../src/features/authFiles/cooldowns';
import { formatCompactDuration, pickTightestLimit } from '../src/features/authFiles/quotaSummary';
import { describeAuthFileProblem, readLastRefreshMs } from '../src/features/authFiles/rowModel';
import type { AuthFileItem } from '../src/types';

// Row components bind CSS modules and the quota store, so the markup contract is checked on
// source text; the row's derived values are covered through their React-free models below.
const row = readFileSync('src/features/authFiles/components/AuthFileRow.tsx', 'utf8');
const table = readFileSync('src/features/authFiles/components/AuthFilesTable.module.scss', 'utf8');
const settings = readFileSync('src/features/authFiles/components/AuthFileSettingsForm.tsx', 'utf8');
const quotaCell = readFileSync('src/features/authFiles/components/AuthFileQuotaCell.tsx', 'utf8');

describe('credential row contract', () => {
  test('one enable switch per row with a credential-specific name and pending guards', () => {
    expect(row.match(/<ToggleSwitch/g)).toHaveLength(1);
    expect(row).toContain("ariaLabel={t('auth_files.card_toggle', { name: file.name })}");
    expect(row).toContain('checked={!file.disabled}');
    expect(row).toContain('disabled={disableControls || isStatusUpdating || isManualRefreshing}');
    expect(row).toContain('const isStatusUpdating = statusUpdating[refreshKey] === true;');
    expect(row).toContain('const refreshKey = getAuthFileRefreshKey(file);');
  });

  test('runtime-only credentials get no checkbox, switch, download or delete', () => {
    const select = row.slice(row.indexOf('styles.cellSelect'), row.indexOf('styles.cellLamp'));
    expect(select).toContain('{!isRuntimeOnly && (');
    expect(select).toContain("ariaLabel={t('auth_files.card_select', { name: file.name })}");
    const toggle = row.slice(row.indexOf('styles.cellToggle'), row.indexOf('styles.cellMenu'));
    expect(toggle).toContain('{!isRuntimeOnly && (');
    expect(row).toMatch(/if \(!isRuntimeOnly\) \{\s*menuItems\.push\(\s*\{\s*id: 'download'/);
  });

  test('every management action stays reachable from the row menu, delete last and in red', () => {
    for (const handler of [
      'onOpenDetails(file)',
      "onOpenDetails(file, 'models')",
      'onRefreshQuota(file, quotaType)',
      'onManualRefresh(file)',
      'onCooldownReset(file)',
      'onDownload(file.name)',
      'onDelete(file.name)',
    ]) {
      expect(row).toContain(handler);
    }
    const tail = row.slice(row.indexOf("type: 'separator'"));
    expect(tail).toContain("id: 'delete'");
    expect(tail).toContain('danger: true');
    expect(row).toContain('file.disabled === true || isStatusUpdating || isManualRefreshing');
  });

  test('the row opens details from a real button; row clicks skip interactive children', () => {
    expect(row).toMatch(/<button\s+type="button"\s+className=\{`\$\{styles\.accountButton\}/);
    expect(row).toContain(
      'const ROW_INTERACTIVE_SELECTOR = \'button, a, input, label, [role="menu"]\';'
    );
    expect(row).not.toMatch(/<div[^>]*onClick/);
  });

  test('never displays the account field (it can be an API key)', () => {
    expect(row).not.toMatch(/file\.account\b|\['account'\]/);
  });

  test('disabled rows use ink levels and an idle lamp instead of fading the whole row', () => {
    expect(table).toMatch(/\.rowDisabled\s*\{[^}]*color: var\(--ink-3\)/);
    expect(table).not.toMatch(/\.rowDisabled[^{]*\{[^}]*opacity/);
  });

  test('the lamp is exactly the pool-rail lamp; low quota never recolors it', () => {
    // Header counts, status filters and the sidebar rail all derive from getCredentialLampState.
    expect(row).toContain('const lamp = getCredentialLampState(file);');
    expect(row).toContain('<StatusLamp state={lamp}');
    expect(row).not.toMatch(/lowQuota|headline[^;\n]*'warn'/);
  });

  test('the quota cell follows the one capacity rule; only a low figure turns red', () => {
    expect(quotaCell).toContain('const tone = toneForRemaining(headline.remaining);');
    expect(quotaCell).toContain('data-tone={tone}');
    expect(table).not.toMatch(/\.quota\[data-tone='warn'\]/);
    expect(table).toMatch(
      /\.quota\[data-tone='fault'\]\s*\{\s*\.quotaPercent\s*\{\s*color: var\(--signal-fault-ink\)/
    );
  });

  test('mobile rows keep the switch and the row menu side by side (no overlapping touch targets)', () => {
    expect(table).toContain("'select lamp glyph account account toggle menu'");
    expect(table).toContain("'select . . sub quota quota quota'");
  });

  test('rows stay dense: 44px comfortable, 36px compact', () => {
    expect(table).toMatch(/\.row\s*\{[^}]*min-height: 44px;/);
    expect(table).toMatch(/\.compact\s*\{\s*\.row\s*\{\s*min-height: 36px;/);
  });

  test('the weight hint keeps its routing settings link in the settings form', () => {
    expect(settings).toContain('i18nKey="auth_files.weight_hint"');
    expect(settings).toContain('to="/config?field=routingStrategy"');
  });
});

const limit = (overrides: Partial<AccountLimit> & { id: string }): AccountLimit => ({
  label: overrides.id,
  remaining: null,
  resetAtMs: null,
  ...overrides,
});

describe('row quota headline', () => {
  test('picks the tightest window and ignores unknown values and spend caps', () => {
    const headline = pickTightestLimit([
      limit({ id: 'five-hour', remaining: 62, resetAtMs: 2_000 }),
      limit({ id: 'seven-day', remaining: 38, resetAtMs: 9_000 }),
      limit({ id: 'unknown', remaining: null }),
      limit({ id: 'extra-usage', remaining: 5 }),
    ]);
    expect(headline).toEqual({ label: 'seven-day', remaining: 0.38, resetAtMs: 9_000 });
  });

  test('breaks ties by the window that resets first', () => {
    expect(
      pickTightestLimit([
        limit({ id: 'late', remaining: 0, resetAtMs: 9_000 }),
        limit({ id: 'soon', remaining: 0, resetAtMs: 1_000 }),
      ])?.label
    ).toBe('soon');
  });

  test('returns null when nothing is measurable', () => {
    expect(pickTightestLimit([limit({ id: 'a' })])).toBeNull();
    expect(pickTightestLimit([])).toBeNull();
  });

  test('compact durations truncate and never claim more time than remains', () => {
    expect(formatCompactDuration(3 * 3_600_000 + 59 * 60_000, 'en')).toMatch(/^3\s?h$/);
    expect(formatCompactDuration(42 * 60_000 + 30_000, 'en')).toMatch(/^42\s?min?$|^42\s?m$/);
    expect(formatCompactDuration(5_000, 'en')).toMatch(/^1\s?min?$|^1\s?m$/);
    expect(formatCompactDuration(2 * 86_400_000, 'en')).toMatch(/^2\s?d$/);
    expect(formatCompactDuration(-1, 'en')).toBeNull();
    expect(formatCompactDuration(null, 'en')).toBeNull();
  });
});

const now = Date.parse('2026-10-18T10:00:00Z');
const credential = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'codex-a.json',
  type: 'codex',
  ...overrides,
});

describe('row status line', () => {
  test('failing credentials surface the upstream message', () => {
    expect(
      describeAuthFileProblem(
        credential({ status: 'error', statusMessage: 'refresh token revoked (401)' }),
        now
      )
    ).toEqual({ kind: 'status', tone: 'fault', message: 'refresh token revoked (401)' });
  });

  test('disabled credentials report nothing, even with a stale error', () => {
    expect(
      describeAuthFileProblem(credential({ disabled: true, statusMessage: 'boom' }), now)
    ).toBeNull();
  });

  test('credential cooldowns lead with time left, HTTP status and reason', () => {
    const problem = describeAuthFileProblem(
      credential({
        cooldownSnapshot: {
          receivedAtMs: now,
          records: [
            { scope: 'model', modelKey: 'm', reason: 'quota', retryAt: '', remainingSeconds: 30 },
            {
              scope: 'credential',
              reason: 'quota exhausted',
              retryAt: '',
              remainingSeconds: 42 * 60,
              httpStatus: 429,
            },
          ],
        },
      }),
      now
    );
    expect(problem).toMatchObject({
      kind: 'cooldown',
      tone: 'warn',
      credentialWide: true,
      modelCount: 1,
      remainingSeconds: 42 * 60,
      httpStatus: 429,
      reason: 'quota exhausted',
    });
  });

  test('elapsed cooldown timers no longer produce a status line', () => {
    expect(
      describeAuthFileProblem(
        credential({
          cooldownSnapshot: {
            receivedAtMs: now - 120_000,
            records: [{ scope: 'credential', reason: 'quota', retryAt: '', remainingSeconds: 60 }],
          },
        }),
        now
      )
    ).toBeNull();
  });

  test('last refresh accepts ISO strings and unix seconds; Go zero time means never', () => {
    expect(readLastRefreshMs(credential({ last_refresh: '2026-10-18T09:00:00Z' }))).toBe(
      Date.parse('2026-10-18T09:00:00Z')
    );
    expect(readLastRefreshMs(credential({ lastRefresh: 1_760_000_000 }))).toBe(1_760_000_000_000);
    expect(readLastRefreshMs(credential({ last_refresh: '0001-01-01T00:00:00Z' }))).toBeNull();
    expect(readLastRefreshMs(credential())).toBeNull();
  });
});

describe('shared cooldown wording (Credentials rows and Overview attention)', () => {
  const t = i18n.getFixedT('en');

  test('credential-wide: time left, HTTP status, then the raw reason the server sent', () => {
    expect(
      formatCooldownLine(
        t,
        {
          credentialWide: true,
          modelCount: 1,
          remainingSeconds: 42 * 60,
          httpStatus: 429,
          reason: 'quota exhausted',
        },
        'en'
      )
    ).toBe('Cooling down 42m · 429 · quota exhausted');
  });

  test('known reason codes are translated; model-only cooldowns name the model count', () => {
    expect(
      formatCooldownLine(
        t,
        { credentialWide: true, modelCount: 0, remainingSeconds: 90 * 60, reason: 'quota' },
        'en'
      )
    ).toBe(`Cooling down 1h · ${t('auth_files.cooldown_reason_quota')}`);
    expect(
      formatCooldownLine(
        t,
        { credentialWide: false, modelCount: 2, remainingSeconds: 180, reason: 'unauthorized' },
        'en'
      )
    ).toBe(`2 models cooling down 3m · ${t('auth_files.cooldown_reason_unauthorized')}`);
  });

  test('elapsed timers say so instead of inventing a duration', () => {
    expect(
      formatCooldownLine(
        t,
        { credentialWide: true, modelCount: 0, remainingSeconds: 0, httpStatus: 429 },
        'en'
      )
    ).toBe(
      `${t('dashboard.attention_cooldown')} · ${t('auth_files.cooldown_timer_elapsed')} · 429`
    );
  });

  test('never prints the generic "unknown reason" label', () => {
    const unknown = t('auth_files.cooldown_reason_unknown');
    expect(cooldownReasonText(t, 'future_reason')).toBe('future_reason');
    expect(cooldownReasonText(t, '   ')).toBeNull();
    expect(cooldownReasonText(t, null)).toBeNull();
    const line = formatCooldownLine(
      t,
      { credentialWide: true, modelCount: 0, remainingSeconds: 60, reason: '' },
      'en'
    );
    expect(line).toBe('Cooling down 1m');
    expect(line).not.toContain(unknown);
  });
});
