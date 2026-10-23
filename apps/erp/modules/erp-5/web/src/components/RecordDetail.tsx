/**
 * ERP-5 HR & Employees — Record Detail
 *
 * The read-only presentation of one record: the primary attributes, the
 * system-maintained ones and the computed or masked ones.
 *
 * The values are rendered as **text**, not as form controls. A value the
 * operator may read but not write is not a field the browser can be talked
 * into changing, and the client never sends it.
 *
 * @module erp5/web/components/RecordDetail
 */

import React from 'react';

export interface RecordDetailItem {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly helperText?: string | undefined;
}

export interface RecordDetailProps {
  readonly items: readonly RecordDetailItem[];
  /** The heading of the group, e.g. "Employee". */
  readonly caption?: string | undefined;
  readonly className?: string | undefined;
}

export const RecordDetail: React.FC<RecordDetailProps> = ({
  items,
  caption,
  className,
}) => (
  <dl
    className={`cs-erp5-detail ${className ?? ''}`.trim()}
    {...(caption ? { 'aria-label': caption } : {})}
  >
    {items.map((item) => (
      <div className="cs-erp5-detail-row" key={item.label}>
        <dt className="cs-erp5-detail-label">{item.label}</dt>
        <dd className="cs-erp5-detail-value">
          {item.value}
          {item.helperText ? (
            <p className="cs-erp5-detail-hint">{item.helperText}</p>
          ) : null}
        </dd>
      </div>
    ))}
  </dl>
);

export default RecordDetail;
