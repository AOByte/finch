async function globalSetup() {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
  const webUrl = process.env.WEB_URL ?? 'http://localhost:3000';

  // Healthcheck: API
  try {
    const apiRes = await fetch(`${apiUrl}/health`);
    if (!apiRes.ok) {
      throw new Error(`API health check failed: ${apiRes.status} ${apiRes.statusText}`);
    }
  } catch (err) {
    throw new Error(
      `API is unreachable at ${apiUrl}/health. ` +
      `Start it with: pnpm --filter api dev\n` +
      `Original error: ${(err as Error).message}`,
    );
  }

  // Healthcheck: Frontend
  try {
    const webRes = await fetch(webUrl);
    if (!webRes.ok) {
      throw new Error(`Frontend health check failed: ${webRes.status} ${webRes.statusText}`);
    }
  } catch (err) {
    throw new Error(
      `Frontend is unreachable at ${webUrl}. ` +
      `Start it with: pnpm --filter web dev\n` +
      `Original error: ${(err as Error).message}`,
    );
  }

  console.log('Global setup: API and Frontend are healthy');
}

export default globalSetup;
