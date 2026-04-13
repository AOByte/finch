import styles from './PhaseBadge.module.css';

interface PhaseBadgeProps {
  phase: string;
  status?: 'not_started' | 'in_progress' | 'completed' | 'failed';
  duration?: number;
}

export function PhaseBadge({ phase, status = 'not_started', duration }: PhaseBadgeProps) {
  const statusClass = styles[status] ?? styles.not_started;
  const durationText = duration ? `${(duration / 1000).toFixed(1)}s` : undefined;

  return (
    <div className={`${styles.badge} ${statusClass}`}>
      <span className={styles.name}>{phase}</span>
      {status !== 'not_started' && (
        <span className={styles.status}>{status.replace(/_/g, ' ')}</span>
      )}
      {durationText && <span className={styles.duration}>{durationText}</span>}
    </div>
  );
}
