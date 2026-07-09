<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
    <header class="site-header">
        <router-link to="/" class="site-header__brand">
            <div class="site-header__brand-icon">L</div>
            <span class="site-header__brand-text">L的奇思妙想</span>
        </router-link>
        <nav class="site-header__nav">
            <router-link
                to="/"
                class="site-header__nav-link"
                :class="{ 'site-header__nav-link--active': route.name === 'Home' }"
            >
                项目
            </router-link>
            <router-link
                to="/about"
                class="site-header__nav-link"
                :class="{ 'site-header__nav-link--active': route.name === 'About' }"
            >
                关于我
            </router-link>
        </nav>
    </header>
</template>

<style scoped lang="scss">
$ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
$ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1);

@keyframes site-header-in {
    from {
        opacity: 0;
        transform: translateY(-8px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.site-header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 32px;
    backdrop-filter: blur(12px);
    background: rgba(255, 255, 255, 0.08);
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    animation: site-header-in 0.85s $ease-out-expo both;

    &__brand {
        display: flex;
        align-items: center;
        gap: 12px;
        text-decoration: none;
    }

    &__brand-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        font-size: 20px;
        font-weight: 700;
        color: #667eea;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 10px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    }

    &__brand-text {
        font-size: 18px;
        font-weight: 600;
        letter-spacing: 1px;
        color: #fff;
    }

    &__nav {
        display: flex;
        gap: 24px;
    }

    &__nav-link {
        font-size: 14px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.72);
        text-decoration: none;
        transition: color 0.2s $ease-out-soft;

        &:hover,
        &--active {
            color: #fff;
        }
    }
}

@media (max-width: 640px) {
    .site-header {
        padding: 16px 20px;

        &__brand-text {
            font-size: 16px;
        }
    }
}

@media (prefers-reduced-motion: reduce) {
    .site-header {
        animation: none;
    }
}
</style>
