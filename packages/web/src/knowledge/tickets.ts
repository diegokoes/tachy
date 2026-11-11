/**
 * What the composer is filled with to have the agent update an entry from
 * tickets. With none named it ends on a space, for the reader to type the
 * ticket before sending.
 */
export function entryUpdateCommand(
  entryId: string,
  ticketRefs: string[] = [],
): string {
  const command = `/entry-update ${entryId}`;
  return ticketRefs.length
    ? `${command} tickets=${ticketRefs.join(",")}`
    : `${command} `;
}
