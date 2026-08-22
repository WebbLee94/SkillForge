import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileTree } from '../../domains/files/FileTree';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
    i18n: { language: 'zh-CN' },
  }),
}));

const mockRootNodes = [
  { name: 'src', path: '/root/src', is_dir: true, children: [] },
  { name: 'README.md', path: '/root/README.md', is_dir: false, children: [] },
];

const mockRootWithDeepDir = [
  {
    name: 'src', path: '/root/src', is_dir: true, children: [
      { name: 'deep', path: '/root/src/deep', is_dir: true, children: [] },
    ],
  },
  { name: 'README.md', path: '/root/README.md', is_dir: false, children: [] },
];

const mockDeepChildren = [
  { name: 'config.json', path: '/root/src/deep/config.json', is_dir: false, children: [] },
];

describe('FileTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockReturnValue(new Promise(() => {}));
    render(<FileTree rootPath="/root" onFileSelect={vi.fn()} />);
    expect(screen.getByText('fileTree.loading')).toBeDefined();
  });

  it('renders empty state when tree is empty', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue([]);
    render(<FileTree rootPath="/root" onFileSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('fileTree.empty')).toBeDefined();
    });
  });

  it('renders file and folder nodes after loading', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue(mockRootNodes);
    render(<FileTree rootPath="/root" onFileSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeDefined();
      expect(screen.getByText('README.md')).toBeDefined();
    });
  });

  it('calls onFileSelect when a file is clicked', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue(mockRootNodes);
    const onFileSelect = vi.fn();
    render(<FileTree rootPath="/root" onFileSelect={onFileSelect} />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeDefined();
    });
    fireEvent.click(screen.getByText('README.md'));
    expect(onFileSelect).toHaveBeenCalledWith('/root/README.md');
  });

  it('expands a directory to reveal already-loaded children', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    // Root dir src has a child dir "deep" already loaded (maxDepth=1 includes 1 level)
    (invoke as any).mockResolvedValue(mockRootWithDeepDir);
    render(<FileTree rootPath="/root" onFileSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeDefined();
    });
    // Expand src — children ("deep") are already in tree, not fetched again
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(screen.getByText('deep')).toBeDefined();
    });
    expect(screen.getByText('▾')).toBeDefined();
  });

  it('collapses a directory on second click', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue(mockRootNodes);
    render(<FileTree rootPath="/root" onFileSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeDefined();
    });
    // Expand first click
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(screen.getByText('▾')).toBeDefined();
    });
    // Collapse second click
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(screen.getByText('▸')).toBeDefined();
    });
  });

  it('lazy-loads children when clicking a dir not yet in loaded set', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    // Initial load: root has src/deep which is a dir NOT in the loaded set
    (invoke as any)
      .mockResolvedValueOnce(mockRootWithDeepDir)
      .mockResolvedValueOnce(mockDeepChildren);
    render(<FileTree rootPath="/root" onFileSelect={vi.fn()} />);
    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('src')).toBeDefined();
    });
    // Expand src to reveal "deep"
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(screen.getByText('deep')).toBeDefined();
    });
    // deep is NOT in loaded set → clicking should trigger lazy load
    fireEvent.click(screen.getByText('deep'));
    await waitFor(() => {
      expect(screen.getByText('config.json')).toBeDefined();
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith('list_directory_tree', {
      path: '/root/src/deep',
      maxDepth: 1,
    });
  });

  it('shows loading spinner while lazy-loading children', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    let resolveDeep!: (v: unknown) => void;
    (invoke as any)
      .mockResolvedValueOnce(mockRootWithDeepDir)
      .mockReturnValueOnce(new Promise((resolve) => { resolveDeep = resolve; }));
    render(<FileTree rootPath="/root" onFileSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeDefined();
    });
    // Expand src
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(screen.getByText('deep')).toBeDefined();
    });
    // Click deep to trigger lazy load — spinner should appear
    fireEvent.click(screen.getByText('deep'));
    await waitFor(() => {
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).not.toBeNull();
    });
    // Resolve the lazy load
    resolveDeep(mockDeepChildren);
    await waitFor(() => {
      expect(screen.getByText('config.json')).toBeDefined();
    });
  });

  it('shows empty directory indicator when expanded dir has no children', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue(mockRootNodes);
    render(<FileTree rootPath="/root" onFileSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeDefined();
    });
    // src has empty children → expand shows "emptyDir"
    fireEvent.click(screen.getByText('src'));
    await waitFor(() => {
      expect(screen.getByText('fileTree.emptyDir')).toBeDefined();
    });
  });

  it('passes custom maxDepth to ipc call', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    (invoke as any).mockResolvedValue([]);
    render(<FileTree rootPath="/custom" onFileSelect={vi.fn()} maxDepth={3} />);
    await waitFor(() => {
      expect(screen.getByText('fileTree.empty')).toBeDefined();
    });
    expect(invoke).toHaveBeenCalledWith('list_directory_tree', {
      path: '/custom',
      maxDepth: 3,
    });
  });
});
