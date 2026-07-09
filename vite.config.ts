import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig((config) => {
    const pathResolve = (dir: string) => resolve(__dirname, '.', dir);
    const alias: Record<string, string> = {
        '/@': pathResolve('./src/'),
        '@': pathResolve('./src/')
    };
    const env = loadEnv(config.mode, process.cwd());
    const apiBaseUrl = env.VITE_API_BASE_URL || '/api';
    const useLocalProxy =
        apiBaseUrl.startsWith('/') && Boolean(env.VITE_API_PROXY_TARGET);

    return {
        plugins: [
            vue(),
            AutoImport({
                include: [/\.vue$/, /\.vue\?vue/, /\.ts/],
                imports: ['vue', 'vue-router'],
                dts: true
            }),
            Components({
                resolvers: [ElementPlusResolver({ importStyle: 'sass' })],
                dts: true
            })
        ],
        resolve: { alias },
        server: {
            port: +(env.VITE_PORT || 8100),
            host: true,
            ...(useLocalProxy
                ? {
                      proxy: {
                          '/api': {
                              target: env.VITE_API_PROXY_TARGET,
                              changeOrigin: true
                          }
                      }
                  }
                : {})
        },
        build: {
            outDir: 'dist',
            chunkSizeWarningLimit: 1500,
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (!id.includes('node_modules')) return;
                        if (id.includes('konva') || id.includes('vue-konva')) {
                            return 'konva-vendor';
                        }
                        if (id.includes('element-plus')) {
                            return 'element-plus';
                        }
                        if (id.includes('vue') || id.includes('vue-router') || id.includes('@vue')) {
                            return 'vue-vendor';
                        }
                    }
                }
            }
        }
    };
});
