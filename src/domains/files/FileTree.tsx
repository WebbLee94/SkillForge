import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder, File } from 'lucide-react';
import { ipc } from '../../lib/ipc';
import type { FileTreeNode as FTNode } from '../../types';
import { cn } from '../../lib/utils';

interface FileTreeProps {
  rootPath: string;
  onFileSelect: (filePath: string) => void;
  maxDepth?: number;
}

/** 递归更新指定目录节点的 children（不可变更新，路径不存在时返回原引用） */
function updateNodeChildren(nodes: FTNode[], dirPath: string, children: FTNode[]): FTNode[] {
  return nodes.map((n) => {
    if (n.path === dirPath) {
      return { ...n, children };
    }
    if (n.children.length > 0) {
      const updated = updateNodeChildren(n.children, dirPath, children);
      if (updated !== n.children) {
        return { ...n, children: updated };
      }
    }
    return n;
  });
}

export function FileTree({ rootPath, onFileSelect, maxDepth = 1 }: FileTreeProps) {
  const { t } = useTranslation('common');
  const [tree, setTree] = useState<FTNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  // 根层仅加载一层：目录子项由 max_depth=1 完整列出，直接标记为已加载
  useEffect(() => {
    setLoading(true);
    setExpanded(new Set());
    setLoaded(new Set());
    setLoadingDirs(new Set());
    ipc.listDirectoryTree(rootPath, maxDepth)
      .then((nodes) => {
        setTree(nodes);
        setLoaded(new Set(nodes.filter((n) => n.is_dir).map((n) => n.path)));
      })
      .finally(() => setLoading(false));
  }, [rootPath, maxDepth]);

  const loadChildren = useCallback(
    async (dirPath: string) => {
      if (loadingDirs.has(dirPath)) return;
      setLoadingDirs((prev) => new Set(prev).add(dirPath));
      try {
        const children = await ipc.listDirectoryTree(dirPath, 1);
        setTree((prev) => updateNodeChildren(prev, dirPath, children));
      } catch (e) {
        console.error('[FileTree] 加载目录失败:', dirPath, e);
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
        setLoaded((prev) => new Set(prev).add(dirPath));
      }
    },
    [loadingDirs]
  );

  const toggleDir = (node: FTNode) => {
    const { path } = node;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        // 子层未加载过才发起请求（根层目录初始已加载，直接展开）
        if (!loaded.has(path)) {
          void loadChildren(path);
        }
      }
      return next;
    });
  };

  const renderNode = (node: FTNode, depth: number) => {
    const isOpen = expanded.has(node.path);
    const isLoading = loadingDirs.has(node.path);
    const isEmpty = node.is_dir && isOpen && !isLoading && node.children.length === 0;
    return (
      <div key={node.path}>
        <div
          className={cn(
            'flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer transition-colors',
            node.is_dir ? 'hover:bg-accent/50' : 'hover:bg-accent/30'
          )}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          onClick={() => {
            if (node.is_dir) toggleDir(node);
            else onFileSelect(node.path);
          }}
        >
          {node.is_dir ? (
            <span className="w-3 shrink-0 flex justify-center">
              {isLoading ? (
                <span
                  className="inline-block h-2 w-2 rounded-full border border-current border-t-transparent animate-spin"
                  aria-label={t('messages.loading')}
                />
              ) : (
                <span className="text-[10px] leading-none opacity-60">{isOpen ? '▾' : '▸'}</span>
              )}
            </span>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className="text-xs shrink-0">{node.is_dir ? <Folder className="h-3.5 w-3.5" /> : <File className="h-3.5 w-3.5" />}</span>
          <span className="truncate text-xs">{node.name}</span>
          {isEmpty && <span className="text-[10px] opacity-40 shrink-0">{t('fileTree.emptyDir')}</span>}
        </div>
        {node.is_dir && isOpen && !isLoading && node.children.length > 0 && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div className="text-xs text-muted-foreground py-4 text-center">{t('fileTree.loading')}</div>;
  }

  if (tree.length === 0) {
    return <div className="text-xs text-muted-foreground py-4 text-center">{t('fileTree.empty')}</div>;
  }

  return (
    <div className="font-mono">
      {tree.map((node) => renderNode(node, 0))}
    </div>
  );
}
