/** Kiểu của `operations.mjs`. */
export interface TempDataset {
  tag: string;
  slug: string;
  title: string;
}

export interface TempPlace {
  tag: string;
  accession: string;
  /** Cách viết địa danh của bản ghi tạm, và khoá so khớp của nó. */
  text: string;
  key: string;
  internalId: string;
}

export function createEmptyDataset(): TempDataset;
export function createSmallDataset(): TempDataset;
export function treeToolsRunning(): boolean;
export function stepsOf(jobId: number): { name: string; status: string }[];
export function removeDataset(dataset: TempDataset): number;
export function createUnresolvedSample(): TempPlace;
export function placeOf(place: TempPlace): { status: string; unit: string | null };
export function buildJobs(dataset: TempDataset): { id: number; status: string }[];
export function removeOperationsData(dataset: TempDataset, place: TempPlace): number;
