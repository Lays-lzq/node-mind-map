<script setup lang="ts">
import beianIcon from '@/assets/img/beian.png';

const currentYear = new Date().getFullYear();
</script>

<template>
    <footer class="site-footer">
        <span>© {{ currentYear }} L的奇思妙想</span>
        <span class="site-footer__dot">·</span>
        <span>Built with Vue 3 + Vite</span>
        <span class="site-footer__dot">·</span>
        <a
            class="site-footer__link"
            href="https://beian.miit.gov.cn/"
            rel="noreferrer"
            target="_blank"
        >
            苏ICP备2026044847号
        </a>
        <span class="site-footer__dot">·</span>
        <a
            class="site-footer__beian"
            href="https://beian.mps.gov.cn/#/query/webSearch?code=32028102004087"
            rel="noreferrer"
            target="_blank"
        >
            <img :src="beianIcon" alt="" class="site-footer__beian-icon" />
            苏公网安备32028102004087号
        </a>
    </footer>
</template>

<style scoped lang="scss">
.site-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 24px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.65);
    border-top: 1px solid rgba(255, 255, 255, 0.1);

    &__dot {
        opacity: 0.5;
    }

    &__link,
    &__beian {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: inherit;
        text-decoration: none;
        transition: color 0.2s;

        &:hover {
            color: rgba(255, 255, 255, 0.9);
        }
    }

    &__beian-icon {
        width: 16px;
        height: 16px;
        object-fit: contain;
    }
}
</style>
