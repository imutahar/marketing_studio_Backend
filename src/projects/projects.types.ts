export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  generationCount: number;
  /** Most recent generated output (for the sidebar/cover thumbnail). */
  thumbnail?: string;
}
