import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateProjectDto, UpdateProjectDto } from './dto/projects.dto';
import { Project, ProjectDetail, ProjectSummary } from './projects.types';
import { DEFAULT_OWNER } from '../common/owner';

/** Stored project = brand kit + lightweight generation counters. */
type ProjectRecord = Project & { generationCount: number; thumbnail?: string };

/**
 * Projects = per-product/campaign workspaces with a brand kit (instructions +
 * reference assets) the generation pipeline injects so outputs are on-brand.
 *
 * Pure in-memory store (no dependency on generation): the pipeline calls
 * `recordGeneration` on success to keep counts/thumbnail fresh. Swap for a DB +
 * per-merchant scoping later.
 */
@Injectable()
export class ProjectsService {
  private readonly store = new Map<string, ProjectRecord>();
  /** Catch-all workspace id; generations without a project land here. */
  private readonly defaultId: string;

  constructor() {
    for (const name of ['شاور جل', 'شامبو', 'شنطة سفر']) {
      const now = new Date().toISOString();
      const id = randomUUID();
      this.store.set(id, {
        id,
        ownerId: DEFAULT_OWNER,
        name,
        brandAssets: [],
        generationCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    // A single always-present default workspace so a generation created without
    // a project is still organized (never orphaned) — hidden from the project
    // list, surfaced via the global asset library and a future "Uncategorized".
    const now = new Date().toISOString();
    this.defaultId = randomUUID();
    this.store.set(this.defaultId, {
      id: this.defaultId,
      ownerId: DEFAULT_OWNER,
      name: 'عام',
      brandAssets: [],
      generationCount: 0,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Id of the catch-all workspace for project-less generations. */
  defaultProjectId(): string {
    return this.defaultId;
  }

  create(dto: CreateProjectDto, ownerId: string): ProjectDetail {
    const now = new Date().toISOString();
    const record: ProjectRecord = {
      id: randomUUID(),
      ownerId,
      name: dto.name.trim(),
      instructions: dto.instructions?.trim() || undefined,
      brandAssets: dto.brandAssets ?? [],
      generationCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(record.id, record);
    return this.detail(record);
  }

  list(ownerId: string): ProjectSummary[] {
    return Array.from(this.store.values())
      .filter((p) => p.ownerId === ownerId)
      .filter((p) => !p.isDefault) // the default workspace isn't a user project
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => this.summarize(p));
  }

  get(id: string, ownerId: string): ProjectDetail {
    return this.detail(this.require(id, ownerId));
  }

  /**
   * Project for generation context — undefined instead of throwing. Owner-scoped
   * so a project is only visible to its owner. Called server-side by the
   * generation pipeline, which passes the owning job's ownerId.
   */
  tryGet(id: string, ownerId: string): Project | undefined {
    const project = this.store.get(id);
    if (!project || project.ownerId !== ownerId) return undefined;
    return project;
  }

  update(id: string, dto: UpdateProjectDto, ownerId: string): ProjectDetail {
    const project = this.require(id, ownerId);
    const updated: ProjectRecord = {
      ...project,
      name: dto.name?.trim() ?? project.name,
      instructions:
        dto.instructions !== undefined
          ? dto.instructions.trim() || undefined
          : project.instructions,
      brandAssets: dto.brandAssets ?? project.brandAssets,
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return this.detail(updated);
  }

  remove(id: string, ownerId: string): void {
    const record = this.store.get(id);
    if (!record || record.ownerId !== ownerId) {
      throw new NotFoundException(`Project "${id}" not found.`);
    }
    if (record.isDefault) {
      throw new BadRequestException('Cannot delete the default workspace.');
    }
    this.store.delete(id);
  }

  /** Called by the generation pipeline when a project's job succeeds. */
  recordGeneration(projectId: string, thumbnailUrl?: string): void {
    const record = this.store.get(projectId);
    if (!record) return;
    record.generationCount += 1;
    if (thumbnailUrl) record.thumbnail = thumbnailUrl;
    this.store.set(projectId, record);
  }

  private require(id: string, ownerId: string): ProjectRecord {
    const project = this.store.get(id);
    if (!project || project.ownerId !== ownerId) {
      throw new NotFoundException(`Project "${id}" not found.`);
    }
    return project;
  }

  private summarize(p: ProjectRecord): ProjectSummary {
    return {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      generationCount: p.generationCount,
      thumbnail: p.thumbnail,
      hasInstructions: Boolean(p.instructions),
      brandAssetCount: p.brandAssets.length,
    };
  }

  private detail(p: ProjectRecord): ProjectDetail {
    return {
      id: p.id,
      ownerId: p.ownerId,
      name: p.name,
      instructions: p.instructions,
      brandAssets: p.brandAssets,
      generationCount: p.generationCount,
      thumbnail: p.thumbnail,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
