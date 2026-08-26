import { vi } from 'vitest';

/**
 * Mock the Tauri IPC `invoke` function for component and store testing.
 *
 * Usage in tests:
 *   import { mockInvoke } from '../test-utils/ipc-mock';
 *   vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
 *
 * then set up mock returns per test:
 *   mockInvoke.mockResolvedValueOnce([...]);
 */

export const mockInvoke = vi.fn();
