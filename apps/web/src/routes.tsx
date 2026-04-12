import { createRootRoute, createRoute } from '@tanstack/react-router';

const rootRoute = createRootRoute();

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function Index() {
    return <h1>Finch</h1>;
  },
});

export const routeTree = rootRoute.addChildren([indexRoute]);
