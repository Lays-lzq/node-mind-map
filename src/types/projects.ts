export type ProjectStatus = 'live' | 'wip' | 'archived';

export interface Project {
    id: string;
    name: string;
    description: string;
    tags: string[];
    status: ProjectStatus;
    icon: string;
    accent: string;
    route?: { name: string };
    externalUrl?: string;
}

export const statusLabel: Record<ProjectStatus, string> = {
    live: '在线',
    wip: '开发中',
    archived: '归档'
};
