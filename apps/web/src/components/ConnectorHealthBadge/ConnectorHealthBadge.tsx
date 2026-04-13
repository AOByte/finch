import styles from './ConnectorHealthBadge.module.css';

interface ConnectorHealthBadgeProps {
  isActive: boolean;
  lastHealthCheck?: string | null;
}

export function ConnectorHealthBadge({ isActive, lastHealthCheck }: ConnectorHealthBadgeProps) {
  const statusClass = isActive ? styles.healthy : styles.unhealthy;
  const label = isActive ? 'Active' : 'Inactive';

  return (
    <span className={`${styles.badge} ${statusClass}`}>
      <span className={styles.dot} />
      {label}
      {lastHealthCheck && (
        <span className={styles.lastCheck}>
          {new Date(lastHealthCheck).toLocaleTimeString()}
        </span>
      )}
    </span>
  );
}
