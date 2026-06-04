export type BrandAssetKind = 'logo' | 'guideline' | 'sheet' | 'reference';

export interface BrandAsset {
  id: string;
  kind: BrandAssetKind;
  name: string;
  /** Image URL or data URI. */
  url: string;
}

export interface Project {
  id: string;
  name: string;
  /** Free-text rules the AI should always follow for this project. */
  instructions?: string;
  brandAssets: BrandAsset[];
  createdAt: string;
  updatedAt: string;
}

/** Lean list item (no heavy brand-asset payloads). */
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  generationCount: number;
  thumbnail?: string;
  hasInstructions: boolean;
  brandAssetCount: number;
}

/** Full project (instructions + brand assets), for editing/generation context. */
export interface ProjectDetail extends Project {
  generationCount: number;
  thumbnail?: string;
}
