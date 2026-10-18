import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, type SelectOption } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { configGroupDomId, findConfigGroup } from '../../groups';
import { configFieldDomId, findConfigFieldById } from '../../searchIndex';
import { useFieldDirty } from './settingState';
import styles from './Field.module.scss';

/** Pulse highlight applied by search jumps (useFieldJump adds/removes it imperatively). */
export const FIELD_HIGHLIGHT_CLASS: string = styles.fieldHighlightActive;

/**
 * Scope root for the :global(.input/.form-group/...) geometry used by block editors. The config
 * page mounts it around the active section; mount it manually when rendering block editors
 * elsewhere (e.g. inside a modal).
 */
export const FIELDS_ROOT_CLASS: string = styles.fieldsRoot;

const cx = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' ');

/* ======================================================================
   Setting rows: one setting per row. Left column = label (+ YAML key), description and error;
   right column = the control. Toggles, inputs, selects and list editors share the skeleton;
   large editors (ICE servers, plugin auth) stack the editor under the copy.
   ====================================================================== */

type SettingCopy = {
  /** Search anchor: the row itself is the anchor (DOM id via configFieldDomId). */
  fieldId: string;
  label: string;
  description?: ReactNode;
  error?: string;
};

type SettingIds = { controlId: string; labelId: string; hintId: string; errorId: string };

function useSettingIds(fieldId: string): SettingIds {
  const controlId = useId();
  return {
    controlId,
    labelId: `${controlId}-${fieldId}-label`,
    hintId: `${controlId}-hint`,
    errorId: `${controlId}-error`,
  };
}

function describedBy(ids: SettingIds, description: ReactNode, error?: string) {
  return (
    [error ? ids.errorId : '', description ? ids.hintId : ''].filter(Boolean).join(' ') || undefined
  );
}

/** YAML path shown next to the label, from the search index (single source for YAML keys). */
function yamlKeyOf(fieldId: string): string | undefined {
  return findConfigFieldById(fieldId)?.yamlKeys?.join('.');
}

/** toggle = switch on the right; input = text/select; side = list editor in the control column;
 *  stack = editor below the copy at full width. */
type RowKind = 'toggle' | 'input' | 'side' | 'stack';
type ControlSize = 'sm' | 'md' | 'lg';

function SettingRow({
  fieldId,
  label,
  description,
  error,
  ids,
  kind,
  size,
  labelFor,
  control,
}: SettingCopy & {
  ids: SettingIds;
  kind: RowKind;
  size?: ControlSize;
  /** Rows with a single control use <label htmlFor>; block editors name a group instead. */
  labelFor?: string;
  control: ReactNode;
}) {
  const dirty = useFieldDirty(fieldId);
  const yamlKey = yamlKeyOf(fieldId);
  return (
    <div
      id={configFieldDomId(fieldId)}
      className={cx(
        styles.row,
        styles[`kind_${kind}`],
        size && styles[`size_${size}`],
        dirty && styles.rowDirty,
        error && styles.rowInvalid
      )}
      data-dirty={dirty || undefined}
    >
      <div className={styles.rowCopy}>
        <div className={styles.rowTitle}>
          {labelFor ? (
            <label id={ids.labelId} htmlFor={labelFor} className={styles.rowLabel}>
              {label}
            </label>
          ) : (
            <span id={ids.labelId} className={styles.rowLabel}>
              {label}
            </span>
          )}
          {yamlKey ? <code className={styles.rowKey}>{yamlKey}</code> : null}
        </div>
        {description ? (
          <div id={ids.hintId} className={styles.rowDescription}>
            {description}
          </div>
        ) : null}
        {error ? (
          <div id={ids.errorId} className={styles.rowError}>
            {error}
          </div>
        ) : null}
      </div>
      <div className={styles.rowControl}>{control}</div>
    </div>
  );
}

export function ToggleSetting({
  checked,
  disabled,
  onChange,
  ...copy
}: Omit<SettingCopy, 'error'> & {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const ids = useSettingIds(copy.fieldId);
  return (
    <SettingRow
      {...copy}
      ids={ids}
      kind="toggle"
      labelFor={ids.controlId}
      control={
        <ToggleSwitch
          id={ids.controlId}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          ariaDescribedBy={describedBy(ids, copy.description)}
        />
      }
    />
  );
}

type NativeInputProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'placeholder' | 'min' | 'max' | 'autoComplete'
>;

export function TextSetting({
  value,
  disabled,
  onChange,
  size = 'md',
  adornment,
  type = 'text',
  placeholder,
  min,
  max,
  autoComplete,
  ...copy
}: SettingCopy &
  NativeInputProps & {
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
    /** sm = numbers / durations; md = plain text; lg = URLs, paths, user agents. */
    size?: ControlSize;
    /** Status tag inside the input on the right (e.g. "Disabled" when keepalive is 0). */
    adornment?: ReactNode;
  }) {
  const ids = useSettingIds(copy.fieldId);
  return (
    <SettingRow
      {...copy}
      ids={ids}
      kind="input"
      size={size}
      labelFor={ids.controlId}
      control={
        <>
          <input
            id={ids.controlId}
            className={cx(
              'input',
              styles.textControl,
              type === 'number' && styles.numberControl,
              adornment ? styles.inputWithAdornment : undefined
            )}
            type={type}
            value={value}
            placeholder={placeholder}
            min={min}
            max={max}
            autoComplete={autoComplete}
            spellCheck={false}
            disabled={disabled}
            aria-invalid={Boolean(copy.error)}
            aria-describedby={describedBy(ids, copy.description, copy.error)}
            onChange={(event) => onChange(event.target.value)}
          />
          {adornment ? <span className={styles.adornment}>{adornment}</span> : null}
        </>
      }
    />
  );
}

export function SelectSetting<T extends string>({
  value,
  options,
  disabled,
  onChange,
  size = 'md',
  ...copy
}: SettingCopy & {
  value: T;
  options: ReadonlyArray<SelectOption & { value: T }>;
  disabled?: boolean;
  onChange: (value: T) => void;
  size?: ControlSize;
}) {
  const ids = useSettingIds(copy.fieldId);
  return (
    <SettingRow
      {...copy}
      ids={ids}
      kind="input"
      size={size}
      labelFor={ids.controlId}
      control={
        <Select
          id={ids.controlId}
          className={styles.selectControl}
          fullWidth
          value={value}
          options={options}
          disabled={disabled}
          ariaLabelledBy={ids.labelId}
          ariaDescribedBy={describedBy(ids, copy.description, copy.error)}
          ariaInvalid={copy.error ? true : undefined}
          onChange={(next) => onChange(next as T)}
        />
      }
    />
  );
}

export type BlockSettingA11y = { describedBy?: string; invalid: boolean };

/**
 * Block editor row (string lists, ICE servers, …). `side` keeps the editor in the control column
 * (list editors); `stack` places it under the copy at full width (multi-field editors).
 * The editor is wrapped in role="group", named by the label and described by hint/error;
 * pass a function as children to receive describedBy for inner controls.
 */
export function BlockSetting({
  children,
  layout = 'side',
  ...copy
}: SettingCopy & {
  layout?: 'side' | 'stack';
  children: ReactNode | ((a11y: BlockSettingA11y) => ReactNode);
}) {
  const ids = useSettingIds(copy.fieldId);
  const a11y = {
    describedBy: describedBy(ids, copy.description, copy.error),
    invalid: Boolean(copy.error),
  };
  return (
    <SettingRow
      {...copy}
      ids={ids}
      kind={layout}
      size={layout === 'side' ? 'lg' : undefined}
      control={
        <div
          role="group"
          className={styles.blockGroup}
          aria-labelledby={ids.labelId}
          aria-describedby={a11y.describedBy}
          aria-invalid={a11y.invalid || undefined}
        >
          {typeof children === 'function' ? children(a11y) : children}
        </div>
      }
    />
  );
}

/** Full-width cell for blocks that render their own rows (the API key list). */
export function SettingCell({ fieldId, children }: { fieldId: string; children: ReactNode }) {
  const dirty = useFieldDirty(fieldId);
  return (
    <div
      id={configFieldDomId(fieldId)}
      className={cx(styles.cell, dirty && styles.rowDirty)}
      data-dirty={dirty || undefined}
    >
      {children}
    </div>
  );
}

/**
 * Settings group: 13px heading (+ optional description and actions) above a hairline-separated
 * list panel. The title comes from the group registry (groups.ts) unless overridden.
 */
export function SettingGroup({
  group,
  title,
  description,
  actions,
  children,
}: {
  group: string;
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const def = findConfigGroup(group);
  const headingId = `${configGroupDomId(group)}-title`;
  return (
    <section id={configGroupDomId(group)} className={styles.group} aria-labelledby={headingId}>
      <header className={styles.groupHeader}>
        <div className={styles.groupHeading}>
          <h3 id={headingId} className={styles.groupTitle}>
            {title ?? (def ? t(def.titleKey) : group)}
          </h3>
          {description ? <p className={styles.groupDescription}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.groupActions}>{actions}</div> : null}
      </header>
      <div className={styles.list}>{children}</div>
    </section>
  );
}

/** Quiet one-line note at the top of a section (scope caveats). */
export function SectionNote({ children }: { children: ReactNode }) {
  return <p className={styles.sectionNote}>{children}</p>;
}

/* ---------- Layout primitives used inside block editors ---------- */

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className={styles.fieldGrid}>{children}</div>;
}

export function FieldStack({ children }: { children: ReactNode }) {
  return <div className={styles.fieldStack}>{children}</div>;
}

// Stable, stateless anchor around a searchable block that is not a setting row
// (payload rule groups). Search jumps target its DOM id and pulse-highlight it.
export function FieldAnchor({ fieldId, children }: { fieldId: string; children: ReactNode }) {
  return (
    <div id={configFieldDomId(fieldId)} className={styles.fieldAnchor}>
      {children}
    </div>
  );
}

/** Standalone helper line (e.g. under a list editor). */
export function FieldHint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div id={id} className={styles.fieldHint}>
      {children}
    </div>
  );
}

/** Label-on-top field used inside multi-control block editors (payload rules, ICE servers). */
export function FieldShell({
  label,
  labelId,
  htmlFor,
  hint,
  hintId,
  error,
  errorId,
  children,
}: {
  label: string;
  labelId?: string;
  htmlFor?: string;
  hint?: string;
  hintId?: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.fieldShell}>
      <label id={labelId} htmlFor={htmlFor} className={styles.fieldLabel}>
        {label}
      </label>
      {children}
      {error ? (
        <div id={errorId} className="error-box">
          {error}
        </div>
      ) : null}
      {hint ? (
        <div id={hintId} className={styles.fieldHint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
