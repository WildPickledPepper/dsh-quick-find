/**
 * dsh-session-find — host half.
 *
 * Nothing to do on the Node side: the feature lives entirely in the browser
 * (client.js). This half exists so the bundle row activates like any other
 * plugin, and so a future host-side "search whole session log" can be added
 * without changing the package shape.
 *
 * Imports nothing from @deepseek-ai/* — profile plugins cannot resolve the
 * host's own packages on every DSH layout.
 */
export const name = 'session-find'
export const inject = []

export function apply() {
  // no-op
}
