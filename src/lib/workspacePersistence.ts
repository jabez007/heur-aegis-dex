import { getBattleFormat, isBattleFormatId, type BattleFormatId } from './battleFormats';

export const WORKSPACE_STORAGE_KEY = 'heur-aegis-dex:workspaces:v1';
export const WORKSPACE_VERSION = 1 as const;

export type PokedexRegion = 'national' | 'kanto' | 'galar' | 'sinnoh' | 'hisui' | 'paldea';

export interface WorkspaceSnapshotV1 {
  version: 1;
  scan: {
    inPokedex: PokedexRegion;
    regulation: string | null;
    minimumStatsTotal: number;
    minimumAttacks: number;
    minimumDefenses: number;
    allowMegas: boolean;
    includeAbilityImmunities: boolean;
    includeMoveCoverage: boolean;
  };
  meta: {
    selectedTypes: string[];
    requireAllTypes: boolean;
  };
  abilityOverrides: Record<string, string>;
  team: {
    format: BattleFormatId;
    roster: Array<{ pokemon: string; ability: string | null }>;
    bring: string[] | null;
    excluded: string[];
  };
}

export interface SavedWorkspace {
  id: string;
  name: string;
  updatedAt: string;
  snapshot: WorkspaceSnapshotV1;
}

export interface WorkspaceArchiveV1 {
  version: 1;
  draft: WorkspaceSnapshotV1 | null;
  draftUpdatedAt: string | null;
  saves: SavedWorkspace[];
}

export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const emptyWorkspaceArchive = (): WorkspaceArchiveV1 => ({
  version: WORKSPACE_VERSION,
  draft: null,
  draftUpdatedAt: null,
  saves: []
});

const POKEDEX_REGIONS = new Set<PokedexRegion>([
  'national', 'kanto', 'galar', 'sinnoh', 'hisui', 'paldea'
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isValidTimestamp = (value: string): boolean => Number.isFinite(Date.parse(value));

const hasUniqueStrings = (values: string[]): boolean => new Set(values).size === values.length;

const nameKey = (name: string): string => name.trim().normalize('NFKC').toLowerCase();

const isAbilityOverrides = (value: unknown): value is Record<string, string> =>
  isObject(value) && Object.values(value).every((ability) => typeof ability === 'string');

export function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshotV1 {
  if (!isObject(value) || value.version !== WORKSPACE_VERSION) return false;
  const { scan, meta, abilityOverrides, team } = value;
  if (!isObject(scan) || !isObject(meta) || !isObject(team)) return false;

  const roster = team.roster;
  const validRoster = Array.isArray(roster) && roster.length <= 6 && roster.every((member) =>
    isObject(member) && typeof member.pokemon === 'string' && member.pokemon.length > 0 &&
    isNullableString(member.ability)
  );
  const rosterNames = validRoster ? roster.map((member) => member.pokemon) : [];
  const validBring = team.bring === null || (
    isStringArray(team.bring) &&
    hasUniqueStrings(team.bring) &&
    team.bring.every((name) => rosterNames.includes(name)) &&
    typeof team.format === 'string' && isBattleFormatId(team.format) &&
    team.bring.length <= getBattleFormat(team.format).broughtToBattle
  );

  return POKEDEX_REGIONS.has(scan.inPokedex as PokedexRegion) &&
    isNullableString(scan.regulation) &&
    isFiniteNumber(scan.minimumStatsTotal) &&
    isFiniteNumber(scan.minimumAttacks) &&
    isFiniteNumber(scan.minimumDefenses) &&
    typeof scan.allowMegas === 'boolean' &&
    typeof scan.includeAbilityImmunities === 'boolean' &&
    typeof scan.includeMoveCoverage === 'boolean' &&
    isStringArray(meta.selectedTypes) &&
    typeof meta.requireAllTypes === 'boolean' &&
    isAbilityOverrides(abilityOverrides) &&
    typeof team.format === 'string' && isBattleFormatId(team.format) &&
    validRoster && hasUniqueStrings(rosterNames) &&
    validBring &&
    isStringArray(team.excluded) && hasUniqueStrings(team.excluded);
}

const isSavedWorkspace = (value: unknown): value is SavedWorkspace =>
  isObject(value) &&
  typeof value.id === 'string' && value.id.length > 0 &&
  typeof value.name === 'string' && value.name.trim().length > 0 && value.name.trim().length <= 40 &&
  typeof value.updatedAt === 'string' && isValidTimestamp(value.updatedAt) &&
  isWorkspaceSnapshot(value.snapshot);

export function isWorkspaceArchive(value: unknown): value is WorkspaceArchiveV1 {
  if (!isObject(value) || value.version !== WORKSPACE_VERSION) return false;
  if (value.draft !== null && !isWorkspaceSnapshot(value.draft)) return false;
  if (!isNullableString(value.draftUpdatedAt) ||
    (value.draftUpdatedAt !== null && !isValidTimestamp(value.draftUpdatedAt)) ||
    !Array.isArray(value.saves)) return false;

  const validSaves = value.saves.every(isSavedWorkspace);
  if (!validSaves) return false;
  const ids = value.saves.map((save) => save.id);
  return hasUniqueStrings(ids);
}

export function readWorkspaceArchive(storage: WorkspaceStorage): WorkspaceArchiveV1 {
  const raw = storage.getItem(WORKSPACE_STORAGE_KEY);
  if (raw === null) return emptyWorkspaceArchive();

  const parsed: unknown = JSON.parse(raw);
  if (isWorkspaceArchive(parsed)) return parsed;

  // A damaged named record must not make every healthy save inaccessible.
  // Salvage independently valid V1 records; malformed envelopes and unknown
  // versions still fail closed so a future schema is never rewritten as V1.
  if (!isObject(parsed) || parsed.version !== WORKSPACE_VERSION || !Array.isArray(parsed.saves)) {
    throw new Error('Saved workspace data is damaged or unsupported.');
  }
  const seenIds = new Set<string>();
  const saves = parsed.saves.filter((save): save is SavedWorkspace => {
    if (!isSavedWorkspace(save) || seenIds.has(save.id)) return false;
    seenIds.add(save.id);
    return true;
  });
  const draft = isWorkspaceSnapshot(parsed.draft) ? parsed.draft : null;
  const draftUpdatedAt = draft && typeof parsed.draftUpdatedAt === 'string' && isValidTimestamp(parsed.draftUpdatedAt)
    ? parsed.draftUpdatedAt
    : null;
  return { version: WORKSPACE_VERSION, draft, draftUpdatedAt, saves };
}

export function writeWorkspaceArchive(storage: WorkspaceStorage, archive: WorkspaceArchiveV1): void {
  if (!isWorkspaceArchive(archive)) throw new Error('Refusing to write an invalid workspace archive.');
  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(archive));
}

export function saveNamedWorkspace(
  archive: WorkspaceArchiveV1,
  name: string,
  snapshot: WorkspaceSnapshotV1,
  updatedAt: string,
  createId: () => string
): WorkspaceArchiveV1 {
  const normalizedName = name.trim();
  if (normalizedName.length === 0 || normalizedName.length > 40) {
    throw new Error('Workspace names must contain 1 to 40 characters.');
  }
  if (!isValidTimestamp(updatedAt)) throw new Error('Workspace timestamp is invalid.');

  const index = archive.saves.findIndex((save) =>
    nameKey(save.name) === nameKey(normalizedName)
  );
  const id = index === -1 ? createId() : archive.saves[index].id;
  if (!id || (index === -1 && archive.saves.some((save) => save.id === id))) {
    throw new Error('Could not create a unique workspace identifier.');
  }
  const saved: SavedWorkspace = {
    id,
    name: normalizedName,
    updatedAt,
    snapshot
  };
  const saves = index === -1
    ? [...archive.saves, saved]
    : archive.saves.map((entry, entryIndex) => entryIndex === index ? saved : entry);

  return { ...archive, saves: saves.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
}

export function renameSavedWorkspace(
  archive: WorkspaceArchiveV1,
  id: string,
  name: string
): WorkspaceArchiveV1 {
  const normalizedName = name.trim();
  if (normalizedName.length === 0 || normalizedName.length > 40) {
    throw new Error('Workspace names must contain 1 to 40 characters.');
  }
  if (archive.saves.some((save) =>
    save.id !== id && nameKey(save.name) === nameKey(normalizedName)
  )) {
    throw new Error(`A workspace named "${normalizedName}" already exists.`);
  }

  return {
    ...archive,
    saves: archive.saves.map((save) => save.id === id ? { ...save, name: normalizedName } : save)
  };
}

export function deleteSavedWorkspace(archive: WorkspaceArchiveV1, id: string): WorkspaceArchiveV1 {
  return { ...archive, saves: archive.saves.filter((save) => save.id !== id) };
}

export function mergeUnresolvedTeamIdentifiers(
  current: WorkspaceSnapshotV1['team'],
  restored: WorkspaceSnapshotV1['team'],
  unresolvedPokemon: ReadonlySet<string>,
  preserveRestoredBring = true
): WorkspaceSnapshotV1['team'] {
  const currentByName = new Map(current.roster.map((member) => [member.pokemon, member]));
  const restoredOrder = restored.roster.map((saved) =>
    unresolvedPokemon.has(saved.pokemon) ? saved : (currentByName.get(saved.pokemon) ?? saved)
  );
  const restoredNames = new Set(restoredOrder.map((member) => member.pokemon));

  return {
    ...current,
    roster: [
      ...restoredOrder,
      ...current.roster.filter((member) => !restoredNames.has(member.pokemon))
    ],
    bring: preserveRestoredBring ? restored.bring : current.bring
  };
}
