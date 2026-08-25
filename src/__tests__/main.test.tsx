import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ===== Hoisted mocks ===== */
const { createRootMock } = vi.hoisted(() => ({
  createRootMock: vi.fn(() => ({ render: vi.fn() })),
}));

vi.mock('react-dom/client', () => ({
  __esModule: true,
  default: { createRoot: createRootMock },
}));

vi.mock('../App', () => ({
  default: () => null,
}));

vi.mock('../lib/i18n', () => ({}));

/* =================================================== */
/*  Tests                                              */
/* =================================================== */
describe('main entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Recreate the #root container
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('creates a React root on the #root element and renders', async () => {
    await import('../main');

    expect(createRootMock).toHaveBeenCalledTimes(1);
    const rootEl = (
      createRootMock.mock.calls[0] as unknown as [HTMLElement]
    )[0];
    expect(rootEl).toBe(document.getElementById('root'));

    const rootInstance = createRootMock.mock.results[0].value;
    expect(rootInstance.render).toHaveBeenCalledTimes(1);
  });
});
