import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../api/client';

interface GateResponseResult {
  submit: (gateId: string, answer: string) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}

export function useGateResponse(): GateResponseResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const submit = async (gateId: string, answer: string) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await apiPost(`/api/gate/${gateId}/respond`, { answer });
      queryClient.invalidateQueries({ queryKey: ['run'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['runGates'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return { submit, isSubmitting, error };
}
