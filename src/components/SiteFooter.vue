<script setup lang="ts">
const currentYear = new Date().getFullYear();
</script>

<template>
    <footer class="site-footer">
        <span>© {{ currentYear }} L的奇思妙想</span>
        <span class="site-footer__dot">·</span>
        <span>Built with Vue 3 + Vite</span>
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
}
</style>
