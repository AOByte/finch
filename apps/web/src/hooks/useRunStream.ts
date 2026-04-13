import { useEffect, useCallback, useRef } from 'react';
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
  const joinedRef = useRef(false);

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

    // Must join harness room before receiving events
    if (!joinedRef.current) {
      socket.emit('join_harness', harnessId);
      joinedRef.current = true;
    }

    const handleEvent = (_event: RunEvent) => {
      invalidateRun();
    };

    socket.on('run.event', handleEvent);

    return () => {
      socket.off('run.event', handleEvent);
    };
  }, [harnessId, invalidateRun]);
}
