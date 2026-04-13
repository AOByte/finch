import styles from './RunStatusBadge.module.css';

interface RunStatusBadgeProps {
  status: string;
}

const STATUS_COLORS: Record<string, string> = {
  RUNNING: styles.running,
  WAITING_FOR_HUMAN: styles.waiting,
  COMPLETED: styles.completed,
  FAILED: styles.failed,
  STALLED: styles.stalled,
  STOPPED: styles.stopped,
};

export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  const colorClass = STATUS_COLORS[status] ?? styles.default;
  return (
    <span className={`${styles.badge} ${colorClass}`} data-testid="run-status">
      {status.replace(/_/g, ' ')}
    </span>
  );
}
