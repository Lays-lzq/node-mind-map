import type { Component } from 'vue';
import { Connection, StarFilled } from '@element-plus/icons-vue';

const projectIconMap: Record<string, Component> = {
    brain: Connection,
    star: StarFilled
};

export function resolveProjectIcon(icon: string): Component | null {
    return projectIconMap[icon.toLowerCase()] ?? null;
}
