import { useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import styles from './AuditTimeline.module.css';

interface AuditEvent {
  auditEventId: string;
  runId: string;
  eventType: string;
  phase: string;
  agentId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface AuditTimelineProps {
  events: AuditEvent[];
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  phase_started: '#3b82f6',
  phase_completed: '#10b981',
  gate_fired: '#f59e0b',
  gate_resumed: '#8b5cf6',
  llm_call: '#6366f1',
  tool_call: '#ec4899',
  rule_violation: '#ef4444',
  agent_skipped_on_resume: '#78716c',
  error: '#dc2626',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function AuditTimeline({ events }: AuditTimelineProps) {
  const [filter, setFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const eventTypes = [...new Set(events.map((e) => e.eventType))];
  const filtered = filter ? events.filter((e) => e.eventType === filter) : events;

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });

  return (
    <div data-testid="audit-timeline">
      <div className={styles.filterBar}>
        <select
          className={styles.filterSelect}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All events ({events.length})</option>
          {eventTypes.map((type) => (
            <option key={type} value={type}>
              {type} ({events.filter((e) => e.eventType === type).length})
            </option>
          ))}
        </select>
      </div>

      <div ref={parentRef} className={styles.scrollContainer}>
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const event = filtered[virtualItem.index];
            const isExpanded = expandedId === event.auditEventId;
            const color = EVENT_TYPE_COLORS[event.eventType] ?? '#6b7280';

            return (
              <div
                key={event.auditEventId}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                className={styles.eventRow}
                onClick={() =>
                  setExpandedId(isExpanded ? null : event.auditEventId)
                }
              >
                <span className={styles.time}>{timeAgo(event.createdAt)}</span>
                <span
                  className={styles.typeBadge}
                  style={{ backgroundColor: color }}
                >
                  {event.eventType}
                </span>
                <span className={styles.phase}>{event.phase}</span>
                <span className={styles.actor}>
                  {event.agentId ?? 'system'}
                </span>
                <span className={styles.summary}>
                  {JSON.stringify(event.payload).slice(0, 80)}
                </span>
                {isExpanded && (
                  <pre className={styles.payload}>
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
