import styles from './MemoryRecordTable.module.css';

interface MemoryRecord {
  memoryId: string;
  type: string;
  content: string;
  relevanceTags: string[];
  sourceRunId: string | null;
  createdAt: string;
}

interface MemoryRecordTableProps {
  records: MemoryRecord[];
  onDelete: (memoryId: string) => void;
}

export function MemoryRecordTable({ records, onDelete }: MemoryRecordTableProps) {
  if (records.length === 0) {
    return <p className={styles.empty}>No memory records found.</p>;
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Type</th>
          <th>Content</th>
          <th>Tags</th>
          <th>Source Run</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => (
          <tr key={record.memoryId}>
            <td>
              <span className={styles.typeBadge}>{record.type}</span>
            </td>
            <td className={styles.content}>
              {record.content.length > 100
                ? `${record.content.slice(0, 100)}...`
                : record.content}
            </td>
            <td>
              {record.relevanceTags.map((tag) => (
                <span key={tag} className={styles.tag}>
                  {tag}
                </span>
              ))}
            </td>
            <td className={styles.runId}>
              {record.sourceRunId?.slice(0, 8) ?? '—'}
            </td>
            <td className={styles.date}>
              {new Date(record.createdAt).toLocaleDateString()}
            </td>
            <td>
              <button
                className={styles.deleteBtn}
                onClick={() => onDelete(record.memoryId)}
              >
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
