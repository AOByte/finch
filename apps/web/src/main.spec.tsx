import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRender = vi.fn();
const mockCreateRoot = vi.fn(() => ({ render: mockRender }));

vi.mock('react-dom/client', () => ({
  default: { createRoot: mockCreateRoot },
  createRoot: mockCreateRoot,
}));

vi.mock('@tanstack/react-query', () => ({
  QueryClient: vi.fn(),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@tanstack/react-router', () => ({
  RouterProvider: () => null,
  createRouter: vi.fn(() => ({})),
}));

vi.mock('./routes', () => ({
  routeTree: {},
}));

describe('main.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up a root element in the DOM
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('should call createRoot with root element and render the app', async () => {
    await import('./main');

    expect(mockCreateRoot).toHaveBeenCalledOnce();
    expect(mockCreateRoot).toHaveBeenCalledWith(document.getElementById('root'));
    expect(mockRender).toHaveBeenCalledOnce();
  });
});
