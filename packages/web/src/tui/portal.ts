/**
 * Moves the node to the end of `target` for as long as it is mounted.
 *
 * For anything that has to sit above the whole app. `z-index` only ranks an
 * element inside its own stacking context, and `.app` opens one, so a dialog
 * rendered inside the window, however high its z-index, still loses to the
 * top nav, which is the window's sibling. A tall dialog slid under it.
 *
 * Moving the node does not detach it from its component: handlers, bindings
 * and scoped styles all travel with the element.
 */
export function portal(node: Element, target: Element = document.body) {
  target.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
