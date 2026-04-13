import { useState } from 'react';
import styles from './AgentPipelineEditor.module.css';

interface AgentConfig {
  agentConfigId: string;
  phase: string;
  position: number;
  agentId: string;
  model: string;
  systemPromptBody: string;
  maxTokens: number;
  isActive: boolean;
}

interface AgentPipelineEditorProps {
  agents: AgentConfig[];
  onSave: (agentConfigId: string, updates: { model?: string; systemPromptBody?: string }) => Promise<void>;
  lockedPreamble?: string;
}

const MODELS = ['claude-opus-4-5', 'claude-sonnet-4-5', 'gpt-4o'];

export function AgentPipelineEditor({ agents, onSave, lockedPreamble }: AgentPipelineEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editModel, setEditModel] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (agent: AgentConfig) => {
    setEditingId(agent.agentConfigId);
    setEditModel(agent.model);
    setEditPrompt(agent.systemPromptBody);
    setError(null);
  };

  const handleSave = async (agentConfigId: string) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(agentConfigId, { model: editModel, systemPromptBody: editPrompt });
      setEditingId(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.editor}>
      {lockedPreamble && (
        <div className={styles.preambleSection}>
          <div className={styles.preambleLabel}>Framework-owned (read-only)</div>
          <pre className={styles.preamble}>{lockedPreamble}</pre>
        </div>
      )}

      {agents.map((agent) => {
        const isEditing = editingId === agent.agentConfigId;
        return (
          <div key={agent.agentConfigId} className={styles.agentCard}>
            <div className={styles.agentHeader}>
              <span className={styles.agentId}>{agent.agentId}</span>
              <span className={styles.position}>Position {agent.position}</span>
              {!isEditing && (
                <button className={styles.editBtn} onClick={() => startEdit(agent)}>
                  Edit
                </button>
              )}
            </div>

            {isEditing ? (
              <div className={styles.editForm}>
                <label className={styles.label}>
                  Model
                  <select
                    className={styles.select}
                    value={editModel}
                    onChange={(e) => setEditModel(e.target.value)}
                  >
                    {MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.label}>
                  System Prompt Body
                  <textarea
                    className={styles.promptTextarea}
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    rows={8}
                  />
                </label>
                {error && <p className={styles.error}>{error}</p>}
                <div className={styles.actions}>
                  <button
                    className={styles.saveBtn}
                    onClick={() => handleSave(agent.agentConfigId)}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    className={styles.cancelBtn}
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.agentInfo}>
                <span className={styles.model}>{agent.model}</span>
                <p className={styles.prompt}>
                  {agent.systemPromptBody
                    ? agent.systemPromptBody.slice(0, 200) + (agent.systemPromptBody.length > 200 ? '...' : '')
                    : '(no custom prompt)'}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
