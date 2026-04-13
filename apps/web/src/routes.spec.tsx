import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { routeTree } from './routes';

describe('routes', () => {
  it('should export a routeTree', () => {
    expect(routeTree).toBeDefined();
  });

  it('should have children routes', () => {
    expect(routeTree.children).toBeDefined();
    const children = Object.values(routeTree.children!);
    expect(children.length).toBeGreaterThanOrEqual(1);
  });

  it('index route getParentRoute should return the root route', () => {
    const children = Object.values(routeTree.children!) as Array<{
      options?: { getParentRoute?: () => unknown };
    }>;
    const indexRoute = children[0];
    const getParentRoute = indexRoute.options?.getParentRoute;
    expect(getParentRoute).toBeDefined();
    // Call the function to exercise the coverage branch
    const parent = getParentRoute!();
    expect(parent).toBe(routeTree);
  });

  it('Login component should render "Finch Login"', () => {
    const children = Object.values(routeTree.children!) as Array<{
      options?: { component?: React.ComponentType };
    }>;
    const loginRoute = children[0];
    const LoginComponent = loginRoute.options?.component;
    expect(LoginComponent).toBeDefined();

    const Component = LoginComponent as React.ComponentType;
    render(<Component />);
    expect(screen.getByText('Finch Login')).toBeDefined();
  });

  it('Login component should render as an h1 element', () => {
    const children = Object.values(routeTree.children!) as Array<{
      options?: { component?: React.ComponentType };
    }>;
    const loginRoute = children[0];
    const LoginComponent = loginRoute.options?.component;

    const Component = LoginComponent as React.ComponentType;
    const { container } = render(<Component />);
    const h1 = container.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1?.textContent).toBe('Finch Login');
  });
});
