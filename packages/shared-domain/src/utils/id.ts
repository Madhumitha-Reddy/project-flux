export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function generateNoteId(): string {
  return `note-${generateId()}`;
}

export function generateBlockId(): string {
  return `block-${generateId()}`;
}

export function generateWorkspaceId(): string {
  return `workspace-${generateId()}`;
}
