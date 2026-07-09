export interface ContactItem {
    label: string;
    value: string;
    href?: string;
}

export interface WorkExperience {
    company: string;
    period: string;
    role: string;
    department: string;
    highlights: string[];
}

export interface ProjectExperience {
    name: string;
    period: string;
    stack: string[];
    description: string;
    highlights: string[];
}

export interface SkillGroup {
    category: string;
    items: string[];
}

export interface Profile {
    name: string;
    nickname: string;
    title: string;
    location: string;
    education: string;
    avatar: string;
    summary: string[];
    contacts: ContactItem[];
    skills: SkillGroup[];
    workExperience: WorkExperience[];
    projectExperience: ProjectExperience[];
}
