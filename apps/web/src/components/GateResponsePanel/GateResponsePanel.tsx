import { useState } from 'react';
import { useGateResponse } from '../../hooks/useGateResponse';
import styles from './GateResponsePanel.module.css';

interface Gate {
  gateId: string;
  question: string;
  description?: string;
  phase?: string;
}

interface GateResponsePanelProps {
  gate: Gate;
  runStatus: string;
}

export function GateResponsePanel({ gate, runStatus }: GateResponsePanelProps) {
  const [answer, setAnswer] = useState('');
  const { submit, isSubmitting, error } = useGateResponse();

  // UI-03: Only render when status is WAITING_FOR_HUMAN
  if (runStatus !== 'WAITING_FOR_HUMAN') {
    return null;
  }

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    await submit(gate.gateId, answer);
    setAnswer('');
  };

  return (
    <div className={styles.panel} data-testid="gate-response-panel">
      {gate.description && (
        <p className={styles.description}>{gate.description}</p>
      )}
      {gate.phase && (
        <span className={styles.phase}>Phase: {gate.phase}</span>
      )}
      <p className={styles.question}>{gate.question}</p>
      <textarea
        className={styles.textarea}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Enter your response..."
        data-testid="gate-answer"
        rows={4}
      />
      {error && <p className={styles.error}>{error}</p>}
      <button
        className={styles.submitBtn}
        onClick={handleSubmit}
        disabled={isSubmitting || !answer.trim()}
        data-testid="gate-submit"
      >
        {isSubmitting ? 'Submitting...' : 'Submit Response'}
      </button>
    </div>
  );
}
