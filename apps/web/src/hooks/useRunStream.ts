import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../lib/socket';

interface RunEvent {
  runId: string;
  type: string;
  phase?: string;
  status?: string;
  payload?: Record<string, unknown>;
}

export function useRunStream(harnessId: string, runId?: string) {
  const queryClient = useQueryClient();

  const invalidateRun = useCallback(() => {
    if (runId) {
      queryClient.invalidateQueries({ queryKey: ['run', runId] });
      queryClient.invalidateQueries({ queryKey: ['runAudit', runId] });
      queryClient.invalidateQueries({ queryKey: ['runGates', runId] });
    }
    queryClient.invalidateQueries({ queryKey: ['runs'] });
  }, [queryClient, runId]);

  useEffect(() => {
    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
    }

    // Join harness room (re-joins on harnessId change)
    socket.emit('join_harness', harnessId);

    const handleEvent = (_event: RunEvent) => {
      invalidateRun();
    };

    socket.on('run.event', handleEvent);

    return () => {
      socket.off('run.event', handleEvent);
      socket.emit('leave_harness', harnessId);
    };
  }, [harnessId, invalidateRun]);
}
