import { useEffect } from 'react';
import { useRouter } from '@tanstack/react-router';
import { checkAuth } from '../api/client';

export function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    checkAuth().then((ok) => {
      if (!ok) router.navigate({ to: '/login' });
    });
  }, [router]);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Finch Dashboard</h1>
      <nav style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <a href="/runs" style={{ padding: '8px 16px', background: '#eff6ff', borderRadius: 6, color: '#2563eb', textDecoration: 'none' }}>Runs</a>
        <a href="/memory" style={{ padding: '8px 16px', background: '#eff6ff', borderRadius: 6, color: '#2563eb', textDecoration: 'none' }}>Memory</a>
        <a href="/agents/default" style={{ padding: '8px 16px', background: '#eff6ff', borderRadius: 6, color: '#2563eb', textDecoration: 'none' }}>Agents</a>
        <a href="/connectors/default" style={{ padding: '8px 16px', background: '#eff6ff', borderRadius: 6, color: '#2563eb', textDecoration: 'none' }}>Connectors</a>
        <a href="/analytics/default" style={{ padding: '8px 16px', background: '#eff6ff', borderRadius: 6, color: '#2563eb', textDecoration: 'none' }}>Analytics</a>
      </nav>
    </div>
  );
}
