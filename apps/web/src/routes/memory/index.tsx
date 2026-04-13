import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '../../api/client';
import { MemoryRecordTable } from '../../components/MemoryRecordTable';

interface MemoryRecord {
  memoryId: string;
  type: string;
  content: string;
  relevanceTags: string[];
  sourceRunId: string | null;
  createdAt: string;
}

interface MemoryResponse {
  data: MemoryRecord[];
  meta: { total: number; hasMore: boolean };
}

export function MemoryPage() {
  const [search, setSearch] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState('FACT');
  const queryClient = useQueryClient();

  const queryParams = search
    ? `/api/memory?harnessId=default&q=${encodeURIComponent(search)}`
    : '/api/memory?harnessId=default';

  const { data, isLoading } = useQuery({
    queryKey: ['memory', search],
    queryFn: () => apiGet<MemoryResponse>(queryParams),
    refetchInterval: 10000,
  });

  const records = data?.data ?? [];

  const handleCreate = async () => {
    if (!newContent.trim()) return;
    await apiPost('/api/memory', {
      harnessId: 'default',
      type: newType,
      content: newContent,
    });
    setNewContent('');
    queryClient.invalidateQueries({ queryKey: ['memory'] });
  };

  const handleDelete = async (memoryId: string) => {
    await apiDelete(`/api/memory/${memoryId}`);
    queryClient.invalidateQueries({ queryKey: ['memory'] });
  };

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Memory Browser</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Semantic search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, padding: 8, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
        />
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Add Memory Record</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
          >
            <option value="FACT">FACT</option>
            <option value="DECISION">DECISION</option>
            <option value="PREFERENCE">PREFERENCE</option>
            <option value="LESSON_LEARNED">LESSON_LEARNED</option>
          </select>
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Memory content..."
            rows={2}
            style={{ flex: 1, padding: 8, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' }}
          />
          <button
            onClick={handleCreate}
            disabled={!newContent.trim()}
            style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, cursor: 'pointer' }}
          >
            Add
          </button>
        </div>
      </div>

      {isLoading ? (
        <p>Loading...</p>
      ) : (
        <MemoryRecordTable records={records} onDelete={handleDelete} />
      )}
    </div>
  );
}
