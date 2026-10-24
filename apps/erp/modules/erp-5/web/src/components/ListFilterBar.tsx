/**
 * ERP-5 HR & Employees — List Filter Bar
 *
 * The search and filter controls of a collection screen.
 *
 * Every control is a real, labelled form control — a text input and real
 * `<select>` elements — so a keyboard-only operator can reach and operate
 * all of them, and so a screen reader announces what each one does. The
 * controls are built on the shared `FormField` component of `@cs/ui`, which
 * associates the label, the helper text and the error with the control.
 *
 * The bar is a `search` landmark, and it is rendered **before** the table
 * in the DOM, which is the order a keyboard operator meets it in.
 *
 * The controls are disabled while the collection is loading. The empty
 * state of the collection itself is rendered by `ListStateBoundary` — the
 * bar only offers the way out of it.
 *
 * @module erp5/web/components/ListFilterBar
 */

import React from 'react';
import { FormField } from '@cs/ui';

export interface ListFilterOption {
  readonly value: string;
  readonly label: string;
}

export interface ListFilterDefinition {
  /** The identifier of the control — also the id prefix of its DOM node. */
  readonly id: string;
  /** The visible label of the control. */
  readonly label: string;
  /** The helper text shown under the control. */
  readonly helperText?: string | undefined;
  /**
   * The selectable values of the control.
   *
   * When the list is present the control is a `<select>`; when it is absent
   * the control is a free-text field, for a filter the API expresses as a
   * single value rather than as a choice.
   */
  readonly options?: readonly ListFilterOption[] | undefined;
  /** The input type of the free-text control, e.g. `month`. */
  readonly inputType?: string | undefined;
  /** The placeholder of the free-text control. */
  readonly placeholder?: string | undefined;
  /** The selected value, or `undefined` for "no filter". */
  readonly value: string | undefined;
  /** Called with the new value, or `undefined` when the filter is cleared. */
  readonly onChange: (value: string | undefined) => void;
}

export interface ListFilterTag {
  /** Stable identifier of the tag. */
  readonly id: string;
  /** Human-readable label, e.g. "Department: Engineering". */
  readonly label: string;
  /** Called when the tag's remove button is activated. */
  readonly onRemove: () => void;
}

export interface ListFilterBarProps {
  /** The accessible name of the search landmark. */
  readonly landmarkLabel: string;
  /**
   * Whether the screen offers a search box.
   *
   * The field is hidden when the endpoint has no `search` parameter — a
   * control that cannot change the server query would only mislead the
   * operator.
   */
  readonly showSearch?: boolean | undefined;
  readonly searchLabel: string;
  readonly searchValue: string;
  readonly onSearchChange: (value: string) => void;
  readonly searchPlaceholder?: string | undefined;
  readonly searchHelperText?: string | undefined;
  /** The faceted filters of the screen. */
  readonly filters?: readonly ListFilterDefinition[] | undefined;
  /** The server-side sort control, when the endpoint supports sorting. */
  readonly sortLabel?: string | undefined;
  readonly sortValue?: string | undefined;
  readonly sortOptions?: readonly ListFilterOption[] | undefined;
  readonly onSortChange?: ((value: string) => void) | undefined;
  /** Clears every filter and the search term. */
  readonly onReset?: (() => void) | undefined;
  readonly resetLabel?: string | undefined;
  readonly isLoading?: boolean | undefined;
  /** Removable tags describing the currently active filters. */
  readonly activeFilters?: readonly ListFilterTag[] | undefined;
}

export const ListFilterBar: React.FC<ListFilterBarProps> = ({
  landmarkLabel,
  showSearch = true,
  searchLabel,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchHelperText,
  filters,
  sortLabel,
  sortValue,
  sortOptions,
  onSortChange,
  onReset,
  resetLabel,
  isLoading = false,
  activeFilters,
}) => (
  <form
    className="cs-erp5-filter-bar"
    role="search"
    aria-label={landmarkLabel}
    onSubmit={(event) => event.preventDefault()}
  >
    <div className="cs-erp5-filter-bar-fields">
      {showSearch ? (
        <FormField
          id="erp5-search"
          label={searchLabel}
          {...(searchHelperText ? { helperText: searchHelperText } : {})}
        >
          <input
            type="search"
            value={searchValue}
            placeholder={searchPlaceholder}
            disabled={isLoading}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </FormField>
      ) : null}
      {(filters ?? []).map((filter) => (
        <FormField
          key={filter.id}
          id={`erp5-filter-${filter.id}`}
          label={filter.label}
          {...(filter.helperText ? { helperText: filter.helperText } : {})}
        >
          {filter.options ? (
            <select
              value={filter.value ?? ''}
              disabled={isLoading}
              onChange={(event) => {
                const next = event.target.value;
                filter.onChange(next === '' ? undefined : next);
              }}
            >
              <option value="">All</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={filter.inputType ?? 'text'}
              value={filter.value ?? ''}
              placeholder={filter.placeholder}
              disabled={isLoading}
              onChange={(event) => {
                const next = event.target.value;
                filter.onChange(next === '' ? undefined : next);
              }}
            />
          )}
        </FormField>
      ))}

      {sortLabel && sortOptions && onSortChange ? (
        <FormField id="erp5-sort" label={sortLabel}>
          <select
            value={sortValue ?? ''}
            disabled={isLoading}
            onChange={(event) => onSortChange(event.target.value)}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}

      {activeFilters && activeFilters.length > 0 ? (
        <div className="cs-erp5-filter-tags" role="list" aria-label="Active filters">
          {activeFilters.map((tag) => (
            <span
              key={tag.id}
              className="cs-erp5-filter-tag"
              role="listitem"
            >
              <span>{tag.label}</span>
              <button
                type="button"
                aria-label={`Remove ${tag.label}`}
                disabled={isLoading}
                onClick={tag.onRemove}
                className="cs-erp5-filter-tag-remove"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {onReset ? (
        <div className="cs-erp5-filter-bar-actions">
          <button
            type="button"
            className="cs-erp5-button cs-erp5-button-secondary"
            onClick={onReset}
            disabled={isLoading}
          >
            {resetLabel ?? 'Clear filters'}
          </button>
        </div>
      ) : null}
    </div>
  </form>
);

export default ListFilterBar;
