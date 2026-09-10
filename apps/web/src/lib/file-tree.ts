export type FileNode =
  | { kind: 'file'; name: string; path: string }
  | { kind: 'folder'; name: string; path: string; children: FileNode[] };

/** Nests a flat list of repo-relative paths; folders come before files at every level. */
export function buildTree(paths: string[]): FileNode[] {
  const root: FileNode[] = [];
  const folders = new Map<string, FileNode[]>();

  for (const path of paths) {
    const segments = path.split('/').filter(Boolean);
    const name = segments.pop();
    if (!name) continue;

    let prefix = '';
    let children = root;
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let existing = folders.get(prefix);
      if (!existing) {
        existing = [];
        folders.set(prefix, existing);
        children.push({ kind: 'folder', name: segment, path: prefix, children: existing });
      }
      children = existing;
    }
    children.push({ kind: 'file', name, path });
  }

  return sort(root);
}

/** Keeps the files whose path contains `needle` and the folders that lead to them. */
export function filterTree(nodes: FileNode[], needle: string): FileNode[] {
  const match = needle.trim().toLowerCase();
  if (!match) return nodes;
  return keep(nodes, match);
}

/** Every folder path in the tree, which is what "Expand all" opens. */
export function folderPaths(nodes: FileNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'folder' ? [node.path, ...folderPaths(node.children)] : [],
  );
}

function keep(nodes: FileNode[], match: string): FileNode[] {
  return nodes.flatMap((node): FileNode[] => {
    if (node.kind === 'file') return node.path.toLowerCase().includes(match) ? [node] : [];
    const children = keep(node.children, match);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

function sort(nodes: FileNode[]): FileNode[] {
  nodes.sort(compare);
  for (const node of nodes) if (node.kind === 'folder') sort(node.children);
  return nodes;
}

function compare(a: FileNode, b: FileNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}
