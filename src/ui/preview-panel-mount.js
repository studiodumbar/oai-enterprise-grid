export function mountPreviewPanel({ document, mount, root, floatingStyles }) {
  const target = mount ?? document.body;
  if (!target?.append) throw new TypeError("Preview panel needs a DOM mount.");
  if (target === document.body) Object.assign(root.style, floatingStyles);
  target.append(root);
  return target;
}
