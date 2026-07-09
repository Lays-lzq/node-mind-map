import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { setAppInstance } from '@/utils/appContext';

import '@/styles/base.scss';

const app = createApp(App);

setAppInstance(app);
app.use(router);

router.isReady().then(() => {
    app.mount('#app');
});
